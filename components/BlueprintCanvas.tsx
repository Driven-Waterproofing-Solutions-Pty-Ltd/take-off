import React, { useState, useRef, useEffect, useImperativeHandle, forwardRef, useMemo } from 'react';
import { Stage, Layer, Rect, Circle, Line as KonvaLine, Path, Group, Label, Tag, Text as KonvaText, Arrow } from 'react-konva';
import Konva from 'konva';
// import { Document, Page, pdfjs } from 'react-pdf'; // Removed for MuPDF
import { Point, ToolType, TakeoffItem, Shape, Unit, LegendSettings } from '../types';
import { calculateDistance, calculatePolylineLength, calculatePolygonArea, getScaledValue, getScaledArea, parseDimensionInput, PresetScale, isPointInPolygon, PRESET_SCALES } from '../utils/geometry';
import { AlertCircle, Trash2, Scissors, Plus, Eraser, MessageSquare, Ruler, Edit2, Loader2 } from 'lucide-react';
// import '../utils/pdfWorker'; // Removed for MuPDF
import { useToast } from '../contexts/ToastContext';
import DraggableLegend from './DraggableLegend';
import NoteInputModal from './NoteInputModal';
import PasteOptionsModal from './PasteOptionsModal';
import ChangeItemModal from './ChangeItemModal';
import { getPageImage, savePageImage } from '../utils/pdfCache';
import { mupdfController } from '../utils/mupdfController';
import { useRamCache } from '../contexts/RamCacheContext';
import { SearchHit } from '../utils/mupdfController';
import { PDFDocument } from 'pdf-lib';

// Removed html2canvas import as we now use pdf-lib for vector export

export interface BlueprintCanvasRef {
    // Legacy ref methods can be removed if unused, but keeping generic ref for future
}

