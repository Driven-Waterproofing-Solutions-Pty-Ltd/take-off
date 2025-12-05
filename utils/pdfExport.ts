
import { PDFDocument, rgb, StandardFonts, PDFFont, PDFPage, degrees, pushGraphicsState, popGraphicsState, moveTo, lineTo, closePath, fill, stroke, setFillingColor, setStrokingColor, setLineWidth, fillAndStroke, setGraphicsState } from 'pdf-lib';
import type { Color } from 'pdf-lib';
import { PlanSet, ProjectData, TakeoffItem, ToolType, Shape, Unit, LegendSettings } from '../types';
import { evaluateFormula } from './math';
import { isPointInPolygon } from './geometry';

// The canvas renders at Scale 2.0 (High DPI).
// The PDF uses 72 DPI points (Scale 1.0).
// We must scale all canvas coordinates by 0.5 to match the PDF coordinate space.
const CANVAS_TO_PDF_SCALE = 0.5;

class ExportLogger {
    private logs: string[] = [];

    log(message: string, data?: any) {
        const timestamp = new Date().toISOString().split('T')[1].replace('Z', '');
        let msg = `[${timestamp}] ${message}`;
        if (data !== undefined) {
            try {
                const str = JSON.stringify(data, (key, value) => {
                    if (key === 'file') return '[File Blob]';
                    return value;
                }, 2);
                msg += `\n${str}`;
            } catch (e) {
                msg += ` [Data Error: ${e}]`;
            }
        }
        this.logs.push(msg);
        console.log(message, data || '');
    }

    section(title: string) {
        this.logs.push(`\n========================================\n${title}\n========================================`);
        console.group(title);
    }

    endSection() {
        this.logs.push(`\n----------------------------------------\n`);
        console.groupEnd();
    }

    getLogContent() {
        return this.logs.join('\n');
    }
}

// Helper: Convert Hex Color to PDF RGB (0-1)
const hexToRgb = (hex: string) => {
    if (!hex || typeof hex !== 'string') return { r: 0, g: 0, b: 0 };
    
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? {
        r: parseInt(result[1], 16) / 255,
        g: parseInt(result[2], 16) / 255,
        b: parseInt(result[3], 16) / 255
    } : { r: 0, g: 0, b: 0 };
};

