import { useCallback, useEffect, useState } from 'react';
import { useHistory } from './useHistory';
import { TakeoffItem, ProjectData, PlanSet, ToolType, Unit } from '../types';
import { useToast } from '../contexts/ToastContext';
import { getAreaUnitFromLinear } from '../utils/geometry';
import {
  exportProjectToZip,
  importProjectFromZip,
} from '../utils/storage';
import { api } from '../lib/api';

// Web-port of the desktop useProjectManager hook.
// Same returned shape so App.tsx and downstream components don't change.
// Differences from desktop:
//   - "File path" is replaced by a project id (URL: /projects/:id)
//   - Autosave hits REST (debounced) instead of writing a SQLite file
//   - "Save to file" emits a JSON snapshot Blob (download), not a .takeoff zip
//   - "Load project" opens a JSON file picker (project state only — PDFs come from R2)

interface ProjectSnapshot {
  items: TakeoffItem[];
  projectData: ProjectData;
  planSets: PlanSet[];
  totalPages: number;
  projectName: string;
}

async function fetchProject(projectId: string): Promise<ProjectSnapshot | null> {
  try {
    const items = await api.items.list(projectId);
    const meta = (await api.projects.get(projectId)) as {
      project: { name: string };
      pages: Array<{
        page_index: number;
        scale_json: string;
        name: string | null;
        legend_json: string | null;
      }>;
      pdfs: Array<{
        id: string;
        name: string | null;
        r2_key: string;
        page_count: number;
        start_page_index: number;
        page_sizes: string;
      }>;
    };
    const projectData: ProjectData = {};
    for (const p of meta.pages) {
      projectData[p.page_index] = {
        scale: JSON.parse(p.scale_json),
        name: p.name ?? undefined,
        legend: p.legend_json ? JSON.parse(p.legend_json) : undefined,
      };
    }
    // Fetch each PDF blob and reconstruct File objects so MuPDF can render.
    // PlanSets are typically 1–3 per project; eager fetch is acceptable.
    const planSets: PlanSet[] = await Promise.all(
      meta.pdfs.map(async (pdf) => {
        let file: File;
        try {
          const blob = await api.projects.fetchPdfBlob(projectId, pdf.r2_key);
          file = new File([blob], pdf.name ?? 'plan.pdf', { type: 'application/pdf' });
        } catch (e) {
          console.error('fetchPdfBlob failed for', pdf.id, e);
          file = undefined as unknown as File;
        }
        return {
          id: pdf.id,
          file,
          name: pdf.name ?? 'plan.pdf',
          pageCount: pdf.page_count,
          startPageIndex: pdf.start_page_index,
          // Stamp the R2 key so usePlanSetSync skips re-uploading
          __r2_key: pdf.r2_key,
        } as PlanSet & { __r2_key: string };
      })
    );
    const totalPages = planSets.reduce((sum, p) => sum + p.pageCount, 0);
    return {
      items,
      projectData,
      planSets,
      totalPages,
      projectName: meta.project.name,
    };
  } catch (e) {
    console.error('fetchProject failed', e);
    return null;
  }
}