interface BlueprintCanvasProps {
    file: File | null;
    fileId: string;
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
    searchHighlights?: SearchHit[];
    currentSearchHitIndex?: number | null;
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

interface VectorPath {
    type: 'line' | 'curve' | 'rect';
    points: Point[];
    closed?: boolean;
}

interface CachedVectorData {
    pageIndex: number;
    paths: VectorPath[];
    bounds: { x: number; y: number; width: number; height: number };
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

// Vector extraction functions
const extractVectorPaths = async (file: File): Promise<CachedVectorData[]> => {
    const arrayBuffer = await file.arrayBuffer();
    const pdfDoc = await PDFDocument.load(arrayBuffer);
    const vectorData: CachedVectorData[] = [];
    
    for (let i = 0; i < pdfDoc.getPageCount(); i++) {
        const page = pdfDoc.getPage(i);
        const paths: VectorPath[] = [];
        
        // For now, we'll use a simplified approach
        // In a full implementation, you'd parse the PDF content stream
        // This is a placeholder that would need proper PDF parsing
        
        vectorData.push({
            pageIndex: i,
            paths,
            bounds: {
                x: 0,
                y: 0,
                width: page.getWidth(),
                height: page.getHeight()
            }
        });
    }
    
    return vectorData;
};

const renderPdfAsImage = async (file: File): Promise<string> => {
    // For now, we'll use the existing MuPDF rendering
    // In a full implementation, this would render the PDF page to an image
    return '';
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
    fileId,
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
    onPageLoaded,
    searchHighlights,
    currentSearchHitIndex
}, ref) => {
    const { addToast } = useToast();
    const viewportRef = useRef<HTMLDivElement>(null);
    const containerRef = useRef<HTMLDivElement>(null); // For PDF (CSS Transform)
    const konvaLayerRef = useRef<Konva.Layer>(null); // For Konva Shapes
    const legendContainerRef = useRef<HTMLDivElement>(null); // For Legend (CSS Transform, Top Layer)
    const loupeRef = useRef<HTMLCanvasElement>(null);

    const [contentWidth, setContentWidth] = useState(0);
    const [originalPdfWidth, setOriginalPdfWidth] = useState(0);
    const [pdfAspectRatio, setPdfAspectRatio] = useState<number>(0);
    const [fileUrl, setFileUrl] = useState<string | null>(null);
    const [numPages, setNumPages] = useState<number | null>(null);
    const [isCurrentPageLoaded, setIsCurrentPageLoaded] = useState(false);
    const [backgroundImage, setBackgroundImage] = useState<string | null>(null);
    const [muPdfLoaded, setMuPdfLoaded] = useState(false);
    const vectorCanvasRef = useRef<HTMLCanvasElement>(null);

    // Vector data caching
    const [cachedVectors, setCachedVectors] = useState<CachedVectorData[]>([]);
    const [pdfImage, setPdfImage] = useState<string | null>(null);

    // Reset loaded state when page changes so we prioritize the new page
    useEffect(() => {
        setIsCurrentPageLoaded(false);
    }, [localPageIndex]);

    // Track if we have performed the initial "Fit to Screen" for the current file
    const [isFitted, setIsFitted] = useState(false);
    // Ref to track the zoom level we just requested via fit-to-screen
    // This helps avoid race conditions where the old zoom prop overwrites the fit transform
    const fittingZoomRef = useRef<number | null>(null);

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
    // State for a specific selected point (vertex)
    const [selectedVertex, setSelectedVertex] = useState<{ itemId: string, shapeId: string, pointIndex: number } | null>(null);
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

    // Effect to clear selected vertex if its shape is no longer selected
    useEffect(() => {
        if (selectedVertex) {
            const isStillSelected = selectedItems.some(s => s.itemId === selectedVertex.itemId && s.shapeId === selectedVertex.shapeId);
            if (!isStillSelected) {
                setSelectedVertex(null);
            }
        }
    }, [selectedItems, selectedVertex]);

    // Effect to maintain selection after items update (e.g., after pasting)
    useEffect(() => {
        // Check if we have a pending selection to apply after items update
        if (pendingSelection) {
            // Verify that all selected items exist in the new items array
            const validSelections = pendingSelection.filter(({ itemId, shapeId }) => {
                const item = items.find(i => i.id === itemId);
                const exists = item && item.shapes.some(s => s.id === shapeId);
                return exists;
            });

            if (validSelections.length > 0) {
                setSelectedItems(validSelections);

                // If only one item is selected, we can also set selectedShape for backward compatibility
                // (though rectangular selection logic handles arrays of shapes)
                if (validSelections.length === 1) {
                    setSelectedShape(validSelections[0]);
                }
                setPendingSelection(null);
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

    const shapeRenderScale = useMemo(() => {
        return (originalPdfWidth > 0 && contentWidth > 0) ? contentWidth / originalPdfWidth : 1;
    }, [contentWidth, originalPdfWidth]);

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

        // If it's a positive Area, Volume, or Fill, include its holes in the selection for context
        if ((activeItem.type === ToolType.AREA || activeItem.type === ToolType.VOLUME || activeItem.type === ToolType.FILL) && !targetShape.deduction) {
            const holes = activeItem.shapes.filter(s => s.deduction && s.points.length > 0 && isPointInPolygon(s.points[0], targetShape.points));
            holes.forEach(h => ids.add(h.id));
        }

        return ids;
    }, [selectedShape, activeTakeoffId, items]);

    // Reset state when file/page changes
    useEffect(() => {
        setContentWidth(0);
        setOriginalPdfWidth(0); // Ensure we don't use stale width from previous page
        setIsFitted(false);
        updateTransform(0, 0, 1);
    }, [file, localPageIndex, globalPageIndex]);

    // Create Blob URL for the file to ensure react-pdf can read it
    useEffect(() => {
        if (!file) {
            setFileUrl(null);
            return;
        }

        if (typeof file === 'string') {
            setFileUrl(file);
            return;
        }
        const url = URL.createObjectURL(file);
        setFileUrl(url);
        return () => URL.revokeObjectURL(url);
    }, [file]);

    const { getCachedPage } = useRamCache();

    // Handle Image Caching (Sophisticated Memory)
    useEffect(() => {
        // Check RAM cache first for specific file/page match
        if (fileId) {
            const ramUrl = getCachedPage(fileId, localPageIndex);
            if (ramUrl) {
                setBackgroundImage(ramUrl);
                return;
            }
        }

        setBackgroundImage(null);
        if (!fileId) return;

        let active = true;

        const loadCachedImage = async () => {
            const blob = await getPageImage(fileId, localPageIndex);
            if (blob && active) {
                const url = URL.createObjectURL(blob);
                setBackgroundImage(url);
            }
        };

        loadCachedImage();

        return () => { active = false; };
    }, [fileId, localPageIndex, getCachedPage]);

    // Render page to cache if missing (Background)
    useEffect(() => {
        if (!isCurrentPageLoaded || !fileId || !muPdfLoaded) return;

        // Check if we already have it
        getPageImage(fileId, localPageIndex).then(existing => {
            if (!existing) {
                // Render in background using MuPDF
                const renderAndSave = async () => {
                    try {
                        // Create a temporary canvas
                        const canvas = document.createElement('canvas');
                        // Use the controller to render (scale 2.0 for high res cache)
                        await mupdfController.renderPageToCanvas(localPageIndex, canvas, 2.0);

                        canvas.toBlob(async (blob) => {
                            if (blob) {
                                await savePageImage(fileId, localPageIndex, blob);
                            }
                        }, 'image/png');
                    } catch (e) {
                        console.warn("Background cache render failed", e);
                    }
                };
                renderAndSave();
            }
        });
    }, [isCurrentPageLoaded, fileId, localPageIndex, muPdfLoaded]);

    // MU-PDF INTEGRATION

    // Load Document into MuPDF
    useEffect(() => {
        if (!file) return;

        const loadDoc = async () => {
            try {
                const buffer = await file.arrayBuffer();
                const pageCount = await mupdfController.loadDocument(new Uint8Array(buffer));
                setNumPages(pageCount);
                setMuPdfLoaded(true);
                console.log("MuPDF loaded document, pages:", pageCount);

                // Get dimensions of first page to set content width
                const dims = mupdfController.getPageDimensions(0);
                const initialWidth = dims.width * RENDER_SCALE; // Render at high res

                setContentWidth(initialWidth);
                setOriginalPdfWidth(dims.width);
                setPdfAspectRatio(dims.height / dims.width);
                onPageWidthChange(dims.width);

                // Extract vector data and render image
                const vectorData = await extractVectorPaths(file);
                setCachedVectors(vectorData);
                
                const imageData = await renderPdfAsImage(file);
                setPdfImage(imageData);

                if (onPageLoaded) onPageLoaded();
                setIsCurrentPageLoaded(true); // Mark as ready

            } catch (e) {
                console.error("MuPDF Load Error", e);
                addToast("Failed to load PDF with MuPDF engine", "error");
            }
        };
        loadDoc();

        return () => { setMuPdfLoaded(false); };
    }, [file]);

    // Render Page with MuPDF
    useEffect(() => {
        if (!muPdfLoaded || !vectorCanvasRef.current) return;

        const render = async () => {
            try {
                // Render at our fixed internal high-res scale
                await mupdfController.renderPageToCanvas(localPageIndex, vectorCanvasRef.current, RENDER_SCALE);
                setIsCurrentPageLoaded(true);
            } catch (e) {
                console.error("MuPDF Render Error", e);
            }
        };
        render();
    }, [muPdfLoaded, localPageIndex]);

    // Pre-cache adjacent pages for instant navigation
    useEffect(() => {
        if (!isCurrentPageLoaded || !muPdfLoaded || numPages === null) return;

        // Pre-load DisplayLists for adjacent pages (runs async, doesn't block UI)
        const pagesToPreload = [localPageIndex - 1, localPageIndex + 1]
            .filter(i => i >= 0 && i < numPages);

        pagesToPreload.forEach(pageIdx => {
            mupdfController.preloadPage(pageIdx);
        });
    }, [isCurrentPageLoaded, localPageIndex, numPages, muPdfLoaded]);

    // Handle Initial Fit-to-Screen
    useEffect(() => {
        if (!viewportRef.current) {
            return;
        }

        const performFit = (viewportWidth: number) => {
            if (contentWidth > 0 && !isFitted && viewportWidth > 0) {
                const fitScale = viewportWidth / contentWidth;
                const newZoom = fitScale * RENDER_SCALE;

                // Set the expected zoom level to handle race condition with old props
                fittingZoomRef.current = newZoom;
                setZoomLevel(newZoom);
                updateTransform(0, 0, fitScale);
                setIsFitted(true);
            }
        };

        // Attempt immediate fit
        const rect = viewportRef.current.getBoundingClientRect();
        if (rect.width > 0) {
            performFit(rect.width);
        }

        const resizeObserver = new ResizeObserver((entries) => {
            for (const entry of entries) {
                performFit(entry.contentRect.width);
            }
        });

        resizeObserver.observe(viewportRef.current);
        return () => resizeObserver.disconnect();
    }, [contentWidth, isFitted, setZoomLevel]);

    // Handle Manual Zoom Updates
    useEffect(() => {
        // Prevent manual zoom updates until the initial fit has been performed
        // This avoids race conditions where a stale zoomLevel from a previous page
        // is applied to the new page before the "fit to screen" logic can run.
        if (contentWidth === 0 || !viewportRef.current || !isFitted) return;

        // If we just performed a fit, we need to wait for the zoomLevel prop to match
        // the value we requested. If it's still the old value (from before the page switch),
        // we ignore it to prevent the view from jumping back to the old zoom level.
        if (fittingZoomRef.current !== null) {
            if (Math.abs(zoomLevel - fittingZoomRef.current) > 0.001) {
                return;
            }
            // Zoom level matches what we set, so we're synced up.
            fittingZoomRef.current = null;
        }

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
    }, [zoomLevel, contentWidth, isFitted]);

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

                if (selectedVertex) {
                    e.preventDefault();
                    e.stopPropagation();
                    deletePoint(selectedVertex.itemId, selectedVertex.shapeId, selectedVertex.pointIndex);
                    setSelectedVertex(null);
                    return;
                }

                if (currentSelectedItems.length > 0) {
                    // Prevent multiple rapid deletions
                    if (isDeletingRef.current) {
                        e.preventDefault();
                        e.stopPropagation();
                        return;
                    }

                    e.preventDefault();
                    e.stopPropagation();
                    isDeletingRef.current = true;

                    // Clear selection first
                    setSelectedItems([]);

                    // Use batch delete if available, otherwise fall back to individual deletes
                    if (onDeleteShapes) {
                        onDeleteShapes(currentSelectedItems);
                    } else {
                        currentSelectedItems.forEach(({ itemId, shapeId }, index) => {
                            onDeleteShape(itemId, shapeId);
                        });
                    }

                    // Reset the deletion flag
                    setTimeout(() => {
                        isDeletingRef.current = false;
                    }, 100);
                } else if (selectedShape) {
                    e.preventDefault();
                    e.stopPropagation();
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
                    if (activeTool === ToolType.VOLUME && drawingPoints.length < 3) return;
                    if (activeTool === ToolType.LINEAR && drawingPoints.length < 2) return;
                    e.preventDefault();
                    finalizeMeasurement(drawingPoints);
                }
            }
        };
        // Use capture: true to ensure this handler runs before global shortcuts
        window.addEventListener('keydown', handleKeyDown, { capture: true });
        return () => window.removeEventListener('keydown', handleKeyDown, { capture: true });
    }, [selectedShape, selectedItems, drawingPoints, showScaleModal, activeTool, onStopRecording, contextMenu, selectedVertex]);

    useEffect(() => {
        if (activeTool !== ToolType.SELECT) {
            setSelectedShape(null);
            setDraggedVertex(null);
            setSelectedVertex(null);
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
        // Apply Konva transform
        if (konvaLayerRef.current) {
            konvaLayerRef.current.x(x);
            konvaLayerRef.current.y(y);
            konvaLayerRef.current.scale({ x: scale, y: scale });
            konvaLayerRef.current.batchDraw();
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
            if (item.visible === false || item.hiddenPages?.includes(globalPageIndex)) return;
            item.shapes.filter(s => s.pageIndex === globalPageIndex).forEach(shape => {
                shape.points.forEach(pt => {
                    if (excludePoint && pt.x === excludePoint.x && pt.y === excludePoint.y) return;

                    const scaledPt = { x: pt.x * shapeRenderScale, y: pt.y * shapeRenderScale };
                    const d = calculateDistance(cursor, scaledPt);
                    if (d < threshold && d < minDist) {
                        minDist = d;
                        closest = scaledPt;
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
            const dx = (currentPoint.x - dragStartPoint.current.x) / shapeRenderScale;
            const dy = (currentPoint.y - dragStartPoint.current.y) / shapeRenderScale;

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
                newPoints[draggedVertex.pointIndex] = { x: newPoint.x / shapeRenderScale, y: newPoint.y / shapeRenderScale };

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
                if (item.visible === false || item.hiddenPages?.includes(globalPageIndex)) return;

                const scaledStart = { x: start.x / shapeRenderScale, y: start.y / shapeRenderScale };
                const scaledEnd = { x: end.x / shapeRenderScale, y: end.y / shapeRenderScale };

                item.shapes
                    .filter(shape => shape.pageIndex === globalPageIndex)
                    .forEach(shape => {
                        if (isShapeIntersectingRect(shape, scaledStart, scaledEnd)) {
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
            // Commit the changes to history when drag ends
            // We need to commit the final state explicitly to ensure the patches are properly finalized
            // This is handled by onInteractionEnd() which calls commitHistory()
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
        const precisionTools = [ToolType.SCALE, ToolType.SEGMENT, ToolType.DIMENSION, ToolType.LINEAR, ToolType.AREA, ToolType.VOLUME, ToolType.NOTE];
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

    const handleStageClick = (e: Konva.KonvaEventObject<MouseEvent>) => {
        // In Select mode, only trigger clicks on the stage background (to deselect)
        // In other modes (Area, Linear, etc.), allow clicking anywhere including on existing shapes
        if (activeTool === ToolType.SELECT && e.target !== e.target.getStage()) {
            return;
        }
        const mouseEvent = e.evt;

        if (contextMenu) {
            setContextMenu(null);
            return;
        }

        if (draggedVertex) return;

        if (justCompletedRectSelection.current) return;

        if (activeTool === ToolType.SELECT) {
            if (!isRectSelecting) {
                if (selectedVertex) {
                    setSelectedVertex(null);
                }
                if (selectedItems.length > 0) {
                    setSelectedItems([]);
                }
                if (selectedShape) {
                    setSelectedShape(null);
                }
                if (activeTakeoffId) {
                    onSelectTakeoffItem(null);
                }
            }
            return;
        }

        const measurementTools = [ToolType.LINEAR, ToolType.ARC, ToolType.AREA, ToolType.VOLUME, ToolType.FILL, ToolType.SEGMENT, ToolType.DIMENSION, ToolType.NOTE];
        if (measurementTools.includes(activeTool) && !scaleInfo.isSet) {
            addToast("Scale is not set. Please calibrate scale first.", 'error');
            return;
        }

        if (isDragging) return;

        const rawPoint = getInternalCoordinates(mouseEvent.clientX, mouseEvent.clientY);
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
            } else if (activeTool === ToolType.VOLUME) {
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
            } else if (activeTool === ToolType.ARC) {
                if (drawingPoints.length >= 2 && point === drawingPoints[0]) {
                    finalizeMeasurement([...drawingPoints, point]);
                    return;
                }
                setDrawingPoints([...drawingPoints, point]);
            } else if (activeTool === ToolType.FILL) {
                // Fill tool: detect enclosed areas and create filled shapes
                handleFillClick(point);
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

        const rawClickPt = getInternalCoordinates(e.clientX, e.clientY);
        const clickPt = { x: rawClickPt.x / shapeRenderScale, y: rawClickPt.y / shapeRenderScale };
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

    const deletePoint = (itemId: string, shapeId: string, pointIndex: number) => {
        const item = items.find(i => i.id === itemId);
        const shape = item?.shapes.find(s => s.id === shapeId);

        if (item && shape) {
            const newPoints = [...shape.points];
            newPoints.splice(pointIndex, 1);

            if (newPoints.length === 0) {
                onDeleteShape(itemId, shapeId);
            } else {
                updateShapeValue(item, shape, newPoints);

                // Update selected vertex index if needed
                if (selectedVertex && selectedVertex.itemId === itemId && selectedVertex.shapeId === shapeId) {
                    if (selectedVertex.pointIndex === pointIndex) {
                        setSelectedVertex(null);
                    } else if (selectedVertex.pointIndex > pointIndex) {
                        setSelectedVertex({ ...selectedVertex, pointIndex: selectedVertex.pointIndex - 1 });
                    }
                }
            }
        }
    };

    const handleExecuteDeletePoint = () => {
        if (!contextMenu || contextMenu.pointIndex === undefined || !contextMenu.shapeId) return;
        const { itemId, shapeId, pointIndex } = contextMenu;
        deletePoint(itemId, shapeId, pointIndex);

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

        if (item && shape && (item.type === ToolType.LINEAR || item.type === ToolType.ARC || item.type === ToolType.SEGMENT || item.type === ToolType.DIMENSION)) {
            const part1Points = shape.points.slice(0, pointIndex + 1);
            const part2Points = shape.points.slice(pointIndex);

            const ppu = scaleInfo.ppu;
            // Points are already in PDF space (from shape.points)
            const pdfPoints1 = part1Points;
            const pdfPoints2 = part2Points;

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
        // newPoints are already in PDF space (passed from handlers that convert to PDF space)
        const pdfPoints = newPoints;

        if (item.type === ToolType.SEGMENT || item.type === ToolType.LINEAR || item.type === ToolType.ARC || item.type === ToolType.DIMENSION) {
            newValue = getScaledValue(calculatePolylineLength(pdfPoints), ppu);
        } else if (item.type === ToolType.AREA) {
            newValue = getScaledArea(calculatePolygonArea(pdfPoints), ppu);
        } else if (item.type === ToolType.VOLUME) {
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
        } else if (onUpdateShape && !isTransient) {
            onUpdateShape(item.id, updatedShape.id, updatedShape);
        }
        return { updatedShape };
    };


    useEffect(() => {
        setDrawingPoints([]);
        setTempPoint(null);
        setSnapPoint(null);
    }, [activeTool, globalPageIndex]);

    const handleFillClick = (point: Point) => {
        // Use cached vector data for more accurate fill detection
        const currentVectors = cachedVectors.find(v => v.pageIndex === globalPageIndex);
        
        if (currentVectors && currentVectors.paths.length > 0) {
            // Use vector paths for fill detection
            const enclosedAreas = findEnclosedAreasFromVectors(currentVectors.paths, point);
            
            if (enclosedAreas.length > 0) {
                const area = calculatePolygonArea(enclosedAreas[0]);
                finalizeMeasurement(enclosedAreas[0]);
                return;
            }
        }
        
        // Fallback to existing shape-based detection
        const allSegments: Array<{ start: Point, end: Point }> = [];
        
        items.forEach(item => {
            if (item.visible === false || item.hiddenPages?.includes(globalPageIndex)) return;
            
            item.shapes.forEach(shape => {
                if (shape.pageIndex !== globalPageIndex) return;
                
                // Only consider linear shapes (lines, arcs, segments, dimensions)
                if ([ToolType.LINEAR, ToolType.ARC, ToolType.SEGMENT, ToolType.DIMENSION].includes(item.type)) {
                    for (let i = 0; i < shape.points.length - 1; i++) {
                        allSegments.push({
                            start: shape.points[i],
                            end: shape.points[i + 1]
                        });
                    }
                }
            });
        });

        // Try to find closed loops and check if point is inside
        const closedLoops = findClosedLoops(allSegments);
        
        for (const loop of closedLoops) {
            if (isPointInPolygon(point, loop)) {
                // Found a containing loop, create filled area
                finalizeMeasurement(loop);
                return;
            }
        }
        
        addToast("No enclosed area found at clicked location", 'info');
    };

    const findClosedLoops = (segments: Array<{ start: Point, end: Point }>): Point[][] => {
        // Simple implementation: look for segments that form closed shapes
        // This is a basic implementation - a full solution would be much more complex
        
        const loops: Point[][] = [];
        const usedSegments = new Set<number>();
        
        for (let i = 0; i < segments.length; i++) {
            if (usedSegments.has(i)) continue;
            
            const loop = traceLoop(segments, i, usedSegments);
            if (loop.length >= 3) {
                loops.push(loop);
            }
        }
        
        return loops;
    };

    const findEnclosedAreasFromVectors = (paths: VectorPath[], clickPoint: Point): Point[][] => {
        // Find closed vector paths that contain the click point
        const areas: Point[][] = [];
        
        paths.forEach(path => {
            if (path.closed && path.points.length >= 3 && isPointInPolygon(clickPoint, path.points)) {
                areas.push(path.points);
            }
        });
        
        return areas;
    };

    const traceLoop = (segments: Array<{ start: Point, end: Point }>, startIndex: number, used: Set<number>): Point[] => {
        const loop: Point[] = [];
        let currentIndex = startIndex;
        let currentEnd = segments[startIndex].end;
        loop.push(segments[startIndex].start);
        
        const maxIterations = segments.length; // Prevent infinite loops
        let iterations = 0;
        
        while (iterations < maxIterations) {
            used.add(currentIndex);
            loop.push(currentEnd);
            
            // Find next connected segment
            let found = false;
            for (let i = 0; i < segments.length; i++) {
                if (used.has(i)) continue;
                
                const seg = segments[i];
                const distance = calculateDistance(currentEnd, seg.start);
                if (distance < 1) { // Close enough to be connected
                    currentIndex = i;
                    currentEnd = seg.end;
                    found = true;
                    break;
                }
            }
            
            if (!found) break;
            
            // Check if we've closed the loop
            const distanceToStart = calculateDistance(currentEnd, segments[startIndex].start);
            if (distanceToStart < 1) {
                break; // Closed the loop
            }
            
            iterations++;
        }
        
        return loop;
    };

    const finalizeMeasurement = (points: Point[]) => {
        let value = 0;
        const ppu = scaleInfo.ppu;
        const pdfScale = originalPdfWidth > 0 && contentWidth > 0 ? originalPdfWidth / contentWidth : 1;
        const pdfPoints = points.map(p => ({ x: p.x * pdfScale, y: p.y * pdfScale }));

        if (activeTool === ToolType.SEGMENT || activeTool === ToolType.LINEAR || activeTool === ToolType.DIMENSION) {
            value = getScaledValue(calculatePolylineLength(pdfPoints), ppu);
        } else if (activeTool === ToolType.ARC) {
            // For arcs, calculate length including curved segments
            // For now, treat as polyline until we implement bulge handling
            value = getScaledValue(calculatePolylineLength(pdfPoints), ppu);
        } else if (activeTool === ToolType.FILL) {
            value = getScaledArea(calculatePolygonArea(pdfPoints), ppu);
        } else if (activeTool === ToolType.AREA) {
            value = getScaledArea(calculatePolygonArea(pdfPoints), ppu);
        } else if (activeTool === ToolType.VOLUME) {
            value = getScaledArea(calculatePolygonArea(pdfPoints), ppu);
        } else if (activeTool === ToolType.COUNT) {
            value = points.length;
        }

        onShapeCreated({
            id: crypto.randomUUID(),
            pageIndex: globalPageIndex,
            points: [...pdfPoints],
            value,
            deduction: isDeductionMode
        });
        setDrawingPoints([]);
        setTempPoint(null);
        setSnapPoint(null);
    };

    const finalizeNote = (points: Point[]) => {
        const pdfScale = originalPdfWidth > 0 && contentWidth > 0 ? originalPdfWidth / contentWidth : 1;
        const pdfPoints = points.map(p => ({ x: p.x * pdfScale, y: p.y * pdfScale }));

        setNoteModal({
            isOpen: true,
            text: '',
            points: pdfPoints
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
        if (!text) return null;

        return (
            <Label x={tempPoint.x + 10} y={tempPoint.y + 10} scale={{ x: visualScaleFactor, y: visualScaleFactor }}>
                <Tag fill="black" cornerRadius={4} />
                <KonvaText text={text} fill="white" padding={4} fontSize={12} />
            </Label>
        );
    };

    const sortedItems = useMemo(() => {
        return [...items].sort((a, b) => {
            const score = (t: ToolType) => (t === ToolType.AREA || t === ToolType.VOLUME) ? 0 : 1;
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
                style={{ cursor: activeTool !== ToolType.SELECT ? 'crosshair' : undefined }}
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
                    {/* Cached Image Layer (Low Res / Immediate) */}
                    {backgroundImage && (
                        <img
                            src={backgroundImage}
                            style={{ width: '100%', height: '100%', position: 'absolute', top: 0, left: 0, objectFit: 'contain' }}
                            alt="Cached Page"
                        />
                    )}

                    {/* PDF Image Layer (Vector-based) */}
                    {pdfImage && (
                        <img
                            src={pdfImage}
                            style={{ width: '100%', height: '100%', position: 'absolute', top: 0, left: 0, objectFit: 'contain' }}
                            alt="PDF Image"
                        />
                    )}

                    {/* MuPDF Vector Render Layer (High Performance) */}
                    {muPdfLoaded ? (
                        <canvas
                            ref={vectorCanvasRef}
                            style={{
                                display: 'block',
                                width: '100%',
                                height: '100%'
                            }}
                        />
                    ) : (
                        <div className="flex items-center justify-center h-full">
                            {file ? "Loading MuPDF Engine..." : "Upload Blueprint"}
                        </div>
                    )}
                </div>

                {/* Loading Indicator Overlay */}
                {(!isCurrentPageLoaded && !backgroundImage && file) && (
                    <div className="absolute inset-0 flex items-center justify-center bg-white z-50">
                        <div className="flex flex-col items-center gap-2">
                            <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
                            <span className="text-sm font-medium text-slate-600">Loading Blueprint...</span>
                        </div>
                    </div>
                )}

                {/* Konva Canvas Overlay */}
                {file && contentWidth > 0 && (
                    <Stage
                        width={viewportRef.current?.clientWidth ?? 0}
                        height={viewportRef.current?.clientHeight ?? 0}
                        className="absolute top-0 left-0"
                        onClick={handleStageClick}
                    >
                        <Layer ref={konvaLayerRef}>
                            {/* Render cached vector paths for snapping reference */}
                            {cachedVectors
                                .filter(vectorData => vectorData.pageIndex === globalPageIndex)
                                .map(vectorData => 
                                    vectorData.paths.map((path, pathIndex) => (
                                        <KonvaLine
                                            key={`vector-${pathIndex}`}
                                            points={path.points.flatMap(p => [p.x, p.y])}
                                            stroke="rgba(0,0,0,0.1)"
                                            strokeWidth={1}
                                            closed={path.closed}
                                        />
                                    ))
                                )}

                            {sortedItems.map(item => {
                                if (item.visible === false || item.hiddenPages?.includes(globalPageIndex)) return null;
                                const shapesOnPage = item.shapes.filter(s => s.pageIndex === globalPageIndex);

                                return shapesOnPage.map(shape => {
                                    const isSelected = selectedItems.some(s => s.itemId === item.id && s.shapeId === shape.id);
                                    const isFocused = focusedShapeIds.has(shape.id);
                                    const isDimmed = focusedShapeIds.size > 0 && !isFocused;

                                    const opacity = (item.type === ToolType.AREA || item.type === ToolType.VOLUME || item.type === ToolType.FILL) ? 0.4 : 1;
                                    const strokeColor = isSelected ? '#3b82f6' : item.color;
                                    const strokeWidth = (isSelected ? 9 : 6) * visualScaleFactor;

                                    return (
                                        <Group
                                            key={shape.id}
                                            onMouseDown={(e) => {
                                                if (activeTool === ToolType.SELECT) {
                                                    e.cancelBubble = true;
                                                    const isMulti = e.evt.shiftKey || e.evt.ctrlKey || e.evt.metaKey;
                                                    const alreadySelected = selectedItems.some(s => s.itemId === item.id && s.shapeId === shape.id);

                                                    if (isMulti) {
                                                        if (alreadySelected) {
                                                            setSelectedItems(prev => prev.filter(s => s.shapeId !== shape.id));
                                                        } else {
                                                            setSelectedItems(prev => [...prev, { itemId: item.id, shapeId: shape.id }]);
                                                        }
                                                    } else if (!alreadySelected) {
                                                        setSelectedItems([{ itemId: item.id, shapeId: shape.id }]);
                                                        setSelectedShape({ itemId: item.id, shapeId: shape.id });
                                                        onSelectTakeoffItem(item.id);
                                                    }

                                                    // Prepare drag
                                                    const currentSel = isMulti
                                                        ? (alreadySelected && !e.evt.shiftKey ? selectedItems : [...(alreadySelected ? [] : selectedItems), ...(!alreadySelected ? [{ itemId: item.id, shapeId: shape.id }] : [])])
                                                        : [{ itemId: item.id, shapeId: shape.id }];

                                                    // Re-evaluate current selection for dragging if we modified it
                                                    let itemsToDrag = selectedItems;
                                                    if (!isMulti && !alreadySelected) {
                                                        itemsToDrag = [{ itemId: item.id, shapeId: shape.id }];
                                                    } else if (isMulti && !alreadySelected) {
                                                        itemsToDrag = [...selectedItems, { itemId: item.id, shapeId: shape.id }];
                                                    }

                                                    // Prepare drag - INCLUDE CHILD CUTOUTS
                                                    const shapesToDrag: { itemId: string, shapeId: string, initialPoints: Point[] }[] = [];
                                                    const processedIds = new Set<string>();

                                                    itemsToDrag.forEach(sel => {
                                                        if (processedIds.has(sel.shapeId)) return;

                                                        const i = items.find(x => x.id === sel.itemId);
                                                        const s = i?.shapes.find(x => x.id === sel.shapeId);
                                                        if (!i || !s) return;

                                                        // Add parent
                                                        shapesToDrag.push({ itemId: sel.itemId, shapeId: sel.shapeId, initialPoints: [...s.points] });
                                                        processedIds.add(sel.shapeId);

                                                        // Check for child cutouts (Deductions inside Area, Volume, or Fill)
                                                        if ((i.type === ToolType.AREA || i.type === ToolType.VOLUME || i.type === ToolType.FILL) && !s.deduction) {
                                                            const childCutouts = i.shapes.filter(other =>
                                                                other.deduction &&
                                                                !processedIds.has(other.id) &&
                                                                other.points.length > 0 &&
                                                                isPointInPolygon(other.points[0], s.points)
                                                            );

                                                            childCutouts.forEach(child => {
                                                                shapesToDrag.push({ itemId: i.id, shapeId: child.id, initialPoints: [...child.points] });
                                                                processedIds.add(child.id);
                                                            });
                                                        }
                                                    });

                                                    setDraggedShapes(shapesToDrag);
                                                    dragStartPoint.current = getInternalCoordinates(e.evt.clientX, e.evt.clientY);
                                                }
                                            }}
                                            onContextMenu={(e) => handleShapeContextMenu(e.evt as unknown as React.MouseEvent, item.id, shape.id)}
                                            onMouseEnter={(e) => {
                                                const container = e.target.getStage()?.container();
                                                if (container) container.style.cursor = activeTool === ToolType.SELECT ? 'move' : 'crosshair';
                                            }}
                                            onMouseLeave={(e) => {
                                                const container = e.target.getStage()?.container();
                                                if (container) container.style.cursor = activeTool === ToolType.SELECT ? 'default' : 'crosshair';
                                            }}
                                        >
                                            {(item.type === ToolType.AREA || item.type === ToolType.VOLUME || item.type === ToolType.FILL) && (
                                                <>
                                                    {shape.deduction ? (
                                                        <>
                                                            <KonvaLine
                                                                points={shape.points.flatMap(p => [p.x * shapeRenderScale, p.y * shapeRenderScale])}
                                                                closed={true}
                                                                fill="black"
                                                                globalCompositeOperation="destination-out"
                                                                opacity={1}
                                                            />
                                                            <KonvaLine
                                                                points={shape.points.flatMap(p => [p.x * shapeRenderScale, p.y * shapeRenderScale])}
                                                                closed={true}
                                                                stroke={strokeColor}
                                                                strokeWidth={strokeWidth}
                                                                dash={[5 * visualScaleFactor, 5 * visualScaleFactor]}
                                                                opacity={1}
                                                                listening={false}
                                                            />
                                                        </>
                                                    ) : (
                                                        <KonvaLine
                                                            points={shape.points.flatMap(p => [p.x * shapeRenderScale, p.y * shapeRenderScale])}
                                                            closed={true}
                                                            fill={item.color}
                                                            opacity={opacity}
                                                            stroke={strokeColor}
                                                            strokeWidth={strokeWidth}
                                                        />
                                                    )}
                                                </>
                                            )}
                                            {(item.type === ToolType.LINEAR || item.type === ToolType.ARC || item.type === ToolType.SEGMENT || item.type === ToolType.DIMENSION) && (
                                                <KonvaLine
                                                    points={shape.points.flatMap(p => [p.x * shapeRenderScale, p.y * shapeRenderScale])}
                                                    stroke={strokeColor}
                                                    strokeWidth={strokeWidth}
                                                    opacity={opacity}
                                                    lineCap="round"
                                                    lineJoin="round"
                                                />
                                            )}
                                            {item.type === ToolType.COUNT && shape.points.map((p, i) => (
                                                <Circle
                                                    key={i}
                                                    x={p.x * shapeRenderScale}
                                                    y={p.y * shapeRenderScale}
                                                    radius={6 * visualScaleFactor}
                                                    fill={item.color}
                                                    stroke="white"
                                                    strokeWidth={2 * visualScaleFactor}
                                                    opacity={opacity}
                                                />
                                            ))}

                                            {item.type === ToolType.NOTE && shape.points.length > 0 && (
                                                <>
                                                    {shape.points.length > 1 && (
                                                        <Arrow
                                                            points={[shape.points[1].x * shapeRenderScale, shape.points[1].y * shapeRenderScale, shape.points[0].x * shapeRenderScale, shape.points[0].y * shapeRenderScale]}
                                                            stroke={item.color}
                                                            fill={item.color}
                                                            strokeWidth={2 * visualScaleFactor}
                                                            pointerLength={10 * visualScaleFactor}
                                                            pointerWidth={10 * visualScaleFactor}
                                                            opacity={opacity}
                                                        />
                                                    )}
                                                    <Label
                                                        x={shape.points[shape.points.length > 1 ? 1 : 0].x * shapeRenderScale}
                                                        y={shape.points[shape.points.length > 1 ? 1 : 0].y * shapeRenderScale}
                                                        scale={{ x: visualScaleFactor, y: visualScaleFactor }}
                                                    >
                                                        <Tag fill="white" stroke={item.color} strokeWidth={1} cornerRadius={4} opacity={0.9} />
                                                        <KonvaText text={shape.text || "Note"} padding={5} fill="black" fontSize={12} />
                                                    </Label>
                                                </>
                                            )}

                                            {item.type === ToolType.DIMENSION && shape.points.length > 1 && (
                                                <Label
                                                    x={(shape.points[0].x * shapeRenderScale + shape.points[1].x * shapeRenderScale) / 2}
                                                    y={(shape.points[0].y * shapeRenderScale + shape.points[1].y * shapeRenderScale) / 2}
                                                    scale={{ x: visualScaleFactor, y: visualScaleFactor }}
                                                >
                                                    <Tag fill="white" stroke={item.color} cornerRadius={2} opacity={0.8} />
                                                    <KonvaText
                                                        text={`${shape.value?.toFixed(2)} ${item.unit}`}
                                                        padding={2}
                                                        fontSize={10}
                                                        fill="black"
                                                    />
                                                </Label>
                                            )}

                                            {isSelected && activeTool === ToolType.SELECT && shape.points.map((p, i) => {
                                                const isPointSelected = selectedVertex?.itemId === item.id && selectedVertex?.shapeId === shape.id && selectedVertex?.pointIndex === i;
                                                return (
                                                    <Circle
                                                        key={`handle-${i}`}
                                                        x={p.x * shapeRenderScale}
                                                        y={p.y * shapeRenderScale}
                                                        radius={(isPointSelected ? 7 : 5) * visualScaleFactor}
                                                        fill={isPointSelected ? "#ef4444" : "white"}
                                                        stroke={isPointSelected ? "#ef4444" : "#3b82f6"}
                                                        strokeWidth={2 * visualScaleFactor}
                                                        draggable
                                                        onDragStart={(e) => {
                                                            e.cancelBubble = true;
                                                            setDraggedVertex({ itemId: item.id, shapeId: shape.id, pointIndex: i });
                                                        }}
                                                        onDragEnd={() => setDraggedVertex(null)}
                                                        onMouseDown={(e) => {
                                                            e.cancelBubble = true;
                                                            if (e.evt.button === 2) handlePointContextMenu(e.evt as unknown as React.MouseEvent, item.id, shape.id, i);
                                                        }}
                                                        onDblClick={(e) => {
                                                            e.cancelBubble = true;
                                                            setSelectedVertex({ itemId: item.id, shapeId: shape.id, pointIndex: i });
                                                        }}
                                                    />
                                                );
                                            })}
                                        </Group>
                                    );
                                });
                            })}

                            {drawingPoints.length > 0 && (
                                <Group>
                                    <KonvaLine
                                        points={[...drawingPoints, tempPoint || drawingPoints[drawingPoints.length - 1]].flatMap(p => [p.x, p.y])}
                                        stroke={items.find(i => i.id === activeTakeoffId)?.color || 'red'}
                                        strokeWidth={3 * visualScaleFactor}
                                        dash={[5 * visualScaleFactor, 5 * visualScaleFactor]}
                                        closed={(activeTool === ToolType.AREA || activeTool === ToolType.VOLUME) && drawingPoints.length >= 2}
                                    />
                                    {drawingPoints.map((p, i) => (
                                        <Circle key={i} x={p.x} y={p.y} radius={4 * visualScaleFactor} fill="white" stroke="red" strokeWidth={1} />
                                    ))}
                                </Group>
                            )}

                            {snapPoint && (
                                <Circle
                                    x={snapPoint.x}
                                    y={snapPoint.y}
                                    radius={6 * visualScaleFactor}
                                    stroke="#d946ef"
                                    strokeWidth={2 * visualScaleFactor}
                                />
                            )}

                            {getLiveLabel()}

                            {/* Search Highlights Layer */}
                            {searchHighlights && searchHighlights.length > 0 && (
                                <Group>
                                    {searchHighlights.map((hit) => {
                                        const isCurrentHit = currentSearchHitIndex === hit.index;
                                        // Convert quads to screen coordinates using shapeRenderScale
                                        return hit.quads.map((quad, qIdx) => {
                                            const minX = Math.min(quad.ul.x, quad.ll.x) * shapeRenderScale;
                                            const maxX = Math.max(quad.ur.x, quad.lr.x) * shapeRenderScale;
                                            const minY = Math.min(quad.ul.y, quad.ur.y) * shapeRenderScale;
                                            const maxY = Math.max(quad.ll.y, quad.lr.y) * shapeRenderScale;

                                            return (
                                                <Rect
                                                    key={`search-${hit.index}-${qIdx}`}
                                                    x={minX}
                                                    y={minY}
                                                    width={maxX - minX}
                                                    height={maxY - minY}
                                                    fill={isCurrentHit ? 'rgba(255, 165, 0, 0.5)' : 'rgba(255, 255, 0, 0.35)'}
                                                    stroke={isCurrentHit ? '#ff8c00' : '#ffd700'}
                                                    strokeWidth={isCurrentHit ? 2 * visualScaleFactor : 1 * visualScaleFactor}
                                                    listening={false}
                                                />
                                            );
                                        });
                                    })}
                                </Group>
                            )}

                            {selectionRect && selectionRect.active && (
                                <Rect
                                    x={Math.min(selectionRect.start.x, selectionRect.end.x)}
                                    y={Math.min(selectionRect.start.y, selectionRect.end.y)}
                                    width={Math.abs(selectionRect.end.x - selectionRect.start.x)}
                                    height={Math.abs(selectionRect.end.y - selectionRect.start.y)}
                                    fill="rgba(59, 130, 246, 0.2)"
                                    stroke="#3b82f6"
                                    strokeWidth={1 * visualScaleFactor}
                                />
                            )}
                        </Layer>
                    </Stage>
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

                                const shapeIdsToChange = new Set<string>();
                                let incompatibleCount = 0;
                                const processedIds = new Set<string>(); // avoid double processing if selected

                                selectionPool.forEach(sel => {
                                    if (processedIds.has(sel.shapeId)) return;

                                    const item = items.find(i => i.id === sel.itemId);
                                    if (item && item.type === rightClickedItemType) {
                                        shapeIdsToChange.add(sel.shapeId);
                                        processedIds.add(sel.shapeId);

                                        // Child Cutout Logic
                                        if (item.type === ToolType.AREA || item.type === ToolType.VOLUME || item.type === ToolType.FILL) {
                                            const parentShape = item.shapes.find(s => s.id === sel.shapeId);
                                            if (parentShape && !parentShape.deduction) {
                                                const childCutouts = item.shapes.filter(other =>
                                                    other.deduction &&
                                                    !processedIds.has(other.id) &&
                                                    other.points.length > 0 &&
                                                    isPointInPolygon(other.points[0], parentShape.points)
                                                );

                                                childCutouts.forEach(child => {
                                                    shapeIdsToChange.add(child.id);
                                                    processedIds.add(child.id);
                                                });
                                            }
                                        }

                                    } else {
                                        incompatibleCount++;
                                    }
                                });

                                if (incompatibleCount > 0) {
                                    addToast(`${incompatibleCount} selected item(s) will not be changed due to incompatible types.`, 'info');
                                }

                                if (shapeIdsToChange.size > 0) {
                                    setSelectedShapeIdsForChange(Array.from(shapeIdsToChange));
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
                        if (item && (item.type === ToolType.AREA || item.type === ToolType.VOLUME || item.type === ToolType.FILL)) {
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
                        if (item && (item.type === ToolType.LINEAR || item.type === ToolType.ARC || item.type === ToolType.SEGMENT || item.type === ToolType.DIMENSION) && contextMenu.pointIndex !== undefined) {
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
                            <select className="border p-2 rounded bg-white text-slate-900" title="Unit of measurement" aria-label="Unit of measurement" value={scaleUnit} onChange={e => setScaleUnit(e.target.value as Unit)}>{Object.values(Unit).map(u => <option key={u} value={u}>{u}</option>)}</select>
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
