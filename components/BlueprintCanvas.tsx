
import React, { useState, useRef, useEffect, useImperativeHandle, forwardRef, useMemo } from 'react';
import { Document, Page } from 'react-pdf';
import { Point, ToolType, TakeoffItem, Shape, Unit, LegendSettings } from '../types';
import { calculateDistance, calculatePolylineLength, calculatePolygonArea, getScaledValue, getScaledArea, parseDimensionInput, PresetScale, isPointInPolygon, PRESET_SCALES } from '../utils/geometry';
import { AlertCircle, Trash2, Scissors, Plus, Eraser, MessageSquare, Ruler, Edit2 } from 'lucide-react';
import '../utils/pdfWorker';
import { useToast } from '../contexts/ToastContext';
import DraggableLegend from './DraggableLegend';
import NoteInputModal from './NoteInputModal';
import PasteOptionsModal from './PasteOptionsModal';
import ChangeItemModal from './ChangeItemModal';

// Removed html2canvas import as we now use pdf-lib for vector export

export interface BlueprintCanvasRef {
    // Legacy ref methods can be removed if unused, but keeping generic ref for future
}

interface BlueprintCanvasProps {
    file: File | null;
    localPageIndex: number;  // The index within the specific file (0-based)
    globalPageIndex: number; // The project-wide index (for saving shapes)
    onPageWidthChange: (width: number) => void;
    activeTool: ToolType;
    items: TakeoffItem[];
    activeTakeoffId: string | null;
    isDeductionMode?: boolean; // Prop to indicate we are cutting out
    onEnableDeduction?: (itemId: string) => void;
    onSelectTakeoffItem: (id: string | null) => void;
    onSelectionChanged?: (selectedShapes: { itemId: string, shapeId: string }[]) => void;
    onShapeCreated: (shape: Shape) => void;
    onUpdateShape?: (itemId: string, shapeId: string, updates: Partial<Shape>) => void;
    onUpdateShapeTransient?: (itemId: string, shape: Shape) => void;
    onBatchUpdateShapesTransient?: (updates: { itemId: string, shape: Shape }[]) => void;
    onSplitShape: (itemId: string, existingShape: Shape, newShape: Shape) => void;
    onUpdateScale: (pixels: number, realValue: number, unit: Unit) => void;
    onUpdateLegend: (settings: Partial<LegendSettings>) => void;
    legendSettings: LegendSettings;
    onDeleteShape: (itemId: string, shapeId: string) => void;
    onDeleteShapes?: (shapes: { itemId: string, shapeId: string }[]) => void;
    onBatchCreateItems?: (itemsToCreate: { newItemId?: string, sourceItemId: string, shapes: Shape[] }[]) => void;
    onBatchAddShapes?: (shapes: { itemId: string, shape: Shape }[]) => void;
    onMoveShapesToItem?: (shapesToMove: { itemId: string, shapeId: string }[], targetItemId: string) => void;
    onStopRecording: () => void;
    scaleInfo: { isSet: boolean, ppu: number, unit: Unit };
    zoomLevel: number;
    setZoomLevel: (z: number) => void;
    pendingPreset?: PresetScale | null;
    clearPendingPreset?: () => void;
    onInteractionEnd?: () => void;
    onPageLoaded?: () => void;
}

// Fixed scale ensures coordinate system is consistent across devices.
// 2.0 = ~144 DPI (Double standard 72 DPI), good balance of quality and performance.
const RENDER_SCALE = 2.0;
const SNAP_THRESHOLD_PX = 15; // Snapping radius in screen pixels

interface ContextMenuState {
    x: number;
    y: number;
    itemId: string;
    shapeId?: string; // Optional because sometimes we right click the item generically, though usually a shape
    pointIndex?: number; // Optional if we clicked the body, not a vertex
    insertIndex?: number; // Index to insert a new point (for Add Point)
    insertPoint?: Point; // Coordinates of new point (for Add Point)
}

const getClosestPointOnSegment = (p: Point, a: Point, b: Point): Point => {
    const atob = { x: b.x - a.x, y: b.y - a.y };
    const atop = { x: p.x - a.x, y: p.y - a.y };
    const lenSq = atob.x * atob.x + atob.y * atob.y;
    let t = 0;
    if (lenSq > 0) {
        t = (atop.x * atob.x + atop.y * atob.y) / lenSq;
    }
    t = Math.max(0, Math.min(1, t));
    return {
        x: a.x + t * atob.x,
        y: a.y + t * atob.y
    };
};

// Helper: Check if a point is inside a rectangle
const isPointInRect = (point: Point, rectStart: Point, rectEnd: Point): boolean => {
    const minX = Math.min(rectStart.x, rectEnd.x);
    const maxX = Math.max(rectStart.x, rectEnd.x);
    const minY = Math.min(rectStart.y, rectEnd.y);
    const maxY = Math.max(rectStart.y, rectEnd.y);
    return point.x >= minX && point.x <= maxX && point.y >= minY && point.y <= maxY;
};

// Helper: Check if a line segment intersects with a rectangle
const isSegmentIntersectingRect = (p1: Point, p2: Point, rectStart: Point, rectEnd: Point): boolean => {
    // If either endpoint is inside the rectangle, it intersects
    if (isPointInRect(p1, rectStart, rectEnd) || isPointInRect(p2, rectStart, rectEnd)) {
        return true;
    }

    // Check if the segment crosses any of the rectangle's edges
    const minX = Math.min(rectStart.x, rectEnd.x);
    const maxX = Math.max(rectStart.x, rectEnd.x);
    const minY = Math.min(rectStart.y, rectEnd.y);
    const maxY = Math.max(rectStart.y, rectEnd.y);

    const rectCorners = [
        { x: minX, y: minY },
        { x: maxX, y: minY },
        { x: maxX, y: maxY },
        { x: minX, y: maxY }
    ];

    // Check intersection with each edge of the rectangle
    for (let i = 0; i < 4; i++) {
        const r1 = rectCorners[i];
        const r2 = rectCorners[(i + 1) % 4];

        // Line segment intersection check
        const denom = (p2.y - p1.y) * (r2.x - r1.x) - (p2.x - p1.x) * (r2.y - r1.y);
        if (Math.abs(denom) > 0.0001) {
            const ua = ((p2.x - p1.x) * (r1.y - p1.y) - (p2.y - p1.y) * (r1.x - p1.x)) / denom;
            const ub = ((r2.x - r1.x) * (r1.y - p1.y) - (r2.y - r1.y) * (r1.x - p1.x)) / denom;
            if (ua >= 0 && ua <= 1 && ub >= 0 && ub <= 1) {
                return true;
            }
        }
    }

    return false;
};

// Helper: Check if a shape intersects with the selection rectangle
const isShapeIntersectingRect = (shape: Shape, rectStart: Point, rectEnd: Point): boolean => {
    // Check if any point is inside the rectangle
    for (const point of shape.points) {
        if (isPointInRect(point, rectStart, rectEnd)) {
            return true;
        }
    }

    // For shapes with multiple points, check if any segment intersects
    if (shape.points.length > 1) {
        for (let i = 0; i < shape.points.length - 1; i++) {
            if (isSegmentIntersectingRect(shape.points[i], shape.points[i + 1], rectStart, rectEnd)) {
                return true;
            }
        }
    }

    return false;
};

// Helper function to copy selected items to clipboard
const copySelectedItems = (
    items: TakeoffItem[],
    selectedItems: { itemId: string, shapeId: string }[],
    selectedShape: { itemId: string, shapeId: string } | null
): { itemId: string, shapeId: string, offset: Point }[] => {
    const itemsToCopy: { itemId: string, shapeId: string, offset: Point }[] = [];

    // If we have rectangle-selected items, copy those
    if (selectedItems.length > 0) {
        selectedItems.forEach(({ itemId, shapeId }) => {
            const item = items.find(i => i.id === itemId);
            const shape = item?.shapes.find(s => s.id === shapeId);
            if (shape) {
                // Store with zero offset since we want to paste at exact original positions
                itemsToCopy.push({ itemId, shapeId, offset: { x: 0, y: 0 } });
            }
        });
    }
    // If we have a single selected shape, copy that
    else if (selectedShape) {
        const item = items.find(i => i.id === selectedShape.itemId);
        const shape = item?.shapes.find(s => s.id === selectedShape.shapeId);
        if (shape) {
            itemsToCopy.push({
                itemId: selectedShape.itemId,
                shapeId: selectedShape.shapeId,
                offset: { x: 0, y: 0 } // No offset for single shape
            });
        }
    }

    return itemsToCopy;
};

// Helper function to paste items from clipboard back to their original items
const pasteToOriginalItems = (
    items: TakeoffItem[],
    clipboardItems: { itemId: string, shapeId: string, offset: Point }[],
    globalPageIndex: number,
    onBatchAddShapes: (shapes: { itemId: string, shape: Shape }[]) => void,
    setPendingSelection: (selection: { itemId: string, shapeId: string }[]) => void
) => {
    if (clipboardItems.length === 0) {
        return;
    }

    const shapesToAdd: { itemId: string, shape: Shape }[] = [];
    const newShapeIds: { itemId: string, shapeId: string }[] = [];

    // Find the original items to get their properties
    clipboardItems.forEach(clipboardItem => {
        const originalItem = items.find(i => i.id === clipboardItem.itemId);
        const originalShape = originalItem?.shapes.find(s => s.id === clipboardItem.shapeId);

        if (originalItem && originalShape) {
            // Create a new shape with the same properties but offset position
            const newPoints = originalShape.points.map(point => ({
                x: point.x + clipboardItem.offset.x,
                y: point.y + clipboardItem.offset.y
            }));

            const newShape: Shape = {
                id: crypto.randomUUID(),
                pageIndex: globalPageIndex,
                points: newPoints,
                value: originalShape.value,
                deduction: originalShape.deduction,
                text: originalShape.text
            };

            shapesToAdd.push({ itemId: clipboardItem.itemId, shape: newShape });
            newShapeIds.push({ itemId: clipboardItem.itemId, shapeId: newShape.id });
        }
    });

    if (shapesToAdd.length > 0) {
        onBatchAddShapes(shapesToAdd);
        setPendingSelection(newShapeIds);
    }
};

