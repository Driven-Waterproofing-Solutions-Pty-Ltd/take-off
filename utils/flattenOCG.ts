import { PDFDocument, PDFName, PDFDict, PDFRef } from 'pdf-lib';

/**
 * Flattens Optional Content Groups (OCGs) in a PDF by merging all layers into a single layer.
 * This helps improve rendering performance for PDFs with excessive OCGs.
 *
 * @param pdfBytes - The PDF file as a Uint8Array
 * @returns A new PDF with flattened OCG layers as a Uint8Array
 */
export async function flattenOCG(pdfBytes: Uint8Array): Promise<Uint8Array> {
    try {
        // Load the existing PDF
        const pdfDoc = await PDFDocument.load(pdfBytes);

        // Check if the PDF has OCGs
        const catalog = pdfDoc.catalog;
        const hasOCProperties = catalog.has(PDFName.of('OCProperties'));

        if (!hasOCProperties) {
            // No OCGs found, return the original PDF
            return pdfBytes;
        }

        // Flatten the OCGs by removing the OCProperties from the catalog
        // This effectively merges all layers into a single layer
        catalog.delete(PDFName.of('OCProperties'));

        // Save the modified PDF
        const flattenedPdfBytes = await pdfDoc.save();

        return flattenedPdfBytes;
    } catch (error) {
        console.error('Error flattening OCG layers:', error);
        // Return the original PDF if flattening fails
        return pdfBytes;
    }
}