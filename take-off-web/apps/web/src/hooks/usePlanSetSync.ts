import { useCallback, useEffect, useRef } from 'react';
import type { PlanSet } from '../types';
import { api } from '../lib/api';
import { mupdfController } from '../utils/mupdfController';
import { useRetryBackoff } from './useRetryBackoff';
import type { SyncStatus } from './useShapeSync';

// Upload newly-added PlanSet PDFs to R2 + register them in D1.
// First render after a projectId change primes snapshots without uploading
// (hydration path: those planSets already live on the server).
//
// `onR2KeyResolved` lets the caller stamp the registered file_key back onto
// the PlanSet in app state (via the Immer-backed history `set` API), so the
// "Save Project" ZIP exporter — which reads each plan set's __r2_key to
// serialize r2_key into the snapshot — sees newly uploaded plans.

export function usePlanSetSync(
  projectId: string | null,
  planSets: PlanSet[],
  onR2KeyResolved?: (planSetId: string, fileKey: string) => void,
): SyncStatus {
  const lastProjectId = useRef<string | null>(null);
  // Per-project dedup state. `seen` covers planSets we don't need to (re)upload;
  // `r2Keys` remembers the R2 file_key we got back for each upload so we don't
  // try to mutate the (frozen) Immer-backed PlanSet to stash it.
  const seen = useRef<Set<string>>(new Set());
  const inflight = useRef<Set<string>>(new Set());
  const r2Keys = useRef<Map<string, string>>(new Map());
  // file_key minted for a plan set's in-progress upload. Reused across
  // retries: POST /pdfs is idempotent on (project_id, r2_key), so if a
  // registration committed but its response was lost, the retry re-registers
  // the SAME key instead of minting a fresh one and inserting a duplicate
  // pdfs row (which hydrated as the same plan twice and inflated totalPages).
  const pendingKeys = useRef<Map<string, string>>(new Map());
  // Stash the latest callback so callers can pass an inline function without
  // having to memoise it — we don't want it to trigger an effect re-run.
  const onR2KeyResolvedRef = useRef(onR2KeyResolved);
  onR2KeyResolvedRef.current = onR2KeyResolved;
  // Same retry pattern as useScaleSync / useShapeSync. A transient R2
  // upload or /api/projects/:id/pdfs failure should not strand the PDF in
  // local-only state; a failed attempt wakes the effect for another pass
  // after an exponential backoff.
  const backoff = useRetryBackoff();

  useEffect(() => {
    if (!projectId) {
      // Detached: forget the old project and orphan in-flight uploads.
      if (lastProjectId.current !== null) {
        lastProjectId.current = null;
        seen.current = new Set();
        inflight.current = new Set();
        r2Keys.current = new Map();
        pendingKeys.current = new Map();
      }
      return;
    }

    if (projectId !== lastProjectId.current) {
      seen.current = new Set(planSets.map((p) => p.id));
      inflight.current = new Set();
      r2Keys.current = new Map();
      pendingKeys.current = new Map();
      backoff.reset();
      lastProjectId.current = projectId;
      return;
    }

    // Bind this pass and its completions to THIS project's state; an upload
    // for the previous project that settles after a switch only touches the
    // discarded sets/maps.
    const seenIds = seen.current;
    const inflightIds = inflight.current;
    const keysById = r2Keys.current;
    const pendingById = pendingKeys.current;
    const isCurrent = () => seenIds === seen.current;

    // Forget failed uploads for plan sets that were removed meanwhile.
    const liveIds = new Set(planSets.map((p) => p.id));
    backoff.prune((key) => {
      const id = key.slice('plan:'.length);
      return inflightIds.has(id) || (liveIds.has(id) && !seenIds.has(id));
    });

    for (const set of planSets) {
      if (seenIds.has(set.id)) continue;
      if (inflightIds.has(set.id)) continue;
      if (backoff.isBackingOff(`plan:${set.id}`)) continue;
      if (keysById.has(set.id)) {
        // Already uploaded earlier in this session — nothing to do.
        seenIds.add(set.id);
        continue;
      }
      if (!set.file) {
        // No bytes locally and no key on server — nothing we can upload.
        seenIds.add(set.id);
        continue;
      }

      inflightIds.add(set.id);

      (async () => {
        let ok = false;
        try {
          let file_key = pendingById.get(set.id);
          if (!file_key) {
            ({ file_key } = await api.projects.requestUploadUrl(projectId, set.name));
            pendingById.set(set.id, file_key);
          }
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

          keysById.set(set.id, file_key);
          pendingById.delete(set.id);
          seenIds.add(set.id);
          // Propagate into app state so exportProjectToZip can serialize
          // r2_key on plan sets that were uploaded mid-session, not only
          // those rehydrated from the server.
          if (isCurrent()) onR2KeyResolvedRef.current?.(set.id, file_key);
          ok = true;
        } catch (e) {
          console.error('sync: planSet upload failed', set.id, e);
        } finally {
          inflightIds.delete(set.id);
          if (isCurrent()) {
            if (ok) backoff.succeeded(`plan:${set.id}`);
            else backoff.failed(`plan:${set.id}`);
          }
        }
      })();
    }
  }, [projectId, planSets, backoff.tick]);

  // True when every plan set added this session has been uploaded and
  // registered: nothing unsent, in flight or waiting to retry.
  const planSetsRef = useRef(planSets);
  planSetsRef.current = planSets;
  const isIdle = useCallback(
    () =>
      lastProjectId.current === null ||
      (inflight.current.size === 0 &&
        !backoff.hasPendingFailures() &&
        planSetsRef.current.every((s) => seen.current.has(s.id) || r2Keys.current.has(s.id) || !s.file)),
    [backoff]
  );
  return { isIdle };
}
