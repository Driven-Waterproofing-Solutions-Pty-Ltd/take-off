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

  // Load project from file logic
  const loadFromFile = useCallback(async (path: string) => {
    // Read and parse first to ensure validity before clearing existing data
    const data = await invoke<number[]>('read_file_binary', { path });
    const importData = new Uint8Array(data);
    const state = await importProjectFromZip(importData);

    // Now it's safe to clear and save
    await clearProjectData();

    const filename = path.split(/[\\/]/).pop() || "Project";
    const name = filename.replace(/\.[^/.]+$/, "");
    const finalName = state.projectName || name;

    await saveProjectData(state.items, state.projectData, state.planSets, state.totalPages, finalName);
    for (const plan of state.planSets) {
      await savePlanFile(plan.id, plan.file);
    }

    return { ...state, projectName: finalName };
  }, []);

  // Load project from storage or file on initial load
  useEffect(() => {
    if (!isLicensed) return;

    const init = async () => {
      try {
        let state = null;
        let loadedFilePath: string | null = null;
        let loadSource: 'file' | 'storage' = 'storage';

        // 1. Try to load from arguments
        try {
          const args = await invoke<string[]>('get_startup_args');
          console.log("Startup args:", args);
          
          // Find first argument that looks like a .takeoff file
          const fileArg = args.find(arg => arg.toLowerCase().endsWith('.takeoff'));
          
          if (fileArg) {
            console.log("Attempting to load from argument:", fileArg);
            state = await loadFromFile(fileArg);
            loadedFilePath = fileArg;
            loadSource = 'file';
          }
        } catch (argError) {
          console.error("Error checking startup args:", argError);
        }

        // 2. Fallback to storage if no file loaded
        if (!state) {
          state = await loadProjectFromStorage();
          loadSource = 'storage';
        }

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

          const nameToUse = state.projectName || (loadedFilePath ? loadedFilePath.split(/[\\/]/).pop()?.replace(/\.[^/.]+$/, "") : "Untitled Project");
          setProjectName(nameToUse || "Untitled Project");
          if (loadedFilePath) setCurrentFilePath(loadedFilePath);

          setLastSavedAt(new Date());
          addToast(loadSource === 'file' ? "Project opened from file" : "Project loaded successfully", 'success');
        }
      } catch (e) {
        console.error("Failed to load project", e);
        addToast("Failed to load project", 'error');
      } finally {
        setIsInitializing(false);
      }
    };
    init();
  }, [isLicensed, loadFromFile]);

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
      const state = await loadFromFile(pendingImportPath);
      
      setCurrentFilePath(pendingImportPath);
      
      clearHistory({ items: state.items, projectData: state.projectData, planSets: state.planSets, totalPages: state.totalPages });
      
      setProjectName(state.projectName);
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