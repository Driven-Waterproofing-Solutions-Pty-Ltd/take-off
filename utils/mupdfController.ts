import * as mupdf from 'mupdf';

// Define simplified types based on MuPDF API
// We might need to adjust these as we verify the actual package exports
export interface MuPDFPage {
    // Basic properties we expect to use
    getBounds(): [number, number, number, number]; // [x, y, w, h]
    toPixmap(ctm: any, colorspace: any, alpha: boolean): any;
}

export interface MuPDFDocument {
    countPages(): number;
    loadPage(index: number): MuPDFPage;
    destroy(): void;
}

class MuPDFController {
    private currentDoc: any | null = null;

    /**
     * Loads a PDF document from a byte array (Uint8Array)
     */
    async loadDocument(data: Uint8Array): Promise<number> {
        if (this.currentDoc) {
            this.currentDoc.destroy();
            this.currentDoc = null;
        }

        try {
            // MuPDF.Document.openDocument(buffer, magic)
            // magic can be "application/pdf" or inferred
            this.currentDoc = mupdf.Document.openDocument(data, "application/pdf");
            return this.currentDoc.countPages();
        } catch (error) {
            console.error("MuPDF: Failed to load document", error);
            throw error;
        }
    }

    /**
     * Loads a document temporarily just to count pages (for uploads)
     */
    async countPagesTransient(data: Uint8Array): Promise<number> {
        let doc: any = null;
        try {
            doc = mupdf.Document.openDocument(data, "application/pdf");
            return doc.countPages();
        } catch (error) {
            console.error("MuPDF: Failed to count pages", error);
            throw error;
        } finally {
            if (doc) doc.destroy();
        }
    }

    /**
     * Renders a page to a given canvas element
     * @param pageIndex 0-based page index
     * @param canvas The HTML canvas element to draw on
     * @param scale Scale factor (1.0 = 72 DPI typically, or internal unit)
     */
    async renderPageToCanvas(pageIndex: number, canvas: HTMLCanvasElement, scale: number = 1.0) {
        if (!this.currentDoc) throw new Error("No document loaded");

        const page = this.currentDoc.loadPage(pageIndex);

        // Calculate Matrix for scaling
        // mupdf.Matrix.scale(x, y)
        const ctm = mupdf.Matrix.scale(scale, scale);

        // Render to Pixmap
        // toPixmap(matrix, colorspace, alpha)
        // We request alpha=true to ensure we get RGBA (4 bytes/pixel) which matches ImageData requirement
        const pixmap = page.toPixmap(ctm, mupdf.ColorSpace.DeviceRGB, true);

        // Update Canvas dimensions
        canvas.width = pixmap.getWidth();
        canvas.height = pixmap.getHeight();

        const context = canvas.getContext('2d');
        if (!context) return;

        // Draw Pixmap to Canvas
        // pixmap.getPixels() returns a Uint8ClampedArray of RGBA data (implied by Canvas compatibility)
        const samples = pixmap.getPixels();

        const width = pixmap.getWidth();
        const height = pixmap.getHeight();

        // Create ImageData
        // The d.ts says getPixels() returns Uint8ClampedArray<ArrayBufferLike>
        // This is directly compatible with ImageData

        const imageData = new ImageData(samples, width, height);
        context.putImageData(imageData, 0, 0);

        // Cleanup
        pixmap.destroy();
        // if (pixmapAuth !== pixmap) pixmapAuth.destroy(); // Removed authentication logic for simplicity
        page.destroy();
    }

    /**
     * Get page dimensions at scale 1.0
     */
    getPageDimensions(pageIndex: number): { width: number, height: number } {
        if (!this.currentDoc) return { width: 0, height: 0 };
        const page = this.currentDoc.loadPage(pageIndex);
        const bounds = page.getBounds(); // [x0, y0, x1, y1]
        page.destroy();
        return { width: bounds[2] - bounds[0], height: bounds[3] - bounds[1] };
    }
}

export const mupdfController = new MuPDFController();
