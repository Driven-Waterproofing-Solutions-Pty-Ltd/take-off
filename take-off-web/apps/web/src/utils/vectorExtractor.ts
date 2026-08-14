import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorkerUrl from 'pdfjs-dist/build/pdf.worker.mjs?url';
import { Point } from '../types';

// pdf.js needs an explicit worker URL under Vite. Setting it once at module
// load is idempotent — repeated assignments to the same URL are no-ops.
if (!pdfjsLib.GlobalWorkerOptions.workerSrc) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorkerUrl;
}

export interface ExtractedVectorPath {
  type: 'line' | 'rect';
  points: Point[];
  closed?: boolean;
}

export interface ExtractedPageVectors {
  pageIndex: number;
  paths: ExtractedVectorPath[];
  bounds: { x: number; y: number; width: number; height: number };
}

// pdf.js 5.x packs every path-construction op into OPS.constructPath. The
// nested path buffer encodes sub-operations using these one-byte codes,
// followed inline by their coordinates. Rectangles are pre-expanded into
// moveTo/lineTo/closePath sequences in the same buffer.
const DRAW_OPS = {
  moveTo: 0,
  lineTo: 1,
  curveTo: 2,
  closePath: 3,
} as const;

// 6-element affine matrix: [a, b, c, d, e, f] → [x', y'] = [a*x+c*y+e, b*x+d*y+f]
const applyMatrix = (m: number[], x: number, y: number): [number, number] => [
  m[0] * x + m[2] * y + m[4],
  m[1] * x + m[3] * y + m[5],
];

const mulMatrix = (a: number[], b: number[]): number[] => [
  a[0] * b[0] + a[2] * b[1],
  a[1] * b[0] + a[3] * b[1],
  a[0] * b[2] + a[2] * b[3],
  a[1] * b[2] + a[3] * b[3],
  a[0] * b[4] + a[2] * b[5] + a[4],
  a[1] * b[4] + a[3] * b[5] + a[5],
];

