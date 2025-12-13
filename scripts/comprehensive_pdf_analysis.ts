import { PDFDocument, PDFName, PDFDict, PDFRef } from 'pdf-lib';
import fs from 'fs';
import path from 'path';

async function comprehensivePdfAnalysis() {
    const filePath = path.resolve('public/2pageshard.pdf');
    console.log(`=== Comprehensive PDF Analysis ===`);
    console.log(`File: ${filePath}`);
    
    const stats = fs.statSync(filePath);
    console.log(`File Size: ${(stats.size / 1024).toFixed(2)} KB`);
    
    const buffer = fs.readFileSync(filePath);
    const pdfDoc = await PDFDocument.load(buffer, { ignoreEncryption: true });
    
    // Basic document info
    console.log(`\n=== Document Information ===`);
    console.log(`PDF Version: ${pdfDoc.context.pdfVersion}`);
    console.log(`Number of Pages: ${pdfDoc.getPageCount()}`);
    
    // Check for encryption
    console.log(`\n=== Security ===`);
    console.log(`Is Encrypted: ${pdfDoc.context.isEncrypted}`);
    
    // Check catalog structure
    console.log(`\n=== Catalog Structure ===`);
    const catalog = pdfDoc.catalog;
    console.log(`Catalog has OCProperties: ${!!catalog.get(PDFName.of('OCProperties'))}`);
    console.log(`Catalog has AcroForm: ${!!catalog.get(PDFName.of('AcroForm'))}`);
    console.log(`Catalog has Names: ${!!catalog.get(PDFName.of('Names'))}`);
    console.log(`Catalog has Dests: ${!!catalog.get(PDFName.of('Dests'))}`);
    
    // Analyze each page
    console.log(`\n=== Page Analysis ===`);
    const pages = pdfDoc.getPages();
    for (let i = 0; i < pages.length; i++) {
        const page = pages[i];
        console.log(`\nPage ${i + 1}:`);
        
        // Check page size
        const { width, height } = page.getSize();
        console.log(`  Size: ${width.toFixed(2)} x ${height.toFixed(2)} points`);
        
        // Check resources
        const resources = page.node.get(PDFName.of('Resources'));
        if (resources && resources instanceof PDFDict) {
            console.log(`  Resources found: Yes`);
            
            // Check for embedded fonts
            const fonts = resources.get(PDFName.of('Font'));
            if (fonts && fonts instanceof PDFDict) {
                console.log(`  Fonts: ${fonts.keys().length}`);
                fonts.keys().forEach(fontKey => {
                    const fontRef = fonts.get(fontKey);
                    if (fontRef instanceof PDFRef) {
                        console.log(`    - ${fontKey.toString()}: ${fontRef.objectNumber} ${fontRef.generationNumber} R`);
                    }
                });
            }
            
            // Check for images (XObjects)
            const xObject = resources.get(PDFName.of('XObject'));
            if (xObject && xObject instanceof PDFDict) {
                console.log(`  Images/XObjects: ${xObject.keys().length}`);
                xObject.keys().forEach(xobjKey => {
                    const xobjRef = xObject.get(xobjKey);
                    if (xobjRef instanceof PDFRef) {
                        console.log(`    - ${xobjKey.toString()}: ${xobjRef.objectNumber} ${xobjRef.generationNumber} R`);
                    }
                });
            }
            
            // Check for properties (OCGs)
            const properties = resources.get(PDFName.of('Properties'));
            if (properties && properties instanceof PDFDict) {
                console.log(`  Optional Content Groups: ${properties.keys().length}`);
            }
            
            // Check for patterns
            const patterns = resources.get(PDFName.of('Pattern'));
            if (patterns && patterns instanceof PDFDict) {
                console.log(`  Patterns: ${patterns.keys().length}`);
            }
            
            // Check for shadings
            const shadings = resources.get(PDFName.of('Shading'));
            if (shadings && shadings instanceof PDFDict) {
                console.log(`  Shadings: ${shadings.keys().length}`);
            }
            
        } else {
            console.log(`  Resources found: No`);
        }
        
        // Check content stream size
        const content = page.node.lookupMaybe(PDFName.of('Contents'), PDFName.of('Contents'));
        if (content) {
            const contentSize = content.sizeInBytes();
            console.log(`  Content Stream Size: ${contentSize} bytes`);
        }
    }
    
    // Check for embedded files
    console.log(`\n=== Embedded Files ===`);
    const names = catalog.get(PDFName.of('Names'));
    if (names && names instanceof PDFDict) {
        const embeddedFiles = names.get(PDFName.of('EmbeddedFiles'));
        if (embeddedFiles) {
            console.log(`Embedded Files found: Yes`);
        } else {
            console.log(`Embedded Files found: No`);
        }
    } else {
        console.log(`Embedded Files found: No`);
    }
    
    // Check for metadata
    console.log(`\n=== Metadata ===`);
    try {
        const info = pdfDoc.getInfo();
        console.log(`Title: ${info.getTitle() || 'None'}`);
        console.log(`Author: ${info.getAuthor() || 'None'}`);
        console.log(`Subject: ${info.getSubject() || 'None'}`);
        console.log(`Creator: ${info.getCreator() || 'None'}`);
        console.log(`Producer: ${info.getProducer() || 'None'}`);
        console.log(`Creation Date: ${info.getCreationDate()?.toString() || 'None'}`);
        console.log(`Modification Date: ${info.getModificationDate()?.toString() || 'None'}`);
    } catch (error) {
        console.log(`Metadata access error: ${error.message}`);
    }
    
    // Check for potential issues
    console.log(`\n=== Potential Issues Analysis ===`);
    
    // Large content streams
    let largeContentStreams = 0;
    for (const page of pages) {
        const content = page.node.lookupMaybe(PDFName.of('Contents'), PDFName.of('Contents'));
        if (content && content.sizeInBytes() > 100000) { // 100KB threshold
            largeContentStreams++;
        }
    }
    console.log(`Pages with large content streams (>100KB): ${largeContentStreams}`);
    
    // Many optional content groups (can slow down rendering)
    const totalOCGs = pages.reduce((count, page) => {
        const resources = page.node.get(PDFName.of('Resources'));
        if (resources && resources instanceof PDFDict) {
            const properties = resources.get(PDFName.of('Properties'));
            if (properties && properties instanceof PDFDict) {
                return count + properties.keys().length;
            }
        }
        return count;
    }, 0);
    console.log(`Total Optional Content Groups: ${totalOCGs}`);
    if (totalOCGs > 50) {
        console.log(`  ⚠️  High number of OCGs may impact rendering performance`);
    }
    
    // File size vs content analysis
    const avgPageSize = stats.size / pages.length;
    console.log(`Average size per page: ${(avgPageSize / 1024).toFixed(2)} KB`);
    if (avgPageSize > 500000) { // 500KB per page threshold
        console.log(`  ⚠️  Large average page size may indicate embedded resources or inefficiencies`);
    }
    
    console.log(`\n=== Analysis Complete ===`);
}

comprehensivePdfAnalysis().catch(console.error);