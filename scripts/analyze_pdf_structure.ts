
import { PDFDocument, PDFName, PDFDict } from 'pdf-lib';
import fs from 'fs';
import path from 'path';

async function analyzePdf() {
    const filePath = path.resolve('public/2pageshard.pdf');
    console.log(`Analyzing: ${filePath}`);

    const buffer = fs.readFileSync(filePath);
    // use ignoreEncryption just in case, though unlikely for public file
    const pdfDoc = await PDFDocument.load(buffer, { ignoreEncryption: true });

    const catalog = pdfDoc.catalog;
    const ocProperties = catalog.get(PDFName.of('OCProperties'));

    console.log('Catalog has OCProperties:', !!ocProperties);

    const pages = pdfDoc.getPages();
    const page = pages[0];
    console.log('Page 1 inspection:');

    const resources = page.node.get(PDFName.of('Resources'));
    if (resources && resources instanceof PDFDict) {
        const properties = resources.get(PDFName.of('Properties'));
        if (properties && properties instanceof PDFDict) {
            console.log('Properties Dictionary Keys:');
            properties.keys().forEach(key => {
                const val = properties.get(key);
                console.log(`  ${key.toString()} -> ${val.toString()}`);
            });
        } else {
            console.log('No Properties dictionary.');
        }

        const xObject = resources.get(PDFName.of('XObject'));
        if (xObject && xObject instanceof PDFDict) {
            console.log('XObject Dictionary Keys:', xObject.keys().map(k => k.toString()).join(', '));
        }
    } else {
        console.log('No Resources dictionary on Page 1.');
    }
}

analyzePdf().catch(console.error);
