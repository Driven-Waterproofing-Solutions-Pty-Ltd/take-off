/**
 * MuPDF Web Worker
 * 
 * Runs MuPDF rendering on a separate thread to keep UI responsive.
 * Uses DisplayList caching for fast re-renders.
 */

// Configure WASM path for worker context (must be before mupdf import)
// @ts-ignore
self["$libmupdf_wasm_Module"] = {
    locateFile: (path: string) => {
        if (path.endsWith('.wasm')) {
            return '/mupdf-wasm.wasm';
        }
        return path;
    }
};

import * as mupdf from 'mupdf';

interface WorkerMessage {
    id: number;
    type: 'loadDocument' | 'renderPage' | 'getPageDimensions' | 'preloadPage' | 'destroy' | 'getCacheStats';
    payload?: any;
}

interface WorkerResponse {
    id: number;
    success: boolean;
    result?: any;
    error?: string;
}

// Document and cache state
let currentDoc: any = null;
const displayListCache = new Map<number, any>();
const dimensionsCache = new Map<number, { width: number, height: number }>();
const MAX_CACHED_PAGES = 10;

/**
 * Get or create DisplayList for a page with LRU caching
 */
function getDisplayList(pageIndex: number): any {
    // Check if cached (move to end for LRU)
    const existing = displayListCache.get(pageIndex);
    if (existing) {
        displayListCache.delete(pageIndex);
        displayListCache.set(pageIndex, existing);
        return existing;
    }

    // Create new DisplayList
    const page = currentDoc.loadPage(pageIndex);
    try {
        const displayList = page.toDisplayList(true);

        // Evict oldest if cache full
        if (displayListCache.size >= MAX_CACHED_PAGES) {
            const oldestKey = displayListCache.keys().next().value;
            if (oldestKey !== undefined) {
                displayListCache.get(oldestKey)?.destroy();
                displayListCache.delete(oldestKey);
            }
        }

        displayListCache.set(pageIndex, displayList);
        return displayList;
    } finally {
        page.destroy();
    }
}

/**
 * Clear all caches
 */
function clearCaches(): void {
    displayListCache.forEach(dl => {
        try { dl.destroy(); } catch (e) { /* ignore */ }
    });
    displayListCache.clear();
    dimensionsCache.clear();
}

/**
 * Handle messages from main thread
 */
self.onmessage = async (e: MessageEvent<WorkerMessage>) => {
    const { id, type, payload } = e.data;

    const respond = (success: boolean, result?: any, error?: string) => {
        const response: WorkerResponse = { id, success, result, error };
        self.postMessage(response);
    };

    try {
        switch (type) {
            case 'loadDocument': {
                // Cleanup previous document
                clearCaches();
                if (currentDoc) {
                    currentDoc.destroy();
                    currentDoc = null;
                }

                // Open new document
                const { data } = payload;
                currentDoc = mupdf.Document.openDocument(data, "application/pdf");
                const pageCount = currentDoc.countPages();
                respond(true, { pageCount });
                break;
            }

            case 'renderPage': {
                if (!currentDoc) {
                    respond(false, undefined, "No document loaded");
                    return;
                }

                const { pageIndex, scale } = payload;
                const startTime = performance.now();

                const displayList = getDisplayList(pageIndex);
                const ctm = mupdf.Matrix.scale(scale, scale);
                const pixmap = displayList.toPixmap(ctm, mupdf.ColorSpace.DeviceRGB, true);

                const pixels = pixmap.getPixels();
                const width = pixmap.getWidth();
                const height = pixmap.getHeight();

                pixmap.destroy();

                const elapsed = performance.now() - startTime;

                // Transfer ownership of pixels buffer to main thread for zero-copy
                respond(true, { pixels, width, height, renderTimeMs: elapsed });
                break;
            }

            case 'getPageDimensions': {
                if (!currentDoc) {
                    respond(false, undefined, "No document loaded");
                    return;
                }

                const { pageIndex } = payload;

                // Check cache
                const cached = dimensionsCache.get(pageIndex);
                if (cached) {
                    respond(true, cached);
                    return;
                }

                const page = currentDoc.loadPage(pageIndex);
                const bounds = page.getBounds();
                page.destroy();

                const dims = {
                    width: bounds[2] - bounds[0],
                    height: bounds[3] - bounds[1]
                };
                dimensionsCache.set(pageIndex, dims);
                respond(true, dims);
                break;
            }

            case 'preloadPage': {
                if (!currentDoc) {
                    respond(true); // Silently succeed
                    return;
                }

                const { pageIndex } = payload;
                const pageCount = currentDoc.countPages();

                if (pageIndex >= 0 && pageIndex < pageCount && !displayListCache.has(pageIndex)) {
                    getDisplayList(pageIndex);
                }
                respond(true);
                break;
            }

            case 'getCacheStats': {
                respond(true, {
                    displayListCount: displayListCache.size,
                    maxDisplayLists: MAX_CACHED_PAGES,
                    dimensionsCount: dimensionsCache.size,
                    documentLoaded: currentDoc !== null
                });
                break;
            }

            case 'destroy': {
                clearCaches();
                if (currentDoc) {
                    currentDoc.destroy();
                    currentDoc = null;
                }
                respond(true);
                break;
            }

            default:
                respond(false, undefined, `Unknown message type: ${type}`);
        }
    } catch (error) {
        respond(false, undefined, String(error));
    }
};

// Let main thread know worker is ready
self.postMessage({ id: -1, success: true, result: { ready: true } });