// Helper function to prepare payload for pasting as new items
const getPasteAsNewItemsPayload = (
    items: TakeoffItem[],
    clipboardItems: { itemId: string, shapeId: string, offset: Point }[],
    globalPageIndex: number
): { payload: { newItemId: string, sourceItemId: string, shapes: Shape[] }[], newSelectedItems: { itemId: string, shapeId: string }[] } => {
    if (clipboardItems.length === 0) {
        return { payload: [], newSelectedItems: [] };
    }

    // Group clipboard items by their source item ID
    const itemsBySource = clipboardItems.reduce((acc, clipboardItem) => {
        if (!acc[clipboardItem.itemId]) {
            acc[clipboardItem.itemId] = [];
        }
        acc[clipboardItem.itemId].push(clipboardItem);
        return acc;
    }, {} as Record<string, typeof clipboardItems>);

    const payload: { newItemId: string, sourceItemId: string, shapes: Shape[] }[] = [];
    const newSelectedItems: { itemId: string, shapeId: string }[] = [];

    // Process each source group
    Object.entries(itemsBySource).forEach(([sourceItemId, groupItems]) => {
        const sourceItem = items.find(i => i.id === sourceItemId);
        if (!sourceItem) return;

        const newShapes: Shape[] = [];
        const newItemId = crypto.randomUUID();

        groupItems.forEach(clipboardItem => {
            const originalShape = sourceItem.shapes.find(s => s.id === clipboardItem.shapeId);
            if (originalShape) {
                // Create a new shape with offset position
                const newPoints = originalShape.points.map(point => ({
                    x: point.x + clipboardItem.offset.x,
                    y: point.y + clipboardItem.offset.y
                }));

                const newShape: Shape = {
                    id: crypto.randomUUID(),
                    pageIndex: globalPageIndex,
                    points: newPoints,
                    value: originalShape.value,
                    deduction: originalShape.deduction,
                    text: originalShape.text
                };
                newShapes.push(newShape);
                newSelectedItems.push({ itemId: newItemId, shapeId: newShape.id });
            }
        });

        if (newShapes.length > 0) {
            payload.push({ newItemId, sourceItemId, shapes: newShapes });
        }
    });

    return { payload, newSelectedItems };
};

