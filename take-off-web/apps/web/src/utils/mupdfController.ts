import * as mupdf from 'mupdf';

// Define simplified types based on MuPDF API
export interface MuPDFPage {
    getBounds(): [number, number, number, number]; // [x0, y0, x1, y1]
    toPixmap(ctm: any, colorspace: any, alpha: boolean, showExtras?: boolean): any;
    toDisplayList(showExtras: boolean): any;
    destroy(): void;
}

export interface MuPDFDocument {
    countPages(): number;
    loadPage(index: number): MuPDFPage;
    destroy(): void;
    loadOutline?(): any[];
    getMetaData?(key: string): string | null;
    needsPassword?(): boolean;
    authenticatePassword?(password: string): number;
}

export interface DisplayList {
    toPixmap(ctm: any, colorspace: any, alpha: boolean): any;
    getBounds(): [number, number, number, number];
    destroy(): void;
}

/**
 * MuPDF Controller with DisplayList caching and LRU memory management
 * 
 * Performance optimizations:
 * - DisplayList caching: Parse page once, render from cache (2-5x faster re-renders)
 * - LRU eviction: Limits memory usage by keeping only recent pages cached
 * - Page dimensions caching: Avoids repeated page loads for dimensions
 */
class MuPDFController {
    private currentDoc: any | null = null;

    // DisplayList cache with LRU eviction
    private displayListCache: Map<number, DisplayList> = new Map();
    private readonly MAX_CACHED_PAGES = 10;

    // Page dimensions cache (lightweight, keep all)
    private dimensionsCache: Map<number, { width: number, height: number }> = new Map();

