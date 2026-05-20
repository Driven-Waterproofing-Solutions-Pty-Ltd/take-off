import React, { useState, useEffect, useRef } from 'react';
import { TakeoffItem, ToolType, ProjectData, PlanSet } from '../types';
import { Trash2, Upload, ChevronDown, ChevronRight, FilePlus, FolderOpen, Save, RefreshCw, Settings, Edit2, Table, Eye, EyeOff, FileDown, MoreHorizontal, Plus, HelpCircle, ShieldCheck, Target, Box } from 'lucide-react';
import { evaluateFormula } from '../utils/math';
import ChangeItemModal from './ChangeItemModal';
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "@/components/ui/tooltip"

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
    onToggleVisibility: (id: string, pageIndex: number) => void;
    onShowEstimates: () => void;
    onShow3D: () => void;
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
    onShow3D,
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
    const [sourceItemIdForChange, setSourceItemIdForChange] = useState<string | null>(null);

    // Sidebar Resizing State
    const [sidebarWidth, setSidebarWidth] = useState<number>(360);
    const [isResizing, setIsResizing] = useState(false);
    const dragStartX = useRef(0);
    const dragStartWidth = useRef(280);

    // Load saved width from localStorage on mount
    // Load saved width from localStorage on mount
    // Load saved width from localStorage on mount
    useEffect(() => {
        const savedWidth = localStorage.getItem('sidebarWidth');
        if (savedWidth) {
            const width = parseInt(savedWidth, 10);
            if (!isNaN(width) && width >= 370 && width <= 600) {
                setSidebarWidth(width);
                dragStartWidth.current = width;
            } else if (!isNaN(width) && width < 370) {
                // Enforce min width if saved value is too small
                setSidebarWidth(360);
                dragStartWidth.current = 370;
            }
        } else {
            // Default if nothing saved, ensure we start > min
            setSidebarWidth(370);
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
            const clamped = Math.max(370, Math.min(500, newWidth));
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

    // Safety check to strictly enforce min width
    useEffect(() => {
        if (sidebarWidth < 360) {
            setSidebarWidth(370);
        }
    }, [sidebarWidth]);

    return (
        <div
            className="bg-background border-r border-border flex flex-col h-full z-20 flex-shrink-0 relative font-sans text-sm shadow-xl shadow-black/5 min-w-[370px]"
            style={{ width: `${sidebarWidth}px`, minWidth: '370px' }}
        >
            {/* Resize handle */}
            <div
                className="absolute top-0 right-0 w-1 h-full cursor-col-resize hover:bg-primary z-30 transition-colors opacity-0 hover:opacity-100"
                onMouseDown={startResizing}
            />

            {/* Header */}
            <div className="px-4 py-3 border-b border-border flex items-center justify-between bg-background shrink-0">
                <div className="flex items-center gap-3 overflow-hidden">
                    <div className="w-8 h-8 shrink-0">
                        <img src="/prologo.svg" alt="Logo" className="w-full h-full object-contain" />
                    </div>
                    <span className="font-semibold text-foreground truncate text-sm">{projectName}</span>
                </div>
                <div className="flex items-center gap-0.5">
                    <TooltipProvider>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-foreground" onClick={onNewProject}>
                                    <FilePlus size={16} />
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent>New Project</TooltipContent>
                        </Tooltip>

                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-foreground" onClick={onLoadProject}>
                                    <FolderOpen size={16} />
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent>Open Project</TooltipContent>
                        </Tooltip>

                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-foreground" onClick={onSaveProject}>
                                    <Save size={16} />
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent>Save Project (Cmd+S)</TooltipContent>
                        </Tooltip>

                        <Separator orientation="vertical" className="h-4 mx-1" />

                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-primary" onClick={onOpenHelp}>
                                    <HelpCircle size={16} />
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent>Help & Shortcuts</TooltipContent>
                        </Tooltip>
                    </TooltipProvider>
                </div>
            </div>

            {/* Estimates & Export Buttons */}
            <div className="p-3 border-b border-border bg-background flex gap-2 shrink-0">
                <Button onClick={onShowEstimates} variant="outline" className="flex-1 h-8 text-xs font-medium border-dashed border-border hover:border-primary/50 hover:bg-primary/5 text-muted-foreground hover:text-primary">
                    <Table size={14} className="mr-2" /> Estimates
                </Button>
                <Button onClick={onShow3D} variant="outline" className="flex-1 h-8 text-xs font-medium border-dashed border-border hover:border-primary/50 hover:bg-primary/5 text-muted-foreground hover:text-primary">
                    <Box size={14} className="mr-2" /> 3D View
                </Button>
                <Button onClick={onOpenExportModal} variant="outline" className="flex-1 h-8 text-xs font-medium border-dashed border-border hover:border-primary/50 hover:bg-primary/5 text-muted-foreground hover:text-primary">
                    <FileDown size={14} className="mr-2" /> Export
                </Button>
            </div>

            <div className="px-4 py-2 shrink-0">
                <div className="flex items-center justify-between mb-1">
                    <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Plans & Takeoffs</div>
                    <TooltipProvider>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-muted-foreground hover:text-primary" onClick={onOpenUploadModal}>
                                    <Plus size={14} />
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent>Add Drawing</TooltipContent>
                        </Tooltip>
                    </TooltipProvider>
                </div>
            </div>

            {/* Main Content List */}
            <ScrollArea className="flex-1 px-2 pb-4 min-h-0">
                {planSets.length === 0 && (
                    <div className="flex flex-col items-center justify-center h-32 text-center text-muted-foreground text-sm px-4">
                        <p className="mb-2">No plans loaded</p>
                        <Button variant="outline" size="sm" onClick={onOpenUploadModal} className="h-7 text-xs">
                            <Upload size={12} className="mr-2" /> Upload Plans
                        </Button>
                    </div>
                )}

                {/* Plan Sets Loop */}
                {planSets.map(plan => {
                    const isCollapsed = collapsedGroups.has(plan.id);
                    return (
                        <div key={plan.id} className="space-y-0.5 mb-2">
                            {/* Plan Header */}
                            <div
                                className="flex items-center gap-1.5 px-2 py-1.5 text-foreground hover:bg-muted/50 rounded-md cursor-pointer transition-colors group"
                                onClick={(e) => toggleGroup(plan.id, e)}
                            >
                                <span className="text-muted-foreground group-hover:text-foreground transition-colors">
                                    {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                                </span>
                                <span className="font-medium text-sm truncate flex-1">{plan.name}</span>
                                <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4 min-w-[1.25rem] justify-center">{plan.pageCount}</Badge>
                            </div>

                            {/* Pages Loop */}
                            {!isCollapsed && (
                                <div className="pl-2 space-y-0.5 border-l border-border/50 ml-2.5">
                                    {Array.from({ length: plan.pageCount }).map((_, localIdx) => {
                                        const globalIdx = plan.startPageIndex + localIdx;
                                        const isPageActive = globalIdx === pageIndex;
                                        const pageName = projectData[globalIdx]?.name || `Page ${localIdx + 1}`;
                                        const pScale = projectData[globalIdx]?.scale;
                                        const isPageExpanded = expandedPages.has(globalIdx);
                                        const pageItems = items.filter(item => item.shapes.some(s => s.pageIndex === globalIdx));

                                        return (
                                            <div key={globalIdx} className="relative">
                                                {/* Page Row */}
                                                <div
                                                    onClick={() => handlePageClick(globalIdx)}
                                                    className={`group flex items-center justify-between px-2 py-1.5 rounded-md cursor-pointer transition-all ${isPageActive
                                                        ? 'bg-primary/10 text-primary font-medium'
                                                        : 'text-muted-foreground hover:bg-muted/30 hover:text-foreground'
                                                        }`}
                                                >
                                                    <div className="flex items-center gap-2 min-w-0 flex-1">
                                                        {editingPageIndex === globalIdx ? (
                                                            <Input
                                                                autoFocus
                                                                value={tempPageName}
                                                                onChange={e => setTempPageName(e.target.value)}
                                                                onBlur={savePageName}
                                                                onKeyDown={handlePageKeyDown}
                                                                onClick={e => e.stopPropagation()}
                                                                className="h-6 text-xs py-0 px-1.5"
                                                            />
                                                        ) : (
                                                            <span
                                                                className="truncate text-sm"
                                                                onDoubleClick={(e) => { e.stopPropagation(); startEditingPage(globalIdx, pageName); }}
                                                                title={pageName}
                                                            >
                                                                {pageName}
                                                            </span>
                                                        )}
                                                    </div>

                                                    <div className="flex items-center gap-1">
                                                        {pageItems.length > 0 && (
                                                            <TooltipProvider>
                                                                <Tooltip>
                                                                    <TooltipTrigger asChild>
                                                                        <Target size={12} className="text-primary" />
                                                                    </TooltipTrigger>
                                                                    <TooltipContent side="right">Has Items</TooltipContent>
                                                                </Tooltip>
                                                            </TooltipProvider>
                                                        )}
                                                        <Button
                                                            variant="ghost"
                                                            size="icon"
                                                            className={`h-5 w-5 opacity-0 group-hover:opacity-100 transition-opacity ${isPageActive ? 'text-primary' : 'text-muted-foreground'}`}
                                                            onClick={(e) => { e.stopPropagation(); startEditingPage(globalIdx, pageName); }}
                                                        >
                                                            <Edit2 size={10} />
                                                        </Button>
                                                    </div>
                                                </div>

                                                {/* Nested Items List */}
                                                {/* Connecting line for tree */}
                                                {isPageExpanded && pageItems.length > 0 && (
                                                    <div className="pl-1 mt-0.5 space-y-0.5 border-l-2 border-border/30 ml-2">
                                                        {pageItems.slice().reverse().map(item => {
                                                            const hasActiveShapesOnThisPage = activeTakeoffId === item.id && pageIndex === globalIdx && item.shapes.some(s => s.pageIndex === globalIdx);
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
                                                                    className={`group flex items-center gap-1 px-1 py-1 rounded-md cursor-pointer transition-all border border-transparent ${isHighlighted
                                                                        ? 'bg-background border-primary/20 shadow-sm ring-1 ring-primary/10'
                                                                        : 'hover:bg-muted/40 text-muted-foreground hover:text-foreground'
                                                                        }`}
                                                                >
                                                                    <div
                                                                        className="w-2.5 h-2.5 rounded-full shrink-0 shadow-sm border border-black/5"
                                                                        style={{ backgroundColor: item.color }}
                                                                    />

                                                                    {isEditingThisItem ? (
                                                                        <Input
                                                                            autoFocus
                                                                            value={tempItemName}
                                                                            onChange={e => setTempItemName(e.target.value)}
                                                                            onBlur={saveItemName}
                                                                            onKeyDown={handleItemKeyDown}
                                                                            onClick={e => e.stopPropagation()}
                                                                            className="h-5 text-xs py-0 px-1"
                                                                        />
                                                                    ) : (
                                                                        <span className={`text-xs truncate flex-1 ${isHighlighted ? 'text-foreground font-medium' : ''}`} style={{ maxWidth: '200px' }}>
                                                                            {item.label}
                                                                        </span>
                                                                    )}

                                                                    <div className="flex items-center gap-2">
                                                                        <span className={`text-xs ${isHighlighted ? 'text-primary font-semibold' : ''}`}>
                                                                            {displayQty.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 1 })}
                                                                            <span className="text-[9px] ml-0.5 opacity-70">{item.unit}</span>
                                                                        </span>

                                                                        {/* Visibility Toggle */}
                                                                        <Button
                                                                            variant="ghost"
                                                                            size="icon"
                                                                            onClick={(e) => {
                                                                                e.stopPropagation();
                                                                                onToggleVisibility(item.id, globalIdx);
                                                                            }}
                                                                            className={`h-5 w-5 ${item.visible === false || item.hiddenPages?.includes(globalIdx) ? 'text-muted-foreground/50' : 'text-muted-foreground opacity-0 group-hover:opacity-100'}`}
                                                                        >
                                                                            {item.visible === false || item.hiddenPages?.includes(globalIdx) ? <EyeOff size={10} /> : <Eye size={10} />}
                                                                        </Button>

                                                                        {/* Record Button */}
                                                                        <Button
                                                                            variant="ghost"
                                                                            size="icon"
                                                                            onClick={(e) => {
                                                                                e.stopPropagation();
                                                                                if (hasActiveShapesOnThisPage && activeTool !== ToolType.SELECT) {
                                                                                    onStop();
                                                                                } else {
                                                                                    onResume(item.id);
                                                                                }
                                                                            }}
                                                                            className={`h-5 w-5 p-0 rounded-full ${hasActiveShapesOnThisPage && activeTool !== ToolType.SELECT ? 'text-red-500 bg-red-50 hover:bg-red-100 hover:text-red-600' : 'text-muted-foreground/50 hover:text-green-600 hover:bg-green-50 opacity-0 group-hover:opacity-100'}`}
                                                                        >
                                                                            <div className={`w-2 h-2 rounded-full ${hasActiveShapesOnThisPage && activeTool !== ToolType.SELECT ? 'bg-red-500 animate-pulse ring-2 ring-red-200' : 'bg-current'}`} />
                                                                        </Button>
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
            </ScrollArea>

            {/* Footer */}
            <div className="p-3 border-t border-border bg-muted/20">
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>{items.length} Items</span>
                    <span className="flex items-center gap-1">
                        {isSaving ? <RefreshCw size={10} className="animate-spin" /> : null}
                        {isSaving ? 'Saving...' : 'Saved'}
                    </span>
                </div>
            </div>

            {/* Context Menu (Custom Styled Popover) */}
            {contextMenu && (
                <>
                    <div className="fixed inset-0 z-40" onClick={() => setContextMenu(null)}></div>
                    <div
                        className="fixed z-50 min-w-[8rem] overflow-hidden rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md animate-in fade-in zoom-in-95 duration-100 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2"
                        style={{ top: contextMenu.y, left: contextMenu.x }}
                    >
                        <div
                            onClick={() => { onEditItem(contextMenu.item); setContextMenu(null); }}
                            className="relative flex cursor-pointer select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-accent hover:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50"
                        >
                            <Settings size={14} className="mr-2 h-4 w-4" /> Properties
                        </div>
                        <div
                            onClick={() => { onToggleVisibility(contextMenu.item.id, pageIndex); setContextMenu(null); }}
                            className="relative flex cursor-pointer select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-accent hover:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50"
                        >
                            {contextMenu.item.visible !== false && !contextMenu.item.hiddenPages?.includes(pageIndex) ? <Eye size={14} className="mr-2 h-4 w-4" /> : <EyeOff size={14} className="mr-2 h-4 w-4" />}
                            {contextMenu.item.visible !== false && !contextMenu.item.hiddenPages?.includes(pageIndex) ? "Hide Item" : "Show Item"}
                        </div>
                        <Separator className="my-1" />
                        <div
                            onClick={() => {
                                const currentPageShapes = contextMenu.item.shapes
                                    .filter(s => s.pageIndex === pageIndex)
                                    .map(s => s.id);
                                setSourceItemIdForChange(contextMenu.item.id);
                                setSelectedShapeIdsForChange(currentPageShapes);
                                setShowChangeItemModal(true);
                                setContextMenu(null);
                            }}
                            className="relative flex cursor-pointer select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-accent hover:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50"
                        >
                            <Edit2 size={14} className="mr-2 h-4 w-4" /> Change Item
                        </div>
                        <div
                            onClick={() => {
                                const shapesOnPage = contextMenu.item.shapes
                                    .filter(s => s.pageIndex === pageIndex)
                                    .map(s => ({ itemId: contextMenu.item.id, shapeId: s.id }));

                                if (shapesOnPage.length > 0 && onDeleteShapes) {
                                    onDeleteShapes(shapesOnPage);
                                }
                                setContextMenu(null);
                            }}
                            className={`relative flex cursor-pointer select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-destructive/10 hover:text-destructive data-[disabled]:pointer-events-none data-[disabled]:opacity-50 ${!contextMenu.item.shapes.some(s => s.pageIndex === pageIndex) ? 'opacity-50 cursor-not-allowed' : ''}`}
                        >
                            <Trash2 size={14} className="mr-2 h-4 w-4" /> Delete Item
                        </div>
                    </div>
                </>
            )}

            {/* Change Item Modal */}
            <ChangeItemModal
                isOpen={showChangeItemModal}
                onClose={() => {
                    setShowChangeItemModal(false);
                    setSourceItemIdForChange(null);
                }}
                onChangeItem={(targetItemId) => {
                    if (onMoveShapesToItem && sourceItemIdForChange) {
                        const sourceItem = items.find(i => i.id === sourceItemIdForChange);
                        if (sourceItem) {
                            const shapesToMove = sourceItem.shapes
                                .filter(s => s.pageIndex === pageIndex)
                                .map(s => ({ itemId: sourceItemIdForChange, shapeId: s.id }));
                            onMoveShapesToItem(shapesToMove, targetItemId);
                        }
                    }
                    setShowChangeItemModal(false);
                    setSourceItemIdForChange(null);
                }}
                items={items}
                sourceItemId={sourceItemIdForChange || ''}
                shapeIds={selectedShapeIdsForChange}
            />
        </div>
    );
};

export default Sidebar;
