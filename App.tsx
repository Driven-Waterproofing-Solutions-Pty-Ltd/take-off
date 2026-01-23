import React, { useState, useRef, useEffect } from 'react';
import { listen } from '@tauri-apps/api/event';

import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
// import { pdfjs } from 'react-pdf'; // Removed for MuPDF implementation
import Sidebar from './components/Sidebar';
import BlueprintCanvas, { BlueprintCanvasRef } from './components/BlueprintCanvas';
import Tools from './components/Tools';
import HelpModal from './components/HelpModal';
import NewItemModal from './components/NewItemModal';
import UploadModal from './components/UploadModal';
import PropertiesModal from './components/PropertiesModal';
import PromptModal from './components/PromptModal';
import ExportModal from './components/ExportModal';
import ConfirmModal from './components/ConfirmModal';
import EstimatesView from './components/EstimatesView';
import ThreeDView from './components/ThreeDView';
import PDFSearch from './components/PDFSearch';
import { ToolType, ProjectData, TakeoffItem, Shape, Unit, PlanSet, LegendSettings } from './types';
import { PresetScale, getAreaUnitFromLinear, isPointInPolygon } from './utils/geometry';
import { useToast } from './contexts/ToastContext';
import { generateMarkupPDF } from './utils/pdfExport';
import { Loader2 } from 'lucide-react';
import { useProjectManager } from './hooks/useProjectManager';
import { useLicense } from './contexts/LicenseContext';
import { RamCacheProvider, useRamCache } from './contexts/RamCacheContext';
import { useViewRouter } from './components/Router';
import { savePlanFile } from './utils/storage';
import { flattenOCG } from './utils/flattenOCG';
import { mupdfController, SearchHit } from './utils/mupdfController';
import { save } from '@tauri-apps/plugin-dialog';
import { writeFile } from '@tauri-apps/plugin-fs';
import { LazyStore } from '@tauri-apps/plugin-store';

