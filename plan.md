# Technical Specification: Memory-Efficient useHistory Hook

## Objective
Replace the current full-snapshot history system with a patch-based system using `immer`. This will significantly reduce memory usage by storing only the differences (patches) between states rather than duplicating the entire state tree for every undo/redo step.

## Proposed Solution
We will refactor `useHistory` to use `immer`'s `produceWithPatches`, `applyPatches`, and `Patch` types.

### 1. New Internal State Structure
Instead of `HistoryState<T>` storing `past: T[]`, it will store:
```typescript
interface HistoryEntry {
  patches: Patch[];
  inversePatches: Patch[];
}

interface HistoryState<T> {
  past: HistoryEntry[];
  present: T;
  future: HistoryEntry[];
}
```

### 2. API Changes
The `set` and `setTransient` functions will be overloaded to accept an Immer "recipe" (function) or a raw state (for backward compatibility, though less efficient).

**Old:**
```typescript
set: (newState: T) => void
```

**New:**
```typescript
type Updater<T> = (draft: T) => void | T;
set: (recipe: Updater<T> | T) => void
```

### 3. Logic Flow

#### `set(recipe)`
1.  Call `produceWithPatches(present, recipe)`.
2.  Receive `[nextState, patches, inversePatches]`.
3.  Push `{ patches, inversePatches }` to `past`.
4.  Update `present` to `nextState`.
5.  Clear `future`.

#### `undo()`
1.  Pop `lastEntry` from `past`.
2.  Update `present = applyPatches(present, lastEntry.inversePatches)`.
3.  Push `lastEntry` to `future`.

#### `redo()`
1.  Pop `nextEntry` from `future`.
2.  Update `present = applyPatches(present, nextEntry.patches)`.
3.  Push `nextEntry` to `past`.

#### `setTransient(recipe)` & `commit()`
*   **Transient Mode**: We will maintain a `transientAccumulator` ref or state that collects patches during transient updates.
*   **On `setTransient`**: Apply patches to `present`, add patches to accumulator.
*   **On `commit`**: Push the accumulated patches as a single entry to `past` and clear the accumulator.

### 4. Migration Strategy
*   **Install**: `npm install immer`
*   **Refactor Hook**: Rewrite `hooks/useHistory.ts`.
*   **Update Consumers**: Refactor usages in `useProjectManager.ts` and `App.tsx` to use the recipe pattern `draft => { ... }` instead of spread syntax `...state`.

## Implementation Guide

### Step 1: Install Dependencies
Run the following command to add Immer:
```bash
npm install immer
```

### Step 2: Refactor `hooks/useHistory.ts`
Replace the entire file with the new implementation.

**Key Implementation Details:**
*   Import `produceWithPatches`, `applyPatches`, `Patch`, `enablePatches` from `immer`.
*   Call `enablePatches()` at the top level.
*   Use `useRef` for `transientAccumulator` to avoid re-renders just for tracking patches? No, needs to be part of state or committed synchronously.
    *   *Correction*: If `setTransient` triggers a re-render (it does), we can store the accumulated patches in a `ref` since they are only committed explicitly. But `undo` during transient state?
    *   Current `undo` resets transient state (clears snapshot). In patch mode, we can just clear the accumulator and revert `present` using accumulated `inversePatches`.

### Step 3: Refactor Consumers
Update `hooks/useProjectManager.ts` and `App.tsx`.

**Pattern Change:**
*   **Before:**
    ```typescript
    setHistory({ ...historyState, items: [...items, newItem] });
    ```
*   **After:**
    ```typescript
    setHistory(draft => {
      draft.items.push(newItem);
    });
    ```

**Files to Modify:**
1.  `hooks/useProjectManager.ts` (~15 changes)
2.  `App.tsx` (~10 changes)

### Step 4: Verify
1.  Test adding items (undo/redo).
2.  Test modifying items (transient updates like dragging).
3.  Test importing/exporting projects (ensure state is correct).