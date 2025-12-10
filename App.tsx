import React, { useState, useRef, useEffect } from 'react';
import { listen } from '@tauri-apps/api/event';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { pdfjs } from 'react-pdf';
import Sidebar from './components/Sidebar';
import BlueprintCanvas, { BlueprintCanvasRef } from './components/BlueprintCanvas';
import Tools from './components/Tools';
import HelpModal from './components/HelpModal';
import NewItemModal from './components/NewItemModal';
import UploadModal from './components/UploadModal';
import PropertiesModal from './components/PropertiesModal';
import EstimatesView from './components/EstimatesView';
import ConfirmModal from './components/ConfirmModal';
import PromptModal from './components/PromptModal';
import ExportModal from './components/ExportModal';
import { ToolType, ProjectData, TakeoffItem, Shape, Unit, PlanSet, LegendSettings } from './types';
import { PresetScale, getAreaUnitFromLinear } from './utils/geometry';
import { useToast } from './contexts/ToastContext';
import { generateMarkupPDF } from './utils/pdfExport';
import { Loader2 } from 'lucide-react';
import { useProjectManager } from './hooks/useProjectManager';
import { useLicense } from './contexts/LicenseContext';
import { useViewRouter } from './components/Router';
import { savePlanFile } from './utils/storage';

