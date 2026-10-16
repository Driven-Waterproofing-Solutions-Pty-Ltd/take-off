import { useCallback, useEffect, useRef } from 'react';
import type { LegendSettings, ProjectData, ScaleCalibration, Unit } from '../types';
import { api } from '../lib/api';
import { useRetryBackoff } from './useRetryBackoff';
import type { SyncStatus } from './useShapeSync';

// Push per-page scale + legend changes to the worker so area/linear/arc tools
// can persist and exported markups keep the user's layout across reloads.
// Scale uses the manual-calibration endpoint with a synthetic 1-pixel/X-unit
// input (no UI for picking presets at the API boundary — the canvas already
// knows the pixelsPerUnit). Legend posts the LegendSettings JSON as-is.

function scaleKey(s: ScaleCalibration): string {
  return s.isSet ? `${s.pixelsPerUnit.toFixed(6)}:${s.unit}` : 'unset';
}

function legendKey(l: LegendSettings | undefined): string {
  if (!l) return 'unset';
  return `${l.x.toFixed(2)}:${l.y.toFixed(2)}:${l.scale.toFixed(3)}:${l.visible ?? true}`;
}

// The api helper throws `${status} ${body}`; pull out a 4xx's JSON `error`.
function rejectionMessage(e: unknown): string | null {
  const text = e instanceof Error ? e.message : String(e);
  const m = /^4\d\d\s+(.*)$/s.exec(text);
  if (!m) return null;
  try {
    const parsed = JSON.parse(m[1]) as { error?: unknown };
    return typeof parsed.error === 'string' ? parsed.error : m[1];
  } catch {
    return m[1];
  }
}

export interface ScaleSyncStatus extends SyncStatus {
  /**
   * True while `pageIndex`'s local calibration hasn't been accepted by the
   * worker (unsent, in flight, waiting to retry, or refused).
   */
  isPagePending: (pageIndex: number) => boolean;
}