    /**
     * Loads a PDF document from a byte array (Uint8Array)
     */
    async loadDocument(data: Uint8Array): Promise<number> {
        // Cleanup previous document and caches
        this.destroy();

        try {
            this.currentDoc = mupdf.Document.openDocument(data, "application/pdf");
            const pageCount = this.currentDoc.countPages();
            console.log(`MuPDF: Loaded document with ${pageCount} pages`);
            return pageCount;
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
     * Get or create DisplayList for a page (cached)
     * DisplayList caches parsed page content for fast re-rendering
     */
    private getDisplayList(pageIndex: number): DisplayList {
        // Check if already cached (and move to end for LRU)
        const existing = this.displayListCache.get(pageIndex);
        if (existing) {
            // Move to end (most recently used)
            this.displayListCache.delete(pageIndex);
            this.displayListCache.set(pageIndex, existing);
            return existing;
        }

        // Create new DisplayList
        const page = this.currentDoc.loadPage(pageIndex);
        try {
            // toDisplayList(showExtras) - true includes annotations/widgets
            const displayList = page.toDisplayList(true);

            // Evict oldest if cache is full
            if (this.displayListCache.size >= this.MAX_CACHED_PAGES) {
                const oldestKey = this.displayListCache.keys().next().value;
                if (oldestKey !== undefined) {
                    const oldest = this.displayListCache.get(oldestKey);
                    oldest?.destroy();
                    this.displayListCache.delete(oldestKey);
                    console.log(`MuPDF: Evicted DisplayList for page ${oldestKey} (LRU)`);
                }
            }

            this.displayListCache.set(pageIndex, displayList);
            console.log(`MuPDF: Created DisplayList for page ${pageIndex} (cache size: ${this.displayListCache.size})`);
            return displayList;
        } finally {
            page.destroy();
        }
    }

    /**
     * Pre-load DisplayList for a page (for adjacent page caching)
     * Call this to warm up the cache before navigation
     */
    preloadPage(pageIndex: number): void {
        if (!this.currentDoc) return;

        const pageCount = this.currentDoc.countPages();
        if (pageIndex < 0 || pageIndex >= pageCount) return;

        // Don't preload if already cached
        if (this.displayListCache.has(pageIndex)) return;

        // Queue preload asynchronously to not block main thread
        setTimeout(() => {
            try {
                this.getDisplayList(pageIndex);
            } catch (e) {
                console.warn(`MuPDF: Failed to preload page ${pageIndex}`, e);
            }
        }, 0);
    }

    /**
     * Renders a page to a given canvas element using DisplayList cache
     * @param pageIndex 0-based page index
     * @param canvas The HTML canvas element to draw on
     * @param scale Scale factor (1.0 = 72 DPI typically)
     */
    async renderPageToCanvas(pageIndex: number, canvas: HTMLCanvasElement, scale: number = 1.0): Promise<void> {
        if (!this.currentDoc) throw new Error("No document loaded");

        const startTime = performance.now();

        // Get cached DisplayList (or create if not cached)
        const displayList = this.getDisplayList(pageIndex);

        // Calculate Matrix for scaling
        const ctm = mupdf.Matrix.scale(scale, scale);

        // Render from DisplayList (much faster than re-parsing page)
        const pixmap = displayList.toPixmap(ctm, mupdf.ColorSpace.DeviceRGB, true);

        // Update Canvas dimensions
        canvas.width = pixmap.getWidth();
        canvas.height = pixmap.getHeight();

        const context = canvas.getContext('2d');
        if (!context) {
            pixmap.destroy();
            return;
        }

        // Draw Pixmap to Canvas
        const samples = pixmap.getPixels();
        const width = pixmap.getWidth();
        const height = pixmap.getHeight();

        const imageData = new ImageData(samples, width, height);
        context.putImageData(imageData, 0, 0);

        // Cleanup pixmap (DisplayList is kept in cache)
        pixmap.destroy();

        const elapsed = performance.now() - startTime;
        console.log(`MuPDF: Rendered page ${pageIndex} at scale ${scale} in ${elapsed.toFixed(1)}ms`);
    }

    /**
     * Renders a page to an ImageData object (for Web Worker transfer)
     * @param pageIndex 0-based page index  
     * @param scale Scale factor
     * @returns ImageData with rendered page
     */
    renderPageToImageData(pageIndex: number, scale: number = 1.0): {
        pixels: Uint8ClampedArray,
        width: number,
        height: number
    } {
        if (!this.currentDoc) throw new Error("No document loaded");

        const displayList = this.getDisplayList(pageIndex);
        const ctm = mupdf.Matrix.scale(scale, scale);
        const pixmap = displayList.toPixmap(ctm, mupdf.ColorSpace.DeviceRGB, true);

        const pixels = pixmap.getPixels();
        const width = pixmap.getWidth();
        const height = pixmap.getHeight();

        pixmap.destroy();

        return { pixels, width, height };
    }

    /**
     * Get page dimensions at scale 1.0 (cached)
     */
    getPageDimensions(pageIndex: number): { width: number, height: number } {
        if (!this.currentDoc) return { width: 0, height: 0 };

        // Check cache first
        const cached = this.dimensionsCache.get(pageIndex);
        if (cached) return cached;

        // Load page to get dimensions
        const page = this.currentDoc.loadPage(pageIndex);
        const bounds = page.getBounds(); // [x0, y0, x1, y1]
        page.destroy();

        const dims = {
            width: bounds[2] - bounds[0],
            height: bounds[3] - bounds[1]
        };

        this.dimensionsCache.set(pageIndex, dims);
        return dims;
    }

    /**
     * Get total page count
     */
    getPageCount(): number {
        return this.currentDoc?.countPages() ?? 0;
    }

    /**
     * Check if a DisplayList is cached for a page
     */
    isPageCached(pageIndex: number): boolean {
        return this.displayListCache.has(pageIndex);
    }

    /**
     * Get current cache statistics
     */
    getCacheStats(): {
        displayListCount: number,
        maxDisplayLists: number,
        dimensionsCount: number
    } {
        return {
            displayListCount: this.displayListCache.size,
            maxDisplayLists: this.MAX_CACHED_PAGES,
            dimensionsCount: this.dimensionsCache.size
        };
    }

    /**
     * Clear all caches (useful when switching documents or low memory)
     */
    clearCaches(): void {
        this.displayListCache.forEach(dl => {
            try {
                dl.destroy();
            } catch (e) {
                console.warn("MuPDF: Error destroying DisplayList", e);
            }
        });
        this.displayListCache.clear();
        this.dimensionsCache.clear();
        console.log("MuPDF: Cleared all caches");
    }

    /**
     * Invalidate cache for a specific page (if page content changes)
     */
    invalidatePage(pageIndex: number): void {
        const dl = this.displayListCache.get(pageIndex);
        if (dl) {
            dl.destroy();
            this.displayListCache.delete(pageIndex);
        }
        this.dimensionsCache.delete(pageIndex);
    }

    /**
     * Full cleanup - destroy document and all caches
     */
    destroy(): void {
        this.clearCaches();

        if (this.currentDoc) {
            try {
                this.currentDoc.destroy();
            } catch (e) {
                console.warn("MuPDF: Error destroying document", e);
            }
            this.currentDoc = null;
        }
    }

    /**
     * Check if a document is currently loaded
     */
    isDocumentLoaded(): boolean {
        return this.currentDoc !== null;
    }

    // ========================================
    // Phase 3: Document Features
    // ========================================

    /**
     * Get document outline (table of contents / bookmarks)
     * Returns null if no outline exists
     */
    getOutline(): OutlineItem[] | null {
        if (!this.currentDoc) return null;

        try {
            const outline = this.currentDoc.loadOutline();
            if (!outline || outline.length === 0) return null;

            const processNode = (item: any): OutlineItem => ({
                title: item.title || "Untitled",
                page: typeof item.page === 'number' ? item.page : -1,
                uri: item.uri,
                children: item.down ? item.down.map(processNode) : undefined
            });

            return outline.map(processNode);
        } catch (e) {
            console.warn("MuPDF: Failed to load outline", e);
            return null;
        }
    }

    /**
     * Get document metadata
     */
    getMetadata(): DocumentMetadata {
        if (!this.currentDoc) return {};

        const getMetaValue = (key: string): string | undefined => {
            try {
                const value = this.currentDoc.getMetaData(key);
                return value || undefined;
            } catch {
                return undefined;
            }
        };

        return {
            format: getMetaValue("format"),
            title: getMetaValue("info:Title"),
            author: getMetaValue("info:Author"),
            subject: getMetaValue("info:Subject"),
            keywords: getMetaValue("info:Keywords"),
            creator: getMetaValue("info:Creator"),
            producer: getMetaValue("info:Producer"),
            creationDate: getMetaValue("info:CreationDate"),
            modDate: getMetaValue("info:ModDate"),
            encryption: getMetaValue("encryption"),
        };
    }

    /**
     * Check if document requires a password
     */
    needsPassword(): boolean {
        try {
            return this.currentDoc?.needsPassword?.() ?? false;
        } catch {
            return false;
        }
    }

    /**
     * Authenticate with a password
     * Returns true if authentication succeeded
     */
    authenticatePassword(password: string): boolean {
        try {
            const result = this.currentDoc?.authenticatePassword?.(password);
            return result !== undefined && result > 0;
        } catch {
            return false;
        }
    }

    /**
     * Extract text from a specific page
     * Returns structured text with bounding box information
     */
    extractPageText(pageIndex: number, options: string = "preserve-whitespace"): PageTextContent {
        if (!this.currentDoc) return { text: "", blocks: [] };

        const page = this.currentDoc.loadPage(pageIndex);
        try {
            const stext = page.toStructuredText(options);

            // Get the raw text
            let fullText = "";
            const blocks: TextBlock[] = [];

            // Walk through the structured text
            // StructuredText contains blocks -> lines -> chars
            try {
                const stextJson = JSON.parse(stext.asJSON());

                if (stextJson.blocks) {
                    for (const block of stextJson.blocks) {
                        const blockLines: TextLine[] = [];
                        let blockText = "";

                        if (block.lines) {
                            for (const line of block.lines) {
                                let lineText = "";
                                const lineChars: TextChar[] = [];

                                if (line.spans) {
                                    for (const span of line.spans) {
                                        if (span.chars) {
                                            for (const char of span.chars) {
                                                lineText += char.c || "";
                                                lineChars.push({
                                                    char: char.c || "",
                                                    quad: char.quad
                                                });
                                            }
                                        }
                                    }
                                }

                                blockLines.push({
                                    text: lineText,
                                    bbox: line.bbox,
                                    chars: lineChars
                                });
                                blockText += lineText + "\n";
                            }
                        }

                        blocks.push({
                            text: blockText.trim(),
                            bbox: block.bbox,
                            lines: blockLines
                        });
                        fullText += blockText;
                    }
                }
            } catch (jsonError) {
                // Fallback: just try to get plain text
                console.warn("MuPDF: Failed to parse structured text JSON", jsonError);
            }

            stext.destroy();
            return { text: fullText.trim(), blocks };
        } catch (e) {
            console.warn(`MuPDF: Failed to extract text from page ${pageIndex}`, e);
            return { text: "", blocks: [] };
        } finally {
            page.destroy();
        }
    }

    /**
     * Extract plain text from a page (simplified version)
     */
    extractPageTextSimple(pageIndex: number): string {
        const result = this.extractPageText(pageIndex);
        return result.text;
    }

    /**
     * Extract text from all pages
     */
    extractAllText(): string {
        if (!this.currentDoc) return "";

        const pageCount = this.currentDoc.countPages();
        const texts: string[] = [];

        for (let i = 0; i < pageCount; i++) {
            const pageText = this.extractPageTextSimple(i);
            if (pageText) {
                texts.push(`--- Page ${i + 1} ---\n${pageText}`);
            }
        }

        return texts.join("\n\n");
    }

    /**
     * Search for text in a specific page
     * Returns array of search hits with bounding quads
     */
    searchPage(pageIndex: number, query: string, maxHits: number = 100): SearchHit[] {
        if (!this.currentDoc || !query) return [];

        const page = this.currentDoc.loadPage(pageIndex);
        try {
            const hits = page.search(query, maxHits);

            if (!hits || hits.length === 0) return [];

            // Each hit is an array of quads (for multi-line matches)
            return hits.map((hitQuads: any[], index: number) => ({
                index,
                pageIndex,
                quads: hitQuads.map((quad: any) => ({
                    ul: { x: quad.ul?.x ?? quad[0], y: quad.ul?.y ?? quad[1] },
                    ur: { x: quad.ur?.x ?? quad[2], y: quad.ur?.y ?? quad[3] },
                    ll: { x: quad.ll?.x ?? quad[4], y: quad.ll?.y ?? quad[5] },
                    lr: { x: quad.lr?.x ?? quad[6], y: quad.lr?.y ?? quad[7] }
                }))
            }));
        } catch (e) {
            console.warn(`MuPDF: Search failed on page ${pageIndex}`, e);
            return [];
        } finally {
            page.destroy();
        }
    }

    /**
     * Search for text across all pages
     * Returns results grouped by page
     */
    searchDocument(query: string, maxHitsPerPage: number = 50): DocumentSearchResult {
        if (!this.currentDoc || !query) {
            return { query, totalHits: 0, pages: [] };
        }

        const pageCount = this.currentDoc.countPages();
        const pages: PageSearchResult[] = [];
        let totalHits = 0;

        for (let i = 0; i < pageCount; i++) {
            const hits = this.searchPage(i, query, maxHitsPerPage);
            if (hits.length > 0) {
                pages.push({
                    pageIndex: i,
                    hits
                });
                totalHits += hits.length;
            }
        }

        console.log(`MuPDF: Found ${totalHits} hits for "${query}" across ${pages.length} pages`);
        return { query, totalHits, pages };
    }

    /**
     * Get page links (internal and external)
     */
    getPageLinks(pageIndex: number): PageLink[] {
        if (!this.currentDoc) return [];

        const page = this.currentDoc.loadPage(pageIndex);
        try {
            const links = page.getLinks();
            if (!links || links.length === 0) return [];

            return links.map((link: any) => ({
                bounds: link.bounds,
                uri: link.uri,
                isInternal: link.uri?.startsWith('#') ?? false
            }));
        } catch (e) {
            console.warn(`MuPDF: Failed to get links from page ${pageIndex}`, e);
            return [];
        } finally {
            page.destroy();
        }
    }

    /**
     * Resolve a link URI to a page number
     */
    resolveLink(uri: string): number | null {
        if (!this.currentDoc || !uri) return null;

        try {
            const pageNum = this.currentDoc.resolveLink(uri);
            return typeof pageNum === 'number' ? pageNum : null;
        } catch {
            return null;
        }
    }
}

// ========================================
// Type Definitions
// ========================================

/**
 * Outline item (table of contents entry)
 */
export interface OutlineItem {
    title: string;
    page: number;
    uri?: string;
    children?: OutlineItem[];
}

/**
 * Document metadata
 */
export interface DocumentMetadata {
    format?: string;
    title?: string;
    author?: string;
    subject?: string;
    keywords?: string;
    creator?: string;
    producer?: string;
    creationDate?: string;
    modDate?: string;
    encryption?: string;
}

/**
 * Text character with position
 */
export interface TextChar {
    char: string;
    quad?: number[];
}

/**
 * Text line with characters
 */
export interface TextLine {
    text: string;
    bbox?: number[];
    chars: TextChar[];
}

/**
 * Text block containing lines
 */
export interface TextBlock {
    text: string;
    bbox?: number[];
    lines: TextLine[];
}

/**
 * Page text content with structure
 */
export interface PageTextContent {
    text: string;
    blocks: TextBlock[];
}

/**
 * Point in 2D space
 */
export interface Point2D {
    x: number;
    y: number;
}

/**
 * Quad (4 corners of a character/word)
 */
export interface Quad {
    ul: Point2D;  // upper-left
    ur: Point2D;  // upper-right
    ll: Point2D;  // lower-left
    lr: Point2D;  // lower-right
}

/**
 * Single search hit
 */
export interface SearchHit {
    index: number;
    pageIndex: number;
    quads: Quad[];
}

/**
 * Search results for a single page
 */
export interface PageSearchResult {
    pageIndex: number;
    hits: SearchHit[];
}

/**
 * Document-wide search results
 */
export interface DocumentSearchResult {
    query: string;
    totalHits: number;
    pages: PageSearchResult[];
}

/**
 * Page link
 */
export interface PageLink {
    bounds: number[];
    uri?: string;
    isInternal: boolean;
}

export const mupdfController = new MuPDFController();

