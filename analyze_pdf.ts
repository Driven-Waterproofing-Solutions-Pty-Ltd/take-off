
import { PDFDocument, PDFName, PDFDict, PDFRawStream } from 'pdf-lib';
import fs from 'fs';

async function analyzePdf() {
    try {
        const filePath = 'public/02-MA NY ALT 2 INTERIOR DESIGN.pdf';
        if (!fs.existsSync(filePath)) {
            console.error('File not found:', filePath);
            return;
        }

        const fileBuffer = fs.readFileSync(filePath);
        console.log(`\n--- PDF ANALYSIS: ${filePath} ---`);
        console.log(`File Size: ${(fileBuffer.length / 1024 / 1024).toFixed(2)} MB`);

        // Check for Linearization by looking for /Linearized in the first 1kb
        const first1024 = fileBuffer.subarray(0, 1024).toString('latin1');
        const isLinearized = first1024.includes('/Linearized');
        console.log(`Fast Web View (Linearized): ${isLinearized ? 'YES' : 'NO'}`);
        if (!isLinearized) {
            console.log('  -> Suggestion: Linearizing this PDF could allow the first page to render before the whole file downloads.');
        }

        const pdfDoc = await PDFDocument.load(fileBuffer);
        const pageCount = pdfDoc.getPageCount();
        console.log(`Page Count: ${pageCount}`);

        // Analyze Resources
        let totalImages = 0;
        let totalForms = 0;
        let totalImageSize = 0;

        // Sample first few pages for complexity
        const pagesToSample = Math.min(pageCount, 5);
        console.log(`\n--- Sampling First ${pagesToSample} Pages for Content ---`);

        for (let i = 0; i < pagesToSample; i++) {
            const page = pdfDoc.getPage(i);
            const { width, height } = page.getSize();
            console.log(`Page ${i + 1}: ${width.toFixed(0)} x ${height.toFixed(0)} pts`);

            const resources = page.node.Resources();
            if (resources instanceof PDFDict) {
                const xObjects = resources.lookupMaybe(PDFName.of('XObject'), PDFDict);
                if (xObjects) {
                    const keys = xObjects.keys();
                    console.log(`  - XObjects on page: ${keys.length}`);
                    for (const key of keys) {
                        const xObj = xObjects.lookup(key);
                        if (xObj instanceof PDFRawStream) {
                            const dict = xObj.dict;
                            const subtype = dict.lookup(PDFName.of('Subtype'));
                            if (subtype === PDFName.of('Image')) {
                                totalImages++;
                                totalImageSize += xObj.getContents().length;
                            } else if (subtype === PDFName.of('Form')) {
                                totalForms++;
                            }
                        }
                    }
                }
            }
        }

        console.log(`\n--- Resource Summary (Sampled) ---`);
        console.log(`Total Images Found (in sample): ${totalImages}`);
        console.log(`Total Forms (Layers/Groups) Found: ${totalForms}`);
        console.log(`Est. Raw Image Data Size (in sample): ${(totalImageSize / 1024 / 1024).toFixed(2)} MB`);

        if (totalForms > 10) {
            console.log('  -> High number of Form XObjects often indicates flattened layers or complex vector groups (CAD blocks).');
        }

    } catch (e) {
        console.error('Error analyzing PDF:', e);
    }
}

analyzePdf();