export function useScaleSync(
  projectId: string | null,
  projectData: ProjectData,
  // Called once per distinct refusal (4xx) of a page's calibration push —
  // e.g. the worker refusing a recalibration that would mix units or
  // mis-price an assembly — so the user learns the server kept the old scale.
  onScaleRejected?: (pageIndex: number, message: string) => void,
  // Called after a page's calibration (or its removal) has synced, so
  // writes held behind it (see isPagePending) can go out.
  onScaleSynced?: () => void
): ScaleSyncStatus {
  const onScaleRejectedRef = useRef(onScaleRejected);
  onScaleRejectedRef.current = onScaleRejected;
  const onScaleSyncedRef = useRef(onScaleSynced);
  onScaleSyncedRef.current = onScaleSynced;
  const projectDataRef = useRef(projectData);
  projectDataRef.current = projectData;
  const lastRejection = useRef<Map<number, string>>(new Map());
  const lastProjectId = useRef<string | null>(null);
  const snapshots = useRef<Map<number, string>>(new Map());
  const legendSnapshots = useRef<Map<number, string>>(new Map());
  const nameSnapshots = useRef<Map<number, string>>(new Map());
  const inflight = useRef<Set<number>>(new Set());
  const legendInflight = useRef<Set<number>>(new Set());
  const nameInflight = useRef<Set<number>>(new Set());
  // Mirror the useShapeSync pattern: refs don't trigger re-renders, so a
  // transient failure (e.g. network blip) would leave the page calibrated
  // only in the browser. Every settled push wakes the effect so the next
  // pass retries against the still-mismatched snapshot — failures after an
  // exponential backoff (the worker can refuse a recalibration with a 400,
  // and retrying that immediately would loop forever).
  const backoff = useRetryBackoff();

  useEffect(() => {
    if (!projectId) {
      // Detached: forget the old project (re-opening it re-primes) and
      // orphan any in-flight completions.
      if (lastProjectId.current !== null) {
        lastProjectId.current = null;
        snapshots.current = new Map();
        legendSnapshots.current = new Map();
        nameSnapshots.current = new Map();
        inflight.current = new Set();
        legendInflight.current = new Set();
        nameInflight.current = new Set();
      }
      return;
    }

    if (projectId !== lastProjectId.current) {
      // Prime from server state.
      snapshots.current = new Map();
      legendSnapshots.current = new Map();
      nameSnapshots.current = new Map();
      inflight.current = new Set();
      legendInflight.current = new Set();
      nameInflight.current = new Set();
      backoff.reset();
      for (const k of Object.keys(projectData)) {
        const i = Number(k);
        snapshots.current.set(i, scaleKey(projectData[i].scale));
        legendSnapshots.current.set(i, legendKey(projectData[i].legend));
        nameSnapshots.current.set(i, projectData[i].name ?? '');
      }
      lastProjectId.current = projectId;
      return;
    }

    // Bind this pass and its completions to THIS project's maps. Keys are
    // page indexes, so a push for the previous project settling after a
    // switch would otherwise mark the new project's page as synced (or
    // unlock its in-flight push); a project switch swaps in fresh maps and
    // stale completions only touch the discarded ones.
    const scaleSnaps = snapshots.current;
    const legendSnaps = legendSnapshots.current;
    const nameSnaps = nameSnapshots.current;
    const scaleInflight = inflight.current;
    const legendInflightSet = legendInflight.current;
    const nameInflightSet = nameInflight.current;
    const isCurrent = () => scaleSnaps === snapshots.current;
    const settle = (key: string, ok: boolean) => {
      if (!isCurrent()) return;
      if (ok) backoff.succeeded(key);
      else backoff.failed(key);
    };

    // A failed key whose diff has since disappeared (e.g. the user undid a
    // recalibration the worker refused) has nothing left to retry; forget it
    // so isIdle() can clear, and let a repeat of the same refusal toast again.
    const forgotten = backoff.prune((key) => {
      const [kind, index] = key.split(':');
      const pageIndex = Number(index);
      const page = projectData[pageIndex];
      if (!page) return false;
      if (kind === 'scale') {
        if (scaleInflight.has(pageIndex)) return true;
        if (page.scale?.isSet) return scaleSnaps.get(pageIndex) !== scaleKey(page.scale);
        const prevKey = scaleSnaps.get(pageIndex);
        return !!page.scale && prevKey !== undefined && prevKey !== 'unset';
      }
      if (kind === 'legend') {
        if (legendInflightSet.has(pageIndex)) return true;
        return !!page.legend && legendSnaps.get(pageIndex) !== legendKey(page.legend);
      }
      if (kind === 'name') {
        if (nameInflightSet.has(pageIndex)) return true;
        return (page.name ?? '') !== (nameSnaps.get(pageIndex) ?? '');
      }
      return true;
    });
    for (const key of forgotten) {
      if (key.startsWith('scale:')) lastRejection.current.delete(Number(key.slice('scale:'.length)));
    }

    for (const k of Object.keys(projectData)) {
      const pageIndex = Number(k);
      const page = projectData[pageIndex];

      // --- Scale ---
      const scale = page.scale;
      if (scale?.isSet) {
        const key = scaleKey(scale);
        const retryKey = `scale:${pageIndex}`;
        if (
          scaleSnaps.get(pageIndex) !== key &&
          !scaleInflight.has(pageIndex) &&
          !backoff.isBackingOff(retryKey)
        ) {
          // We don't have two known points; pass synthetic ones so the worker
          // re-derives the same pixelsPerUnit (distance(p1,p2) / real_distance).
          // distance = pixelsPerUnit, real_distance = 1 → ppu / 1 = ppu. ✅
          scaleInflight.add(pageIndex);
          api.scale
            .manual(
              projectId,
              pageIndex,
              { x: 0, y: 0 },
              { x: scale.pixelsPerUnit, y: 0 },
              1,
              scale.unit as Unit
            )
            .then(() => {
              scaleSnaps.set(pageIndex, key);
              lastRejection.current.delete(pageIndex);
              return true;
            })
            .catch((e) => {
              console.error('sync: scale push failed', pageIndex, e);
              const reason = rejectionMessage(e);
              if (reason && isCurrent() && lastRejection.current.get(pageIndex) !== reason) {
                lastRejection.current.set(pageIndex, reason);
                onScaleRejectedRef.current?.(pageIndex, reason);
              }
              return false;
            })
            .then((ok) => {
              scaleInflight.delete(pageIndex);
              settle(retryKey, ok);
              if (ok && isCurrent()) onScaleSyncedRef.current?.();
            });
        }
      } else if (scale) {
        // Calibration undone (or otherwise cleared) after it had synced:
        // persist the unset state, otherwise a reload resurrects the old
        // scale and server-side measurements keep using it.
        const retryKey = `scale:${pageIndex}`;
        const prevKey = scaleSnaps.get(pageIndex);
        if (
          prevKey !== undefined &&
          prevKey !== 'unset' &&
          !scaleInflight.has(pageIndex) &&
          !backoff.isBackingOff(retryKey)
        ) {
          scaleInflight.add(pageIndex);
          api.scale
            .clear(projectId, pageIndex)
            .then(() => {
              scaleSnaps.set(pageIndex, 'unset');
              return true;
            })
            .catch((e) => {
              console.error('sync: scale clear failed', pageIndex, e);
              return false;
            })
            .then((ok) => {
              scaleInflight.delete(pageIndex);
              settle(retryKey, ok);
              if (ok && isCurrent()) onScaleSyncedRef.current?.();
            });
        }
      }

      // --- Legend ---
      const legend = page.legend;
      if (legend) {
        const lk = legendKey(legend);
        const retryKey = `legend:${pageIndex}`;
        if (
          legendSnaps.get(pageIndex) !== lk &&
          !legendInflightSet.has(pageIndex) &&
          !backoff.isBackingOff(retryKey)
        ) {
          legendInflightSet.add(pageIndex);
          api.legend
            .set(projectId, pageIndex, legend)
            .then(() => {
              legendSnaps.set(pageIndex, lk);
              return true;
            })
            .catch((e) => {
              console.error('sync: legend push failed', pageIndex, e);
              return false;
            })
            .then((ok) => {
              legendInflightSet.delete(pageIndex);
              settle(retryKey, ok);
            });
        }
      }

      // --- Page name (sidebar inline rename) ---
      const name = page.name ?? '';
      const prevName = nameSnaps.get(pageIndex) ?? '';
      const nameRetryKey = `name:${pageIndex}`;
      if (
        name !== prevName &&
        !nameInflightSet.has(pageIndex) &&
        !backoff.isBackingOff(nameRetryKey)
      ) {
        nameInflightSet.add(pageIndex);
        api.pageName
          .set(projectId, pageIndex, name)
          .then(() => {
            nameSnaps.set(pageIndex, name);
            return true;
          })
          .catch((e) => {
            console.error('sync: page name push failed', pageIndex, e);
            return false;
          })
          .then((ok) => {
            nameInflightSet.delete(pageIndex);
            settle(nameRetryKey, ok);
          });
      }
    }
  }, [projectId, projectData, backoff.tick]);

  const isIdle = useCallback(
    () =>
      inflight.current.size === 0 &&
      legendInflight.current.size === 0 &&
      nameInflight.current.size === 0 &&
      !backoff.hasPendingFailures(),
    [backoff]
  );
  // useShapeSync holds a page's derived writes (recomputed shape values,
  // retagged item units and depths) while this is true. The shape PUT
  // stores the client's value, so sending them beside a recalibration the
  // worker then refused left D1 with the old scale and new-scale quantities.
  const isPagePending = useCallback((pageIndex: number) => {
    if (lastProjectId.current === null) return false;
    if (inflight.current.has(pageIndex)) return true;
    const scale = projectDataRef.current[pageIndex]?.scale;
    if (!scale) return false;
    const prev = snapshots.current.get(pageIndex);
    if (scale.isSet) return prev !== scaleKey(scale);
    return prev !== undefined && prev !== 'unset';
  }, []);

  return { isIdle, isPagePending };
}
