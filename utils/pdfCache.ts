import { BaseDirectory, exists, mkdir, readFile, writeFile } from '@tauri-apps/plugin-fs';

const PDF_CACHE_DIR = 'protakeoff/pdf_store/cache';

/**
 * Ensures the cache directory exists.
 */
export const ensureCacheDir = async () => {
    try {
        const dirExists = await exists(PDF_CACHE_DIR, { baseDir: BaseDirectory.AppLocalData });
        if (!dirExists) {
            await mkdir(PDF_CACHE_DIR, { baseDir: BaseDirectory.AppLocalData, recursive: true });
        }
    } catch (e) {
        console.error("Failed to ensure cache directory:", e);
    }
};

/**
 * Retrieves a cached page image as a Blob.
 * @param fileId The ID of the PDF file (PlanSet ID).
 * @param pageIndex The 0-based index of the page.
 * @returns A Blob of the image if found, otherwise null.
 */
export const getPageImage = async (fileId: string, pageIndex: number): Promise<Blob | null> => {
    try {
        const filePath = `${PDF_CACHE_DIR}/${fileId}_page_${pageIndex}.png`;
        const fileExists = await exists(filePath, { baseDir: BaseDirectory.AppLocalData });

        if (fileExists) {
            const data = await readFile(filePath, { baseDir: BaseDirectory.AppLocalData });
            return new Blob([data], { type: 'image/png' });
        }
    } catch (e) {
        // file not found or read error, just return null
    }
    return null;
};

/**
 * Saves a page image to the cache.
 * @param fileId The ID of the PDF file (PlanSet ID).
 * @param pageIndex The 0-based index of the page.
 * @param blob The image Blob to save.
 */
export const savePageImage = async (fileId: string, pageIndex: number, blob: Blob): Promise<void> => {
    try {
        await ensureCacheDir();
        const filePath = `${PDF_CACHE_DIR}/${fileId}_page_${pageIndex}.png`;
        const buffer = await blob.arrayBuffer();
        const uint8Array = new Uint8Array(buffer);

        await writeFile(filePath, uint8Array, { baseDir: BaseDirectory.AppLocalData });
    } catch (e) {
        console.error(`Failed to save page image for ${fileId} page ${pageIndex}:`, e);
    }
};
