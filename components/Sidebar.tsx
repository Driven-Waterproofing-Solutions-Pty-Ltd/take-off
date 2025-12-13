
import React, { useState, useEffect, useRef } from 'react';
import { TakeoffItem, ToolType, ProjectData, PlanSet } from '../types';
import { Trash2, Upload, ChevronDown, ChevronRight, FilePlus, FolderOpen, Save, RefreshCw, Settings, Edit2, Table, Eye, EyeOff, FileDown, MoreHorizontal, Plus, HelpCircle, ShieldCheck } from 'lucide-react';
import { evaluateFormula } from '../utils/math';
import Logo from './Logo';
import ChangeItemModal from './ChangeItemModal';

interface SidebarProps {
    items: TakeoffItem[];
    activeTakeoffId: string | null;
    selectedShapes?: { itemId: string, shapeId: string }[];
    onDelete: (id: string) => void;
    onResume: (id: string) => void;
    onSelect: (id: string) => void;
    onStop: () => void;
    onOpenUploadModal: () => void;
    planSets: PlanSet[];
    pageIndex: number;
    setPageIndex: (i: number) => void;
    totalPages: number;
    projectData: ProjectData;
    scaleInfo: { isSet: boolean, unit: string, ppu: number };
    onToggleVisibility: (id: string) => void;
    onShowEstimates: () => void;
    onRenamePage: (index: number, name: string) => void;
    onDeletePage: (index: number) => void;
    onEditItem: (item: TakeoffItem) => void;
    onRenameItem: (itemId: string, newName: string) => void;
    onMoveShapesToItem?: (shapesToMove: { itemId: string, shapeId: string }[], targetItemId: string) => void;
    onDeleteShapes?: (shapesToDelete: { itemId: string, shapeId: string }[]) => void;

    // Project Actions
    projectName: string;
    onNewProject: () => void;
    onSaveProject: () => void;
    onLoadProject: () => void;
    isSaving: boolean;
    lastSavedAt: Date | null;
    activeTool: ToolType;
    onOpenExportModal: () => void;
    onOpenHelp: () => void;
    onOpenLicense: () => void;
}

