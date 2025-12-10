import { useState, useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { save, open } from '@tauri-apps/plugin-dialog';
import { writeFile } from '@tauri-apps/plugin-fs';
import { useHistory } from './useHistory';
import { TakeoffItem, ProjectData, PlanSet, ToolType, Unit } from '../types';
import {
  saveProjectData,
  savePlanFile,
  loadProjectFromStorage,
  clearProjectData,
  exportProjectToZip,
  importProjectFromZip
} from '../utils/storage';
import { useToast } from '../contexts/ToastContext';
import { getAreaUnitFromLinear } from '../utils/geometry';

export const useProjectManager = (isLicensed: boolean) => {
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
    clear: clearHistory
  } = useHistory<{
    items: TakeoffItem[];
    projectData: ProjectData;
    planSets: PlanSet[];
    totalPages: number;
  }>({
    items: [],
    projectData: {},
    planSets: [],
    totalPages: 0
  });

  const { items, projectData, planSets, totalPages } = historyState;

  const [projectName, setProjectName] = useState("Untitled Project");
  const [isSaving, setIsSaving] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const [isInitializing, setIsInitializing] = useState(true);
  const [loadingMessage, setLoadingMessage] = useState("Loading Project...");
  const [currentFilePath, setCurrentFilePath] = useState<string | null>(null);
  const [pendingImportPath, setPendingImportPath] = useState<string | null>(null);
  const [showImportConfirm, setShowImportConfirm] = useState(false);
  const [showNewProjectPrompt, setShowNewProjectPrompt] = useState(false);

  // Load project from storage on initial load
  useEffect(() => {
    if (!isLicensed) return;

    const init = async () => {
      try {
        const state = await loadProjectFromStorage();
        if (state) {
          const patchedItems = state.items.map(item => {
            if (item.type === ToolType.AREA) {
              const correctedUnit = getAreaUnitFromLinear(item.unit as Unit);
              if (correctedUnit !== item.unit) {
                return { ...item, unit: correctedUnit };
              }
            }
            return item;
          });

          clearHistory({
            items: patchedItems,
            projectData: state.projectData,
            planSets: state.planSets,
            totalPages: state.totalPages
          });

          if (state.projectName) setProjectName(state.projectName);

          setLastSavedAt(new Date());
          addToast("Project loaded successfully", 'success');
        }
      } catch (e) {
        console.error("Failed to load project", e);
        addToast("Failed to load existing project", 'error');
      } finally {
        setIsInitializing(false);
      }
    };
    init();
  }, [isLicensed]);

  // Autosave
  useEffect(() => {
    if (isInitializing || !isLicensed) return;

    const saveData = async () => {
      setIsSaving(true);
      try {
        await saveProjectData(items, projectData, planSets, totalPages, projectName);
        setLastSavedAt(new Date());
      } catch (e) {
        console.error("Autosave failed", e);
      } finally {
        setIsSaving(false);
      }
    };

    const timeout = setTimeout(saveData, 1000);
    return () => clearTimeout(timeout);
  }, [items, projectData, totalPages, planSets.length, isInitializing, projectName, isLicensed]);

  const handleNewProjectRequest = () => setShowNewProjectPrompt(true);

  const handleNewProjectConfirmed = async (name: string) => {
    setShowNewProjectPrompt(false);
    await clearProjectData();
    clearHistory({ items: [], projectData: {}, planSets: [], totalPages: 0 });
    setProjectName(name);
    setCurrentFilePath(null);
    addToast(`Created project: ${name}`, 'success');
  };

  const handleSaveProject = async () => {
    setIsSaving(true);
    try {
      const blob = await exportProjectToZip(items, projectData, planSets, totalPages, projectName);
      const buffer = await blob.arrayBuffer();
      const uint8Array = new Uint8Array(buffer);

      let savePath = currentFilePath;

      if (!savePath) {
        const sanitizedName = projectName.replace(/[^a-z0-9]/gi, '_');
        savePath = await save({
          filters: [{
            name: 'Takeoff Project',
            extensions: ['takeoff']
          }],
          defaultPath: `${sanitizedName}.takeoff`
        });
      }

      if (savePath) {
        await writeFile(savePath, uint8Array);
        setCurrentFilePath(savePath);
        addToast("Project saved to file", 'success');
      }
    } catch (e) {
      console.error("Export failed", e);
      addToast("Failed to save project", 'error');
    } finally {
      setIsSaving(false);
    }
  };

  const handleLoadProjectClick = async () => {
    try {
      const selected = await open({
        multiple: false,
        filters: [{
          name: 'Takeoff Project',
          extensions: ['takeoff']
        }]
      });

      if (selected && typeof selected === 'string') {
        setPendingImportPath(selected);
        setShowImportConfirm(true);
      }
    } catch (e) {
      console.error("Failed to open file dialog", e);
    }
  };

  const handleImportConfirmed = async () => {
    if (!pendingImportPath) return;
    setShowImportConfirm(false);
    setIsInitializing(true);
    setLoadingMessage("Importing Project...");
    try {
      await clearProjectData();

      const data = await invoke<number[]>('read_file_binary', { path: pendingImportPath });
      const importData = new Uint8Array(data);

      const filename = pendingImportPath.split(/[\\/]/).pop() || "Project";
      const name = filename.replace(/\.[^/.]+$/, "");
      setCurrentFilePath(pendingImportPath);

      const state = await importProjectFromZip(importData);
      clearHistory({ items: state.items, projectData: state.projectData, planSets: state.planSets, totalPages: state.totalPages });

      const finalName = state.projectName || name;
      setProjectName(finalName);

      await saveProjectData(state.items, state.projectData, state.planSets, state.totalPages, finalName);
      for (const plan of state.planSets) {
        await savePlanFile(plan.id, plan.file);
      }
      setLastSavedAt(new Date());
      addToast("Project imported successfully", 'success');
    } catch (err) {
      console.error("Import failed", err);
      addToast("Failed to import project.", 'error');
    } finally {
      setIsInitializing(false);
      setLoadingMessage("Loading Project...");
      setPendingImportPath(null);
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
    currentFilePath,
    showImportConfirm,
    showNewProjectPrompt,

    // Setters
    setProjectName,
    setHistory,
    setHistoryTransient,
    commitHistory,
    setShowImportConfirm,
    setPendingImportPath,
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
  };
};