export const useProjectManager = (_isLicensed = true) => {
  const { addToast } = useToast();

  const {
    state: historyState,
    set: setHistory,
    setTransient: setHistoryTransient,
    commit: commitHistory,
    undo,
    redo,
    canUndo,
    canRedo,
    clear: clearHistory,
  } = useHistory<{
    items: TakeoffItem[];
    projectData: ProjectData;
    planSets: PlanSet[];
    totalPages: number;
  }>({
    items: [],
    projectData: {},
    planSets: [],
    totalPages: 0,
  });

  const { items, projectData, planSets, totalPages } = historyState;

  const [projectName, setProjectName] = useState('Untitled Project');
  const [projectId, setProjectId] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const [isInitializing, setIsInitializing] = useState(true);
  const [loadingMessage, setLoadingMessage] = useState('Loading project…');
  const [showImportConfirm, setShowImportConfirm] = useState(false);
  const [showNewProjectPrompt, setShowNewProjectPrompt] = useState(false);
  const [pendingImportFile, setPendingImportFile] = useState<File | null>(null);

  // Initial load — read ?project=ID from URL if present, otherwise just leave empty.
  useEffect(() => {
    const init = async () => {
      try {
        const url = new URL(window.location.href);
        const id = url.searchParams.get('project');
        if (id) {
          const snap = await fetchProject(id);
          if (snap) {
            const patched = snap.items.map((item) => {
              if (item.type === ToolType.AREA) {
                const correctedUnit = getAreaUnitFromLinear(item.unit as Unit);
                if (correctedUnit !== item.unit) return { ...item, unit: correctedUnit };
              }
              return item;
            });
            clearHistory({
              items: patched,
              projectData: snap.projectData,
              planSets: snap.planSets,
              totalPages: snap.totalPages,
            });
            setProjectId(id);
            setProjectName(snap.projectName);
            setLastSavedAt(new Date());
          }
        }
      } catch (e) {
        console.error('init failed', e);
        addToast('Failed to load project', 'error');
      } finally {
        setIsInitializing(false);
      }
    };
    init();
    // Intentionally omit deps; this runs once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // No autosave loop for project items in this slice — every measurement
  // tool already persists to D1 the moment it's invoked through /api/measure.
  // Project NAME is the only thing this hook tracks that needs a save call;
  // we save it on blur via setProjectNameAndSync.
  const setProjectNameAndSync = useCallback(
    async (next: string) => {
      setProjectName(next);
      // Currently no PATCH endpoint — name set at create time.
      // Add later when the rename flow is needed.
      void next;
    },
    []
  );

  // Re-hydrate items + per-page scale/legend from the server while preserving
  // local plan-set blobs (avoids re-fetching tens of MB of PDFs from R2 on
  // every refresh). The agent panel calls this after a run so canvas, markup
  // export and saved snapshot all see the server-side writes the agent made.
  const refreshProject = useCallback(async () => {
    if (!projectId) return;
    try {
      const snap = await fetchProject(projectId);
      if (!snap) return;
      const patched = snap.items.map((item) => {
        if (item.type === ToolType.AREA) {
          const correctedUnit = getAreaUnitFromLinear(item.unit as Unit);
          if (correctedUnit !== item.unit) return { ...item, unit: correctedUnit };
        }
        return item;
      });
      setHistory(draft => {
        draft.items = patched;
        draft.projectData = snap.projectData;
      });
    } catch (e) {
      console.error('refreshProject failed', e);
    }
  }, [projectId, setHistory]);

  const handleNewProjectRequest = () => setShowNewProjectPrompt(true);

  const handleNewProjectConfirmed = async (name: string) => {
    setShowNewProjectPrompt(false);
    try {
      const created = await api.projects.create(name);
      const url = new URL(window.location.href);
      url.searchParams.set('project', created.id);
      window.history.replaceState({}, '', url.toString());
      clearHistory({ items: [], projectData: {}, planSets: [], totalPages: 0 });
      setProjectId(created.id);
      setProjectName(name);
      setLastSavedAt(new Date());
      addToast(`Created project: ${name}`, 'success');
    } catch (e) {
      console.error('create failed', e);
      addToast('Failed to create project', 'error');
    }
  };

  const handleSaveProject = async () => {
    // __r2_key is only stamped after the R2 upload AND the pdfs-row
    // registration both resolve. If a user clicks Save before that finishes
    // for a freshly-uploaded plan, exportProjectToZip serializes r2_key as
    // undefined; importing the snapshot then has no key to fetch and the
    // drawing reopens as a blank placeholder. Block the save and tell them
    // to wait until plan sync completes.
    const stillUploading = planSets.find(
      (p) => !(p as PlanSet & { __r2_key?: string }).__r2_key
    );
    if (stillUploading) {
      addToast(
        `Plan "${stillUploading.name}" is still uploading — wait a moment and try Save again.`,
        'info'
      );
      return;
    }
    setIsSaving(true);
    try {
      const blob = await exportProjectToZip(
        items,
        projectData,
        planSets,
        totalPages,
        projectName,
        projectId ?? undefined
      );
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${projectName.replace(/[^a-z0-9]/gi, '_')}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      addToast('Project snapshot downloaded', 'success');
    } catch (e) {
      console.error('save failed', e);
      addToast('Failed to save project', 'error');
    } finally {
      setIsSaving(false);
    }
  };

  const handleLoadProjectClick = async () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json,.takeoff';
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return;
      setPendingImportFile(file);
      setShowImportConfirm(true);
    };
    input.click();
  };

  const handleImportConfirmed = async () => {
    if (!pendingImportFile) return;
    setShowImportConfirm(false);
    setIsInitializing(true);
    setLoadingMessage('Importing project…');
    try {
      const snap = await importProjectFromZip(pendingImportFile);

      // Rehydrate PDF bytes from R2 BEFORE detaching from any open cloud
      // project. The snapshot carries each plan set's r2_key plus the
      // sourceProjectId those keys belong to; we resolve them now so the
      // imported plan sets land in local state with real File objects
      // (otherwise the canvas can't render — see usePlanSetSync's "no
      // bytes locally and no key on server" branch). After detach there
      // would be no projectId to authorise the GETs against, so order
      // matters: fetch first, detach second.
      let planSets = snap.planSets;
      if (snap.sourceProjectId) {
        planSets = await Promise.all(
          snap.planSets.map(async (p) => {
            const key = (p as PlanSet & { __r2_key?: string }).__r2_key;
            if (!key || p.file) return p;
            try {
              const blob = await api.projects.fetchPdfBlob(snap.sourceProjectId!, key);
              const file = new File([blob], p.name ?? 'plan.pdf', { type: 'application/pdf' });
              return { ...p, file };
            } catch (e) {
              console.warn('snapshot PDF fetch failed', p.id, key, e);
              return p;
            }
          })
        );
      }

      // CRITICAL: detach from any currently-open cloud project. If we left
      // projectId pointing at it while clearHistory() replaced state with
      // the imported snapshot, useShapeSync would treat every item in the
      // old cloud project as removed and DELETE them, then POST the
      // imported items into the open cloud project.
      setProjectId(null);
      const url = new URL(window.location.href);
      url.searchParams.delete('project');
      window.history.replaceState({}, '', url.toString());

      clearHistory({
        items: snap.items,
        projectData: snap.projectData,
        planSets,
        totalPages: snap.totalPages,
      });
      setProjectName(snap.projectName);
      setLastSavedAt(new Date());
      addToast('Project imported (local only — save to persist)', 'success');
    } catch (e) {
      console.error('import failed', e);
      addToast('Failed to import project', 'error');
    } finally {
      setIsInitializing(false);
      setLoadingMessage('Loading project…');
      setPendingImportFile(null);
    }
  };

  return {
    // State
    projectName,
    items,
    projectData,
    planSets,
    totalPages,
    isSaving,
    lastSavedAt,
    isInitializing,
    loadingMessage,
    currentFilePath: projectId, // legacy field name — now project id
    showImportConfirm,
    showNewProjectPrompt,

    // Setters
    setProjectName: setProjectNameAndSync,
    setHistory,
    setHistoryTransient,
    commitHistory,
    setShowImportConfirm,
    // Web: the import flow uses a File, not a path. Accept and ignore the arg
    // so call sites copied from the desktop App.tsx still typecheck.
    setPendingImportPath: (_path?: string | null) => {},
    setShowNewProjectPrompt,

    // Actions
    undo,
    redo,
    canUndo,
    canRedo,
    handleNewProjectRequest,
    handleNewProjectConfirmed,
    handleSaveProject,
    handleLoadProjectClick,
    handleImportConfirmed,
    refreshProject,
  };
};
