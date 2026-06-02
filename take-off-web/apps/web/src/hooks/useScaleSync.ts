import { useEffect, useRef, useState } from 'react';
import type { LegendSettings, ProjectData, ScaleCalibration, Unit } from '../types';
import { api } from '../lib/api';

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

export function useScaleSync(projectId: string | null, projectData: ProjectData): void {
  const lastProjectId = useRef<string | null>(null);
  const snapshots = useRef<Map<number, string>>(new Map());
  const legendSnapshots = useRef<Map<number, string>>(new Map());
  const inflight = useRef<Set<number>>(new Set());
  const legendInflight = useRef<Set<number>>(new Set());
  // Mirror the useShapeSync pattern: refs don't trigger re-renders, so a
  // transient failure (e.g. network blip) would leave the page calibrated
  // only in the browser. Bumping this tick in every .finally() wakes the
  // effect so the next pass retries against the still-mismatched snapshot.
  const [tick, setTick] = useState(0);
  const retry = () => setTick((t) => t + 1);

  useEffect(() => {
    if (!projectId) return;

    if (projectId !== lastProjectId.current) {
      // Prime from server state.
      snapshots.current = new Map();
      legendSnapshots.current = new Map();
      inflight.current = new Set();
      legendInflight.current = new Set();
      for (const k of Object.keys(projectData)) {
        const i = Number(k);
        snapshots.current.set(i, scaleKey(projectData[i].scale));
        legendSnapshots.current.set(i, legendKey(projectData[i].legend));
      }
      lastProjectId.current = projectId;
      return;
    }

    for (const k of Object.keys(projectData)) {
      const pageIndex = Number(k);
      const page = projectData[pageIndex];

      // --- Scale ---
      const scale = page.scale;
      if (scale?.isSet) {
        const key = scaleKey(scale);
        if (snapshots.current.get(pageIndex) !== key && !inflight.current.has(pageIndex)) {
          // We don't have two known points; pass synthetic ones so the worker
          // re-derives the same pixelsPerUnit (distance(p1,p2) / real_distance).
          // distance = pixelsPerUnit, real_distance = 1 → ppu / 1 = ppu. ✅
          inflight.current.add(pageIndex);
          snapshots.current.set(pageIndex, key);
          api.scale
            .manual(
              projectId,
              pageIndex,
              { x: 0, y: 0 },
              { x: scale.pixelsPerUnit, y: 0 },
              1,
              scale.unit as Unit
            )
            .catch((e) => {
              snapshots.current.delete(pageIndex);
              console.error('sync: scale push failed', pageIndex, e);
            })
            .finally(() => {
              inflight.current.delete(pageIndex);
              retry();
            });
        }
      }

      // --- Legend ---
      const legend = page.legend;
      if (legend) {
        const lk = legendKey(legend);
        if (legendSnapshots.current.get(pageIndex) !== lk && !legendInflight.current.has(pageIndex)) {
          legendInflight.current.add(pageIndex);
          legendSnapshots.current.set(pageIndex, lk);
          api.legend
            .set(projectId, pageIndex, legend)
            .catch((e) => {
              legendSnapshots.current.delete(pageIndex);
              console.error('sync: legend push failed', pageIndex, e);
            })
            .finally(() => {
              legendInflight.current.delete(pageIndex);
              retry();
            });
        }
      }
    }
  }, [projectId, projectData, tick]);
}