const App: React.FC = () => {
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
  const [helpModalTab, setHelpModalTab] = useState<'guide' | 'shortcuts' | 'properties' | 'license'>('guide');
  const [editingItem, setEditingItem] = useState<TakeoffItem | null>(null);
  const [pendingTool, setPendingTool] = useState<ToolType | null>(null);

  const [showDeletePageConfirm, setShowDeletePageConfirm] = useState(false);
  const [pageToDelete, setPageToDelete] = useState<number | null>(null);

  const [showExportModal, setShowExportModal] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState({ current: 0, total: 0 });

  const [isUploadingPdf, setIsUploadingPdf] = useState(false);
  const [uploadLoadingMessage, setUploadLoadingMessage] = useState("Uploading PDF Plans...");

  const canvasRef = useRef<BlueprintCanvasRef>(null);

  useEffect(() => {
    if (activeTakeoffId) {
      const activeItem = items.find(i => i.id === activeTakeoffId);
      const hasShapesOnCurrentPage = activeItem?.shapes.some(s => s.pageIndex === pageIndex);
      if (activeItem && activeItem.shapes.length > 0 && !hasShapesOnCurrentPage) {
        setActiveTakeoffId(null);
        setSelectedShapes([]);
      }
    } else if (selectedShapes.length > 0) {
      const validSelectedShapes = selectedShapes.filter(sel => {
        const item = items.find(i => i.id === sel.itemId);
        const shape = item?.shapes.find(s => s.id === sel.shapeId);
        return shape && shape.pageIndex === pageIndex;
      });
      if (validSelectedShapes.length !== selectedShapes.length) {
        setSelectedShapes(validSelectedShapes);
      }
    }
  }, [pageIndex, activeTakeoffId, selectedShapes, items]);

  const handleExportPDF = async (pageIndices: number[], includeLegend: boolean, includeNotes: boolean) => {
    setIsExporting(true);
    setExportProgress({ current: 0, total: pageIndices.length });
    try {
      const { pdfBytes } = await generateMarkupPDF(planSets, projectData, items, pageIndices, includeLegend, includeNotes);
      const sanitizedProjectName = projectName.replace(/[^a-z0-9]/gi, '_');
      const dateStr = new Date().toISOString().slice(0, 10);
      const blob = new Blob([pdfBytes as BlobPart], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${sanitizedProjectName}-Markup-${dateStr}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
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
        return { file: set.file, localPageIndex: pdfPageIndex, name: set.name };
      }
    }
    return null;
  };

  const handleUpload = async (files: File[], names: string[]) => {
    setShowUploadModal(false);
    setIsUploadingPdf(true);
    setUploadLoadingMessage("Uploading PDF Plans...");
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

        const pdf = await pdfjs.getDocument(bufferCopy).promise;
        const numPages = pdf.numPages;

        const newPlanSet: PlanSet = {
          id: crypto.randomUUID(),
          file: fileCopy,
          name,
          pageCount: numPages,
          startPageIndex: currentTotalPages,
          pages: Array.from({ length: numPages }, (_, i) => i)
        };
        await savePlanFile(newPlanSet.id, fileCopy);
        newPlanSets.push(newPlanSet);
        currentTotalPages += numPages;
      }
      setHistory({ ...historyState, planSets: newPlanSets, totalPages: currentTotalPages });
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
    if ([ToolType.LINEAR, ToolType.AREA, ToolType.SEGMENT, ToolType.DIMENSION].includes(tool)) {
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
      if (pendingTool === ToolType.COUNT) { unit = Unit.EACH; } else { unit = scale.unit; }
    }
    if (pendingTool === ToolType.AREA) { unit = getAreaUnitFromLinear(unit); }
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
      subItems: data.subItems || []
    };
    setHistory({ ...historyState, items: [...items, newItem] });
    setActiveTakeoffId(newItem.id);
    setActiveTool(pendingTool);
    setIsDeductionMode(false);
    setShowNewItemModal(false);
    setPendingTool(null);
    addToast(`Created item: ${newItem.label}`, 'success');
  };

  const calculateTotalValue = (shapes: Shape[]) => shapes.reduce((sum, s) => s.deduction ? sum - s.value : sum + s.value, 0);

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
        totalValue: calculateTotalValue(shapes)
      };
      newItemsList.push(newItem);
      lastItemId = newItem.id;
    });

    if (newItemsList.length > 0) {
      setHistory({ ...historyState, items: [...items, ...newItemsList] });
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

    const newItems = items.map(item => {
      if (shapesByItem[item.id]) {
        const newShapes = [...item.shapes, ...shapesByItem[item.id]];
        const newTotal = calculateTotalValue(newShapes);
        return { ...item, shapes: newShapes, totalValue: newTotal };
      }
      return item;
    });

    setHistory({ ...historyState, items: newItems });
    addToast(`Added ${shapesToAdd.length} shapes`, 'success');
  };

  const handleShapeCreated = (shape: Shape) => {
    if (!activeTakeoffId) return;
    if (isDeductionMode) shape.deduction = true;
    const newItems = items.map(item => {
      if (item.id === activeTakeoffId) {
        const newShapes = [...item.shapes, shape];
        const newTotal = calculateTotalValue(newShapes);
        return { ...item, shapes: newShapes, totalValue: newTotal };
      }
      return item;
    });
    setHistory({ ...historyState, items: newItems });
    if (isDeductionMode) {
      setIsDeductionMode(false);
      addToast("Cutout added", 'success');
    }
  };

  const handleUpdateShape = (itemId: string, shapeId: string, updates: Partial<Shape>) => {
    const newItems = items.map(item => {
      if (item.id === itemId) {
        const newShapes = item.shapes.map(shape => shape.id === shapeId ? { ...shape, ...updates } : shape);
        const newTotal = calculateTotalValue(newShapes);
        return { ...item, shapes: newShapes, totalValue: newTotal };
      }
      return item;
    });
    setHistory({ ...historyState, items: newItems });
  };

  const handleUpdateShapeTransient = (itemId: string, updatedShape: Shape) => {
    const newItems = items.map(item => {
      if (item.id === itemId) {
        const newShapes = item.shapes.map(s => s.id === updatedShape.id ? updatedShape : s);
        const newTotal = calculateTotalValue(newShapes);
        return { ...item, shapes: newShapes, totalValue: newTotal };
      }
      return item;
    });
    setHistoryTransient({ ...historyState, items: newItems });
  };

  const handleBatchUpdateShapesTransient = (updates: { itemId: string, shape: Shape }[]) => {
    const updatesByItemId = updates.reduce((acc, { itemId, shape }) => {
      if (!acc[itemId]) {
        acc[itemId] = [];
      }
      acc[itemId].push(shape);
      return acc;
    }, {} as Record<string, Shape[]>);

    const newItems = items.map(item => {
      if (updatesByItemId[item.id]) {
        const itemUpdates = updatesByItemId[item.id];
        const updatedShapes = item.shapes.map(shape => {
          const update = itemUpdates.find(u => u.id === shape.id);
          return update || shape;
        });
        return { ...item, shapes: updatedShapes };
      }
      return item;
    });

    setHistoryTransient({ ...historyState, items: newItems });
  };

  const handleSplitShape = (itemId: string, updatedShape: Shape, newShape: Shape) => {
    const newItems = items.map(item => {
      if (item.id === itemId) {
        const newShapes = item.shapes.map(s => s.id === updatedShape.id ? updatedShape : s);
        newShapes.push(newShape);
        const newTotal = calculateTotalValue(newShapes);
        return { ...item, shapes: newShapes, totalValue: newTotal };
      }
      return item;
    });
    setHistory({ ...historyState, items: newItems });
  };

  const handleUpdateItem = (itemId: string, updates: Partial<TakeoffItem>) => {
    const newItems = items.map(item => item.id === itemId ? { ...item, ...updates } : item);
    setHistory({ ...historyState, items: newItems });
  };

  const handleDeleteItem = (id: string) => {
    if (activeTakeoffId === id) { setActiveTakeoffId(null); setActiveTool(ToolType.SELECT); setIsDeductionMode(false); }
    setHistory({ ...historyState, items: items.filter(i => i.id !== id) });
    addToast("Item deleted", 'info');
  };

  const handleDeleteShape = (itemId: string, shapeId: string) => {
    const newItems = items.map(item => {
      if (item.id === itemId) {
        const newShapes = item.shapes.filter(s => s.id !== shapeId);
        const newTotal = calculateTotalValue(newShapes);
        return { ...item, shapes: newShapes, totalValue: newTotal };
      }
      return item;
    });
    setHistory({ ...historyState, items: newItems });
  };

  const handleDeleteShapes = (shapesToDelete: { itemId: string, shapeId: string }[]) => {
    const shapeIdSet = new Set(shapesToDelete.map(s => s.shapeId));
    const newItems = items.map(item => {
      const newShapes = item.shapes.filter(shape => !shapeIdSet.has(shape.id));
      if (newShapes.length !== item.shapes.length) {
        const newTotal = calculateTotalValue(newShapes);
        return { ...item, shapes: newShapes, totalValue: newTotal };
      }
      return item;
    });
    setHistory({ ...historyState, items: newItems });
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
          totalValue: calculateTotalValue(remainingShapes)
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
          totalValue: calculateTotalValue(updatedShapes)
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

    setHistory({ ...historyState, items: newItems });
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
    setHistory({
      ...historyState,
      projectData: { ...projectData, [pageIndex]: { ...projectData[pageIndex], scale: { isSet: true, pixelsPerUnit: ppu, unit } } }
    });
    addToast("Scale calibrated", 'success');
  };

  const handleUpdateLegend = (updates: Partial<LegendSettings>) => {
    const currentLegend = projectData[pageIndex]?.legend || { x: 50, y: 50, scale: 1, visible: true };
    setHistoryTransient({
      ...historyState,
      projectData: { ...projectData, [pageIndex]: { ...projectData[pageIndex], legend: { ...currentLegend, ...updates } } }
    });
  };

  useEffect(() => {
    const unlisteners: Promise<() => void>[] = [];

    unlisteners.push(listen('open_help', () => {
      setHelpModalTab('guide');
      setShowHelpModal(true);
    }));

    unlisteners.push(listen('open_activation', () => {
      setHelpModalTab('license');
      setShowHelpModal(true);
    }));

    unlisteners.push(listen('new_project', handleNewProjectRequest));
    unlisteners.push(listen('open_project', handleLoadProjectClick));
    unlisteners.push(listen('save_project', handleSaveProject));

    return () => {
      unlisteners.forEach(u => u.then(f => f()));
    };
  }, [handleNewProjectRequest, handleLoadProjectClick, handleSaveProject]);

  useKeyboardShortcuts({
    undo, redo, setTool: (t) => { setActiveTool(t); if (t === ToolType.SELECT) setActiveTakeoffId(null); },
    toggleDeductionMode: () => { if (activeTakeoffId) setIsDeductionMode(p => !p); },
    deleteSelectedItem: () => { if (activeTakeoffId) handleDeleteItem(activeTakeoffId); },
    cancelAction: () => { setActiveTakeoffId(null); setActiveTool(ToolType.SELECT); },
    zoomIn: () => setZoomLevel(z => Math.min(10, z + 0.25)), zoomOut: () => setZoomLevel(z => Math.max(0.1, z - 0.25)),
    saveProject: handleSaveProject, nextPage: () => pageIndex < totalPages - 1 && setPageIndex(p => p + 1),
    prevPage: () => pageIndex > 0 && setPageIndex(p => p - 1), zoomToFit: () => setZoomLevel(1.0),
    toggleRecord: () => activeTakeoffId && handleStopTakeoff(), toggleViewMode: () => setViewMode(viewMode === 'canvas' ? 'estimates' : 'canvas'),
    finishShape: () => activeTakeoffId && handleStopTakeoff(), copyItem: () => { }, pasteItem: () => { }
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
        onToggleVisibility={(id) => handleUpdateItem(id, { visible: !items.find(i => i.id === id)?.visible })}
        onShowEstimates={() => { handleStopTakeoff(); setViewMode('estimates'); }}
        onRenamePage={(i, n) => setHistory({ ...historyState, projectData: { ...projectData, [i]: { ...projectData[i], name: n } } })}
        onDeletePage={(i) => { setPageToDelete(i); setShowDeletePageConfirm(true); }}
        onEditItem={setEditingItem} onRenameItem={(id, n) => handleUpdateItem(id, { label: n })}
        onMoveShapesToItem={handleMoveShapesToItem}
        projectName={projectName} onNewProject={handleNewProjectRequest} onSaveProject={handleSaveProject} onLoadProject={handleLoadProjectClick}
        isSaving={isSaving} lastSavedAt={lastSavedAt} activeTool={activeTool} onOpenExportModal={() => setShowExportModal(true)}
        onOpenHelp={() => setShowHelpModal(true)}
      />
      <main className="flex-1 relative flex flex-col h-full overflow-hidden">
        {viewMode === 'estimates' ? (
          <EstimatesView items={items} onBack={() => setViewMode('canvas')} onDeleteItem={handleDeleteItem} onUpdateItem={handleUpdateItem}
            onReorderItems={(newItems) => setHistory({ ...historyState, items: newItems })} onEditItem={setEditingItem} />
        ) : (
          <>
            {planSets.length > 0 && (
              <Tools activeTool={activeTool} setTool={(t) => { setActiveTool(t); if (t === ToolType.SELECT) setActiveTakeoffId(null); setIsDeductionMode(false); }}
                onInitiateTool={handleInitiateTool} scale={zoomLevel} setScale={setZoomLevel} onSetPresetScale={setPendingPreset}
                isRecording={!!activeTakeoffId && activeTool !== ToolType.SELECT} onUndo={undo} onRedo={redo} canUndo={canUndo} canRedo={canRedo}
                isLegendVisible={currentLegend.visible ?? true} onToggleLegend={() => handleUpdateLegend({ visible: !(currentLegend.visible ?? true) })}
                isPageScaled={currentScale.isSet} />
            )}
            <BlueprintCanvas ref={canvasRef} file={activePlan?.file || null} localPageIndex={activePlan?.localPageIndex || 0} globalPageIndex={pageIndex}
              onPageWidthChange={() => { }} activeTool={activeTool} items={items} activeTakeoffId={activeTakeoffId} isDeductionMode={isDeductionMode}
              onEnableDeduction={handleEnableDeductionMode} onSelectTakeoffItem={setActiveTakeoffId} onSelectionChanged={setSelectedShapes} onShapeCreated={handleShapeCreated}
              onUpdateShape={handleUpdateShape} onUpdateShapeTransient={handleUpdateShapeTransient} onBatchUpdateShapesTransient={handleBatchUpdateShapesTransient} onSplitShape={handleSplitShape}
              onUpdateScale={handleUpdateScale} onUpdateLegend={handleUpdateLegend} legendSettings={currentLegend} onDeleteShape={handleDeleteShape} onDeleteShapes={handleDeleteShapes}
              onBatchCreateItems={handleBatchCreateItems}
              onBatchAddShapes={handleBatchAddShapes}
              onMoveShapesToItem={handleMoveShapesToItem}
              onStopRecording={handleStopTakeoff} onInteractionEnd={commitHistory}
              scaleInfo={{ isSet: currentScale.isSet, ppu: currentScale.pixelsPerUnit, unit: currentScale.unit }}
              zoomLevel={zoomLevel} setZoomLevel={setZoomLevel} pendingPreset={pendingPreset} clearPendingPreset={() => setPendingPreset(null)} />
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

export default App;
