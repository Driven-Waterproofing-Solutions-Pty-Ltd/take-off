import { useCallback, useEffect, useRef, useState } from 'react';

// Shared retry pacing for the local-state → REST sync hooks.
//
// The hooks diff local state against "last synced" snapshots inside an
// effect. Refs don't re-run effects, so each hook bumps a `tick` when an
// in-flight op settles. Doing that immediately on FAILURE turned any
// persistent error (a 400 the server will keep returning, e.g. a refused
// recalibration or an incompatible item) into a tight request loop. This
// keeps the immediate wake-up on success (so work deferred behind it — e.g.
// shapes waiting on their parent item — runs right away) but backs a failed
// key off exponentially: 1s, 2s, 4s … capped at 30s.

const BASE_DELAY_MS = 1_000;
const MAX_DELAY_MS = 30_000;

export interface RetryBackoff {
  /** Effect dependency: changes whenever the effect should run again. */
  tick: number;
  /** True while `key` is waiting out its backoff window. */
  isBackingOff: (key: string) => boolean;
  /** Clear `key`'s failure history and wake the effect now. */
  succeeded: (key: string) => void;
  /** Record a failure for `key` and wake the effect once its delay elapses. */
  failed: (key: string) => void;
  /** Wake the effect now without touching any key's state. */
  wake: () => void;
  /** Forget all keys (e.g. when the project changes). */
  reset: () => void;
  /** True while any key has an unresolved failure (waiting to retry). */
  hasPendingFailures: () => boolean;
}

export function useRetryBackoff(): RetryBackoff {
  const [tick, setTick] = useState(0);
  const failures = useRef<Map<string, number>>(new Map());
  const retryAt = useRef<Map<string, number>>(new Map());
  const timers = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());

  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const t of pending) clearTimeout(t);
      pending.clear();
    };
  }, []);

  const wake = useCallback(() => setTick((t) => t + 1), []);

  const isBackingOff = useCallback((key: string) => {
    const at = retryAt.current.get(key);
    return at !== undefined && at > Date.now();
  }, []);

  const succeeded = useCallback(
    (key: string) => {
      failures.current.delete(key);
      retryAt.current.delete(key);
      wake();
    },
    [wake]
  );

  const failed = useCallback(
    (key: string) => {
      const count = (failures.current.get(key) ?? 0) + 1;
      failures.current.set(key, count);
      const delay = Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** (count - 1));
      const at = Date.now() + delay;
      retryAt.current.set(key, at);
      const timer = setTimeout(() => {
        timers.current.delete(timer);
        // Open the window explicitly (timers can fire a hair early), unless a
        // newer failure has already rescheduled this key.
        if (retryAt.current.get(key) === at) retryAt.current.delete(key);
        wake();
      }, delay);
      timers.current.add(timer);
    },
    [wake]
  );

  const reset = useCallback(() => {
    failures.current = new Map();
    retryAt.current = new Map();
  }, []);

  const hasPendingFailures = useCallback(() => failures.current.size > 0, []);

  return { tick, isBackingOff, succeeded, failed, wake, reset, hasPendingFailures };
}
