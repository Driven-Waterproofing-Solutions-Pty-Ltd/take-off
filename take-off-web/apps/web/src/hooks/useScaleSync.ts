import { useEffect, useRef } from 'react';
import type { ProjectData, ScaleCalibration, Unit } from '../types';
import { api } from '../lib/api';

// Push per-page scale changes to the worker so area/linear/arc tools can persist.
// Uses the manual-calibration endpoint with a synthetic 1-pixel/X-unit input
// (no UI for picking presets at the API boundary — the canvas already knows
// the pixelsPerUnit, we just need to convey it).

function scaleKey(s: ScaleCalibration): string {
  return s.isSet ? `${s.pixelsPerUnit.toFixed(6)}:${s.unit}` : 'unset';
}

export function useScaleSync(projectId: string | null, projectData: ProjectData): void {
  const lastProjectId = useRef<string | null>(null);
  const snapshots = useRef<Map<number, string>>(new Map());
  const inflight = useRef<Set<number>>(new Set());

  useEffect(() => {
    if (!projectId) return;

    if (projectId !== lastProjectId.current) {
      // Prime from server state.
      snapshots.current = new Map();
      inflight.current = new Set();
      for (const k of Object.keys(projectData)) {
        const i = Number(k);
        snapshots.current.set(i, scaleKey(projectData[i].scale));
      }
      lastProjectId.current = projectId;
      return;
    }

    for (const k of Object.keys(projectData)) {
      const pageIndex = Number(k);
      const scale = projectData[pageIndex].scale;
      if (!scale?.isSet) continue;
      const key = scaleKey(scale);
      if (snapshots.current.get(pageIndex) === key) continue;
      if (inflight.current.has(pageIndex)) continue;

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
        .finally(() => inflight.current.delete(pageIndex));
    }
  }, [projectId, projectData]);
}
