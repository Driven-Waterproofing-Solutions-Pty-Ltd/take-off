import { useState, useCallback, useRef } from 'react';
import { produceWithPatches, applyPatches, Patch, enablePatches, Draft } from 'immer';

// Enable patches plugin
enablePatches();

interface HistoryEntry {
  patches: Patch[];
  inversePatches: Patch[];
}

interface HistoryState<T> {
  past: HistoryEntry[];
  present: T;
  future: HistoryEntry[];
  transient?: { patches: Patch[], inversePatches: Patch[] } | null;
}

interface HistoryOptions {
  capacity?: number;
}

interface UseHistoryReturn<T> {
  state: T;
  set: (recipe: ((draft: Draft<T>) => void | T) | T) => void;
  setTransient: (recipe: ((draft: Draft<T>) => void | T) | T) => void;
  commit: () => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  clear: (initialState: T) => void;
}

export function useHistory<T>(initialState: T, options: HistoryOptions = {}): UseHistoryReturn<T> {
  const { capacity = 30 } = options;

  const [history, setHistory] = useState<HistoryState<T>>({
    past: [],
    present: initialState,
    future: [],
    transient: null
  });

  const canUndo = history.past.length > 0;
  const canRedo = history.future.length > 0;

  const undo = useCallback(() => {
    setHistory(curr => {
      if (curr.past.length === 0) return { ...curr, transient: null };

      const previousEntry = curr.past[curr.past.length - 1];
      const newPast = curr.past.slice(0, curr.past.length - 1);
      
      // Apply inverse patches to current state to go back
      const newPresent = applyPatches(curr.present, previousEntry.inversePatches);

      return {
        past: newPast,
        present: newPresent,
        future: [previousEntry, ...curr.future],
        transient: null
      };
    });
  }, []);

  const redo = useCallback(() => {
    setHistory(curr => {
      if (curr.future.length === 0) return { ...curr, transient: null };

      const nextEntry = curr.future[0];
      const newFuture = curr.future.slice(1);
      
      // Apply patches to current state to go forward
      const newPresent = applyPatches(curr.present, nextEntry.patches);

      return {
        past: [...curr.past, nextEntry],
        present: newPresent,
        future: newFuture,
        transient: null
      };
    });
  }, []);

  const set = useCallback((recipeOrNextState: ((draft: Draft<T>) => void | T) | T) => {
    setHistory(curr => {
      let nextState: T;
      let patches: Patch[];
      let inversePatches: Patch[];

      if (typeof recipeOrNextState === 'function') {
         // @ts-ignore
         [nextState, patches, inversePatches] = produceWithPatches(curr.present, recipeOrNextState);
      } else {
         // @ts-ignore
         [nextState, patches, inversePatches] = produceWithPatches(curr.present, () => recipeOrNextState);
      }
      
      if (patches.length === 0) return curr;

      let newPast = [...curr.past];
      
      // If we have pending transient patches, commit them first as a history entry
      // This ensures we don't lose the history of the transient actions if a hard set occurs
      if (curr.transient) {
          newPast.push(curr.transient);
      }

      const newEntry = { patches, inversePatches };
      newPast.push(newEntry);
      
      // Enforce capacity
      while (newPast.length > capacity) {
        newPast.shift();
      }

      return {
        past: newPast,
        present: nextState,
        future: [],
        transient: null
      };
    });
  }, [capacity]);

  const setTransient = useCallback((recipeOrNextState: ((draft: Draft<T>) => void | T) | T) => {
    setHistory(curr => {
        let nextState: T;
        let patches: Patch[];
        let inversePatches: Patch[];

        if (typeof recipeOrNextState === 'function') {
             // @ts-ignore
             [nextState, patches, inversePatches] = produceWithPatches(curr.present, recipeOrNextState);
        } else {
             // @ts-ignore
             [nextState, patches, inversePatches] = produceWithPatches(curr.present, () => recipeOrNextState);
        }
        
        if (patches.length === 0) return curr;

        // Accumulate patches
        const currentTransient = curr.transient || { patches: [], inversePatches: [] };
        
        const newTransient = {
            patches: [...currentTransient.patches, ...patches],
            // Inverse patches need to be prepended to maintain correct undo order (LIFO for undo)
            inversePatches: [...inversePatches, ...currentTransient.inversePatches]
        };

        return {
            ...curr,
            present: nextState,
            transient: newTransient
        };
    });
  }, []);

  const commit = useCallback(() => {
    setHistory(curr => {
        if (!curr.transient) return curr;

         const newPast = [...curr.past, curr.transient];
         
         // Enforce capacity
         if (newPast.length > capacity) {
             newPast.splice(0, newPast.length - capacity);
         }

         return {
             past: newPast,
             present: curr.present,
             future: [],
             transient: null
         };
    });
  }, [capacity]);

  const clear = useCallback((initialState: T) => {
    setHistory({
      past: [],
      present: initialState,
      future: [],
      transient: null
    });
  }, []);

  return {
    state: history.present,
    set,
    setTransient,
    commit,
    undo,
    redo,
    canUndo,
    canRedo,
    clear
  };
}