/**
 * MuPDF Worker Controller
 * 
 * Provides a Promise-based API for interacting with the MuPDF Web Worker.
 * Falls back to main thread rendering if Web Workers are not available.
 */

// Import worker with Vite's ?worker syntax
import MuPDFWorker from '../workers/mupdf.worker?worker';

interface WorkerResponse {
    id: number;
    success: boolean;
    result?: any;
    error?: string;
}

type PendingRequest = {
    resolve: (value: any) => void;
    reject: (error: Error) => void;
};

class MuPDFWorkerController {
    private worker: Worker | null = null;
    private requestId = 0;
    private pendingRequests = new Map<number, PendingRequest>();
    private isReady = false;
    private readyPromise: Promise<void>;
    private readyResolve: (() => void) | null = null;

    constructor() {
        this.readyPromise = new Promise((resolve) => {
            this.readyResolve = resolve;
        });
        this.initWorker();
    }

    private initWorker(): void {
        try {
            this.worker = new MuPDFWorker();

            this.worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
                const { id, success, result, error } = e.data;

                // Handle ready message
                if (id === -1 && result?.ready) {
                    this.isReady = true;
                    this.readyResolve?.();
                    console.log("MuPDF Worker: Ready");
                    return;
                }

                const pending = this.pendingRequests.get(id);
                if (pending) {
                    this.pendingRequests.delete(id);
                    if (success) {
                        pending.resolve(result);
                    } else {
                        pending.reject(new Error(error || "Unknown worker error"));
                    }
                }
            };

            this.worker.onerror = (error) => {
                console.error("MuPDF Worker Error:", error);
                // Reject all pending requests
                this.pendingRequests.forEach(pending => {
                    pending.reject(new Error("Worker error"));
                });
                this.pendingRequests.clear();
            };
        } catch (error) {
            console.warn("MuPDF Worker: Failed to initialize, Web Workers may not be supported", error);
            this.isReady = true;
            this.readyResolve?.();
        }
    }

    private async sendMessage(type: string, payload?: any): Promise<any> {
        await this.readyPromise;

        if (!this.worker) {
            throw new Error("Worker not available");
        }

        return new Promise((resolve, reject) => {
            const id = ++this.requestId;
            this.pendingRequests.set(id, { resolve, reject });
            this.worker!.postMessage({ id, type, payload });
        });
    }

    /**
     * Check if worker is available
     */
    isWorkerAvailable(): boolean {
        return this.worker !== null && this.isReady;
    }

    /**
     * Load a PDF document
     */
    async loadDocument(data: Uint8Array): Promise<number> {
        const result = await this.sendMessage('loadDocument', { data });
        console.log(`MuPDF Worker: Loaded document with ${result.pageCount} pages`);
        return result.pageCount;
    }

    /**
     * Render a page to ImageData
     */
    async renderPage(pageIndex: number, scale: number): Promise<{
        pixels: Uint8ClampedArray;
        width: number;
        height: number;
        renderTimeMs: number;
    }> {
        const result = await this.sendMessage('renderPage', { pageIndex, scale });
        return result;
    }

    /**
     * Render a page directly to a canvas
     */
    async renderPageToCanvas(pageIndex: number, canvas: HTMLCanvasElement, scale: number): Promise<void> {
        const { pixels, width, height, renderTimeMs } = await this.renderPage(pageIndex, scale);

        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const imageData = new ImageData(pixels, width, height);
        ctx.putImageData(imageData, 0, 0);

        console.log(`MuPDF Worker: Rendered page ${pageIndex} at scale ${scale} in ${renderTimeMs.toFixed(1)}ms`);
    }

    /**
     * Get page dimensions
     */
    async getPageDimensions(pageIndex: number): Promise<{ width: number; height: number }> {
        return await this.sendMessage('getPageDimensions', { pageIndex });
    }

    /**
     * Preload a page into cache
     */
    async preloadPage(pageIndex: number): Promise<void> {
        await this.sendMessage('preloadPage', { pageIndex });
    }

    /**
     * Get cache statistics
     */
    async getCacheStats(): Promise<{
        displayListCount: number;
        maxDisplayLists: number;
        dimensionsCount: number;
        documentLoaded: boolean;
    }> {
        return await this.sendMessage('getCacheStats');
    }

    /**
     * Destroy the worker and cleanup
     */
    async destroy(): Promise<void> {
        if (this.worker) {
            try {
                await this.sendMessage('destroy');
            } catch (e) {
                // Ignore errors during cleanup
            }
            this.worker.terminate();
            this.worker = null;
        }
        this.pendingRequests.clear();
    }
}

// Singleton instance
let workerController: MuPDFWorkerController | null = null;

/**
 * Get the MuPDF Worker Controller singleton
 */
export function getMuPDFWorkerController(): MuPDFWorkerController {
    if (!workerController) {
        workerController = new MuPDFWorkerController();
    }
    return workerController;
}

/**
 * Destroy the worker controller (call on app unmount)
 */
export async function destroyMuPDFWorkerController(): Promise<void> {
    if (workerController) {
        await workerController.destroy();
        workerController = null;
    }
}

export { MuPDFWorkerController };