const Sidebar: React.FC<SidebarProps> = ({
    items,
    activeTakeoffId,
    selectedShapes = [],
    onDelete,
    onResume,
    onSelect,
    onStop,
    onOpenUploadModal,
    planSets,
    pageIndex,
    setPageIndex,
    projectData,
    onToggleVisibility,
    onShowEstimates,
    onRenamePage,
    onDeletePage,
    onEditItem,
    onRenameItem,
    onMoveShapesToItem,
    onDeleteShapes,
    projectName,
    onNewProject,
    onSaveProject,
    onLoadProject,
    isSaving,
    lastSavedAt,
    activeTool,
    onOpenExportModal,
    onOpenHelp,
    onOpenLicense,
}) => {
    const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
    const [expandedPages, setExpandedPages] = useState<Set<number>>(new Set());

    // Page Renaming State
    const [editingPageIndex, setEditingPageIndex] = useState<number | null>(null);
    const [tempPageName, setTempPageName] = useState('');

    // Item Renaming State (Inline)
    const [editingItemId, setEditingItemId] = useState<string | null>(null);
    const [tempItemName, setTempItemName] = useState('');

    // Context Menu State
    const [contextMenu, setContextMenu] = useState<{ x: number; y: number; item: TakeoffItem } | null>(null);

    // Change Item Modal State
    const [showChangeItemModal, setShowChangeItemModal] = useState(false);
    const [selectedShapeIdsForChange, setSelectedShapeIdsForChange] = useState<string[]>([]);

    // Sidebar Resizing State
    const [sidebarWidth, setSidebarWidth] = useState<number>(280);
    const [isResizing, setIsResizing] = useState(false);
    const dragStartX = useRef(0);
    const dragStartWidth = useRef(280);

    // Load saved width from localStorage on mount
    useEffect(() => {
        const savedWidth = localStorage.getItem('sidebarWidth');
        if (savedWidth) {
            const width = parseInt(savedWidth, 10);
            if (!isNaN(width) && width >= 200 && width <= 600) {
                setSidebarWidth(width);
                dragStartWidth.current = width;
            }
        }
    }, []);

    // Save width to localStorage when it changes
    useEffect(() => {
        localStorage.setItem('sidebarWidth', sidebarWidth.toString());
    }, [sidebarWidth]);

    // Automatically expand the current page when pageIndex changes
    useEffect(() => {
        setExpandedPages(prev => {
            const newSet = new Set(prev);
            newSet.add(pageIndex);
            return newSet;
        });
    }, [pageIndex]);

    // Mouse move/up handlers for resizing
    useEffect(() => {
        const handleMouseMove = (e: MouseEvent) => {
            if (!isResizing) return;
            const delta = e.clientX - dragStartX.current;
            const newWidth = dragStartWidth.current + delta;
            // Clamp width between min and max
            const clamped = Math.max(240, Math.min(500, newWidth));
            setSidebarWidth(clamped);
        };

        const handleMouseUp = () => {
            setIsResizing(false);
        };

        if (isResizing) {
            window.addEventListener('mousemove', handleMouseMove);
            window.addEventListener('mouseup', handleMouseUp);
        }

        return () => {
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', handleMouseUp);
        };
    }, [isResizing]);

    const startResizing = (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsResizing(true);
        dragStartX.current = e.clientX;
        dragStartWidth.current = sidebarWidth;
    };

    const toggleGroup = (planId: string, e: React.MouseEvent) => {
        e.stopPropagation();
        const newSet = new Set(collapsedGroups);
        if (newSet.has(planId)) {
            newSet.delete(planId);
        } else {
            newSet.add(planId);
        }
        setCollapsedGroups(newSet);
    };

    const togglePage = (idx: number, e?: React.MouseEvent) => {
        if (e) e.stopPropagation();
        const newSet = new Set(expandedPages);
        if (newSet.has(idx)) {
            newSet.delete(idx);
        } else {
            newSet.add(idx);
        }
        setExpandedPages(newSet);
    };

    const handlePageClick = (idx: number) => {
        if (pageIndex === idx) {
            togglePage(idx);
        } else {
            setPageIndex(idx);
            setExpandedPages(prev => new Set(prev).add(idx));
        }
    };

    const startEditingPage = (idx: number, currentName: string) => {
        setEditingPageIndex(idx);
        setTempPageName(currentName);
    };

    const savePageName = () => {
        if (editingPageIndex !== null && tempPageName.trim()) {
            onRenamePage(editingPageIndex, tempPageName.trim());
        }
        setEditingPageIndex(null);
    };

    const handlePageKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') {
            savePageName();
        } else if (e.key === 'Escape') {
            setEditingPageIndex(null);
        }
    };

    const startEditingItem = (id: string, currentName: string) => {
        setEditingItemId(id);
        setTempItemName(currentName);
    };

    const saveItemName = () => {
        if (editingItemId && tempItemName.trim()) {
            onRenameItem(editingItemId, tempItemName.trim());
        }
        setEditingItemId(null);
    };

    const handleItemKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') {
            saveItemName();
        } else if (e.key === 'Escape') {
            setEditingItemId(null);
        }
    };

    const handleItemContextMenu = (e: React.MouseEvent, item: TakeoffItem) => {
        e.preventDefault();
        setContextMenu({ x: e.clientX, y: e.clientY, item });
    };

    return (
        <div
            className="bg-white border-r border-slate-200 flex flex-col h-full z-20 flex-shrink-0 relative font-sans text-sm"
            style={{ width: `${sidebarWidth}px` }}
        >
            {/* Resize handle */}
            <div
                className="absolute top-0 right-0 w-1 h-full cursor-col-resize hover:bg-blue-500 z-30 transition-colors opacity-0 hover:opacity-100"
                onMouseDown={startResizing}
            />

            {/* Header */}
            <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between bg-white shrink-0">
                <div className="flex items-center gap-2 overflow-hidden">
                    <div className="w-9 h-9 shrink-0">
                        <img src="/prologo.svg" alt="Logo" className="w-full h-full object-contain" />
                    </div>
                    <span className="font-semibold text-slate-800 truncate">{projectName}</span>
                </div>
                <div className="flex items-center gap-1">
                    <button onClick={onNewProject} className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-md transition-colors" title="New Project">
                        <FilePlus size={16} />
                    </button>
                    <button onClick={onLoadProject} className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-md transition-colors" title="Open Project">
                        <FolderOpen size={16} />
                    </button>
                    <button onClick={onSaveProject} className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-md transition-colors" title="Save Project (Cmd+S)">
                        <Save size={16} />
                    </button>
                    <div className="w-px h-4 bg-slate-200 mx-1"></div>
                    <button onClick={onOpenLicense} className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-md transition-colors" title="License Manager">
                        <ShieldCheck size={16} />
                    </button>
                    <button onClick={onOpenHelp} className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-md transition-colors" title="Help & Shortcuts">
                        <HelpCircle size={16} />
                    </button>
                </div>
            </div>

            {/* Estimates & Export Buttons (Moved to Top) */}
            <div className="p-2 border-b border-slate-100 bg-white flex gap-2 shrink-0">
                <button onClick={onShowEstimates} className="flex-1 py-1.5 bg-white border border-slate-200 rounded-md text-xs font-medium text-slate-700 shadow-sm hover:bg-slate-50 hover:border-slate-300 transition-all flex items-center justify-center gap-2">
                    <Table size={14} /> Estimates
                </button>
                <button onClick={onOpenExportModal} className="flex-1 py-1.5 bg-white border border-slate-200 rounded-md text-xs font-medium text-slate-700 shadow-sm hover:bg-slate-50 hover:border-slate-300 transition-all flex items-center justify-center gap-2">
                    <FileDown size={14} /> Export
                </button>
            </div>

            <div className="px-3 py-2 shrink-0">
                <div className="flex items-center justify-between px-2 mb-1">
                    <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Plans & Takeoffs</div>
                    <button onClick={onOpenUploadModal} className="text-slate-400 hover:text-blue-600 transition-colors">
                        <Plus size={14} />
                    </button>
                </div>
            </div>

            {/* Main Content List */}
            <div className="flex-1 overflow-y-auto px-1 pb-4 space-y-4">
                {planSets.length === 0 && (
                    <div className="text-center text-slate-400 text-sm mt-8 px-4">
                        No plans loaded. Click + to add plans.
                    </div>
                )}

                {/* Plan Sets Loop */}
                {planSets.map(plan => {
                    const isCollapsed = collapsedGroups.has(plan.id);
                    return (
                        <div key={plan.id} className="space-y-0.5">
                            {/* Plan Header */}
                            <div
                                className="flex items-center gap-1.5 px-1 py-1.5 text-slate-500 hover:text-slate-800 hover:bg-slate-50 rounded-md cursor-pointer transition-colors group"
                                onClick={(e) => toggleGroup(plan.id, e)}
                            >
                                <span className="text-slate-400 group-hover:text-slate-600 transition-colors">
                                    {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                                </span>
                                <span className="font-medium text-sm truncate flex-1">{plan.name}</span>
                                <span className="text-[10px] text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded-full">{plan.pageCount}</span>
                            </div>

                            {/* Pages Loop */}
                            {!isCollapsed && (
                                <div className="pl-2 space-y-0.5 border-l border-slate-100 ml-2">
                                    {Array.from({ length: plan.pageCount }).map((_, localIdx) => {
                                        const globalIdx = plan.startPageIndex + localIdx;
                                        const isPageActive = globalIdx === pageIndex;
                                        const pageName = projectData[globalIdx]?.name || `Page ${localIdx + 1}`;
                                        const pScale = projectData[globalIdx]?.scale;
                                        const isPageExpanded = expandedPages.has(globalIdx);

                                        // Filter items that have shapes on this specific page
                                        const pageItems = items.filter(item => item.shapes.some(s => s.pageIndex === globalIdx));

                                        return (
                                            <div key={globalIdx}>
                                                {/* Page Row */}
                                                <div
                                                    onClick={() => handlePageClick(globalIdx)}
                                                    className={`group flex items-center justify-between px-1 py-1.5 rounded-md cursor-pointer transition-all ${isPageActive ? 'bg-blue-50 text-blue-700' : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'}`}
                                                >
                                                    <div className="flex items-center gap-2 min-w-0 flex-1">
                                                        {editingPageIndex === globalIdx ? (
                                                            <input
                                                                autoFocus
                                                                value={tempPageName}
                                                                onChange={e => setTempPageName(e.target.value)}
                                                                onBlur={savePageName}
                                                                onKeyDown={handlePageKeyDown}
                                                                onClick={e => e.stopPropagation()}
                                                                className="flex-1 min-w-0 text-sm px-1 py-0.5 border border-blue-300 rounded bg-white text-slate-900 focus:outline-none focus:ring-1 focus:ring-blue-500"
                                                            />
                                                        ) : (
                                                            <span
                                                                className="truncate text-sm font-medium"
                                                                onDoubleClick={(e) => { e.stopPropagation(); startEditingPage(globalIdx, pageName); }}
                                                                title={pageName}
                                                            >
                                                                {pageName}
                                                            </span>
                                                        )}
                                                    </div>

                                                    <div className="flex items-center gap-1">
                                                        {pageItems.length > 0 && (
                                                            <span className="text-slate-400" title="Has items">
                                                                <Table size={12} />
                                                            </span>
                                                        )}
                                                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                                            {!pScale?.isSet && (
                                                                <span className="w-1.5 h-1.5 rounded-full bg-red-400" title="Unscaled"></span>
                                                            )}
                                                            <button
                                                                className="p-1 hover:bg-slate-200 rounded text-slate-400 hover:text-slate-600"
                                                                onClick={(e) => { e.stopPropagation(); startEditingPage(globalIdx, pageName); }}
                                                            >
                                                                <Edit2 size={12} />
                                                            </button>
                                                        </div>
                                                    </div>
                                                </div>

                                                {/* Nested Items List */}
                                                {isPageExpanded && pageItems.length > 0 && (
                                                    <div className="pl-2 mt-0.5 space-y-0.5">
                                                        {pageItems.slice().reverse().map(item => {
                                                            // Check if this item is active AND has shapes on the CURRENT active page only
                                                            const hasActiveShapesOnThisPage = activeTakeoffId === item.id && pageIndex === globalIdx && item.shapes.some(s => s.pageIndex === globalIdx);
                                                            // Only highlight if selected shapes are on THIS specific page AND it's the current page
                                                            const hasSelectedShapesOnThisPage = pageIndex === globalIdx && selectedShapes.some(s => {
                                                                if (s.itemId !== item.id) return false;
                                                                const shape = item.shapes.find(sh => sh.id === s.shapeId);
                                                                return shape && shape.pageIndex === globalIdx;
                                                            });
                                                            const isHighlighted = hasActiveShapesOnThisPage || hasSelectedShapesOnThisPage;
                                                            const pageShapes = item.shapes.filter(s => s.pageIndex === globalIdx);
                                                            const pageRawQty = pageShapes.reduce((sum, s) => {
                                                                if (s.deduction) return sum - s.value;
                                                                return sum + s.value;
                                                            }, 0);
                                                            const displayQty = evaluateFormula(item, pageRawQty);
                                                            const isEditingThisItem = editingItemId === item.id;

                                                            return (
                                                                <div
                                                                    key={item.id}
                                                                    onClick={() => onSelect(item.id)}
                                                                    onContextMenu={(e) => handleItemContextMenu(e, item)}
                                                                    className={`group flex items-center gap-1.5 px-1 py-1 rounded-md cursor-pointer transition-all border border-transparent ${isHighlighted ? 'bg-white border-blue-200 shadow-sm' : 'hover:bg-slate-50'}`}
                                                                >
                                                                    <div
                                                                        className="w-2 h-2 rounded-full shrink-0"
                                                                        style={{ backgroundColor: item.color }}
                                                                    ></div>

                                                                    {isEditingThisItem ? (
                                                                        <input
                                                                            autoFocus
                                                                            value={tempItemName}
                                                                            onChange={e => setTempItemName(e.target.value)}
                                                                            onBlur={saveItemName}
                                                                            onKeyDown={handleItemKeyDown}
                                                                            onClick={e => e.stopPropagation()}
                                                                            className="flex-1 min-w-0 text-xs px-1 py-0.5 border border-blue-300 rounded bg-white text-slate-900 focus:outline-none focus:ring-1 focus:ring-blue-500"
                                                                        />
                                                                    ) : (
                                                                        <span className={`text-xs truncate flex-1 ${isHighlighted ? 'text-slate-900 font-medium' : 'text-slate-600'}`}>
                                                                            {item.label}
                                                                        </span>
                                                                    )}

                                                                    <div className="flex items-center gap-2">
                                                                        {displayQty.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 1 })} <span className="text-[10px] text-slate-400 ml-0.5">{item.unit}</span>

                                                                        {/* Visibility Toggle */}
                                                                        <button
                                                                            onClick={(e) => {
                                                                                e.stopPropagation();
                                                                                onToggleVisibility(item.id);
                                                                            }}
                                                                            className={`p-1 rounded hover:bg-slate-100 transition-all ${item.visible === false ? 'text-slate-300' : 'text-slate-400 hover:text-slate-600 opacity-0 group-hover:opacity-100'}`}
                                                                            title={item.visible === false ? "Show Item" : "Hide Item"}
                                                                        >
                                                                            {item.visible === false ? <EyeOff size={12} /> : <Eye size={12} />}
                                                                        </button>

                                                                        {/* Record Button */}
                                                                        <button
                                                                            onClick={(e) => {
                                                                                e.stopPropagation();
                                                                                if (hasActiveShapesOnThisPage && activeTool !== ToolType.SELECT) {
                                                                                    onStop();
                                                                                } else {
                                                                                    onResume(item.id);
                                                                                }
                                                                            }}
                                                                            className={`p-1 rounded-full transition-all ${hasActiveShapesOnThisPage && activeTool !== ToolType.SELECT ? 'text-red-500 bg-red-50' : 'text-slate-300 hover:text-green-600 hover:bg-green-50 opacity-0 group-hover:opacity-100'}`}
                                                                        >
                                                                            <div className={`w-2 h-2 rounded-full ${hasActiveShapesOnThisPage && activeTool !== ToolType.SELECT ? 'bg-red-500 animate-pulse' : 'bg-current'}`} />
                                                                        </button>
                                                                    </div>
                                                                </div>
                                                            );
                                                        })}
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>

            {/* Footer */}
            <div className="p-3 border-t border-slate-100 bg-slate-50/50">
                <div className="flex items-center justify-between text-xs text-slate-500">
                    <span>{items.length} Items</span>
                    <span>{isSaving ? 'Saving...' : 'Saved'}</span>
                </div>
            </div>

            {/* Context Menu */}
            {contextMenu && (
                <>
                    <div className="fixed inset-0 z-40" onClick={() => setContextMenu(null)}></div>
                    <div
                        className="fixed z-50 bg-white shadow-xl border border-slate-100 rounded-lg py-1 w-40 flex flex-col text-xs animate-in fade-in zoom-in-95 duration-100"
                        style={{ top: contextMenu.y, left: contextMenu.x }}
                    >
                        <button
                            onClick={() => { onEditItem(contextMenu.item); setContextMenu(null); }}
                            className="px-3 py-2 text-left hover:bg-slate-50 flex items-center gap-2 text-slate-700"
                        >
                            <Settings size={14} className="text-slate-400" /> Properties
                        </button>
                        <button
                            onClick={() => { onToggleVisibility(contextMenu.item.id); setContextMenu(null); }}
                            className="px-3 py-2 text-left hover:bg-slate-50 flex items-center gap-2 text-slate-700"
                        >
                            {contextMenu.item.visible !== false ? <EyeOff size={14} className="text-slate-400" /> : <Eye size={14} className="text-slate-400" />}
                            {contextMenu.item.visible !== false ? "Hide Item" : "Show Item"}
                        </button>
                        <div className="border-t border-slate-100 my-1"></div>
                        <button
                            onClick={() => {
                                // Get all shape IDs for this item on the current page
                                const currentPageShapes = contextMenu.item.shapes
                                    .filter(s => s.pageIndex === pageIndex)
                                    .map(s => s.id);
                                setSelectedShapeIdsForChange(currentPageShapes);
                                setShowChangeItemModal(true);
                                setContextMenu(null);
                            }}
                            className="px-3 py-2 text-left hover:bg-slate-50 flex items-center gap-2 text-slate-700"
                        >
                            <Edit2 size={14} /> Change Item
                        </button>
                        <button
                            onClick={() => { onDelete(contextMenu.item.id); setContextMenu(null); }}
                            className="px-3 py-2 text-left hover:bg-red-50 flex items-center gap-2 text-red-600"
                        >
                            <Trash2 size={14} /> Delete Item
                        </button>

                        {/* New "Clear from Page" option */}
                        <div className="border-t border-slate-100 my-1"></div>
                        <button
                            onClick={() => {
                                const shapesOnPage = contextMenu.item.shapes
                                    .filter(s => s.pageIndex === pageIndex)
                                    .map(s => ({ itemId: contextMenu.item.id, shapeId: s.id }));

                                if (shapesOnPage.length > 0 && onDeleteShapes) {
                                    onDeleteShapes(shapesOnPage);
                                }
                                setContextMenu(null);
                            }}
                            className={`px-3 py-2 text-left flex items-center gap-2 ${contextMenu.item.shapes.some(s => s.pageIndex === pageIndex) ? 'hover:bg-red-50 text-red-600' : 'text-slate-300 cursor-not-allowed'}`}
                            disabled={!contextMenu.item.shapes.some(s => s.pageIndex === pageIndex)}
                        >
                            <Trash2 size={14} /> Clear from Page
                        </button>
                    </div>
                </>
            )}

            {/* Change Item Modal */}
            <ChangeItemModal
                isOpen={showChangeItemModal}
                onClose={() => setShowChangeItemModal(false)}
                onChangeItem={(targetItemId) => {
                    if (onMoveShapesToItem && contextMenu) {
                        const shapesToMove = contextMenu.item.shapes
                            .filter(s => s.pageIndex === pageIndex)
                            .map(s => ({ itemId: contextMenu.item.id, shapeId: s.id }));
                        onMoveShapesToItem(shapesToMove, targetItemId);
                    }
                    setShowChangeItemModal(false);
                }}
                items={items}
                sourceItemId={contextMenu?.item.id || ''}
                shapeIds={selectedShapeIdsForChange}
            />
        </div>
    );
};

export default Sidebar;