// Helper: Convert points to SVG Path string (Using SPACES for maximum compatibility)
const pointsToSvgPath = (points: { x: number, y: number }[], logger?: ExportLogger) => {
    if (points.length === 0) return '';
    
    if (isNaN(points[0].x) || isNaN(points[0].y)) {
        logger?.log("Error: NaN points detected in SVG generation", points[0]);
        return '';
    }

    let cleanPoints = points;
    const first = points[0];
    const last = points[points.length - 1];
    
    // Check for duplicate end point
    if (points.length > 1 && Math.abs(first.x - last.x) < 0.001 && Math.abs(first.y - last.y) < 0.001) {
        cleanPoints = points.slice(0, points.length - 1);
    }

    if (cleanPoints.length === 0) return '';

    // Standardize decimals to 2 places to reduce file size and ensure valid PDF syntax
    const start = `M ${cleanPoints[0].x.toFixed(2)} ${cleanPoints[0].y.toFixed(2)}`;
    const rest = cleanPoints.slice(1).map(p => `L ${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(' ');
    return `${start} ${rest} Z`;
};

// Helper: Get Signed Area using Cross Product Shoelace Formula
// For Cartesian (Y-up) systems like PDF:
// Positive Area = Counter-Clockwise (CCW)
// Negative Area = Clockwise (CW)
const getSignedArea = (points: { x: number, y: number }[]) => {
    let area = 0;
    for (let i = 0; i < points.length; i++) {
        const j = (i + 1) % points.length;
        area += points[i].x * points[j].y;
        area -= points[j].x * points[i].y;
    }
    return area / 2;
};

// Helper: Draw polygon with holes using low-level PDF operators
const drawPolygonWithHoles = (
    page: PDFPage,
    outerPoints: { x: number, y: number }[],
    holes: { x: number, y: number }[][],
    fillColor: Color,
    fillOpacity: number,
    strokeColor: Color,
    strokeWidth: number,
    strokeOpacity: number,
    logger?: ExportLogger
) => {
    if (outerPoints.length < 3) return;

    // Create graphics state for opacity
    const graphicsState = page.doc.context.obj({
        Type: 'ExtGState',
        ca: fillOpacity,      // Fill opacity
        CA: strokeOpacity,    // Stroke opacity
    });
    
    const graphicsStateKey = page.node.newExtGState('AreaFillGS', graphicsState);

    // Save graphics state and set opacity
    page.pushOperators(pushGraphicsState());
    page.pushOperators(setGraphicsState(graphicsStateKey));

    // Set colors
    page.pushOperators(setFillingColor(fillColor));
    if (strokeWidth > 0) {
        page.pushOperators(setStrokingColor(strokeColor));
        page.pushOperators(setLineWidth(strokeWidth));
    }

    // Begin path: outer shape
    const first = outerPoints[0];
    page.pushOperators(moveTo(first.x, first.y));
    for (let i = 1; i < outerPoints.length; i++) {
        const p = outerPoints[i];
        page.pushOperators(lineTo(p.x, p.y));
    }
    page.pushOperators(closePath());

    // Holes
    for (const hole of holes) {
        if (hole.length < 3) continue;
        const hFirst = hole[0];
        page.pushOperators(moveTo(hFirst.x, hFirst.y));
        for (let i = 1; i < hole.length; i++) {
            const p = hole[i];
            page.pushOperators(lineTo(p.x, p.y));
        }
        page.pushOperators(closePath());
    }

    // Fill and stroke (non-zero winding rule)
    page.pushOperators(fillAndStroke());

    // Restore graphics state
    page.pushOperators(popGraphicsState());

    logger?.log(`  Low-level polygon drawn: outer points=${outerPoints.length}, holes=${holes.length}, fillOpacity=${fillOpacity}, strokeOpacity=${strokeOpacity}`);
};

class CoordinateMapper {
    private pageHeight: number;
    private pageWidth: number;
    private rotation: number;
    private logger?: ExportLogger;

    constructor(page: PDFPage, logger?: ExportLogger) {
        const { width, height } = page.getSize();
        this.pageWidth = width;
        this.pageHeight = height;
        this.rotation = page.getRotation().angle;
        this.logger = logger;
        this.logger?.log(`CoordinateMapper Init: Size=[${width}, ${height}], Rotation=${this.rotation}`);
    }

    map(vx: number, vy: number) {
        const x = vx * CANVAS_TO_PDF_SCALE;
        const y = vy * CANVAS_TO_PDF_SCALE;

        // Visual (Canvas) X/Y to PDF X/Y based on Rotation
        // Canvas (0,0) is Top-Left.
        
        if (this.rotation === 0) {
            // PDF (0,0) is Bottom-Left.
            return { x: x, y: this.pageHeight - y };
        } else if (this.rotation === 90) {
            // PDF (0,0) is Top-Left visually (Relative).
            return { x: y, y: x };
        } else if (this.rotation === 180) {
            // PDF (0,0) is Top-Right visually.
            return { x: this.pageWidth - x, y: y };
        } else if (this.rotation === 270) {
            // PDF (0,0) is Bottom-Right visually.
            return { x: this.pageWidth - y, y: this.pageHeight - x };
        }
        return { x, y: this.pageHeight - y };
    }

    getTextRotation() {
        return degrees(this.rotation);
    }

    getRotationAngle() {
        return this.rotation;
    }
}

const wrapText = (text: string, font: PDFFont, size: number, maxWidth: number): string[] => {
    const words = text.split(' ');
    const lines: string[] = [];
    let currentLine = words[0];

    for (let i = 1; i < words.length; i++) {
        const word = words[i];
        const width = font.widthOfTextAtSize(currentLine + " " + word, size);
        if (width < maxWidth) {
            currentLine += " " + word;
        } else {
            lines.push(currentLine);
            currentLine = word;
        }
    }
    lines.push(currentLine);
    return lines;
};


export const generateMarkupPDF = async (
    planSets: PlanSet[],
    projectData: ProjectData,
    items: TakeoffItem[],
    pageIndices: number[],
    includeLegend: boolean,
    includeNotes: boolean
): Promise<{ pdfBytes: Uint8Array, logContent: string }> => {

    const logger = new ExportLogger();
    logger.section("Starting PDF Export");
    logger.log("Items Count", items.length);
    logger.log("Pages to Export", pageIndices);
    
    // Create new PDF
    const outPdf = await PDFDocument.create();
    const font = await outPdf.embedFont(StandardFonts.Helvetica);
    const fontBold = await outPdf.embedFont(StandardFonts.HelveticaBold);

    const pagesByPlan: Record<string, number[]> = {};
    const planSetMap: Record<string, PlanSet> = {};

    planSets.forEach(p => planSetMap[p.id] = p);

    pageIndices.forEach(globalIdx => {
        const plan = planSets.find(p => globalIdx >= p.startPageIndex && globalIdx < p.startPageIndex + p.pageCount);
        if (plan) {
            if (!pagesByPlan[plan.id]) pagesByPlan[plan.id] = [];
            pagesByPlan[plan.id].push(globalIdx);
        }
    });

    for (const [planId, globalIndices] of Object.entries(pagesByPlan)) {
        const plan = planSetMap[planId];
        logger.section(`Processing Plan: ${plan.name}`);
        
        let sourcePdf;
        try {
            const existingPdfBytes = await plan.file.arrayBuffer();
            sourcePdf = await PDFDocument.load(existingPdfBytes);
            logger.log("Source PDF Loaded", { pageCount: sourcePdf.getPageCount() });
        } catch (e) {
            logger.log("Error Loading Source PDF", e);
            continue;
        }

        const localIndices = globalIndices.map(gIdx => {
            const relativeIdx = gIdx - plan.startPageIndex;
            if (plan.pages && plan.pages[relativeIdx] !== undefined) {
                return plan.pages[relativeIdx];
            }
            return relativeIdx;
        });

        const copiedPages = await outPdf.copyPages(sourcePdf, localIndices);

        for (let i = 0; i < copiedPages.length; i++) {
            const page = copiedPages[i];
            const globalIdx = globalIndices[i];
            outPdf.addPage(page);

            const mapper = new CoordinateMapper(page, logger);

            const pData = projectData[globalIdx];

            const pageItems = items.filter(item =>
                item.visible !== false &&
                item.shapes.some(s => s.pageIndex === globalIdx)
            );

            logger.log(`Page GlobalIdx: ${globalIdx} - Items to draw: ${pageItems.length}`);

            for (const item of pageItems) {
                const c = hexToRgb(item.color);
                const pdfColor = rgb(c.r, c.g, c.b);
                const shapes = item.shapes.filter(s => s.pageIndex === globalIdx);

                if (item.type === ToolType.AREA) {
                    const positiveShapes = shapes.filter(s => !s.deduction);
                    const negativeShapes = shapes.filter(s => s.deduction);
                    const FILL_OPACITY = 0.4;

                    for (let pIdx = 0; pIdx < positiveShapes.length; pIdx++) {
                        const posShape = positiveShapes[pIdx];
                        if (posShape.points.length < 3) continue;

                        const holes = negativeShapes.filter(negShape => {
                            if (negShape.points.length < 3) return false;
                            return isPointInPolygon(negShape.points[0], posShape.points);
                        });

                        const posPointsPDF = posShape.points.map(p => mapper.map(p.x, p.y));
                        
                        // Debug log for the first point
                        if (pIdx === 0) {
                            logger.log(`  Shape ${item.label} P0: (${posPointsPDF[0].x.toFixed(1)}, ${posPointsPDF[0].y.toFixed(1)}) Color: ${item.color}`);
                        }

                        // Use drawSvgPath for EVERYTHING to ensure consistency.
                        // Manually manage winding order for SVG Path standard (CCW for outer, CW for inner usually works best with Non-Zero rules).
                        
                        // 1. Outer Shape: Must be CCW
                        const outerArea = getSignedArea(posPointsPDF);
                        logger.log(`  Outer signed area: ${outerArea}`);
                        if (outerArea < 0) {
                            posPointsPDF.reverse();
                            logger.log(`  Reversed outer shape to CCW`);
                        }

                        let svgPath = pointsToSvgPath(posPointsPDF, logger);
                        logger.log(`  Outer SVG path: ${svgPath}`);

                        const holePointsArray: { x: number, y: number }[][] = [];
                        for (const hole of holes) {
                            const holePointsPDF = hole.points.map(p => mapper.map(p.x, p.y));
                            // 2. Inner Holes: Must be CW
                            const holeArea = getSignedArea(holePointsPDF);
                            logger.log(`  Hole signed area: ${holeArea}`);
                            if (holeArea > 0) {
                                holePointsPDF.reverse();
                                logger.log(`  Reversed hole to CW`);
                            }
                            holePointsArray.push(holePointsPDF);
                            
                            const holePath = pointsToSvgPath(holePointsPDF, logger);
                            logger.log(`  Hole SVG path: ${holePath}`);
                            svgPath += ' ' + holePath;
                        }

                        // Debug logging
                        logger.log(`  drawPolygonWithHoles for ${item.label}:`, {
                            pointsCount: posPointsPDF.length,
                            holesCount: holes.length,
                            color: item.color,
                            fillOpacity: FILL_OPACITY,
                            borderOpacity: 0.8
                        });

                        try {
                            drawPolygonWithHoles(
                                page,
                                posPointsPDF,
                                holePointsArray,
                                pdfColor,
                                FILL_OPACITY,
                                pdfColor,
                                1, // stroke width
                                0.8, // stroke opacity
                                logger
                            );
                            logger.log(`  Low-level polygon drawn for ${item.label}`);
                        } catch (err) {
                            logger.log(`  Low-level polygon error for ${item.label}`, err);
                        }
                    }

                    // Draw Outlines (Separate Pass for better style)
                    const LINE_THICKNESS = 1.33;
                    const LINE_OPACITY = 0.8;

                    for (const shape of shapes) {
                        if (shape.points.length === 0) continue;
                        const points = shape.points.map(p => mapper.map(p.x, p.y));
                        
                        for (let k = 0; k < points.length; k++) {
                            const p1 = points[k];
                            const p2 = points[(k + 1) % points.length];
                            page.drawLine({
                                start: p1, end: p2,
                                color: pdfColor, thickness: LINE_THICKNESS,
                                opacity: LINE_OPACITY,
                                dashArray: shape.deduction ? [3, 3] : undefined
                            });
                        }
                    }

                } else {
                    // Non-Area Tools
                    for (const shape of shapes) {
                        if (shape.points.length === 0) continue;
                        const points = shape.points.map(p => mapper.map(p.x, p.y));

                        if (item.type === ToolType.COUNT) {
                            points.forEach(p => {
                                page.drawCircle({
                                    x: p.x, y: p.y, size: 5,
                                    color: pdfColor, borderColor: rgb(1, 1, 1), borderWidth: 2, opacity: 0.8
                                });
                            });
                        }
                        else if (item.type === ToolType.NOTE && includeNotes) {
                            const p1 = points[0];
                            const p2 = points.length > 1 ? points[1] : p1;
                            
                            if (points.length > 1) {
                                page.drawLine({ start: p2, end: p1, color: pdfColor, thickness: 2 });
                                const headLen = 10;
                                const dx = p1.x - p2.x;
                                const dy = p1.y - p2.y;
                                const angle = Math.atan2(dy, dx);
                                page.drawLine({
                                    start: p1,
                                    end: { x: p1.x - headLen * Math.cos(angle - Math.PI / 6), y: p1.y - headLen * Math.sin(angle - Math.PI / 6) },
                                    color: pdfColor, thickness: 2
                                });
                                page.drawLine({
                                    start: p1,
                                    end: { x: p1.x - headLen * Math.cos(angle + Math.PI / 6), y: p1.y - headLen * Math.sin(angle + Math.PI / 6) },
                                    color: pdfColor, thickness: 2
                                });
                            }

                            if (shape.text) {
                                const fontSize = 10;
                                const lines = wrapText(shape.text, font, fontSize, 200);
                                const lineHeight = fontSize + 4;
                                const boxHeight = (lines.length * lineHeight) + 4;
                                let boxWidth = 0;
                                lines.forEach(l => { const w = font.widthOfTextAtSize(l, fontSize); if(w>boxWidth) boxWidth=w; });
                                boxWidth += 8;

                                const textRot = mapper.getRotationAngle();
                                
                                page.drawRectangle({
                                    x: p2.x, y: p2.y - boxHeight,
                                    width: boxWidth, height: boxHeight,
                                    color: rgb(1, 1, 1), opacity: 0.8,
                                    borderColor: pdfColor, borderWidth: 1,
                                    rotate: degrees(textRot)
                                });

                                lines.forEach((line, i) => {
                                    page.drawText(line, {
                                        x: p2.x + 4, 
                                        y: p2.y - (i + 1) * lineHeight, 
                                        size: fontSize, font, color: pdfColor,
                                        rotate: degrees(textRot)
                                    });
                                });
                            }
                        }
                        else if (item.type === ToolType.LINEAR || item.type === ToolType.SEGMENT || item.type === ToolType.DIMENSION) {
                            for (let k = 0; k < points.length - 1; k++) {
                                page.drawLine({
                                    start: points[k], end: points[k + 1],
                                    color: pdfColor, thickness: 1.33, opacity: 0.8
                                });
                            }
                            if (item.type === ToolType.DIMENSION && points.length >= 2) {
                                drawDimension(page, points[0], points[1], pdfColor, shape.value, item.unit, fontBold, mapper);
                            }
                        }
                    }
                }
            }

            if (includeLegend && pageItems.length > 0) {
                const legendSettings = pData?.legend || { x: 50, y: 50, scale: 1 };
                const legendItems = pageItems.filter(i => i.type !== ToolType.NOTE);
                if (legendItems.length > 0) {
                    drawNativeLegend(page, legendItems, globalIdx, legendSettings, font, fontBold, mapper);
                }
            }
        }
        logger.endSection();
    }

    const pdfBytes = await outPdf.save();
    return { pdfBytes, logContent: logger.getLogContent() };
};

const drawDimension = (
    page: PDFPage,
    p1: { x: number, y: number },
    p2: { x: number, y: number },
    color: Color,
    value: number,
    unit: string,
    font: PDFFont,
    mapper: CoordinateMapper
) => {
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len === 0) return;

    const nx = -dy / len;
    const ny = dx / len;
    const tickLen = 8;
    const LINE_THICKNESS = 1.0;

    page.drawLine({
        start: { x: p1.x + nx * tickLen, y: p1.y + ny * tickLen },
        end: { x: p1.x - nx * tickLen, y: p1.y - ny * tickLen },
        color, thickness: LINE_THICKNESS
    });
    page.drawLine({
        start: { x: p2.x + nx * tickLen, y: p2.y + ny * tickLen },
        end: { x: p2.x - nx * tickLen, y: p2.y - ny * tickLen },
        color, thickness: LINE_THICKNESS
    });

    const mx = (p1.x + p2.x) / 2;
    const my = (p1.y + p2.y) / 2;

    const text = `${value.toFixed(2)} ${unit}`;
    const textSize = 10;
    const textWidth = font.widthOfTextAtSize(text, textSize);

    page.drawText(text, {
        x: mx - textWidth / 2,
        y: my,
        size: textSize,
        font: font,
        color: rgb(0.2, 0.2, 0.2),
        rotate: mapper.getTextRotation()
    });
};

const drawNativeLegend = (
    page: PDFPage,
    items: TakeoffItem[],
    globalIdx: number,
    settings: { x: number, y: number, scale: number },
    font: PDFFont,
    fontBold: PDFFont,
    mapper: CoordinateMapper
) => {
    const anchor = mapper.map(settings.x, settings.y);
    const rotation = mapper.getRotationAngle();

    const pdfScale = settings.scale * CANVAS_TO_PDF_SCALE;

    const baseWidth = 200;
    const fontSize = 11 * pdfScale;
    const headerFontSize = 12 * pdfScale;
    const lineHeight = 16 * pdfScale;
    const headerHeight = 22 * pdfScale;
    const padding = 8 * pdfScale;

    const contentHeight = headerHeight + (items.length * lineHeight) + padding;

    const w = baseWidth * pdfScale;
    const h = contentHeight;

    let rectParams: { x: number, y: number, w: number, h: number } = { x: 0, y: 0, w: 0, h: 0 };
    let textOrigin: { x: number, y: number } = { x: 0, y: 0 };
    let textRightVec: { x: number, y: number } = { x: 0, y: 0 };
    let textDownVec: { x: number, y: number } = { x: 0, y: 0 };

    if (rotation === 0) {
        rectParams = { x: anchor.x, y: anchor.y - h, w: w, h: h };
        textOrigin = { x: anchor.x + padding, y: anchor.y - padding };
        textRightVec = { x: 1, y: 0 };
        textDownVec = { x: 0, y: -1 };
    }
    else if (rotation === 90) {
        rectParams = { x: anchor.x, y: anchor.y, w: h, h: w };
        textOrigin = { x: anchor.x + padding, y: anchor.y + padding };
        textRightVec = { x: 0, y: 1 };
        textDownVec = { x: 1, y: 0 };
    }
    else if (rotation === 180) {
        rectParams = { x: anchor.x - w, y: anchor.y, w: w, h: h };
        textOrigin = { x: anchor.x - padding, y: anchor.y + padding };
        textRightVec = { x: -1, y: 0 };
        textDownVec = { x: 0, y: 1 };
    }
    else if (rotation === 270) {
        rectParams = { x: anchor.x - h, y: anchor.y - w, w: h, h: w };
        textOrigin = { x: anchor.x - padding, y: anchor.y - padding };
        textRightVec = { x: 0, y: -1 };
        textDownVec = { x: -1, y: 0 };
    }

    page.drawRectangle({
        x: rectParams.x,
        y: rectParams.y,
        width: rectParams.w,
        height: rectParams.h,
        color: rgb(1, 1, 1),
        opacity: 0.98,
        borderColor: rgb(0.85, 0.85, 0.85),
        borderWidth: 0.75,
    });

    const headerText = "LEGEND";
    const headerW = fontBold.widthOfTextAtSize(headerText, headerFontSize);
    const headerCenterOffset = (w - (padding * 2) - headerW) / 2;

    const headerYOffset = headerHeight * 0.65;
    const hx = textOrigin.x + (textRightVec.x * headerCenterOffset) + (textDownVec.x * headerYOffset);
    const hy = textOrigin.y + (textRightVec.y * headerCenterOffset) + (textDownVec.y * headerYOffset);

    page.drawText(headerText, {
        x: hx,
        y: hy,
        size: headerFontSize,
        font: fontBold,
        color: rgb(0.1, 0.1, 0.1),
        rotate: degrees(rotation)
    });

    const drawRow = (label: string, qty: string, rowIdx: number, colorHex: string) => {
        const rowYOffset = headerHeight + ((rowIdx) * lineHeight) + (lineHeight * 0.65);
        const c = hexToRgb(colorHex);

        const swatchSize = 10 * pdfScale;
        const swatchYCenterOffset = rowYOffset + (swatchSize * 0.15);

        const sx = textOrigin.x + (textDownVec.x * swatchYCenterOffset);
        const sy = textOrigin.y + (textDownVec.y * swatchYCenterOffset);

        page.drawRectangle({
            x: sx, y: sy, width: swatchSize, height: swatchSize,
            color: rgb(c.r, c.g, c.b),
            borderColor: rgb(c.r * 0.8, c.g * 0.8, c.b * 0.8),
            borderWidth: 0.5,
            rotate: degrees(rotation)
        });

        const labelXOffset = swatchSize + (5 * pdfScale);
        const lx = textOrigin.x + (textRightVec.x * labelXOffset) + (textDownVec.x * rowYOffset);
        const ly = textOrigin.y + (textRightVec.y * labelXOffset) + (textDownVec.y * rowYOffset);

        page.drawText(label, {
            x: lx, y: ly, size: fontSize, font: font, color: rgb(0.2, 0.2, 0.2), rotate: degrees(rotation)
        });

        const qtyW = fontBold.widthOfTextAtSize(qty, fontSize);
        const qtyXOffset = w - (padding * 2) - qtyW;

        const qx = textOrigin.x + (textRightVec.x * qtyXOffset) + (textDownVec.x * rowYOffset);
        const qy = textOrigin.y + (textRightVec.y * qtyXOffset) + (textDownVec.y * rowYOffset);

        page.drawText(qty, {
            x: qx, y: qy, size: fontSize, font: fontBold, color: rgb(0.1, 0.1, 0.1), rotate: degrees(rotation)
        });
    };

    items.forEach((item, idx) => {
        const pageShapes = item.shapes.filter(s => s.pageIndex === globalIdx);
        const raw = pageShapes.reduce((sum, s) => s.deduction ? sum - s.value : sum + s.value, 0);
        const qty = evaluateFormula(item, raw);

        const label = item.label.length > 18 ? item.label.substring(0, 16) + '..' : item.label;
        const qtyText = `${qty.toLocaleString(undefined, { maximumFractionDigits: 1 })} ${item.unit}`;

        drawRow(label, qtyText, idx, item.color);
    });
};
