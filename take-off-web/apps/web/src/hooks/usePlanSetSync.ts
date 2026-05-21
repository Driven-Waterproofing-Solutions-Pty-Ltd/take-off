import { useEffect, useRef } from 'react';
import type { PlanSet } from '../types';
import { api } from '../lib/api';
import { mupdfController } from '../utils/mupdfController';

// Upload newly-added PlanSet PDFs to R2 + register them in D1.
// First render after a projectId change primes snapshots without uploading
// (hydration path: those planSets already live on the server).
//
// PDF metadata stored on the planSet so we can re-resolve the R2 key later:
//   (planSet as any).__r2_key  — set after successful register

interface PlanSetWithR2 extends PlanSet {
  __r2_key?: string;
}

export function usePlanSetSync(projectId: string | null, planSets: PlanSet[]): void {
  const lastProjectId = useRef<string | null>(null);
  const seen = useRef<Set<string>>(new Set());
  const inflight = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!projectId) return;

    if (projectId !== lastProjectId.current) {
      seen.current = new Set(planSets.map((p) => p.id));
      inflight.current = new Set();
      lastProjectId.current = projectId;
      return;
    }

    for (const set of planSets as PlanSetWithR2[]) {
      if (seen.current.has(set.id)) continue;
      if (inflight.current.has(set.id)) continue;
      if (!set.file) {
        // No bytes locally and no key on server — nothing we can upload.
        seen.current.add(set.id);
        continue;
      }
      if (set.__r2_key) {
        // Already uploaded (e.g. re-add from same session).
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

          set.__r2_key = file_key;
          seen.current.add(set.id);
        } catch (e) {
          console.error('sync: planSet upload failed', set.id, e);
        } finally {
          inflight.current.delete(set.id);
        }
      })();
    }
  }, [projectId, planSets]);
}