const AppContent: React.FC = () => {
  const { addToast } = useToast();
  const { isLicensed } = useLicense();
  const { viewMode, setViewMode } = useViewRouter();

  const {
    projectName,
    items,
    projectData,
    planSets,
    totalPages,
    isSaving,
    lastSavedAt,
    isInitializing,
    loadingMessage,
    showImportConfirm,
    showNewProjectPrompt,
    setShowNewProjectPrompt,
    setProjectName,
    setHistory,
    setHistoryTransient,
    commitHistory,
    undo,
    redo,
    canUndo,
    canRedo,
    handleNewProjectRequest,
    handleNewProjectConfirmed,
    handleSaveProject,
    handleLoadProjectClick,
    handleImportConfirmed,
    setShowImportConfirm,
    setPendingImportPath,
  } = useProjectManager(isLicensed);

  const historyState = { items, projectData, planSets, totalPages };

  const [pageIndex, setPageIndex] = useState<number>(0);
  const [zoomLevel, setZoomLevel] = useState<number>(1.0);

  const [activeTool, setActiveTool] = useState<ToolType>(ToolType.SELECT);
  const [activeTakeoffId, setActiveTakeoffId] = useState<string | null>(null);
  const [selectedShapes, setSelectedShapes] = useState<{ itemId: string, shapeId: string }[]>([]);

  const [isDeductionMode, setIsDeductionMode] = useState(false);
  const [pendingPreset, setPendingPreset] = useState<PresetScale | null>(null);

  const [showNewItemModal, setShowNewItemModal] = useState(false);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [showHelpModal, setShowHelpModal] = useState(false);
  const [helpModalTab, setHelpModalTab] = useState<'guide' | 'shortcuts' | 'properties'>('guide');
  const [editingItem, setEditingItem] = useState<TakeoffItem | null>(null);
  const [pendingTool, setPendingTool] = useState<ToolType | null>(null);

  const [showDeletePageConfirm, setShowDeletePageConfirm] = useState(false);
  const [pageToDelete, setPageToDelete] = useState<number | null>(null);

  const [showExportModal, setShowExportModal] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState({ current: 0, total: 0 });

  // PDF Search state
  const [showPDFSearch, setShowPDFSearch] = useState(false);
  const [searchHighlights, setSearchHighlights] = useState<SearchHit[]>([]);
  const [currentSearchHitIndex, setCurrentSearchHitIndex] = useState<number | null>(null);

  const [isUploadingPdf, setIsUploadingPdf] = useState(false);
  const [uploadLoadingMessage, setUploadLoadingMessage] = useState("Uploading PDF Plans...");

  const canvasRef = useRef<BlueprintCanvasRef>(null);

  useEffect(() => {
    // Only clear selection if it's no longer valid for the current page
    if (selectedShapes.length > 0) {
      const validSelectedShapes = selectedShapes.filter(sel => {
        const item = items.find(i => i.id === sel.itemId);
        const shape = item?.shapes.find(s => s.id === sel.shapeId);
        // Only keep shapes that exist on the CURRENT page
        return shape && shape.pageIndex === pageIndex;
      });

      // If we have selected shapes that are not on this page, clear them
      // This happens when switching pages while shapes are selected
      if (validSelectedShapes.length !== selectedShapes.length) {
        setSelectedShapes(validSelectedShapes);

        // Note: We deliberately DO NOT clear activeTakeoffId here.
        // We want to persist the "Active Recording Item" across pages so the user
        // can continue measuring the same item on the new page.
      }
    }
  }, [pageIndex, selectedShapes, items]);

  const { preloadPage } = useRamCache();

  // RAM Cache Preload Effect
  useEffect(() => {
    const uniquePages = new Set<string>();
    const pagesToLoad: { fileId: string, index: number }[] = [];

    items.forEach(item => {
      item.shapes.forEach(shape => {
        // Find plan set for this global page index
        const globalIndex = shape.pageIndex;
        const planSet = planSets.find(ps => globalIndex >= ps.startPageIndex && globalIndex < ps.startPageIndex + ps.pageCount);

        if (planSet) {
          const localIdx = globalIndex - planSet.startPageIndex;
          // Accounting for remapped pages
          let finalLocalIdx = localIdx;
          if (planSet.pages && planSet.pages[localIdx] !== undefined) {
            finalLocalIdx = planSet.pages[localIdx];
          } else if (planSet.pages && planSet.pages.length <= localIdx) {
            // Fallback for safety, though activePlanDetails logic suggests this:
            finalLocalIdx = localIdx;
          }

          const key = `${planSet.id}_${finalLocalIdx}`;
          if (!uniquePages.has(key)) {
            uniquePages.add(key);
            pagesToLoad.push({ fileId: planSet.id, index: finalLocalIdx });
          }
        }
      });
    });

    // Execute preloads
    pagesToLoad.forEach(p => preloadPage(p.fileId, p.index));
  }, [items, planSets, preloadPage]);

  const handleExportPDF = async (pageIndices: number[], includeLegend: boolean, includeNotes: boolean) => {
    setIsExporting(true);
    setExportProgress({ current: 0, total: pageIndices.length });
    try {
      const { pdfBytes } = await generateMarkupPDF(planSets, projectData, items, pageIndices, includeLegend, includeNotes);
      const sanitizedProjectName = projectName.replace(/[^a-z0-9]/gi, '_');
      const dateStr = new Date().toISOString().slice(0, 10);
      const defaultFileName = `${sanitizedProjectName}-Markup-${dateStr}.pdf`;

      // Use LazyStore to check if we have a saved export directory
      const store = new LazyStore('settings.json');
      const savedExportDir = await store.get<string>('pdfExportDirectory');

      // Determine the default path for the save dialog
      let defaultPath = defaultFileName;
      if (savedExportDir) {
        // Use saved directory + new filename
        defaultPath = `${savedExportDir}/${defaultFileName}`;
      }

      // Show save dialog to let user pick location
      const savePath = await save({
        filters: [{
          name: 'PDF Document',
          extensions: ['pdf']
        }],
        defaultPath: defaultPath
      });

      // If user cancelled the dialog
      if (!savePath) {
        addToast("Export cancelled", 'info');
        return;
      }

      // Save the directory for future exports (first time or when user picks new location)
      const lastSlashIndex = Math.max(savePath.lastIndexOf('/'), savePath.lastIndexOf('\\'));
      if (lastSlashIndex > -1) {
        const newExportDir = savePath.substring(0, lastSlashIndex);
        await store.set('pdfExportDirectory', newExportDir);
        await store.save();
      }

      // Write the PDF to the chosen location
      await writeFile(savePath, pdfBytes);
      addToast("PDF Export successful!", 'success');
    } catch (e) {
      console.error("Export Error:", e);
      addToast("Export failed. See console.", 'error');
    } finally {
      setIsExporting(false);
      setShowExportModal(false);
    }
  };

  const getCurrentPageScale = () => projectData[pageIndex]?.scale || { isSet: false, pixelsPerUnit: 0, unit: Unit.FEET };

  const getActivePlanDetails = () => {
    if (planSets.length === 0) return null;
    for (const set of planSets) {
      if (pageIndex >= set.startPageIndex && pageIndex < set.startPageIndex + set.pageCount) {
        const localIdx = pageIndex - set.startPageIndex;
        let pdfPageIndex = localIdx;
        if (set.pages && set.pages[localIdx] !== undefined) {
          pdfPageIndex = set.pages[localIdx];
        } else if (set.pages && set.pages.length <= localIdx) {
          pdfPageIndex = localIdx;
        }
        return { file: set.file, localPageIndex: pdfPageIndex, name: set.name, id: set.id };
      }
    }
    return null;
  };

  const handleUpload = async (files: File[], names: string[]) => {
    setShowUploadModal(false);
    setIsUploadingPdf(true);
    setIsUploadingPdf(true);
    setUploadLoadingMessage("Optimizing PDF Plans (this may take a moment)...");
    try {
      let newPlanSets = [...planSets];
      let currentTotalPages = totalPages;
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const name = names[i];

        const fileBlob = new Blob([file], { type: 'application/pdf' });
        const fileCopy = new File([fileBlob], file.name, { type: 'application/pdf', lastModified: file.lastModified });

        const buffer = await fileCopy.arrayBuffer();
        const bufferCopy = buffer.slice(0);

        // Flatten OCGs for performance
        let finalBuffer = bufferCopy;
        try {
          const flattened = await flattenOCG(new Uint8Array(bufferCopy));
          finalBuffer = flattened.buffer as ArrayBuffer;
        } catch (e) {
          console.warn(`Failed to flatten ${name}, using original`, e);
        }

        // const pdf = await pdfjs.getDocument(finalBuffer.slice(0) as ArrayBuffer).promise;
        const numPages = await mupdfController.countPagesTransient(new Uint8Array(finalBuffer));

        // Re-create file from flattened buffer
        // Use Uint8Array view for Blob to avoid ArrayBuffer/SharedArrayBuffer mismatch
        const flattenedBlob = new Blob([new Uint8Array(finalBuffer)], { type: 'application/pdf' });
        const flattenedFile = new File([flattenedBlob], file.name, { type: 'application/pdf', lastModified: Date.now() });

        const newPlanSet: PlanSet = {
          id: crypto.randomUUID(),
          file: flattenedFile,
          name,
          pageCount: numPages,
          startPageIndex: currentTotalPages,
          pages: Array.from({ length: numPages }, (_, i) => i)
        };
        await savePlanFile(newPlanSet.id, flattenedFile);
        newPlanSets.push(newPlanSet);
        currentTotalPages += numPages;
      }
      setHistory(draft => {
        draft.planSets = newPlanSets;
        draft.totalPages = currentTotalPages;
      });
      if (planSets.length === 0 && newPlanSets.length > 0) {
        setPageIndex(0);
        setZoomLevel(1.0);
        setActiveTakeoffId(null);
        setViewMode('canvas');
      }
      addToast(`Added ${files.length} plan(s)`, 'success');
    } catch (error) {
      console.error("Error loading PDF metadata:", error);
      addToast("Failed to load PDF file", 'error');
    } finally {
      setIsUploadingPdf(false);
      setUploadLoadingMessage("Loading Project...");
    }
  };

  const handleInitiateTool = (tool: ToolType) => {
    if ([ToolType.LINEAR, ToolType.ARC, ToolType.AREA, ToolType.FILL, ToolType.SEGMENT, ToolType.DIMENSION].includes(tool)) {
      const scale = getCurrentPageScale();
      if (!scale.isSet) {
        addToast("Please set the scale for this page first", 'error');
        return;
      }
    }
    setPendingTool(tool);
    setShowNewItemModal(true);
  };

  const handleEnableDeductionMode = (itemId: string) => {
    const item = items.find(i => i.id === itemId);
    if (!item) return;
    setActiveTakeoffId(itemId);
    setActiveTool(item.type);
    setIsDeductionMode(true);
    addToast("Cutout mode enabled. Draw to subtract.", 'info');
  };

  const handleCreateTakeoffItem = (data: Partial<TakeoffItem>) => {
    if (!pendingTool) return;
    const scale = getCurrentPageScale();
    let unit = data.unit;
    if (!unit) {
      if (pendingTool === ToolType.COUNT) { unit = Unit.EACH; } 
      else if (pendingTool === ToolType.VOLUME) { unit = Unit.CUBIC_FEET; }
      else if (pendingTool === ToolType.AREA || pendingTool === ToolType.FILL) { unit = getAreaUnitFromLinear(scale.unit); }
      else { unit = scale.unit; }
    }
    if (pendingTool === ToolType.AREA || pendingTool === ToolType.FILL) { unit = getAreaUnitFromLinear(unit); }
    const newItem: TakeoffItem = {
      id: crypto.randomUUID(),
      label: data.label || 'New Item',
      type: pendingTool,
      color: data.color || '#3b82f6',
      unit: unit,
      shapes: [],
      totalValue: 0,
      visible: true,
      properties: data.properties || [],
      formula: data.formula || 'Qty',
      price: data.price,
      group: data.group || 'General',
      subItems: data.subItems || [],
      depth: data.depth
    };
    setHistory(draft => {
      draft.items.push(newItem);
    });
    setActiveTakeoffId(newItem.id);
    setActiveTool(pendingTool);
    setIsDeductionMode(false);
    setShowNewItemModal(false);
    setPendingTool(null);
    addToast(`Created item: ${newItem.label}`, 'success');
  };

  const calculateTotalValue = (shapes: Shape[], item: TakeoffItem) => {
    const baseValue = shapes.reduce((sum, s) => s.deduction ? sum - s.value : sum + s.value, 0);
    return item.type === ToolType.VOLUME && item.depth ? baseValue * item.depth : baseValue;
  };

  const handleBatchCreateItems = (itemsToCreate: { newItemId?: string, sourceItemId: string, shapes: Shape[] }[]) => {
    const newItemsList: TakeoffItem[] = [];
    let lastItemId = activeTakeoffId;

    itemsToCreate.forEach(({ newItemId, sourceItemId, shapes }) => {
      const sourceItem = items.find(i => i.id === sourceItemId);
      if (!sourceItem) return;

      const newItem: TakeoffItem = {
        ...sourceItem,
        id: newItemId || crypto.randomUUID(),
        label: `${sourceItem.label} (Copy)`,
        shapes: shapes,
        totalValue: calculateTotalValue(shapes, item)
      };
      newItemsList.push(newItem);
      lastItemId = newItem.id;
    });

    if (newItemsList.length > 0) {
      setHistory(draft => {
        draft.items.push(...newItemsList);
      });
      setActiveTakeoffId(lastItemId);
      addToast(`Created ${newItemsList.length} new item(s)`, 'success');
    }
  };

  const handleBatchAddShapes = (shapesToAdd: { itemId: string, shape: Shape }[]) => {
    const shapesByItem = shapesToAdd.reduce((acc, { itemId, shape }) => {
      if (!acc[itemId]) acc[itemId] = [];
      acc[itemId].push(shape);
      return acc;
    }, {} as Record<string, Shape[]>);

    setHistory(draft => {
      draft.items.forEach(item => {
        if (shapesByItem[item.id]) {
          item.shapes.push(...shapesByItem[item.id]);
          item.totalValue = calculateTotalValue(item.shapes, item);
        }
      });
    });
    addToast(`Added ${shapesToAdd.length} shapes`, 'success');
  };

  const handleShapeCreated = (shape: Shape) => {
    if (!activeTakeoffId) return;
    if (isDeductionMode) shape.deduction = true;
    setHistory(draft => {
      const item = draft.items.find(i => i.id === activeTakeoffId);
      if (item) {
        item.shapes.push(shape);
        item.totalValue = calculateTotalValue(item.shapes, item);
      }
    });
    if (isDeductionMode) {
      setIsDeductionMode(false);
      addToast("Cutout added", 'success');
    }
  };

  const handleUpdateShape = (itemId: string, shapeId: string, updates: Partial<Shape>) => {
    setHistory(draft => {
      const item = draft.items.find(i => i.id === itemId);
      if (item) {
        const shape = item.shapes.find(s => s.id === shapeId);
        if (shape) {
          Object.assign(shape, updates);
          item.totalValue = calculateTotalValue(item.shapes, item);
        }
      }
    });
  };

  const handleUpdateShapeTransient = (itemId: string, updatedShape: Shape) => {
    setHistoryTransient(draft => {
      const item = draft.items.find(i => i.id === itemId);
      if (item) {
        const index = item.shapes.findIndex(s => s.id === updatedShape.id);
        if (index !== -1) {
          item.shapes[index] = updatedShape;
          item.totalValue = calculateTotalValue(item.shapes, item);
        }
      }
    });
  };

  const handleBatchUpdateShapesTransient = (updates: { itemId: string, shape: Shape }[]) => {
    const updatesByItemId = updates.reduce((acc, { itemId, shape }) => {
      if (!acc[itemId]) {
        acc[itemId] = [];
      }
      acc[itemId].push(shape);
      return acc;
    }, {} as Record<string, Shape[]>);

    setHistoryTransient(draft => {
      draft.items.forEach(item => {
        if (updatesByItemId[item.id]) {
          const itemUpdates = updatesByItemId[item.id];
          itemUpdates.forEach(updatedShape => {
            const index = item.shapes.findIndex(s => s.id === updatedShape.id);
            if (index !== -1) {
              item.shapes[index] = updatedShape;
            }
          });
        }
      });
    });
  };

  const handleSplitShape = (itemId: string, updatedShape: Shape, newShape: Shape) => {
    setHistory(draft => {
      const item = draft.items.find(i => i.id === itemId);
      if (item) {
        const index = item.shapes.findIndex(s => s.id === updatedShape.id);
        if (index !== -1) {
          item.shapes[index] = updatedShape;
          item.shapes.push(newShape);
          item.totalValue = calculateTotalValue(item.shapes, item);
        }
      }
    });
  };

  const handleUpdateItem = (itemId: string, updates: Partial<TakeoffItem>) => {
    setHistory(draft => {
      const item = draft.items.find(i => i.id === itemId);
      if (item) {
        Object.assign(item, updates);
      }
    });
  };

  const handleDeleteItem = (id: string) => {
    if (activeTakeoffId === id) { setActiveTakeoffId(null); setActiveTool(ToolType.SELECT); setIsDeductionMode(false); }
    setHistory(draft => {
      draft.items = draft.items.filter(i => i.id !== id);
    });
    addToast("Item deleted", 'info');
  };

  const handleToggleItemVisibility = (itemId: string, pageIndex: number) => {
    setHistory(draft => {
      const item = draft.items.find(i => i.id === itemId);
      if (item) {
        // Migration: If globally hidden, unhide globally so we can manage per-page
        if (item.visible === false) {
          item.visible = true;
        }

        if (!item.hiddenPages) {
          item.hiddenPages = [];
        }

        const idx = item.hiddenPages.indexOf(pageIndex);
        if (idx >= 0) {
          item.hiddenPages.splice(idx, 1);
        } else {
          item.hiddenPages.push(pageIndex);
        }
      }
    });
  };

  const handleDeleteShape = (itemId: string, shapeId: string) => {
    setHistory(draft => {
      const item = draft.items.find(i => i.id === itemId);
      if (item) {
        item.shapes = item.shapes.filter(s => s.id !== shapeId);
        item.totalValue = calculateTotalValue(item.shapes, item);
      }
    });
  };

  const handleDeleteShapes = (shapesToDelete: { itemId: string, shapeId: string }[]) => {
    // Expand deletion to include contained cutouts
    const allShapesToDelete = [...shapesToDelete];
    const processedIds = new Set(shapesToDelete.map(s => s.shapeId));

    shapesToDelete.forEach(({ itemId, shapeId }) => {
      const item = items.find(i => i.id === itemId);
      if (!item) return;
      const shape = item.shapes.find(s => s.id === shapeId);

      if (item.type === ToolType.AREA && shape && !shape.deduction) {
        const childCutouts = item.shapes.filter(other =>
          other.deduction &&
          !processedIds.has(other.id) &&
          other.points.length > 0 &&
          isPointInPolygon(other.points[0], shape.points)
        );

        childCutouts.forEach(child => {
          allShapesToDelete.push({ itemId: item.id, shapeId: child.id });
          processedIds.add(child.id);
        });
      }
    });

    const shapeIdSet = new Set(allShapesToDelete.map(s => s.shapeId));
    setHistory(draft => {
      draft.items.forEach(item => {
        const originalLength = item.shapes.length;
        item.shapes = item.shapes.filter(shape => !shapeIdSet.has(shape.id));
        if (item.shapes.length !== originalLength) {
          item.totalValue = calculateTotalValue(item.shapes, item);
        }
      });
    });
  };

  const handleMoveShapesToItem = (shapesToMove: { itemId: string, shapeId: string }[], targetItemId: string) => {
    const targetItem = items.find(item => item.id === targetItemId);
    if (!targetItem) {
      addToast("Target item not found", 'error');
      return;
    }

    const shapesBySource = shapesToMove.reduce((acc, shape) => {
      if (!acc[shape.itemId]) {
        acc[shape.itemId] = [];
      }
      acc[shape.itemId].push(shape.shapeId);
      return acc;
    }, {} as Record<string, string[]>);

    const sourceItemIds = Object.keys(shapesBySource);
    const movedShapes: Shape[] = [];

    let newItems = items.map(item => {
      if (sourceItemIds.includes(item.id)) {
        const shapeIdsToRemove = new Set(shapesBySource[item.id]);
        const itemShapesToMove = item.shapes.filter(s => shapeIdsToRemove.has(s.id));
        movedShapes.push(...itemShapesToMove);

        const remainingShapes = item.shapes.filter(s => !shapeIdsToRemove.has(s.id));
        return {
          ...item,
          shapes: remainingShapes,
          totalValue: calculateTotalValue(remainingShapes, item)
        };
      }
      return item;
    });

    newItems = newItems.map(item => {
      if (item.id === targetItemId) {
        const updatedShapes = [...item.shapes, ...movedShapes];
        return {
          ...item,
          shapes: updatedShapes,
          totalValue: calculateTotalValue(updatedShapes, item)
        };
      }
      return item;
    });

    const sourceItemsAfterChange = newItems.filter(item => sourceItemIds.includes(item.id));
    const emptySourceItemIds = new Set<string>();
    sourceItemsAfterChange.forEach(item => {
      if (item.shapes.length === 0) {
        emptySourceItemIds.add(item.id);
      }
    });

    if (emptySourceItemIds.size > 0) {
      newItems = newItems.filter(item => !emptySourceItemIds.has(item.id));
      if (activeTakeoffId && emptySourceItemIds.has(activeTakeoffId)) {
        setActiveTakeoffId(null);
        setActiveTool(ToolType.SELECT);
      }
    }

    const movedShapeIdSet = new Set(shapesToMove.map(s => s.shapeId));
    setSelectedShapes(prev => prev.filter(sel => !movedShapeIdSet.has(sel.shapeId)));

    setHistory(draft => {
      // Remove shapes from source items
      sourceItemIds.forEach(sourceId => {
        const sourceItem = draft.items.find(i => i.id === sourceId);
        if (sourceItem) {
          const shapeIdsToRemove = new Set(shapesBySource[sourceId]);
          sourceItem.shapes = sourceItem.shapes.filter(s => !shapeIdsToRemove.has(s.id));
          sourceItem.totalValue = calculateTotalValue(sourceItem.shapes, sourceItem);
        }
      });

      // Add to target item
      const targetDraftItem = draft.items.find(i => i.id === targetItemId);
      if (targetDraftItem) {
        targetDraftItem.shapes.push(...movedShapes);
        targetDraftItem.totalValue = calculateTotalValue(targetDraftItem.shapes, targetDraftItem);
      }

      // Remove empty source items
      if (emptySourceItemIds.size > 0) {
        draft.items = draft.items.filter(item => !emptySourceItemIds.has(item.id));
      }
    });

    addToast(`Moved ${shapesToMove.length} shape(s) to ${targetItem.label}`, 'success');
  };

  const handleResumeTakeoff = (id: string) => {
    const item = items.find(i => i.id === id);
    if (item) {
      if ([ToolType.LINEAR, ToolType.AREA, ToolType.SEGMENT, ToolType.DIMENSION].includes(item.type)) {
        const scale = getCurrentPageScale();
        if (!scale.isSet) { addToast("Please set the scale first", 'error'); return; }
      }
      setActiveTakeoffId(id); setActiveTool(item.type); setIsDeductionMode(false); setViewMode('canvas');
    }
  };

  const handleStopTakeoff = () => { setActiveTakeoffId(null); setActiveTool(ToolType.SELECT); setIsDeductionMode(false); };

  const handleUpdateScale = (pixels: number, realValue: number, unit: Unit) => {
    const ppu = pixels / realValue;
    setHistory(draft => {
      if (!draft.projectData[pageIndex]) {
        draft.projectData[pageIndex] = { scale: { isSet: false, pixelsPerUnit: 1, unit: Unit.FEET } };
      }
      draft.projectData[pageIndex].scale = { isSet: true, pixelsPerUnit: ppu, unit };
    });
    addToast("Scale calibrated", 'success');
  };

  const handleUpdateLegend = (updates: Partial<LegendSettings>) => {
    setHistoryTransient(draft => {
      if (!draft.projectData[pageIndex]) {
        draft.projectData[pageIndex] = { scale: { isSet: false, pixelsPerUnit: 1, unit: Unit.FEET } };
      }
      const currentLegend = draft.projectData[pageIndex].legend || { x: 50, y: 50, scale: 1, visible: true };
      draft.projectData[pageIndex].legend = { ...currentLegend, ...updates };
    });
  };

  useEffect(() => {
    const unlisteners: Promise<() => void>[] = [];

    unlisteners.push(listen('open_help', () => {
      setHelpModalTab('guide');
      setShowHelpModal(true);
    }));

    unlisteners.push(listen('new_project', handleNewProjectRequest));
    unlisteners.push(listen('open_project', handleLoadProjectClick));
    unlisteners.push(listen('save_project', handleSaveProject));

    return () => {
      unlisteners.forEach(u => u.then(f => f()));
    };
  }, [handleNewProjectRequest, handleLoadProjectClick, handleSaveProject]);

  // Check for Stripe success return
  useEffect(() => {
    const checkSubscriptionSuccess = async () => {
      const urlParams = new URLSearchParams(window.location.search);
      const sessionId = urlParams.get('session_id');

      if (sessionId) {
        // Clear the param immediately so we don't re-trigger on reload
        window.history.replaceState({}, document.title, window.location.pathname);

        addToast("Purchase completed!", 'success');
      }
    };

    checkSubscriptionSuccess();
  }, [addToast]);

  useKeyboardShortcuts({
    undo, redo, setTool: (t) => { setActiveTool(t); if (t === ToolType.SELECT) setActiveTakeoffId(null); },
    toggleDeductionMode: () => { if (activeTakeoffId) setIsDeductionMode(p => !p); },
    deleteSelectedItem: () => {
      if (activeTakeoffId) {
        // Context-aware delete:
        // If shapes exist on current page, delete only those (Clear from Page)
        // If NO shapes on current page, delete the entire item (Delete Item)
        const item = items.find(i => i.id === activeTakeoffId);
        if (item) {
          const shapesOnPage = item.shapes.filter(s => s.pageIndex === pageIndex);
          if (shapesOnPage.length > 0) {
            handleDeleteShapes(shapesOnPage.map(s => ({ itemId: item.id, shapeId: s.id })));
            addToast(`Cleared ${shapesOnPage.length} measurement(s) from this page`, 'info');
          } else {
            handleDeleteItem(activeTakeoffId);
          }
        }
      }
    },
    cancelAction: () => { setActiveTakeoffId(null); setActiveTool(ToolType.SELECT); },
    zoomIn: () => setZoomLevel(z => Math.min(10, z + 0.25)), zoomOut: () => setZoomLevel(z => Math.max(0.1, z - 0.25)),
    saveProject: handleSaveProject, nextPage: () => pageIndex < totalPages - 1 && setPageIndex(p => p + 1),
    prevPage: () => pageIndex > 0 && setPageIndex(p => p - 1), zoomToFit: () => setZoomLevel(1.0),
    toggleRecord: () => activeTakeoffId && handleStopTakeoff(), toggleViewMode: () => setViewMode(viewMode === 'canvas' ? 'estimates' : viewMode === 'estimates' ? '3d' : 'canvas'),
    finishShape: () => activeTakeoffId && handleStopTakeoff(), copyItem: () => { }, pasteItem: () => { },
    openSearch: () => setShowPDFSearch(prev => !prev)
  });

  if (isInitializing || isUploadingPdf) {
    return (
      <div className="h-screen w-screen flex flex-col items-center justify-center bg-slate-50 gap-6">
        <div className="relative">
          <div className="w-16 h-16 border-4 border-slate-200 border-t-blue-600 rounded-full animate-spin"></div>
        </div>
        <div className="text-center space-y-2"><h2 className="text-xl font-semibold text-slate-800">{isUploadingPdf ? uploadLoadingMessage : loadingMessage}</h2></div>
      </div>
    );
  }

  const currentScale = getCurrentPageScale();
  const currentLegend = projectData[pageIndex]?.legend || { x: 50, y: 50, scale: 1, visible: true };
  const activePlan = getActivePlanDetails();

  return (
    <div className="flex h-screen w-screen bg-slate-50 overflow-hidden font-sans">
      <Sidebar
        items={items} activeTakeoffId={activeTakeoffId} selectedShapes={selectedShapes} onDelete={handleDeleteItem} onResume={handleResumeTakeoff} onStop={handleStopTakeoff}
        onSelect={setActiveTakeoffId} onOpenUploadModal={() => setShowUploadModal(true)} planSets={planSets} pageIndex={pageIndex}
        setPageIndex={setPageIndex} totalPages={totalPages} projectData={projectData}
        scaleInfo={{ isSet: currentScale.isSet, unit: currentScale.unit, ppu: currentScale.pixelsPerUnit }}
        onToggleVisibility={handleToggleItemVisibility}
        onShowEstimates={() => { handleStopTakeoff(); setViewMode('estimates'); }}
        onShow3D={() => { handleStopTakeoff(); setViewMode('3d'); }}
        onRenamePage={(i, n) => setHistory(draft => {
          if (!draft.projectData[i]) {
            draft.projectData[i] = { scale: { isSet: false, pixelsPerUnit: 1, unit: Unit.FEET } };
          }
          draft.projectData[i].name = n;
        })}
        onDeletePage={(i) => { setPageToDelete(i); setShowDeletePageConfirm(true); }}
        onEditItem={setEditingItem} onRenameItem={(id, n) => handleUpdateItem(id, { label: n })}
        onMoveShapesToItem={handleMoveShapesToItem}
        projectName={projectName} onNewProject={handleNewProjectRequest} onSaveProject={handleSaveProject} onLoadProject={handleLoadProjectClick}
        isSaving={isSaving} lastSavedAt={lastSavedAt} activeTool={activeTool} onOpenExportModal={() => setShowExportModal(true)}
        onOpenHelp={() => setShowHelpModal(true)}
        onDeleteShapes={handleDeleteShapes}
      />
      <main className="flex-1 relative flex flex-col h-full overflow-hidden">
        {viewMode === 'estimates' ? (
          <EstimatesView items={items} onBack={() => setViewMode('canvas')} onDeleteItem={handleDeleteItem} onUpdateItem={handleUpdateItem}
            onReorderItems={(newItems) => setHistory(draft => { draft.items = newItems; })} onEditItem={setEditingItem} />
        ) : viewMode === '3d' ? (
          <ThreeDView items={items} onBack={() => setViewMode('canvas')} planSets={planSets} pageIndex={pageIndex} />
        ) : (
          <>
            {planSets.length > 0 && (
              <Tools activeTool={activeTool} setTool={(t) => { setActiveTool(t); if (t === ToolType.SELECT) setActiveTakeoffId(null); setIsDeductionMode(false); }}
                onInitiateTool={handleInitiateTool} scale={zoomLevel} setScale={setZoomLevel} onSetPresetScale={setPendingPreset}
                isRecording={!!activeTakeoffId && activeTool !== ToolType.SELECT} onUndo={undo} onRedo={redo} canUndo={canUndo} canRedo={canRedo}
                isLegendVisible={currentLegend.visible ?? true} onToggleLegend={() => handleUpdateLegend({ visible: !(currentLegend.visible ?? true) })}
                isPageScaled={currentScale.isSet}
                onOpenSearch={() => setShowPDFSearch(prev => !prev)}
                isSearchOpen={showPDFSearch} />
            )}
            <BlueprintCanvas
              key={pageIndex}
              ref={canvasRef}
              file={activePlan?.file || null}
              fileId={activePlan?.id || ''}
              localPageIndex={activePlan?.localPageIndex || 0}
              globalPageIndex={pageIndex}
              onPageWidthChange={() => { }} activeTool={activeTool} items={items} activeTakeoffId={activeTakeoffId} isDeductionMode={isDeductionMode}
              onEnableDeduction={handleEnableDeductionMode} onSelectTakeoffItem={setActiveTakeoffId} onSelectionChanged={setSelectedShapes} onShapeCreated={handleShapeCreated}
              onUpdateShape={handleUpdateShape} onUpdateShapeTransient={handleUpdateShapeTransient} onBatchUpdateShapesTransient={handleBatchUpdateShapesTransient} onSplitShape={handleSplitShape}
              onUpdateScale={handleUpdateScale} onUpdateLegend={handleUpdateLegend} legendSettings={currentLegend} onDeleteShape={handleDeleteShape} onDeleteShapes={handleDeleteShapes}
              onBatchCreateItems={handleBatchCreateItems}
              onBatchAddShapes={handleBatchAddShapes}
              onMoveShapesToItem={handleMoveShapesToItem}
              onStopRecording={handleStopTakeoff} onInteractionEnd={commitHistory}
              scaleInfo={{ isSet: currentScale.isSet, ppu: currentScale.pixelsPerUnit, unit: currentScale.unit }}
              zoomLevel={zoomLevel} setZoomLevel={setZoomLevel} pendingPreset={pendingPreset} clearPendingPreset={() => setPendingPreset(null)}
              searchHighlights={searchHighlights}
              currentSearchHitIndex={currentSearchHitIndex} />
            <PDFSearch
              isOpen={showPDFSearch}
              onClose={() => setShowPDFSearch(false)}
              onNavigateToPage={setPageIndex}
              currentPageIndex={pageIndex}
              onHighlightsChange={setSearchHighlights}
              onCurrentHitChange={setCurrentSearchHitIndex}
            />
          </>
        )}
      </main>
      {showUploadModal && <UploadModal onUpload={handleUpload} onCancel={() => setShowUploadModal(false)} isFirstUpload={planSets.length === 0} />}
      {showNewItemModal && pendingTool && <NewItemModal toolType={pendingTool} existingCount={items.length} onCreate={handleCreateTakeoffItem} onCancel={() => { setShowNewItemModal(false); setPendingTool(null); }} />}
      {editingItem && <PropertiesModal item={editingItem} items={items} onSave={handleUpdateItem} onClose={() => setEditingItem(null)} />}
      <HelpModal isOpen={showHelpModal} onClose={() => setShowHelpModal(false)} initialTab={helpModalTab} />
      <ExportModal isOpen={showExportModal} planSets={planSets} projectData={projectData} currentPageIndex={pageIndex} isExporting={isExporting} progress={exportProgress} onClose={() => setShowExportModal(false)} onExport={handleExportPDF} />
      <PromptModal isOpen={showNewProjectPrompt} title="Create New Project" message="Enter a name for the new project." placeholder="My Project" onConfirm={(name) => handleNewProjectConfirmed(name).then(() => setViewMode('canvas'))} onCancel={() => setShowNewProjectPrompt(false)} confirmText="Create Project" />
      <ConfirmModal isOpen={showImportConfirm} title="Import Project?" message="Loading a project will replace the current workspace." onConfirm={() => handleImportConfirmed().then(() => setViewMode('canvas'))} onCancel={() => { setShowImportConfirm(false); setPendingImportPath(null); }} confirmText="Import Project" isDestructive />
      <ConfirmModal isOpen={showDeletePageConfirm} title="Delete Page?" message="Are you sure you want to delete this page?" onConfirm={() => { /* Logic to be implemented */ setShowDeletePageConfirm(false); }} onCancel={() => setShowDeletePageConfirm(false)} confirmText="Delete Page" isDestructive />
    </div>
  );
};

const App: React.FC = () => (
  <RamCacheProvider>
    <AppContent />
  </RamCacheProvider>
);

export default App;
