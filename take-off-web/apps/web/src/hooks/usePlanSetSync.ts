import { useEffect, useRef, useState } from 'react';
import type { PlanSet } from '../types';
import { api } from '../lib/api';
import { mupdfController } from '../utils/mupdfController';

// Upload newly-added PlanSet PDFs to R2 + register them in D1.
// First render after a projectId change primes snapshots without uploading
// (hydration path: those planSets already live on the server).

export function usePlanSetSync(projectId: string | null, planSets: PlanSet[]): void {
  const lastProjectId = useRef<string | null>(null);
  // Per-project dedup state. `seen` covers planSets we don't need to (re)upload;
  // `r2Keys` remembers the R2 file_key we got back for each upload so we don't
  // try to mutate the (frozen) Immer-backed PlanSet to stash it.
  const seen = useRef<Set<string>>(new Set());
  const inflight = useRef<Set<string>>(new Set());
  const r2Keys = useRef<Map<string, string>>(new Map());
  // Same retry-loop pattern as useScaleSync / useShapeSync. A transient R2
  // upload or /api/projects/:id/pdfs failure should not strand the PDF in
  // local-only state; bumping tick on every inflight completion wakes the
  // effect for another pass against the same plan set.
  const [tick, setTick] = useState(0);
  const retry = () => setTick((t) => t + 1);

  useEffect(() => {
    if (!projectId) return;

    if (projectId !== lastProjectId.current) {
      seen.current = new Set(planSets.map((p) => p.id));
      inflight.current = new Set();
      r2Keys.current = new Map();
      lastProjectId.current = projectId;
      return;
    }

    for (const set of planSets) {
      if (seen.current.has(set.id)) continue;
      if (inflight.current.has(set.id)) continue;
      if (r2Keys.current.has(set.id)) {
        // Already uploaded earlier in this session — nothing to do.
        seen.current.add(set.id);
        continue;
      }
      if (!set.file) {
        // No bytes locally and no key on server — nothing we can upload.
        seen.current.add(set.id);
        continue;
      }

      inflight.current.add(set.id);

      (async () => {
        try {
          const { file_key } = await api.projects.requestUploadUrl(projectId, set.name);
          const bytes = await set.file.arrayBuffer();
          await api.projects.uploadPdfBytes(projectId, file_key, bytes);

          // Page sizes — quick MuPDF probe so we don't have to re-render later.
          const sizes: Array<{ width: number; height: number }> = [];
          for (let i = 0; i < set.pageCount; i++) {
            try {
              const dim = mupdfController.getPageDimensions(i);
              sizes.push({ width: dim.width, height: dim.height });
            } catch {
              sizes.push({ width: 0, height: 0 });
            }
          }

          await api.projects.registerPdf(projectId, {
            file_key,
            name: set.name,
            page_count: set.pageCount,
            page_sizes: sizes,
            start_page_index: set.startPageIndex,
          });

          r2Keys.current.set(set.id, file_key);
          seen.current.add(set.id);
        } catch (e) {
          console.error('sync: planSet upload failed', set.id, e);
        } finally {
          inflight.current.delete(set.id);
          retry();
        }
      })();
    }
  }, [projectId, planSets, tick]);
}
