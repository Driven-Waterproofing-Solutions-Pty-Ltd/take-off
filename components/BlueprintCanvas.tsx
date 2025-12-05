
import React, { useState, useRef, useEffect, useImperativeHandle, forwardRef, useMemo } from 'react';
import { Document, Page } from 'react-pdf';
import { Point, ToolType, TakeoffItem, Shape, Unit, LegendSettings } from '../types';
import { calculateDistance, calculatePolylineLength, calculatePolygonArea, getScaledValue, getScaledArea, parseDimensionInput, PresetScale, isPointInPolygon, PRESET_SCALES } from '../utils/geometry';
import { AlertCircle, Trash2, Scissors, Plus, Eraser, MessageSquare, Ruler } from 'lucide-react';
import '../utils/pdfWorker';
import { useToast } from '../contexts/ToastContext';
import DraggableLegend from './DraggableLegend';
import NoteInputModal from './NoteInputModal';

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
    onShapeCreated: (shape: Shape) => void;
    onUpdateShape?: (itemId: string, shapeId: string, updates: Partial<Shape>) => void;
    onUpdateShapeTransient?: (itemId: string, shape: Shape) => void;
    onSplitShape: (itemId: string, existingShape: Shape, newShape: Shape) => void;
    onUpdateScale: (pixels: number, realValue: number, unit: Unit) => void;
    onUpdateLegend: (settings: Partial<LegendSettings>) => void;
    legendSettings: LegendSettings;
    onDeleteShape: (itemId: string, shapeId: string) => void;
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
    onShapeCreated,
    onUpdateShape,
    onUpdateShapeTransient,
    onSplitShape,
    onUpdateScale,
    onUpdateLegend,
    legendSettings,
    onDeleteShape,
    onStopRecording,
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
    const [noteModal, setNoteModal] = useState<{ isOpen: boolean, text: string, itemId?: string, shapeId?: string, points?: Point[] }>({ isOpen: false, text: '' });
    // Context Menu State
    const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);

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

    // Handle deletion via keyboard
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            // Ignore key events when target is an input, textarea, or contenteditable element
            const target = e.target as HTMLElement;
            if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
                return;
            }

            if ((e.key === 'Delete' || e.key === 'Backspace') && selectedShape) {
                e.preventDefault();
                e.stopPropagation();
                onDeleteShape(selectedShape.itemId, selectedShape.shapeId);
                setSelectedShape(null);
            }

            if (e.key === 'Escape') {
                if (contextMenu) {
                    setContextMenu(null);
                } else if (activeTool !== ToolType.SELECT) {
                    onStopRecording();
                } else if (selectedShape) {
                    setSelectedShape(null);
                    onSelectTakeoffItem(null);
                }
            }

            if (e.key === 'Enter') {
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
    }, [selectedShape, drawingPoints, showScaleModal, activeTool, onStopRecording, contextMenu]);

    useEffect(() => {
        if (activeTool !== ToolType.SELECT) {
            setSelectedShape(null);
            setDraggedVertex(null);
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

        // If dragging vertex, we don't pan
        if (draggedVertex) return;

        // Panning condition
        if ((isSelectToolLeftClick || isMiddleClick) && viewportRef.current) {
            // Check if clicking on shape or blank area is handled by SVG events falling through
            // because SVG has pointer-events-none but shapes have pointer-events-auto.
            // If e.target is the SVG background (which we don't have now since it's transparent/none), it falls through to viewport.
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
        if (draggedVertex) {
            // Do NOT clear selectedShape here, as that would deselect the item after dragging a point
            // setSelectedShape(null); 
            setDraggedVertex(null);
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

        if (activeTool === ToolType.SELECT) {
            if (draggedVertex) return;
            // Clicking on empty SVG space clears selection
            setSelectedShape(null);
            onSelectTakeoffItem(null);
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

    const handleShapeContextMenu = (e: React.MouseEvent, itemId: string, shapeId: string) => {
        e.preventDefault();
        e.stopPropagation();

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

    const updateShapeValue = (item: TakeoffItem, shape: Shape, newPoints: Point[], isTransient = false) => {
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
    };


    useEffect(() => {
        setDrawingPoints([]);
        setTempPoint(null);
        setSnapPoint(null);
    }, [activeTool, globalPageIndex, activeTakeoffId]);

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
                className={`w-full h-full relative overflow-hidden select-none ${isDragging ? 'cursor-grabbing' : (activeTool === ToolType.SELECT ? 'cursor-default' : 'cursor-crosshair')}`}
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onMouseLeave={() => { handleMouseUp(); setShowLoupe(false); }}
                onContextMenu={(e) => e.preventDefault()}
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
                                                        if (activeTool === ToolType.SELECT && !draggedVertex) {
                                                            e.stopPropagation();
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
        </div>
    );
});

export default BlueprintCanvas;
