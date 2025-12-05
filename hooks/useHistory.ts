import { useState, useCallback } from 'react';

interface HistoryState<T> {
  past: T[];
  present: T;
  future: T[];
}

interface UseHistoryReturn<T> {
  state: T;
  set: (newState: T) => void;
  setTransient: (newState: T) => void; // Updates present without pushing to past (sets snapshot)
  commit: () => void; // Commits the snapshot to past
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  clear: (initialState: T) => void;
}

export function useHistory<T>(initialState: T): UseHistoryReturn<T> {
  const [history, setHistory] = useState<HistoryState<T>>({
    past: [],
    present: initialState,
    future: []
  });

  // Snapshot stores the state *before* a transient sequence started.
  // If null, it means we are not in a transient sequence.
  const [snapshot, setSnapshot] = useState<T | null>(null);

  const canUndo = history.past.length > 0;
  const canRedo = history.future.length > 0;

  const undo = useCallback(() => {
    setHistory(curr => {
      if (curr.past.length === 0) return curr;

      const previous = curr.past[curr.past.length - 1];
      const newPast = curr.past.slice(0, curr.past.length - 1);

      return {
        past: newPast,
        present: previous,
        future: [curr.present, ...curr.future]
      };
    });
    setSnapshot(null); // Reset snapshot on undo
  }, []);

  const redo = useCallback(() => {
    setHistory(curr => {
      if (curr.future.length === 0) return curr;

      const next = curr.future[0];
      const newFuture = curr.future.slice(1);

      return {
        past: [...curr.past, curr.present],
        present: next,
        future: newFuture
      };
    });
    setSnapshot(null); // Reset snapshot on redo
  }, []);

  // Standard set: pushes current present to past, sets new present, clears future
  const set = useCallback((newState: T) => {
    setHistory(curr => {
      if (newState === curr.present) return curr;
      
      return {
        past: [...curr.past, curr.present],
        present: newState,
        future: []
      };
    });
    setSnapshot(null); // Reset snapshot
  }, []);

  // Transient set: updates present, but keeps the *original* present (before transient updates) in snapshot
  const setTransient = useCallback((newState: T) => {
    setHistory(curr => ({
      ...curr,
      present: newState
    }));
    
    setSnapshot(prev => prev === null ? history.present : prev);
  }, [history.present]);

  // Commit: takes the snapshot (if exists) and pushes IT to past, effectively treating the whole transient sequence as one step from Snapshot -> Present
  const commit = useCallback(() => {
    if (snapshot !== null) {
      setHistory(curr => ({
        past: [...curr.past, snapshot],
        present: curr.present,
        future: []
      }));
      setSnapshot(null);
    }
  }, [snapshot]);

  const clear = useCallback((initialState: T) => {
      setHistory({
          past: [],
          present: initialState,
          future: []
      });
      setSnapshot(null);
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