// Cubic Bezier flattening — adaptive split by chord-control deviation.
const flattenBezier = (
  p0: [number, number],
  p1: [number, number],
  p2: [number, number],
  p3: [number, number],
  out: Array<[number, number]>,
  tolerance = 0.5,
  depth = 0,
): void => {
  if (depth > 6) {
    out.push(p3);
    return;
  }
  const dx = p3[0] - p0[0];
  const dy = p3[1] - p0[1];
  const len = Math.hypot(dx, dy) || 1;
  const d1 = Math.abs((p1[0] - p0[0]) * dy - (p1[1] - p0[1]) * dx) / len;
  const d2 = Math.abs((p2[0] - p0[0]) * dy - (p2[1] - p0[1]) * dx) / len;
  if (Math.max(d1, d2) <= tolerance) {
    out.push(p3);
    return;
  }
  const m01: [number, number] = [(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2];
  const m12: [number, number] = [(p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2];
  const m23: [number, number] = [(p2[0] + p3[0]) / 2, (p2[1] + p3[1]) / 2];
  const m012: [number, number] = [(m01[0] + m12[0]) / 2, (m01[1] + m12[1]) / 2];
  const m123: [number, number] = [(m12[0] + m23[0]) / 2, (m12[1] + m23[1]) / 2];
  const m0123: [number, number] = [(m012[0] + m123[0]) / 2, (m012[1] + m123[1]) / 2];
  flattenBezier(p0, m01, m012, m0123, out, tolerance, depth + 1);
  flattenBezier(m0123, m123, m23, p3, out, tolerance, depth + 1);
};

async function extractPageVectorPaths(
  page: pdfjsLib.PDFPageProxy,
  renderScale: number,
  maxSegments: number,
): Promise<ExtractedVectorPath[]> {
  const OPS = (pdfjsLib as unknown as { OPS: Record<string, number> }).OPS;
  const viewport = page.getViewport({ scale: renderScale });
  const opList = await page.getOperatorList();

  const paths: ExtractedVectorPath[] = [];
  const stack: number[][] = [[1, 0, 0, 1, 0, 0]];
  let ctm = stack[0];

  let subpath: Point[] = [];
  let subpathStart: Point | null = null;
  let totalSegments = 0;

  const toViewport = (px: number, py: number): [number, number] => {
    const [tx, ty] = applyMatrix(ctm, px, py);
    const v = viewport.convertToViewportPoint(tx, ty);
    return [v[0], v[1]];
  };

  const flushSubpath = (closed: boolean) => {
    if (subpath.length >= 2) {
      paths.push({ type: 'line', points: subpath, closed });
      totalSegments += subpath.length - 1 + (closed ? 1 : 0);
    }
    subpath = [];
    subpathStart = null;
  };

  // pdf.js's "ordinary" constructPath format passes the ops as one array
  // and the coordinates as a separate flat array (each op consumes a fixed
  // pair count: moveTo/lineTo 1 pair, curveTo 3 pairs, closePath 0). The
  // existing walkPathBuffer below handles the legacy packed form where
  // ops and coords are interleaved into one buffer — fallback for older
  // PDFs.
  const walkOpsCoords = (ops: number[], coords: number[] | Float32Array): void => {
    const at = (i: number) => (typeof coords === 'number' ? 0 : (coords as ArrayLike<number>)[i] as number);
    let c = 0;
    for (const op of ops) {
      switch (op) {
        case DRAW_OPS.moveTo: {
          flushSubpath(false);
          const [vx, vy] = toViewport(at(c++), at(c++));
          subpath.push({ x: vx, y: vy });
          subpathStart = { x: vx, y: vy };
          break;
        }
        case DRAW_OPS.lineTo: {
          const [vx, vy] = toViewport(at(c++), at(c++));
          if (subpath.length === 0 && subpathStart) subpath.push(subpathStart);
          subpath.push({ x: vx, y: vy });
          break;
        }
        case DRAW_OPS.curveTo: {
          if (subpath.length === 0) {
            c += 6;
            break;
          }
          const last = subpath[subpath.length - 1];
          const c1 = toViewport(at(c++), at(c++));
          const c2 = toViewport(at(c++), at(c++));
          const p3 = toViewport(at(c++), at(c++));
          const flat: Array<[number, number]> = [];
          flattenBezier([last.x, last.y], c1, c2, p3, flat);
          for (const [fx, fy] of flat) subpath.push({ x: fx, y: fy });
          break;
        }
        case DRAW_OPS.closePath: {
          if (subpath.length >= 2 && subpathStart) {
            const first = subpath[0];
            const last = subpath[subpath.length - 1];
            if (first.x !== last.x || first.y !== last.y) {
              subpath.push({ x: first.x, y: first.y });
            }
          }
          flushSubpath(true);
          break;
        }
        default:
          // Unknown draw op — bail rather than misalign coords.
          return;
      }
    }
  };

  // Walk a packed pdf.js 5.x path buffer (legacy interleaved form):
  //   [op, ...coords, op, ...coords, ...]
  // op codes are DRAW_OPS values; coord counts follow the spec table.
  const walkPathBuffer = (buf: number[]): void => {
    let p = 0;
    while (p < buf.length) {
      const op = buf[p++];
      switch (op) {
        case DRAW_OPS.moveTo: {
          flushSubpath(false);
          const [vx, vy] = toViewport(buf[p++], buf[p++]);
          subpath.push({ x: vx, y: vy });
          subpathStart = { x: vx, y: vy };
          break;
        }
        case DRAW_OPS.lineTo: {
          const [vx, vy] = toViewport(buf[p++], buf[p++]);
          if (subpath.length === 0 && subpathStart) subpath.push(subpathStart);
          subpath.push({ x: vx, y: vy });
          break;
        }
        case DRAW_OPS.curveTo: {
          if (subpath.length === 0) {
            p += 6;
            break;
          }
          const last = subpath[subpath.length - 1];
          const c1 = toViewport(buf[p++], buf[p++]);
          const c2 = toViewport(buf[p++], buf[p++]);
          const p3 = toViewport(buf[p++], buf[p++]);
          const flat: Array<[number, number]> = [];
          flattenBezier([last.x, last.y], c1, c2, p3, flat);
          for (const [fx, fy] of flat) subpath.push({ x: fx, y: fy });
          break;
        }
        case DRAW_OPS.closePath: {
          if (subpath.length >= 2 && subpathStart) {
            const first = subpath[0];
            const last = subpath[subpath.length - 1];
            if (first.x !== last.x || first.y !== last.y) {
              subpath.push({ x: first.x, y: first.y });
            }
          }
          flushSubpath(true);
          break;
        }
        default:
          // Unknown draw op — bail on this buffer rather than misalign coords.
          return;
      }
    }
  };

  for (let i = 0; i < opList.fnArray.length; i++) {
    if (totalSegments >= maxSegments) break;
    const fn = opList.fnArray[i];

    if (fn === OPS.save) {
      stack.push([...ctm]);
      ctm = stack[stack.length - 1];
      continue;
    }
    if (fn === OPS.restore) {
      if (stack.length > 1) stack.pop();
      ctm = stack[stack.length - 1];
      continue;
    }
    if (fn === OPS.transform) {
      const m = opList.argsArray[i] as number[];
      ctm = mulMatrix(ctm, m);
      stack[stack.length - 1] = ctm;
      continue;
    }
    if (fn === OPS.constructPath) {
      // Two pdf.js argsArray shapes seen in the wild for constructPath:
      //   (a) modern (pdf.js 4.x/5.x ordinary lists): [ops: number[],
      //       coords: number[] | Float32Array, minMax?]
      //   (b) legacy (some older / paint-wrapped variants): [paintOp,
      //       [pathBuffer], minMax] — ops and coords interleaved into one
      //       buffer wrapped in a single-element array.
      // The previous code only handled (b) and read args[1][0]; under
      // shape (a) that resolved to the first coordinate (a number) and
      // walkPathBuffer was never called, so CAD pages uploaded EMPTY
      // vector caches and snap/fill silently failed. Detect both.
      const args = opList.argsArray[i] as unknown[];
      const first = args[0];
      const second = args[1];
      let closeAtPaint = false;
      if (Array.isArray(first) && first.length > 0 && typeof first[0] === 'number') {
        // Shape (a) — modern: [ops, coords].
        const ops = first as number[];
        const coords =
          Array.isArray(second) || (second && typeof second === 'object' && 'length' in (second as object))
            ? (second as number[] | Float32Array)
            : ([] as number[]);
        walkOpsCoords(ops, coords);
        // Closure intent comes from the NEXT op (stroke / closeStroke / etc.),
        // not from within constructPath itself.
        const next = opList.fnArray[i + 1];
        closeAtPaint =
          next === OPS.closeStroke ||
          next === OPS.closeFillStroke ||
          next === OPS.closeEOFillStroke;
      } else {
        // Shape (b) — legacy packed buffer.
        const paintOp = first as number;
        const dataWrapper = second as unknown[] | undefined;
        const pathBuffer = dataWrapper?.[0];
        if (Array.isArray(pathBuffer)) {
          walkPathBuffer(pathBuffer as number[]);
        } else if (pathBuffer && typeof pathBuffer === 'object' && 'length' in (pathBuffer as object)) {
          walkPathBuffer(Array.from(pathBuffer as ArrayLike<number>));
        }
        closeAtPaint =
          paintOp === OPS.closeStroke ||
          paintOp === OPS.closeFillStroke ||
          paintOp === OPS.closeEOFillStroke;
      }
      flushSubpath(closeAtPaint);
      continue;
    }
    // Some PDFs (older or unusual generators) may still emit individual
    // path-construction ops outside constructPath. Handle the common ones
    // defensively so we don't silently drop their geometry.
    if (fn === OPS.rectangle) {
      const args = opList.argsArray[i] as number[];
      const [x, y, w, h] = args;
      flushSubpath(false);
      const corners: Point[] = [
        (([cx, cy]) => ({ x: cx, y: cy }))(toViewport(x, y)),
        (([cx, cy]) => ({ x: cx, y: cy }))(toViewport(x + w, y)),
        (([cx, cy]) => ({ x: cx, y: cy }))(toViewport(x + w, y + h)),
        (([cx, cy]) => ({ x: cx, y: cy }))(toViewport(x, y + h)),
      ];
      paths.push({ type: 'rect', points: corners, closed: true });
      totalSegments += 4;
      continue;
    }
  }
  flushSubpath(false);

  return paths;
}

// Drop sub-pixel paths and round coordinates to integer pixels. RENDER_SCALE
// is 2.0 so 1 px ≈ 0.5 PDF points ≈ 0.18 mm at native resolution — way under
// the ~8 px snap tolerance the server uses. Integer coords also shrink the
// JSON payload (no decimals) so dense AutoCAD pages stay under D1's row-size
// budget after segments get expanded into {a, b} pairs server-side.
const PRECISION = 1;
const roundCoord = (v: number) => Math.round(v * PRECISION) / PRECISION;

const simplifyPaths = (paths: ExtractedVectorPath[]): ExtractedVectorPath[] => {
  const out: ExtractedVectorPath[] = [];
  for (const path of paths) {
    if (path.points.length < 2) continue;
    const points: Point[] = [];
    let totalLen = 0;
    let prev: Point | null = null;
    for (const p of path.points) {
      const rx = roundCoord(p.x);
      const ry = roundCoord(p.y);
      if (prev && prev.x === rx && prev.y === ry) continue;
      if (prev) totalLen += Math.hypot(rx - prev.x, ry - prev.y);
      points.push({ x: rx, y: ry });
      prev = { x: rx, y: ry };
    }
    if (points.length < 2 || totalLen < 1) continue;
    out.push({ ...path, points });
  }
  return out;
};

export async function extractPdfVectorPaths(
  file: File | ArrayBuffer,
  renderScale: number,
  options: { maxSegmentsPerPage?: number } = {},
): Promise<ExtractedPageVectors[]> {
  const data =
    file instanceof ArrayBuffer ? file : await file.arrayBuffer();
  // 40k segments per page keeps the per-row D1 payload comfortably under the
  // ~1 MB limit once vertices + {a,b} segment pairs are expanded for upload.
  // Worst-case dense AutoCAD pages we've measured top out around 11k segs.
  const maxSegments = options.maxSegmentsPerPage ?? 40_000;

  // pdf.js consumes the buffer; clone so the caller's File can still be used
  // by other consumers (MuPDF).
  const loadingTask = pdfjsLib.getDocument({ data: data.slice(0) });
  const doc = await loadingTask.promise;
  const result: ExtractedPageVectors[] = [];

  try {
    for (let i = 0; i < doc.numPages; i++) {
      const page = await doc.getPage(i + 1);
      try {
        const viewport = page.getViewport({ scale: renderScale });
        const rawPaths = await extractPageVectorPaths(page, renderScale, maxSegments);
        const paths = simplifyPaths(rawPaths);
        result.push({
          pageIndex: i,
          paths,
          bounds: { x: 0, y: 0, width: viewport.width, height: viewport.height },
        });
      } finally {
        page.cleanup();
      }
      // Yield to keep the UI responsive on long PDFs.
      await new Promise((r) => setTimeout(r, 0));
    }
  } finally {
    await doc.destroy();
  }

  return result;
}