const BlueprintCanvas = forwardRef<BlueprintCanvasRef, BlueprintCanvasProps>(({
    file,
    localPageIndex,
    globalPageIndex,
    onPageWidthChange,
    activeTool,
    items,
    activeTakeoffId,
    isDeductionMode = false,
    onEnableDeduction,
    onSelectTakeoffItem,
    onSelectionChanged,
    onShapeCreated,
    onUpdateShape,
    onUpdateShapeTransient,
    onBatchUpdateShapesTransient,
    onSplitShape,
    onUpdateScale,
    onUpdateLegend,
    legendSettings,
    onDeleteShape,
    onDeleteShapes,
    onStopRecording,
    onBatchCreateItems,
    onBatchAddShapes,
    onMoveShapesToItem,
    scaleInfo,
    zoomLevel,
    setZoomLevel,
    pendingPreset,
    clearPendingPreset,
    onInteractionEnd,
    onPageLoaded
}, ref) => {
    const { addToast } = useToast();
    const viewportRef = useRef<HTMLDivElement>(null);
    const containerRef = useRef<HTMLDivElement>(null); // For PDF (CSS Transform)
    const svgLayerRef = useRef<SVGGElement>(null); // For Shapes (SVG Transform)
    const legendContainerRef = useRef<HTMLDivElement>(null); // For Legend (CSS Transform, Top Layer)
    const loupeRef = useRef<HTMLCanvasElement>(null);

    const [contentWidth, setContentWidth] = useState(0);
    const [originalPdfWidth, setOriginalPdfWidth] = useState(0);
    const [pdfAspectRatio, setPdfAspectRatio] = useState<number>(0);
    const [fileUrl, setFileUrl] = useState<string | null>(null);

    // Track if we have performed the initial "Fit to Screen" for the current file
    const [isFitted, setIsFitted] = useState(false);

    const transform = useRef({ x: 0, y: 0, scale: 1 });
    const [isDragging, setIsDragging] = useState(false);
    const dragStart = useRef({ x: 0, y: 0 });
    const transformStart = useRef({ x: 0, y: 0 });

    const [drawingPoints, setDrawingPoints] = useState<Point[]>([]);
    const [tempPoint, setTempPoint] = useState<Point | null>(null);
    const [snapPoint, setSnapPoint] = useState<Point | null>(null);

    const [showScaleModal, setShowScaleModal] = useState(false);
    const [scaleInputStr, setScaleInputStr] = useState<string>('');
    const [scaleUnit, setScaleUnit] = useState<Unit>(Unit.FEET);

    const [showLoupe, setShowLoupe] = useState(false);
    const [loupePos, setLoupePos] = useState({ x: 0, y: 0 });

    // Selection state
    const [selectedShape, setSelectedShape] = useState<{ itemId: string, shapeId: string } | null>(null);
    // State for dragging a specific point of an existing shape
    const [draggedVertex, setDraggedVertex] = useState<{ itemId: string, shapeId: string, pointIndex: number } | null>(null);
    // State for dragging entire shapes (all points together) - supports single or multiple shapes
    const [draggedShapes, setDraggedShapes] = useState<{ itemId: string, shapeId: string, initialPoints: Point[] }[]>([]);
    const dragStartPoint = useRef<Point | null>(null);
    const [noteModal, setNoteModal] = useState<{ isOpen: boolean, text: string, itemId?: string, shapeId?: string, points?: Point[] }>({ isOpen: false, text: '' });
    // Context Menu State
    const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);

    // Rectangle Selection State
    const [selectionRect, setSelectionRect] = useState<{ start: Point, end: Point, active: boolean } | null>(null);
    const [selectedItems, setSelectedItems] = useState<{ itemId: string, shapeId: string }[]>([]);
    const [isRectSelecting, setIsRectSelecting] = useState(false);
    const justCompletedRectSelection = useRef(false);
    const isDeletingRef = useRef(false);
    const selectedItemsRef = useRef<{ itemId: string, shapeId: string }[]>([]);

    // Clipboard state for copy/paste functionality
    const [clipboardItems, setClipboardItems] = useState<{ itemId: string, shapeId: string, offset: Point }[]>([]);

    // Paste options modal state
    const [showPasteOptions, setShowPasteOptions] = useState(false);
    
    // State to track pending selection after paste
    const [pendingSelection, setPendingSelection] = useState<{ itemId: string, shapeId: string }[] | null>(null);

    // Change Item Modal State
    const [showChangeItemModal, setShowChangeItemModal] = useState(false);
    const [selectedShapeIdsForChange, setSelectedShapeIdsForChange] = useState<string[]>([]);

    // Keep ref in sync with state
    useEffect(() => {
        selectedItemsRef.current = selectedItems;
    }, [selectedItems]);

    // Effect to maintain selection after items update (e.g., after pasting)
    useEffect(() => {
        // Check if we have a pending selection to apply after items update
        if (pendingSelection) {
            console.log('[SELECTION EFFECT] Items updated, applying pending selection:', pendingSelection);
            
            // Verify that all selected items exist in the new items array
            const validSelections = pendingSelection.filter(({ itemId, shapeId }) => {
                const item = items.find(i => i.id === itemId);
                const exists = item && item.shapes.some(s => s.id === shapeId);
                return exists;
            });
            
            if (validSelections.length > 0) {
                console.log('[SELECTION EFFECT] Setting selected items:', validSelections);
                setSelectedItems(validSelections);
                
                // If only one item is selected, we can also set selectedShape for backward compatibility
                // (though rectangular selection logic handles arrays of shapes)
                if (validSelections.length === 1) {
                    setSelectedShape(validSelections[0]);
                }
                setPendingSelection(null);
            } else {
                console.log('[SELECTION EFFECT] No valid selections found after update');
            }
        } else if (selectedItems.length > 0) {
            // This block handles cases where we didn't just paste, but items updated
            // We want to preserve existing selection if possible
            const validSelections = selectedItems.filter(({ itemId, shapeId }) => {
                const item = items.find(i => i.id === itemId);
                return item && item.shapes.some(s => s.id === shapeId);
            });
            
            // Only update if some selections became invalid
            if (validSelections.length !== selectedItems.length) {
                setSelectedItems(validSelections);
            }
        }
    }, [items, pendingSelection]); // Add pendingSelection to dependencies

    // Notify parent when selection changes
    useEffect(() => {
        if (onSelectionChanged) {
            onSelectionChanged(selectedItems);
        }
    }, [selectedItems, onSelectionChanged]);

    // Calculate visual scale factor to keep lines/markers constant size on screen
    const currentScale = zoomLevel / RENDER_SCALE;
    const visualScaleFactor = 1 / Math.max(currentScale, 0.0001);

    const scaleLabel = useMemo(() => {
        if (!scaleInfo.isSet) return "Scale Not Set";
        const match = PRESET_SCALES.find(p => Math.abs(p.pointsPerUnit - scaleInfo.ppu) < 0.001 && p.unit === scaleInfo.unit);
        if (match) return match.label;
        return "Custom Scale";
    }, [scaleInfo]);

    // Calculate Focused Shapes (The specific shape selected, plus any relevant children like cutouts)
    const focusedShapeIds = useMemo(() => {
        if (!activeTakeoffId) return new Set<string>();
        const activeItem = items.find(i => i.id === activeTakeoffId);
        if (!activeItem) return new Set<string>();

        // If no specific shape selected (e.g. sidebar selection), select ALL for that item
        if (!selectedShape || selectedShape.itemId !== activeTakeoffId) {
            return new Set(activeItem.shapes.map(s => s.id));
        }

        // Specific shape is selected
        const targetShape = activeItem.shapes.find(s => s.id === selectedShape.shapeId);
        if (!targetShape) return new Set<string>();

        const ids = new Set<string>();
        ids.add(targetShape.id);

        // If it's a positive Area, include its holes in the selection for context
        if (activeItem.type === ToolType.AREA && !targetShape.deduction) {
            const holes = activeItem.shapes.filter(s => s.deduction && s.points.length > 0 && isPointInPolygon(s.points[0], targetShape.points));
            holes.forEach(h => ids.add(h.id));
        }

        return ids;
    }, [selectedShape, activeTakeoffId, items]);

    // Reset state when file/page changes
    useEffect(() => {
        setContentWidth(0);
        setIsFitted(false);
        updateTransform(0, 0, 1);
    }, [file, localPageIndex, globalPageIndex]);

    // Create Blob URL for the file to ensure react-pdf can read it
    useEffect(() => {
        if (!file) {
            setFileUrl(null);
            return;
        }

        // If it's already a URL string (unlikely given types but possible), use it
        if (typeof file === 'string') {
            setFileUrl(file);
            return;
        }

        try {
            const url = URL.createObjectURL(file);
            setFileUrl(url);
            return () => URL.revokeObjectURL(url);
        } catch (error) {
            console.error("Error creating object URL for PDF:", error);
            setFileUrl(null);
        }
    }, [file]);

    // Handle Initial Fit-to-Screen
    useEffect(() => {
        if (!viewportRef.current) return;

        const resizeObserver = new ResizeObserver((entries) => {
            for (const entry of entries) {
                // Only trigger fit if we have content and haven't fitted yet
                if (contentWidth > 0 && !isFitted) {
                    const width = entry.contentRect.width;
                    if (width > 0) {
                        const fitScale = width / contentWidth;
                        const newZoom = fitScale * RENDER_SCALE;

                        setZoomLevel(newZoom);
                        updateTransform(0, 0, fitScale);
                        setIsFitted(true);
                    }
                }
            }
        });

        resizeObserver.observe(viewportRef.current);
        return () => resizeObserver.disconnect();
    }, [contentWidth, isFitted, setZoomLevel]);

    // Handle Manual Zoom Updates
    useEffect(() => {
        if (contentWidth === 0 || !viewportRef.current) return;
        const targetScale = zoomLevel / RENDER_SCALE;

        if (Math.abs(targetScale - transform.current.scale) > 0.00001) {
            const rect = viewportRef.current.getBoundingClientRect();
            const cx = rect.width / 2;
            const cy = rect.height / 2;

            const wx = (cx - transform.current.x) / transform.current.scale;
            const wy = (cy - transform.current.y) / transform.current.scale;

            const newX = cx - (wx * targetScale);
            const newY = cy - (wy * targetScale);

            updateTransform(newX, newY, targetScale);
        }
    }, [zoomLevel, contentWidth]);

    useEffect(() => {
        if (pendingPreset && clearPendingPreset && originalPdfWidth > 0) {
            onUpdateScale(pendingPreset.pointsPerUnit, 1, pendingPreset.unit);
            clearPendingPreset();
        }
    }, [pendingPreset, originalPdfWidth]);

    // Handle keyboard shortcuts including copy/paste
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            // Ignore key events when target is an input, textarea, or contenteditable element
            const target = e.target as HTMLElement;
            if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
                return;
            }

            // Copy selected items (Ctrl+C)
            if ((e.ctrlKey || e.metaKey) && e.key === 'c') {
                e.preventDefault();
                e.stopPropagation();

                const itemsToCopy = copySelectedItems(items, selectedItems, selectedShape);
                if (itemsToCopy.length > 0) {
                    setClipboardItems(itemsToCopy);
                    addToast(`${itemsToCopy.length} item(s) copied to clipboard`, 'success');
                } else {
                    addToast('No items selected to copy', 'info');
                }
                return;
            }

            // Paste items (Ctrl+V) - now shows options modal
            if ((e.ctrlKey || e.metaKey) && e.key === 'v') {
                e.preventDefault();
                e.stopPropagation();

                if (clipboardItems.length > 0) {
                    setShowPasteOptions(true);
                } else {
                    addToast('Clipboard is empty', 'info');
                }
                return;
            }

            // Delete selected items (either single or multiple)
            if (e.key === 'Delete' || e.key === 'Backspace') {
                // Use ref to get current value and avoid stale closures
                const currentSelectedItems = selectedItemsRef.current;

                if (currentSelectedItems.length > 0) {
                    // Prevent multiple rapid deletions
                    if (isDeletingRef.current) {
                        console.log('[BATCH DELETE] Already deleting, ignoring duplicate event');
                        e.preventDefault();
                        e.stopPropagation();
                        return;
                    }

                    e.preventDefault();
                    e.stopPropagation();
                    isDeletingRef.current = true;

                    console.log('[BATCH DELETE] Starting batch deletion');
                    console.log('[BATCH DELETE] Selected items count:', currentSelectedItems.length);
                    console.log('[BATCH DELETE] Selected items:', currentSelectedItems);

                    // Clear selection first
                    setSelectedItems([]);

                    // Use batch delete if available, otherwise fall back to individual deletes
                    if (onDeleteShapes) {
                        console.log('[BATCH DELETE] Using batch delete API');
                        onDeleteShapes(currentSelectedItems);
                        console.log('[BATCH DELETE] Batch delete completed');
                    } else {
                        console.log('[BATCH DELETE] No batch API, using individual deletes');
                        currentSelectedItems.forEach(({ itemId, shapeId }, index) => {
                            console.log(`[BATCH DELETE] Deleting item ${index + 1}/${currentSelectedItems.length}:`, { itemId, shapeId });
                            onDeleteShape(itemId, shapeId);
                        });
                        console.log('[BATCH DELETE] Individual deletes completed');
                    }

                    // Reset the deletion flag
                    setTimeout(() => {
                        isDeletingRef.current = false;
                        console.log('[BATCH DELETE] Deletion flag reset');
                    }, 100);
                } else if (selectedShape) {
                    e.preventDefault();
                    e.stopPropagation();
                    console.log('[SINGLE DELETE] Deleting single shape:', selectedShape);
                    onDeleteShape(selectedShape.itemId, selectedShape.shapeId);
                    setSelectedShape(null);
                }
            }

            if (e.key === 'Escape') {
                if (contextMenu) {
                    setContextMenu(null);
                } else if (selectedItems.length > 0) {
                    // Clear rectangle selection
                    setSelectedItems([]);
                } else if (activeTool !== ToolType.SELECT) {
                    onStopRecording();
                } else if (selectedShape) {
                    setSelectedShape(null);
                    onSelectTakeoffItem(null);
                }
            }

            if (e.key === 'Enter' || e.key === 'n' || e.key === 'N') {
                if (activeTool === ToolType.COUNT) {
                    e.preventDefault();
                    onStopRecording();
                    return;
                }

                if (drawingPoints.length > 0 && !showScaleModal) {
                    if (activeTool === ToolType.AREA && drawingPoints.length < 3) return;
                    if (activeTool === ToolType.LINEAR && drawingPoints.length < 2) return;
                    e.preventDefault();
                    finalizeMeasurement(drawingPoints);
                }
            }
        };
        // Use capture: true to ensure this handler runs before global shortcuts
        window.addEventListener('keydown', handleKeyDown, { capture: true });
        return () => window.removeEventListener('keydown', handleKeyDown, { capture: true });
    }, [selectedShape, selectedItems, drawingPoints, showScaleModal, activeTool, onStopRecording, contextMenu]);

    useEffect(() => {
        if (activeTool !== ToolType.SELECT) {
            setSelectedShape(null);
            setDraggedVertex(null);
            setDraggedShapes([]);
            dragStartPoint.current = null;
            setContextMenu(null);
        }
    }, [activeTool]);

    const updateTransform = (x: number, y: number, scale: number) => {
        transform.current = { x, y, scale };
        const transformString = `translate(${x}px, ${y}px) scale(${scale})`;

        // Apply CSS transform to PDF for performance
        if (containerRef.current) {
            containerRef.current.style.transform = transformString;
        }
        // Apply CSS transform to Legend Container
        if (legendContainerRef.current) {
            legendContainerRef.current.style.transform = transformString;
        }
        // Apply SVG transform attribute to Vector layer for crisp rendering
        if (svgLayerRef.current) {
            svgLayerRef.current.setAttribute('transform', `translate(${x}, ${y}) scale(${scale})`);
        }
    };

    // Attach non-passive wheel listener for smooth zooming prevention
    useEffect(() => {
        const node = viewportRef.current;
        if (!node) return;

        const handleWheel = (e: WheelEvent) => {
            e.preventDefault();
            if (contextMenu) setContextMenu(null);

            const rect = node.getBoundingClientRect();
            const mx = e.clientX - rect.left;
            const my = e.clientY - rect.top;

            const cx = (mx - transform.current.x) / transform.current.scale;
            const cy = (my - transform.current.y) / transform.current.scale;

            const ZOOM_SPEED = 0.2;
            const delta = -Math.sign(e.deltaY);
            const minScale = 0.1 / RENDER_SCALE;
            const maxScale = 20 / RENDER_SCALE;

            const newScale = Math.max(minScale, Math.min(maxScale, transform.current.scale * (1 + delta * ZOOM_SPEED)));

            const newX = mx - cx * newScale;
            const newY = my - cy * newScale;

            updateTransform(newX, newY, newScale);
            setZoomLevel(newScale * RENDER_SCALE);
        };

        node.addEventListener('wheel', handleWheel, { passive: false });
        return () => {
            node.removeEventListener('wheel', handleWheel);
        };
    }, [contextMenu, setZoomLevel]);

    const handleMouseDown = (e: React.MouseEvent) => {
        if (contextMenu) setContextMenu(null);

        const isMiddleClick = e.button === 1;
        const isSelectToolLeftClick = activeTool === ToolType.SELECT && e.button === 0;

        // If dragging vertex, we don't pan or select
        if (draggedVertex) return;

        // For SELECT tool with left click, we need to determine if this is:
        // 1. Clicking on a shape (handled by shape's onClick)
        // 2. Dragging to create selection rectangle (handled here)
        // 3. Panning (middle click or after rectangle selection fails)

        if (isSelectToolLeftClick && viewportRef.current) {
            // Start tracking for potential rectangle selection
            const point = getInternalCoordinates(e.clientX, e.clientY);
            setSelectionRect({ start: point, end: point, active: true });
            setIsRectSelecting(false); // Not yet confirmed as rect selection
            dragStart.current = { x: e.clientX, y: e.clientY };
            transformStart.current = { x: transform.current.x, y: transform.current.y };
            e.preventDefault();
        } else if (isMiddleClick && viewportRef.current) {
            // Middle click always pans
            setIsDragging(true);
            dragStart.current = { x: e.clientX, y: e.clientY };
            transformStart.current = { x: transform.current.x, y: transform.current.y };
            e.preventDefault();
        }
    };

    const getClosestSnapPoint = (cursor: Point, excludePoint?: Point): Point | null => {
        const threshold = SNAP_THRESHOLD_PX / transform.current.scale;
        let closest: Point | null = null;
        let minDist = Infinity;

        if (drawingPoints.length > 0) {
            const startPt = drawingPoints[0];
            if (!excludePoint || (startPt.x !== excludePoint.x || startPt.y !== excludePoint.y)) {
                const d = calculateDistance(cursor, startPt);
                if (d < threshold && d < minDist) {
                    minDist = d;
                    closest = startPt;
                }
            }
        }

        items.forEach(item => {
            if (item.visible === false) return;
            item.shapes.filter(s => s.pageIndex === globalPageIndex).forEach(shape => {
                shape.points.forEach(pt => {
                    if (excludePoint && pt.x === excludePoint.x && pt.y === excludePoint.y) return;

                    const d = calculateDistance(cursor, pt);
                    if (d < threshold && d < minDist) {
                        minDist = d;
                        closest = pt;
                    }
                });
            });
        });

        return closest;
    };

    const handleMouseMove = (e: React.MouseEvent) => {
        // Handle entire shape dragging (all points together) - supports multiple shapes
        if (draggedShapes.length > 0 && activeTool === ToolType.SELECT && dragStartPoint.current) {
            const currentPoint = getInternalCoordinates(e.clientX, e.clientY);
            const dx = currentPoint.x - dragStartPoint.current.x;
            const dy = currentPoint.y - dragStartPoint.current.y;

            const updates: { itemId: string, shape: Shape }[] = [];
            draggedShapes.forEach(draggedShape => {
                const item = items.find(i => i.id === draggedShape.itemId);
                const shape = item?.shapes.find(s => s.id === draggedShape.shapeId);

                if (item && shape && draggedShape.initialPoints) {
                    const newPoints = draggedShape.initialPoints.map(pt => ({
                        x: pt.x + dx,
                        y: pt.y + dy
                    }));

                    const { updatedShape } = updateShapeValue(item, shape, newPoints, true);
                    if (updatedShape) {
                        updates.push({ itemId: item.id, shape: updatedShape });
                    }
                }
            });

            if (updates.length > 0 && onBatchUpdateShapesTransient) {
                onBatchUpdateShapesTransient(updates);
            }
            return;
        }

        if (draggedVertex && activeTool === ToolType.SELECT) {
            const rawPoint = getInternalCoordinates(e.clientX, e.clientY);

            const item = items.find(i => i.id === draggedVertex.itemId);
            const shape = item?.shapes.find(s => s.id === draggedVertex.shapeId);

            if (item && shape) {
                const oldPoint = shape.points[draggedVertex.pointIndex];
                const snapped = getClosestSnapPoint(rawPoint, oldPoint);
                const newPoint = snapped || rawPoint;

                const newPoints = [...shape.points];
                newPoints[draggedVertex.pointIndex] = newPoint;

                updateShapeValue(item, shape, newPoints, true);
            }
            return;
        }

        // Handle rectangle selection dragging
        if (selectionRect && selectionRect.active && activeTool === ToolType.SELECT) {
            const currentPoint = getInternalCoordinates(e.clientX, e.clientY);
            setSelectionRect({ ...selectionRect, end: currentPoint });

            // If we've moved more than a few pixels, confirm this is a rectangle selection
            const dx = e.clientX - dragStart.current.x;
            const dy = e.clientY - dragStart.current.y;
            const distance = Math.sqrt(dx * dx + dy * dy);

            if (distance > 5 && !isRectSelecting) {
                setIsRectSelecting(true);
                setIsDragging(false); // Not panning
            }
            return;
        }

        if (isDragging) {
            const dx = e.clientX - dragStart.current.x;
            const dy = e.clientY - dragStart.current.y;
            updateTransform(transformStart.current.x + dx, transformStart.current.y + dy, transform.current.scale);
            return;
        }

        updateLoupe(e.clientX, e.clientY);

        if (activeTool !== ToolType.SELECT && activeTool !== ToolType.COUNT) {
            const rawPoint = getInternalCoordinates(e.clientX, e.clientY);
            const snapped = getClosestSnapPoint(rawPoint);

            if (snapped) {
                setTempPoint(snapped);
                setSnapPoint(snapped);
            } else {
                setTempPoint(rawPoint);
                setSnapPoint(null);
            }
        }
    };

    const handleMouseUp = () => {
        // Handle rectangle selection finalization
        if (isRectSelecting && selectionRect && selectionRect.active) {
            const { start, end } = selectionRect;
            const selected: { itemId: string, shapeId: string }[] = [];

            // Find all shapes that intersect with the selection rectangle
            items.forEach(item => {
                if (item.visible === false) return;

                item.shapes
                    .filter(shape => shape.pageIndex === globalPageIndex)
                    .forEach(shape => {
                        if (isShapeIntersectingRect(shape, start, end)) {
                            selected.push({ itemId: item.id, shapeId: shape.id });
                        }
                    });
            });

            setSelectedItems(selected);
            setSelectionRect(null);
            setIsRectSelecting(false);

            // Set flag to prevent immediate clearing by handleSvgClick
            justCompletedRectSelection.current = true;
            setTimeout(() => {
                justCompletedRectSelection.current = false;
            }, 100);

            return;
        }

        // Clear selection rect if it was just a click (not a drag)
        if (selectionRect && selectionRect.active && !isRectSelecting) {
            setSelectionRect(null);
        }

        if (draggedVertex) {
            // Do NOT clear selectedShape here, as that would deselect the item after dragging a point
            // setSelectedShape(null); 
            setDraggedVertex(null);
            if (onInteractionEnd) onInteractionEnd();
        }

        if (draggedShapes.length > 0) {
            setDraggedShapes([]);
            dragStartPoint.current = null;
            if (onInteractionEnd) onInteractionEnd();
        }

        setIsDragging(false);
    };

    const getInternalCoordinates = (clientX: number, clientY: number): Point => {
        if (!viewportRef.current) return { x: 0, y: 0 };
        const rect = viewportRef.current.getBoundingClientRect();
        const mx = clientX - rect.left;
        const my = clientY - rect.top;
        return {
            x: (mx - transform.current.x) / transform.current.scale,
            y: (my - transform.current.y) / transform.current.scale
        };
    };

    const updateLoupe = (clientX: number, clientY: number) => {
        const precisionTools = [ToolType.SCALE, ToolType.SEGMENT, ToolType.DIMENSION, ToolType.LINEAR, ToolType.AREA, ToolType.NOTE];
        if (!precisionTools.includes(activeTool)) {
            if (showLoupe) setShowLoupe(false);
            return;
        }
        if (!loupeRef.current || !viewportRef.current) return;
        const rect = viewportRef.current.getBoundingClientRect();
        if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) {
            setShowLoupe(false);
            return;
        }
        const pdfCanvas = containerRef.current?.querySelector('.react-pdf__Page canvas') as HTMLCanvasElement;
        if (!pdfCanvas) return;
        setShowLoupe(true);
        setLoupePos({ x: clientX, y: clientY });
        const ctx = loupeRef.current.getContext('2d');
        if (!ctx) return;

        let pt: Point;
        if (snapPoint) {
            pt = snapPoint;
        } else {
            pt = getInternalCoordinates(clientX, clientY);
        }

        const canvasRatio = pdfCanvas.width / contentWidth;
        const sourceX = pt.x * canvasRatio;
        const sourceY = pt.y * canvasRatio;

        const size = 160;
        const zoom = 2;
        const sourceSize = size / zoom;
        ctx.clearRect(0, 0, size, size);
        ctx.save();
        ctx.beginPath();
        ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
        ctx.clip();
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, size, size);
        try {
            ctx.drawImage(pdfCanvas, sourceX - sourceSize / 2, sourceY - sourceSize / 2, sourceSize, sourceSize, 0, 0, size, size);
        } catch (e) { }

        ctx.strokeStyle = snapPoint ? '#d946ef' : 'rgba(220, 38, 38, 0.8)';
        ctx.lineWidth = snapPoint ? 2 : 1;

        ctx.beginPath();
        ctx.moveTo(size / 2, 0); ctx.lineTo(size / 2, size);
        ctx.moveTo(0, size / 2); ctx.lineTo(size, size / 2);
        ctx.stroke();

        ctx.strokeStyle = '#cbd5e1';
        ctx.lineWidth = 4;
        ctx.stroke();
        ctx.restore();
    };

    const handleSvgClick = (e: React.MouseEvent) => {
        if (contextMenu) {
            setContextMenu(null);
            return;
        }

        // Clear selection when clicking empty canvas (regardless of active tool)
        if (draggedVertex) return;

        // Don't clear if we just completed a rectangle selection
        if (justCompletedRectSelection.current) return;

        // Only clear selection if not currently doing a rectangle selection
        if (!isRectSelecting && !selectionRect?.active) {
            // Clear multiple selected shapes
            if (selectedItems.length > 0) {
                setSelectedItems([]);
            }

            // Clear single item selection (from sidebar click or canvas shape click)
            if (selectedShape) {
                setSelectedShape(null);
            }
            
            // Always clear active takeoff when clicking empty canvas
            if (activeTakeoffId) {
                onSelectTakeoffItem(null);
            }
        }

        if (activeTool === ToolType.SELECT) {
            return;
        }

        const measurementTools = [ToolType.LINEAR, ToolType.AREA, ToolType.SEGMENT, ToolType.DIMENSION, ToolType.NOTE];
        if (measurementTools.includes(activeTool) && !scaleInfo.isSet) {
            addToast("Scale is not set. Please calibrate scale first.", 'error');
            return;
        }

        if (isDragging) return;

        const rawPoint = getInternalCoordinates(e.clientX, e.clientY);
        const point = getClosestSnapPoint(rawPoint) || rawPoint;

        if (activeTool === ToolType.SCALE) {
            if (drawingPoints.length === 0) setDrawingPoints([point]);
            else { setDrawingPoints([...drawingPoints, point]); setShowScaleModal(true); }
        } else {
            if (activeTool === ToolType.SEGMENT || activeTool === ToolType.DIMENSION) {
                if (drawingPoints.length === 0) setDrawingPoints([point]);
                else {
                    finalizeMeasurement([...drawingPoints, point]);
                }
            } else if (activeTool === ToolType.COUNT) {
                finalizeMeasurement([point]);
            } else if (activeTool === ToolType.AREA) {
                if (drawingPoints.length >= 3 && point === drawingPoints[0]) {
                    finalizeMeasurement([...drawingPoints]);
                    return;
                }
                setDrawingPoints([...drawingPoints, point]);
            } else if (activeTool === ToolType.LINEAR) {
                if (drawingPoints.length >= 2 && point === drawingPoints[0]) {
                    finalizeMeasurement([...drawingPoints, point]);
                    return;
                }
                setDrawingPoints([...drawingPoints, point]);
            } else if (activeTool === ToolType.NOTE) {
                if (drawingPoints.length === 0) {
                    setDrawingPoints([point]);
                } else {
                    finalizeNote([...drawingPoints, point]);
                }
            }
        }
    };

    const handlePointContextMenu = (e: React.MouseEvent, itemId: string, shapeId: string, pointIndex: number) => {
        e.preventDefault();
        e.stopPropagation();
        setContextMenu({
            x: e.clientX,
            y: e.clientY,
            itemId,
            shapeId,
            pointIndex
        });
    };

    const handleCanvasContextMenu = (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();

        // If we have multiple shapes selected, show context menu for changing multiple items
        if (selectedItems.length > 0) {
            setContextMenu({
                x: e.clientX,
                y: e.clientY,
                itemId: selectedItems[0].itemId, // Use first item as reference
                shapeId: selectedItems[0].shapeId
            });
        }
    };

    const handleShapeContextMenu = (e: React.MouseEvent, itemId: string, shapeId: string) => {
        e.preventDefault();
        e.stopPropagation();

        // If a multi-selection is active, but user right-clicks a shape *outside* of it,
        // clear the multi-selection and treat this as a single shape action.
        const isInSelection = selectedItems.some(s => s.itemId === itemId && s.shapeId === shapeId);
        if (selectedItems.length > 0 && !isInSelection) {
            setSelectedItems([]);
        }

        const clickPt = getInternalCoordinates(e.clientX, e.clientY);
        const item = items.find(i => i.id === itemId);
        const shape = item?.shapes.find(s => s.id === shapeId);

        let insertIndex = -1;
        let insertPoint = clickPt;

        if (item && shape && shape.points.length > 1) {
            let minDst = Infinity;
            const isClosed = item.type === ToolType.AREA;
            const loopLen = isClosed ? shape.points.length : shape.points.length - 1;

            for (let i = 0; i < loopLen; i++) {
                const p1 = shape.points[i];
                const p2 = shape.points[(i + 1) % shape.points.length];

                const closest = getClosestPointOnSegment(clickPt, p1, p2);
                const d = calculateDistance(clickPt, closest);

                if (d < minDst) {
                    minDst = d;
                    insertIndex = i + 1;
                    insertPoint = closest;
                }
            }
        }

        setContextMenu({
            x: e.clientX,
            y: e.clientY,
            itemId,
            shapeId,
            insertIndex,
            insertPoint
        });
    };

    const handleExecuteDeletePoint = () => {
        if (!contextMenu || contextMenu.pointIndex === undefined || !contextMenu.shapeId) return;
        const { itemId, shapeId, pointIndex } = contextMenu;

        const item = items.find(i => i.id === itemId);
        const shape = item?.shapes.find(s => s.id === shapeId);

        if (item && shape) {
            const newPoints = [...shape.points];
            newPoints.splice(pointIndex, 1);

            if (newPoints.length === 0) {
                onDeleteShape(itemId, shapeId);
            } else {
                updateShapeValue(item, shape, newPoints);
            }
        }
        setContextMenu(null);
    };

    const handleExecuteAddPoint = () => {
        if (!contextMenu || !contextMenu.shapeId || contextMenu.insertIndex === undefined || !contextMenu.insertPoint) return;
        const { itemId, shapeId, insertIndex, insertPoint } = contextMenu;

        const item = items.find(i => i.id === itemId);
        const shape = item?.shapes.find(s => s.id === shapeId);

        if (item && shape) {
            const newPoints = [...shape.points];
            newPoints.splice(insertIndex, 0, insertPoint);
            updateShapeValue(item, shape, newPoints);
        }
        setContextMenu(null);
    };

    const handleExecuteAddCutout = () => {
        if (!contextMenu || !onEnableDeduction) return;
        onEnableDeduction(contextMenu.itemId);
        setContextMenu(null);
    };

    const handleExecuteBreakPath = () => {
        if (!contextMenu || contextMenu.pointIndex === undefined || !contextMenu.shapeId) return;
        const { itemId, shapeId, pointIndex } = contextMenu;

        const item = items.find(i => i.id === itemId);
        const shape = item?.shapes.find(s => s.id === shapeId);

        if (item && shape && (item.type === ToolType.LINEAR || item.type === ToolType.SEGMENT || item.type === ToolType.DIMENSION)) {
            const part1Points = shape.points.slice(0, pointIndex + 1);
            const part2Points = shape.points.slice(pointIndex);

            const ppu = scaleInfo.ppu;
            const pdfScale = originalPdfWidth > 0 && contentWidth > 0 ? originalPdfWidth / contentWidth : 1;

            const pdfPoints1 = part1Points.map(p => ({ x: p.x * pdfScale, y: p.y * pdfScale }));
            const pdfPoints2 = part2Points.map(p => ({ x: p.x * pdfScale, y: p.y * pdfScale }));

            let val1 = 0;
            if (part1Points.length > 1) {
                val1 = getScaledValue(calculatePolylineLength(pdfPoints1), ppu);
            }

            let val2 = 0;
            if (part2Points.length > 1) {
                val2 = getScaledValue(calculatePolylineLength(pdfPoints2), ppu);
            }

            const updatedOriginalShape: Shape = {
                ...shape,
                points: part1Points,
                value: val1
            };

            const newShape: Shape = {
                id: crypto.randomUUID(),
                pageIndex: globalPageIndex,
                points: part2Points,
                value: val2
            };

            onSplitShape(itemId, updatedOriginalShape, newShape);
        }
        setContextMenu(null);
    };

    const updateShapeValue = (item: TakeoffItem, shape: Shape, newPoints: Point[], isTransient = false): { updatedShape: Shape | null } => {
        let newValue = 0;
        const ppu = scaleInfo.ppu;
        const pdfScale = originalPdfWidth > 0 && contentWidth > 0 ? originalPdfWidth / contentWidth : 1;
        const pdfPoints = newPoints.map(p => ({ x: p.x * pdfScale, y: p.y * pdfScale }));

        if (item.type === ToolType.SEGMENT || item.type === ToolType.LINEAR || item.type === ToolType.DIMENSION) {
            newValue = getScaledValue(calculatePolylineLength(pdfPoints), ppu);
        } else if (item.type === ToolType.AREA) {
            newValue = getScaledArea(calculatePolygonArea(pdfPoints), ppu);
        } else if (item.type === ToolType.COUNT) {
            newValue = newPoints.length;
        }

        const updatedShape: Shape = {
            ...shape,
            points: newPoints,
            value: newValue
        };

        if (isTransient && onUpdateShapeTransient) {
            onUpdateShapeTransient(item.id, updatedShape);
        } else if (onUpdateShape) {
            onUpdateShape(item.id, updatedShape.id, updatedShape);
        }
        return { updatedShape };
    };


    useEffect(() => {
        setDrawingPoints([]);
        setTempPoint(null);
        setSnapPoint(null);
    }, [activeTool, globalPageIndex]);

    const finalizeMeasurement = (points: Point[]) => {
        let value = 0;
        const ppu = scaleInfo.ppu;
        const pdfScale = originalPdfWidth > 0 && contentWidth > 0 ? originalPdfWidth / contentWidth : 1;
        const pdfPoints = points.map(p => ({ x: p.x * pdfScale, y: p.y * pdfScale }));

        if (activeTool === ToolType.SEGMENT || activeTool === ToolType.LINEAR || activeTool === ToolType.DIMENSION) {
            value = getScaledValue(calculatePolylineLength(pdfPoints), ppu);
        } else if (activeTool === ToolType.AREA) {
            value = getScaledArea(calculatePolygonArea(pdfPoints), ppu);
        } else if (activeTool === ToolType.COUNT) {
            value = points.length;
        }

        onShapeCreated({
            id: crypto.randomUUID(),
            pageIndex: globalPageIndex,
            points: [...points],
            value
        });
        setDrawingPoints([]);
        setTempPoint(null);
        setSnapPoint(null);
    };

    const finalizeNote = (points: Point[]) => {
        setNoteModal({
            isOpen: true,
            text: '',
            points: points
        });
        setDrawingPoints([]);
        setTempPoint(null);
        setSnapPoint(null);
    };

    const handleSaveNote = (text: string) => {
        if (noteModal.itemId && noteModal.shapeId) {
            // Update existing note
            const item = items.find(i => i.id === noteModal.itemId);
            const shape = item?.shapes.find(s => s.id === noteModal.shapeId);
            if (item && shape && onUpdateShape) {
                onUpdateShape(item.id, shape.id, { text: text });
            }
        } else if (noteModal.points) {
            // Create new note
            onShapeCreated({
                id: crypto.randomUUID(),
                pageIndex: globalPageIndex,
                points: noteModal.points,
                value: 0,
                text: text
            });
        }
        setNoteModal({ isOpen: false, text: '' });
    };

    const finalizeScale = () => {
        const pdfScale = originalPdfWidth > 0 && contentWidth > 0 ? originalPdfWidth / contentWidth : 1;

        const p1 = { x: drawingPoints[0].x * pdfScale, y: drawingPoints[0].y * pdfScale };
        const p2 = { x: drawingPoints[1].x * pdfScale, y: drawingPoints[1].y * pdfScale };

        const distPdfPoints = calculateDistance(p1, p2);
        const real = parseDimensionInput(scaleInputStr);

        if (real && real > 0) {
            onUpdateScale(distPdfPoints, real, scaleUnit);
            setDrawingPoints([]);
            setShowScaleModal(false);
            setScaleInputStr('');
        } else {
            addToast("Invalid dimension value entered", 'error');
        }
    };

    const getLiveLabel = () => {
        if (!tempPoint || drawingPoints.length === 0) return null;
        let text = '';

        const pdfScale = originalPdfWidth > 0 && contentWidth > 0 ? originalPdfWidth / contentWidth : 1;
        const currentPdfPt = { x: tempPoint.x * pdfScale, y: tempPoint.y * pdfScale };
        const prevPdfPt = { x: drawingPoints[drawingPoints.length - 1].x * pdfScale, y: drawingPoints[drawingPoints.length - 1].y * pdfScale };

        if (activeTool === ToolType.SEGMENT || activeTool === ToolType.DIMENSION) {
            const d = calculateDistance({ x: drawingPoints[0].x * pdfScale, y: drawingPoints[0].y * pdfScale }, currentPdfPt);
            text = scaleInfo.isSet ? `${getScaledValue(d, scaleInfo.ppu).toFixed(2)} ${scaleInfo.unit}` : '';
        } else if (activeTool === ToolType.LINEAR) {
            const pdfPoints = drawingPoints.map(p => ({ x: p.x * pdfScale, y: p.y * pdfScale }));
            const l = calculatePolylineLength(pdfPoints) + calculateDistance(prevPdfPt, currentPdfPt);
            text = scaleInfo.isSet ? `${getScaledValue(l, scaleInfo.ppu).toFixed(2)} ${scaleInfo.unit}` : '';
        }
        return text ? (
            <foreignObject x={tempPoint.x + 10} y={tempPoint.y + 10} width="100" height="30" className="pointer-events-none overflow-visible">
                <div className="bg-black/75 text-white text-xs px-2 py-1 rounded w-fit whitespace-nowrap" style={{ transform: `scale(${visualScaleFactor})`, transformOrigin: 'top left' }}>{text}</div>
            </foreignObject>
        ) : null;
    };

    const sortedItems = useMemo(() => {
        return [...items].sort((a, b) => {
            const score = (t: ToolType) => t === ToolType.AREA ? 0 : 1;
            return score(a.type) - score(b.type);
        });
    }, [items]);

    const contentHeight = pdfAspectRatio && contentWidth ? contentWidth * pdfAspectRatio : '100%';

    return (
        <div className="flex-1 h-full relative bg-slate-200 overflow-hidden">
            <style>{`.react-pdf__Page__canvas { display: block !important; margin: 0 !important; }`}</style>

            {/* Scale Indicator */}
            <div className="absolute top-4 left-4 z-30 pointer-events-none select-none">
                <div className="bg-white/90 backdrop-blur-sm border border-slate-200 px-3 py-1.5 rounded-lg shadow-sm flex items-center gap-2">
                    <Ruler size={14} className={scaleInfo.isSet ? "text-slate-900" : "text-red-500"} />
                    <span className={`text-xs font-medium ${scaleInfo.isSet ? "text-slate-700" : "text-red-600"}`}>
                        {scaleLabel}
                    </span>
                </div>
            </div>

            <div
                ref={viewportRef}
                className={`w-full h-full relative overflow-hidden select-none ${isDragging || draggedShapes.length > 0 ? 'cursor-grabbing' : (activeTool === ToolType.SELECT ? 'cursor-default' : 'cursor-crosshair')}`}
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onMouseLeave={() => { handleMouseUp(); setShowLoupe(false); }}
                onContextMenu={handleCanvasContextMenu}
            >
                {/* PDF Container - Scaled via CSS for performance */}
                <div
                    ref={containerRef}
                    className="absolute top-0 left-0 origin-top-left will-change-transform shadow-xl bg-white"
                    style={{ width: contentWidth, height: pdfAspectRatio ? contentWidth * pdfAspectRatio : 'auto' }}
                >
                    {fileUrl ? (
                        <Document
                            file={fileUrl}
                            loading={<div className="p-10">Loading PDF...</div>}
                            onLoadError={(error) => console.error("BlueprintCanvas PDF Load Error:", error)}
                        >
                            <Page
                                pageNumber={localPageIndex + 1}
                                scale={RENDER_SCALE}
                                renderTextLayer={false}
                                renderAnnotationLayer={false}
                                onLoadSuccess={(page) => {
                                    const viewport = page.getViewport({ scale: RENDER_SCALE });
                                    setContentWidth(viewport.width);
                                    setOriginalPdfWidth(viewport.width / RENDER_SCALE);
                                    setPdfAspectRatio(viewport.height / viewport.width);
                                    onPageWidthChange(viewport.width / RENDER_SCALE);
                                    if (onPageLoaded) onPageLoaded();
                                }}
                            />
                        </Document>
                    ) : (
                        <div className="flex items-center justify-center h-96 text-slate-400">Upload Blueprint</div>
                    )}
                </div>

                {/* SVG Overlay - Scaled via SVG Transform for crispness */}
                {file && contentWidth > 0 && (
                    <svg className="absolute top-0 left-0 w-full h-full pointer-events-none" style={{ overflow: 'visible' }}>
                        <g ref={svgLayerRef} onClick={handleSvgClick}>
                            <rect width={contentWidth} height={pdfAspectRatio ? contentWidth * pdfAspectRatio : '100%'} fill="transparent" style={{ pointerEvents: 'auto' }} />
                            <defs>
                                {items.filter(i => i.type === ToolType.AREA && i.visible !== false).map(item => {
                                    const pageShapes = item.shapes.filter(s => s.pageIndex === globalPageIndex);
                                    if (pageShapes.length === 0) return null;

                                    const deductions = pageShapes.filter(s => s.deduction);
                                    if (deductions.length === 0 && !isDeductionMode) return null;

                                    return (
                                        <mask
                                            key={`mask-${item.id}`}
                                            id={`mask-${item.id}`}
                                            maskUnits="userSpaceOnUse"
                                            maskContentUnits="userSpaceOnUse"
                                            x="-50000" y="-50000" width="100000" height="100000"
                                        >
                                            {/* White background: reveal everything */}
                                            <rect x="-50000" y="-50000" width="100000" height="100000" fill="white" />

                                            {/* Black shapes: hide these parts (deductions) */}
                                            {deductions.map(shape => (
                                                <polygon
                                                    key={shape.id}
                                                    points={shape.points.map(p => `${p.x},${p.y}`).join(' ')}
                                                    fill="black"
                                                />
                                            ))}

                                            {/* Live deduction preview */}
                                            {isDeductionMode && activeTakeoffId === item.id && drawingPoints.length > 0 && (
                                                <polygon
                                                    points={[...drawingPoints, tempPoint].filter(Boolean).map(p => `${p!.x},${p!.y}`).join(' ')}
                                                    fill="black"
                                                />
                                            )}
                                        </mask>
                                    );
                                })}

                                {items.filter(i => i.type === ToolType.NOTE).map(item => (
                                    <marker
                                        key={`arrowhead-${item.id}`}
                                        id={`arrowhead-${item.id}`}
                                        markerWidth="10"
                                        markerHeight="7"
                                        refX="9"
                                        refY="3.5"
                                        orient="auto"
                                    >
                                        <polygon points="0 0, 10 3.5, 0 7" fill={item.color} />
                                    </marker>
                                ))}
                            </defs>

                            {sortedItems.map(item => {
                                if (item.visible === false) return null;
                                const pageShapes = item.shapes.filter(s => s.pageIndex === globalPageIndex);
                                if (pageShapes.length === 0) return null;

                                const positiveShapes = pageShapes.filter(s => !s.deduction);
                                const negativeShapes = pageShapes.filter(s => s.deduction);
                                const hasMask = negativeShapes.length > 0 || (isDeductionMode && activeTakeoffId === item.id);
                                const isItemActive = activeTakeoffId === item.id;

                                return (
                                    <g key={item.id} style={{ pointerEvents: 'auto' }}>
                                        <g mask={hasMask ? `url(#mask-${item.id})` : undefined}>
                                            {positiveShapes.map(shape => {
                                                const isShapeSelected = selectedShape?.shapeId === shape.id; // Specific shape selected

                                                // Highlighting logic:
                                                // If no specific shape selected (sidebar selection), highlight all shapes of active item.
                                                // If specific shape selected, highlight only that shape (and its holes via focusedShapeIds).
                                                const inFocus = focusedShapeIds.has(shape.id);
                                                const isHighlighted = isItemActive && (selectedShape ? inFocus : true);

                                                const opacity = isHighlighted ? 1 : 0.6;
                                                const strokeWidth = (isHighlighted ? 6 : 4) * visualScaleFactor;
                                                const markerStrokeWidth = 2 * visualScaleFactor;
                                                const radius = (isHighlighted ? 12 : 8) * visualScaleFactor;

                                                const handleShapeClick = (e: React.MouseEvent) => {
                                                    if (activeTool === ToolType.SELECT) {
                                                        e.stopPropagation();
                                                        // Select specific shape
                                                        setSelectedShape({ itemId: item.id, shapeId: shape.id });
                                                        onSelectTakeoffItem(item.id);
                                                    }
                                                };


                                                const handleShapeMouseDown = (e: React.MouseEvent) => {
                                                    if (activeTool === ToolType.SELECT && !draggedVertex && e.button === 0) {
                                                        e.stopPropagation();
                                                        
                                                        // Start shape dragging (entire shape movement)
                                                        const startPoint = getInternalCoordinates(e.clientX, e.clientY);
                                                        dragStartPoint.current = startPoint;

                                                        // Check if this shape is part of the selected items (from rectangle selection)
                                                        const isInSelection = selectedItems.some(s => s.itemId === item.id && s.shapeId === shape.id);

                                                        if (isInSelection && selectedItems.length > 0) {
                                                            // Drag all selected shapes together WITHOUT changing selection
                                                            const shapesToDrag = selectedItems.map(selected => {
                                                                const selectedItem = items.find(i => i.id === selected.itemId);
                                                                const selectedShape = selectedItem?.shapes.find(s => s.id === selected.shapeId);
                                                                return {
                                                                    itemId: selected.itemId,
                                                                    shapeId: selected.shapeId,
                                                                    initialPoints: selectedShape ? [...selectedShape.points] : []
                                                                };
                                                            });
                                                            setDraggedShapes(shapesToDrag);
                                                        } else {
                                                            // Select the shape and drag only this shape
                                                            setSelectedShape({ itemId: item.id, shapeId: shape.id });
                                                            onSelectTakeoffItem(item.id);
                                                            
                                                            setDraggedShapes([{
                                                                itemId: item.id,
                                                                shapeId: shape.id,
                                                                initialPoints: [...shape.points]
                                                            }]);
                                                        }
                                                    }
                                                };

                                                if (item.type === ToolType.DIMENSION) {
                                                    return (
                                                        <g key={shape.id}>
                                                            <polyline
                                                                points={shape.points.map(p => `${p.x},${p.y}`).join(' ')}
                                                                fill="none"
                                                                stroke={item.color}
                                                                strokeWidth={2 * visualScaleFactor}
                                                                style={{ cursor: activeTool === ToolType.SELECT ? 'pointer' : 'crosshair' }}
                                                                onClick={handleShapeClick}
                                                                onMouseDown={handleShapeMouseDown}
                                                                onContextMenu={(e) => activeTool === ToolType.SELECT && handleShapeContextMenu(e, item.id, shape.id)}
                                                            />

                                                            {shape.points.length >= 2 && (() => {
                                                                const p1 = shape.points[0];
                                                                const p2 = shape.points[1];
                                                                const dx = p2.x - p1.x;
                                                                const dy = p2.y - p1.y;
                                                                const len = Math.sqrt(dx * dx + dy * dy);

                                                                if (len === 0) return null;

                                                                const nx = -dy / len;
                                                                const ny = dx / len;
                                                                const tickLen = 10 * visualScaleFactor;

                                                                const t1a = { x: p1.x + nx * tickLen, y: p1.y + ny * tickLen };
                                                                const t1b = { x: p1.x - nx * tickLen, y: p1.y - ny * tickLen };
                                                                const t2a = { x: p2.x + nx * tickLen, y: p2.y + ny * tickLen };
                                                                const t2b = { x: p2.x - nx * tickLen, y: p2.y - ny * tickLen };

                                                                const mx = (p1.x + p2.x) / 2;
                                                                const my = (p1.y + p2.y) / 2;

                                                                return (
                                                                    <>
                                                                        <line x1={t1a.x} y1={t1a.y} x2={t1b.x} y2={t1b.y} stroke={item.color} strokeWidth={2 * visualScaleFactor} />
                                                                        <line x1={t2a.x} y1={t2a.y} x2={t2b.x} y2={t2b.y} stroke={item.color} strokeWidth={2 * visualScaleFactor} />

                                                                        <foreignObject
                                                                            x={mx} y={my}
                                                                            width={120 * visualScaleFactor} height={40 * visualScaleFactor}
                                                                            className="overflow-visible pointer-events-none"
                                                                        >
                                                                            <div className="flex justify-center items-center" style={{ transform: `translate(-50%, -50%) scale(${visualScaleFactor})`, transformOrigin: 'center center' }}>
                                                                                <span className="px-1 py-0.5 text-[10px] font-bold bg-white text-slate-800 border border-slate-300 rounded shadow-sm whitespace-nowrap">
                                                                                    {shape.value.toFixed(2)} {item.unit}
                                                                                </span>
                                                                            </div>
                                                                        </foreignObject>
                                                                    </>
                                                                );
                                                            })()}
                                                        </g>
                                                    );
                                                }

                                                const TagName = item.type === ToolType.AREA ? 'polygon' : 'polyline';

                                                return (
                                                    <React.Fragment key={shape.id}>
                                                        {item.type === ToolType.COUNT ? (
                                                            shape.points.map((pt, pIdx) => (
                                                                <circle
                                                                    key={pIdx}
                                                                    cx={pt.x} cy={pt.y}
                                                                    r={radius}
                                                                    fill={item.color}
                                                                    stroke="white"
                                                                    strokeWidth={markerStrokeWidth}
                                                                    strokeOpacity={isHighlighted ? 1 : 0}
                                                                    fillOpacity={opacity}
                                                                    style={{ cursor: activeTool === ToolType.SELECT ? 'move' : 'crosshair' }}
                                                                    onClick={handleShapeClick}
                                                                    onContextMenu={(e) => activeTool === ToolType.SELECT && handlePointContextMenu(e, item.id, shape.id, pIdx)}
                                                                    onMouseDown={(e) => {
                                                                        if (activeTool === ToolType.SELECT && e.button === 0) {
                                                                            e.stopPropagation();
                                                                            setSelectedShape({ itemId: item.id, shapeId: shape.id });
                                                                            setDraggedVertex({ itemId: item.id, shapeId: shape.id, pointIndex: pIdx });
                                                                            onSelectTakeoffItem(item.id);
                                                                        }
                                                                    }}
                                                                />
                                                            ))
                                                        ) : (
                                                            <TagName
                                                                points={shape.points.map(p => `${p.x},${p.y}`).join(' ')}
                                                                fill={item.type === ToolType.AREA ? item.color : 'none'}
                                                                fillOpacity={0.2}
                                                                stroke={item.color}
                                                                strokeWidth={strokeWidth}
                                                                strokeOpacity={opacity}
                                                                style={{ cursor: activeTool === ToolType.SELECT ? 'pointer' : 'crosshair' }}
                                                                onClick={handleShapeClick}
                                                                onMouseDown={handleShapeMouseDown}
                                                                onContextMenu={(e) => activeTool === ToolType.SELECT && handleShapeContextMenu(e, item.id, shape.id)}
                                                            />
                                                        )}
                                                    </React.Fragment>
                                                )
                                            })}
                                        </g>

                                        {negativeShapes.map(shape => {
                                            // Handle cutout selection
                                            const inFocus = focusedShapeIds.has(shape.id);
                                            const isHighlighted = isItemActive && (selectedShape ? inFocus : true);

                                            return (
                                                <polygon
                                                    key={shape.id}
                                                    points={shape.points.map(p => `${p.x},${p.y}`).join(' ')}
                                                    fill="transparent"
                                                    stroke={item.color} // Use same color as item
                                                    strokeWidth={2 * visualScaleFactor}
                                                    strokeDasharray={`${4 * visualScaleFactor},${4 * visualScaleFactor}`}
                                                    strokeOpacity={isHighlighted ? 1 : 0.6}
                                                    style={{ cursor: activeTool === ToolType.SELECT ? 'pointer' : 'crosshair' }}
                                                    onClick={(e) => {
                                                        if (activeTool === ToolType.SELECT) {
                                                            e.stopPropagation();
                                                            // Select specific cutout shape
                                                            setSelectedShape({ itemId: item.id, shapeId: shape.id });
                                                            onSelectTakeoffItem(item.id);
                                                        }
                                                    }}
                                                    onMouseDown={(e) => {
                                                        if (activeTool === ToolType.SELECT && !draggedVertex && e.button === 0) {
                                                            e.stopPropagation();
                                                            // Select the shape
                                                            setSelectedShape({ itemId: item.id, shapeId: shape.id });
                                                            onSelectTakeoffItem(item.id);

                                                            // Start shape dragging (entire shape movement)
                                                            const startPoint = getInternalCoordinates(e.clientX, e.clientY);
                                                            dragStartPoint.current = startPoint;
                                                            setDraggedShapes([{
                                                                itemId: item.id,
                                                                shapeId: shape.id,
                                                                initialPoints: [...shape.points] // Store copy of initial points
                                                            }]);
                                                        }
                                                    }}
                                                    onContextMenu={(e) => activeTool === ToolType.SELECT && handleShapeContextMenu(e, item.id, shape.id)}
                                                />
                                            );
                                        })}

                                        {/* Show handles for all shapes if item is active (Unified Selection) */}
                                        {pageShapes.filter(s => activeTakeoffId === item.id && item.type !== ToolType.COUNT).map(shape => {
                                            // Only show handles if this shape is in the focused set (or all are focused if none selected)
                                            if (selectedShape && !focusedShapeIds.has(shape.id)) return null;

                                            return shape.points.map((pt, idx) => (
                                                <circle
                                                    key={`handle-${shape.id}-${idx}`}
                                                    cx={pt.x} cy={pt.y}
                                                    r={6 * visualScaleFactor}
                                                    fill="white"
                                                    stroke={item.color} // Use same color as item for both main and deduction shapes
                                                    strokeWidth={2 * visualScaleFactor}
                                                    style={{ cursor: 'move' }}
                                                    onContextMenu={(e) => activeTool === ToolType.SELECT && handlePointContextMenu(e, item.id, shape.id, idx)}
                                                    onMouseDown={(e) => {
                                                        if (activeTool === ToolType.SELECT && e.button === 0) {
                                                            e.stopPropagation();
                                                            setDraggedVertex({ itemId: item.id, shapeId: shape.id, pointIndex: idx });
                                                        }
                                                    }}
                                                />
                                            ))
                                        })}

                                        {item.type !== ToolType.DIMENSION && positiveShapes.map(shape => {
                                            // Highlight label if item is active
                                            const inFocus = focusedShapeIds.has(shape.id);
                                            const isHighlighted = isItemActive && (selectedShape ? inFocus : true);

                                            if (!isHighlighted || item.type === ToolType.COUNT || shape.points.length === 0) return null;

                                            let labelPos = { x: 0, y: 0 };
                                            let labelValue = shape.value;

                                            if (item.type === ToolType.AREA) {
                                                const cx = shape.points.reduce((s, p) => s + p.x, 0) / shape.points.length;
                                                const cy = shape.points.reduce((s, p) => s + p.y, 0) / shape.points.length;
                                                labelPos = { x: cx, y: cy };

                                                const containedDeductions = negativeShapes.filter(d =>
                                                    d.points.length > 0 && isPointInPolygon(d.points[0], shape.points)
                                                );
                                                const deductionTotal = containedDeductions.reduce((sum, d) => sum + d.value, 0);
                                                labelValue = Math.max(0, shape.value - deductionTotal);

                                            } else {
                                                let totalDist = 0;
                                                const dists: number[] = [];
                                                for (let i = 0; i < shape.points.length - 1; i++) {
                                                    const d = calculateDistance(shape.points[i], shape.points[i + 1]);
                                                    totalDist += d;
                                                    dists.push(d);
                                                }
                                                let target = totalDist / 2;
                                                let found = false;
                                                for (let i = 0; i < dists.length; i++) {
                                                    if (target <= dists[i]) {
                                                        const ratio = target / dists[i];
                                                        const p1 = shape.points[i];
                                                        const p2 = shape.points[i + 1];
                                                        labelPos = {
                                                            x: p1.x + (p2.x - p1.x) * ratio,
                                                            y: p1.y + (p2.y - p1.y) * ratio
                                                        };
                                                        found = true;
                                                        break;
                                                    }
                                                    target -= dists[i];
                                                }
                                                if (!found && shape.points.length > 0) labelPos = shape.points[0];
                                            }

                                            return (
                                                <foreignObject
                                                    key={`label-${shape.id}`}
                                                    x={labelPos.x} y={labelPos.y}
                                                    width={100 * visualScaleFactor} height={30 * visualScaleFactor}
                                                    className="overflow-visible pointer-events-none"
                                                >
                                                    <div className="flex justify-center items-center" style={{ transform: `translate(-50%, -50%) scale(${visualScaleFactor})`, transformOrigin: 'center center' }}>
                                                        <span className={`px-1 py-0.5 text-[10px] font-bold text-white rounded shadow-sm whitespace-nowrap ${isItemActive ? 'ring-2 ring-white ring-offset-2 ring-offset-black' : ''}`} style={{ backgroundColor: item.color }}>
                                                            {labelValue.toFixed(2)}
                                                        </span>
                                                    </div>
                                                </foreignObject>
                                            );
                                        })}
                                    </g>
                                )
                            })}

                            {items.filter(i => i.type === ToolType.NOTE && i.visible !== false).map(item => {
                                const pageShapes = item.shapes.filter(s => s.pageIndex === globalPageIndex);
                                return pageShapes.map(shape => {
                                    const isSelected = selectedShape?.shapeId === shape.id;
                                    const p1 = shape.points[0];
                                    const p2 = shape.points.length > 1 ? shape.points[1] : p1;

                                    // If 2 points, draw arrow from p2 (text) to p1 (target)
                                    const isArrow = shape.points.length > 1;

                                    return (
                                        <g key={shape.id}
                                            onClick={(e) => {
                                                if (activeTool === ToolType.SELECT) {
                                                    e.stopPropagation();
                                                    setSelectedShape({ itemId: item.id, shapeId: shape.id });
                                                    onSelectTakeoffItem(item.id);
                                                }
                                            }}
                                            style={{ cursor: activeTool === ToolType.SELECT ? 'pointer' : 'default' }}
                                        >
                                            {isArrow && (
                                                <>
                                                    <line
                                                        x1={p2.x} y1={p2.y} x2={p1.x} y2={p1.y}
                                                        stroke={item.color}
                                                        strokeWidth={2 * visualScaleFactor}
                                                        markerEnd={`url(#arrowhead-${item.id})`}
                                                    />
                                                    <circle cx={p1.x} cy={p1.y} r={3 * visualScaleFactor} fill={item.color} />
                                                </>
                                            )}

                                            <g transform={`translate(${p2.x}, ${p2.y}) scale(${visualScaleFactor})`}>
                                                <foreignObject
                                                    x={0} y={0}
                                                    width={200} height={100}
                                                    className="overflow-visible"
                                                    style={{ pointerEvents: 'none' }} // Allow clicks to pass through wrapper
                                                >
                                                    <div
                                                        className={`bg-white/90 border shadow-sm rounded p-1 text-xs inline-block cursor-pointer hover:ring-2 hover:ring-blue-300 transition-all ${isSelected ? 'ring-2 ring-blue-500' : 'border-slate-300'}`}
                                                        style={{
                                                            transformOrigin: 'top left',
                                                            color: item.color,
                                                            borderColor: item.color,
                                                            pointerEvents: 'auto' // Re-enable clicks on the note itself
                                                        }}
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            if (activeTool === ToolType.SELECT || activeTool === ToolType.NOTE) {
                                                                setNoteModal({
                                                                    isOpen: true,
                                                                    text: shape.text || '',
                                                                    itemId: item.id,
                                                                    shapeId: shape.id
                                                                });
                                                            }
                                                        }}
                                                    >
                                                        {shape.text}
                                                    </div>
                                                </foreignObject>
                                            </g>
                                        </g>
                                    );
                                });
                            })}

                            {drawingPoints.length > 0 && (
                                <g className="pointer-events-none">
                                    {activeTool === ToolType.AREA ? (
                                        <polygon
                                            points={[...drawingPoints, tempPoint].filter(Boolean).map(p => `${p!.x},${p!.y}`).join(' ')}
                                            fill={isDeductionMode ? 'black' : (items.find(i => i.id === activeTakeoffId)?.color || '#3b82f6')}
                                            fillOpacity={isDeductionMode ? 0.2 : 0.1}
                                            stroke={isDeductionMode ? 'red' : (items.find(i => i.id === activeTakeoffId)?.color || '#3b82f6')}
                                            strokeWidth={2 * visualScaleFactor}
                                            strokeDasharray={`${5 * visualScaleFactor},${5 * visualScaleFactor}`}
                                        />
                                    ) : (
                                        <polyline
                                            points={[...drawingPoints, tempPoint].filter(Boolean).map(p => `${p!.x},${p!.y}`).join(' ')}
                                            fill="none"
                                            stroke={items.find(i => i.id === activeTakeoffId)?.color || '#3b82f6'}
                                            strokeWidth={2 * visualScaleFactor}
                                            strokeDasharray={`${5 * visualScaleFactor},${5 * visualScaleFactor}`}
                                        />
                                    )}

                                    {drawingPoints.map((p, i) => (
                                        <circle key={i} cx={p.x} cy={p.y} r={4 * visualScaleFactor} fill={isDeductionMode ? 'red' : (items.find(i => i.id === activeTakeoffId)?.color || '#3b82f6')} />
                                    ))}
                                    {getLiveLabel()}
                                </g>
                            )}

                            {snapPoint && activeTool !== ToolType.SELECT && (
                                <circle
                                    cx={snapPoint.x}
                                    cy={snapPoint.y}
                                    r={8 * visualScaleFactor}
                                    stroke="#d946ef"
                                    strokeWidth={2 * visualScaleFactor}
                                    fill="transparent"
                                    className="pointer-events-none animate-pulse"
                                />
                            )}

                            {/* Rectangle Selection Visual */}
                            {selectionRect && selectionRect.active && isRectSelecting && (
                                <rect
                                    x={Math.min(selectionRect.start.x, selectionRect.end.x)}
                                    y={Math.min(selectionRect.start.y, selectionRect.end.y)}
                                    width={Math.abs(selectionRect.end.x - selectionRect.start.x)}
                                    height={Math.abs(selectionRect.end.y - selectionRect.start.y)}
                                    fill="rgba(59, 130, 246, 0.1)"
                                    stroke="#3b82f6"
                                    strokeWidth={2 * visualScaleFactor}
                                    strokeDasharray={`${8 * visualScaleFactor},${4 * visualScaleFactor}`}
                                    className="pointer-events-none"
                                />
                            )}

                            {/* Highlight selected items from rectangle selection */}
                            {selectedItems.length > 0 && selectedItems.map(({ itemId, shapeId }) => {
                                const item = items.find(i => i.id === itemId);
                                const shape = item?.shapes.find(s => s.id === shapeId);

                                if (!item || !shape || shape.pageIndex !== globalPageIndex) return null;

                                const strokeWidth = 6 * visualScaleFactor;
                                const handleRadius = 6 * visualScaleFactor;

                                // Render highlight based on shape type
                                if (item.type === ToolType.AREA) {
                                    return (
                                        <g key={`highlight-${shapeId}`}>
                                            <polygon
                                                points={shape.points.map(p => `${p.x},${p.y}`).join(' ')}
                                                fill="none"
                                                stroke={item.color}
                                                strokeWidth={strokeWidth}
                                                className="pointer-events-none"
                                            />
                                            {/* Vertex handles */}
                                            {shape.points.map((pt, idx) => (
                                                <circle
                                                    key={`handle-${shapeId}-${idx}`}
                                                    cx={pt.x}
                                                    cy={pt.y}
                                                    r={handleRadius}
                                                    fill="white"
                                                    stroke={item.color}
                                                    strokeWidth={2 * visualScaleFactor}
                                                    className="pointer-events-none"
                                                />
                                            ))}
                                        </g>
                                    );
                                } else if (item.type === ToolType.LINEAR || item.type === ToolType.SEGMENT || item.type === ToolType.DIMENSION) {
                                    return (
                                        <g key={`highlight-${shapeId}`}>
                                            <polyline
                                                points={shape.points.map(p => `${p.x},${p.y}`).join(' ')}
                                                fill="none"
                                                stroke={item.color}
                                                strokeWidth={strokeWidth}
                                                className="pointer-events-none"
                                            />
                                            {/* Vertex handles */}
                                            {shape.points.map((pt, idx) => (
                                                <circle
                                                    key={`handle-${shapeId}-${idx}`}
                                                    cx={pt.x}
                                                    cy={pt.y}
                                                    r={handleRadius}
                                                    fill="white"
                                                    stroke={item.color}
                                                    strokeWidth={2 * visualScaleFactor}
                                                    className="pointer-events-none"
                                                />
                                            ))}
                                        </g>
                                    );
                                } else if (item.type === ToolType.COUNT) {
                                    return shape.points.map((p, idx) => (
                                        <circle
                                            key={`highlight-${shapeId}-${idx}`}
                                            cx={p.x}
                                            cy={p.y}
                                            r={12 * visualScaleFactor}
                                            fill="none"
                                            stroke={item.color}
                                            strokeWidth={strokeWidth}
                                            className="pointer-events-none"
                                        />
                                    ));
                                }
                                return null;
                            })}
                        </g>
                    </svg>
                )}

                {/* Legend Layer - Separated to sit on top of SVG */}
                {file && contentWidth > 0 && (
                    <div
                        ref={legendContainerRef}
                        className="absolute top-0 left-0 origin-top-left pointer-events-none"
                        style={{ width: contentWidth, height: pdfAspectRatio ? contentWidth * pdfAspectRatio : 'auto' }}
                    >
                        <div className="pointer-events-auto">
                            <DraggableLegend
                                items={items}
                                globalPageIndex={globalPageIndex}
                                zoomLevel={currentScale}
                                visible={legendSettings.visible ?? true}
                                x={legendSettings.x}
                                y={legendSettings.y}
                                scale={legendSettings.scale}
                                onUpdate={onUpdateLegend}
                            />
                        </div>
                    </div>
                )}
            </div>

            <canvas ref={loupeRef} width={160} height={160} className={`fixed pointer-events-none z-50 rounded-full bg-white shadow-2xl border-4 border-white ${showLoupe ? 'block' : 'hidden'}`} style={{ left: loupePos.x + 20, top: loupePos.y + 20 }} />

            {/* Context Menus and Modals remain unchanged */}
            {contextMenu && (
                <div
                    className="fixed bg-white rounded-lg shadow-xl border border-slate-200 py-1 z-50 min-w-[150px]"
                    style={{ left: contextMenu.x, top: contextMenu.y }}
                    onMouseDown={(e) => e.stopPropagation()}
                >
                    {contextMenu.pointIndex !== undefined && (
                        <button
                            onClick={handleExecuteDeletePoint}
                            className="w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-red-50 flex items-center gap-2"
                        >
                            <Trash2 size={14} /> Delete Point
                        </button>
                    )}

                    {/* New Delete Shape Button */}
                    {contextMenu.shapeId && (
                        <button
                            onClick={() => {
                                if (contextMenu.shapeId) onDeleteShape(contextMenu.itemId, contextMenu.shapeId);
                                setContextMenu(null);
                            }}
                            className="w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-red-50 flex items-center gap-2"
                        >
                            <Trash2 size={14} /> Delete Shape
                        </button>
                    )}

                    {/* Change Item Button */}
                    {contextMenu.shapeId && (
                        <button
                            onClick={() => {
                                if (!contextMenu?.itemId) return;

                                const rightClickedItem = items.find(i => i.id === contextMenu.itemId);
                                if (!rightClickedItem) return;
                                const rightClickedItemType = rightClickedItem.type;

                                const selectionPool = selectedItems.length > 0
                                    ? selectedItems
                                    : [{ itemId: contextMenu.itemId, shapeId: contextMenu.shapeId! }];

                                const shapeIdsToChange: string[] = [];
                                let incompatibleCount = 0;

                                selectionPool.forEach(sel => {
                                    const item = items.find(i => i.id === sel.itemId);
                                    if (item && item.type === rightClickedItemType) {
                                        shapeIdsToChange.push(sel.shapeId);
                                    } else {
                                        incompatibleCount++;
                                    }
                                });

                                if (incompatibleCount > 0) {
                                    addToast(`${incompatibleCount} selected item(s) will not be changed due to incompatible types.`, 'info');
                                }

                                if (shapeIdsToChange.length > 0) {
                                    setSelectedShapeIdsForChange(shapeIdsToChange);
                                    setShowChangeItemModal(true);
                                } else {
                                    // If no compatible shapes, still close the menu
                                    setContextMenu(null);
                                }
                            }}
                            className="w-full text-left px-4 py-2 text-sm text-slate-700 hover:bg-slate-100 flex items-center gap-2"
                        >
                            <Edit2 size={14} /> Change Item
                        </button>
                    )}

                    {(() => {
                        const item = items.find(i => i.id === contextMenu.itemId);
                        if (item && item.type === ToolType.AREA) {
                            return (
                                <button
                                    onClick={handleExecuteAddCutout}
                                    className="w-full text-left px-4 py-2 text-sm text-slate-700 hover:bg-slate-100 flex items-center gap-2"
                                >
                                    <Eraser size={14} /> Add Cutout
                                </button>
                            )
                        }
                        return null;
                    })()}

                    {(() => {
                        const item = items.find(i => i.id === contextMenu.itemId);
                        if (item && (item.type === ToolType.LINEAR || item.type === ToolType.SEGMENT || item.type === ToolType.DIMENSION) && contextMenu.pointIndex !== undefined) {
                            return (
                                <button
                                    onClick={handleExecuteBreakPath}
                                    className="w-full text-left px-4 py-2 text-sm text-slate-700 hover:bg-slate-100 flex items-center gap-2"
                                >
                                    <Scissors size={14} /> Break Path
                                </button>
                            );
                        }
                        return null;
                    })()}

                    <div className="border-t border-slate-100 my-1"></div>

                    {contextMenu.shapeId && contextMenu.insertIndex !== undefined && (
                        <button
                            onClick={handleExecuteAddPoint}
                            className="w-full text-left px-4 py-2 text-sm text-slate-700 hover:bg-blue-50 hover:text-blue-600 flex items-center gap-2"
                        >
                            <Plus size={14} /> Add Point
                        </button>
                    )}
                </div>
            )}

            {showScaleModal && (
                <div className="fixed inset-0 flex items-center justify-center bg-black/50 z-50" onMouseDown={(e) => e.stopPropagation()}>
                    <div className="bg-white p-6 rounded-xl shadow-xl w-96">
                        <h3 className="font-bold mb-2">Calibrate Scale</h3>
                        <div className="bg-blue-50 text-blue-800 p-2 text-xs rounded mb-4 flex gap-2">
                            <AlertCircle size={16} /> <span>Calibrate using the longest known dimension for accuracy.</span>
                        </div>
                        <div className="flex gap-2 mb-4">
                            <input autoFocus className="border p-2 flex-1 rounded bg-white text-slate-900" placeholder="Length (e.g. 50')" value={scaleInputStr} onChange={e => setScaleInputStr(e.target.value)} />
                            <select className="border p-2 rounded bg-white text-slate-900" value={scaleUnit} onChange={e => setScaleUnit(e.target.value as Unit)}>{Object.values(Unit).map(u => <option key={u} value={u}>{u}</option>)}</select>
                        </div>
                        <div className="flex justify-end gap-2">
                            <button onClick={() => { setShowScaleModal(false); setDrawingPoints([]); }} className="text-slate-500 px-4">Cancel</button>
                            <button onClick={finalizeScale} className="bg-blue-600 text-white px-4 py-2 rounded">Set Scale</button>
                        </div>
                    </div>
                </div>
            )}
            {/* Note Input Modal */}
            <NoteInputModal
                isOpen={noteModal.isOpen}
                initialText={noteModal.text}
                onSave={handleSaveNote}
                onClose={() => setNoteModal({ ...noteModal, isOpen: false })}
            />

            {/* Paste Options Modal */}
            <PasteOptionsModal
                isOpen={showPasteOptions}
                onClose={() => setShowPasteOptions(false)}
                onPasteToOriginal={() => {
                    setShowPasteOptions(false);
                    if (onBatchAddShapes) {
                        pasteToOriginalItems(items, clipboardItems, globalPageIndex, onBatchAddShapes, setPendingSelection);
                    } else {
                        addToast('Paste to original items is not supported', 'error');
                    }
                }}
                onPasteAsNewItems={() => {
                    setShowPasteOptions(false);
                    if (onBatchCreateItems) {
                        const { payload, newSelectedItems } = getPasteAsNewItemsPayload(items, clipboardItems, globalPageIndex);
                        onBatchCreateItems(payload);
                        setPendingSelection(newSelectedItems);
                    } else {
                        addToast('Paste as new items is not supported in this version', 'error');
                    }
                }}
                items={items}
                clipboardItemCount={clipboardItems.length}
            />

            {/* Change Item Modal */}
            <ChangeItemModal
                isOpen={showChangeItemModal}
                onClose={() => {
                    setShowChangeItemModal(false);
                    setContextMenu(null); // Clear context menu state when modal closes
                }}
                onChangeItem={(targetItemId) => {
                    if (onMoveShapesToItem) {
                        const shapesToMove = selectedShapeIdsForChange.map(shapeId => {
                            // Find the item ID for each shape ID
                            const item = items.find(i => i.shapes.some(s => s.id === shapeId));
                            return { itemId: item!.id, shapeId };
                        });
                        onMoveShapesToItem(shapesToMove, targetItemId);
                    }
                    setShowChangeItemModal(false);
                    setContextMenu(null); // Also clear on success
                }}
                items={items}
                sourceItemId={contextMenu?.itemId || ''}
                shapeIds={selectedShapeIdsForChange}
            />
        </div>
    );
});

export default BlueprintCanvas;
