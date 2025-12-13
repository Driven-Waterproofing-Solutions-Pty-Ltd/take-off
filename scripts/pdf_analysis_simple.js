const { PDFDocument, PDFName, PDFDict, PDFRef } = require('pdf-lib');
const fs = require('fs');
const path = require('path');

async function simplePdfAnalysis() {
    const filePath = path.resolve('public/2pageshard.pdf');
    console.log(`=== PDF Analysis Report ===`);
    console.log(`File: ${filePath}`);
    
    // File size analysis
    const stats = fs.statSync(filePath);
    console.log(`File Size: ${(stats.size / 1024).toFixed(2)} KB (${stats.size} bytes)`);
    
    const buffer = fs.readFileSync(filePath);
    const pdfDoc = await PDFDocument.load(buffer, { ignoreEncryption: true });
    
    // Basic info
    console.log(`Number of Pages: ${pdfDoc.getPageCount()}`);
    const avgPageSize = stats.size / pdfDoc.getPageCount();
    console.log(`Average size per page: ${(avgPageSize / 1024).toFixed(2)} KB`);
    
    // Page analysis
    console.log(`\n=== Page Details ===`);
    const pages = pdfDoc.getPages();
    
    let totalFonts = 0;
    let totalImages = 0;
    let totalOCGs = 0;
    let largeContentPages = 0;
    
    for (let i = 0; i < pages.length; i++) {
        const page = pages[i];
        const { width, height } = page.getSize();
        console.log(`Page ${i + 1}: ${width.toFixed(0)} x ${height.toFixed(0)} points`);
        
        const resources = page.node.get(PDFName.of('Resources'));
        if (resources && resources instanceof PDFDict) {
            // Count fonts
            const fonts = resources.get(PDFName.of('Font'));
            if (fonts && fonts instanceof PDFDict) {
                const fontCount = fonts.keys().length;
                totalFonts += fontCount;
                console.log(`  Fonts: ${fontCount}`);
            }
            
            // Count images/XObjects
            const xObject = resources.get(PDFName.of('XObject'));
            if (xObject && xObject instanceof PDFDict) {
                const imageCount = xObject.keys().length;
                totalImages += imageCount;
                console.log(`  Images/XObjects: ${imageCount}`);
                
                // List image references
                xObject.keys().forEach(xobjKey => {
                    const xobjRef = xObject.get(xobjKey);
                    if (xobjRef instanceof PDFRef) {
                        console.log(`    - ${xobjKey.toString()}: ${xobjRef.objectNumber} ${xobjRef.generationNumber} R`);
                    }
                });
            }
            
            // Count Optional Content Groups
            const properties = resources.get(PDFName.of('Properties'));
            if (properties && properties instanceof PDFDict) {
                const ocgCount = properties.keys().length;
                totalOCGs += ocgCount;
                console.log(`  Optional Content Groups: ${ocgCount}`);
            }
        }
    }
    
    // Summary analysis
    console.log(`\n=== Summary Analysis ===`);
    console.log(`Total Fonts: ${totalFonts}`);
    console.log(`Total Images/XObjects: ${totalImages}`);
    console.log(`Total Optional Content Groups: ${totalOCGs}`);
    
    // Performance indicators
    console.log(`\n=== Performance Indicators ===`);
    
    // File size analysis
    if (stats.size > 1000000) { // 1MB threshold
        console.log(`⚠️  Large file size (>1MB) may cause slow loading`);
    } else {
        console.log(`✓ File size is reasonable`);
    }
    
    // Average page size analysis
    if (avgPageSize > 500000) { // 500KB per page threshold
        console.log(`⚠️  Large average page size may indicate embedded resources or inefficiencies`);
    } else {
        console.log(`✓ Average page size is reasonable`);
    }
    
    // Optional Content Groups analysis
    if (totalOCGs > 50) {
        console.log(`⚠️  High number of Optional Content Groups (${totalOCGs}) may impact rendering performance`);
    } else {
        console.log(`✓ Reasonable number of Optional Content Groups`);
    }
    
    // Font analysis
    if (totalFonts > 20) {
        console.log(`⚠️  Large number of fonts (${totalFonts}) may slow down rendering`);
    } else {
        console.log(`✓ Reasonable number of fonts`);
    }
    
    // Image analysis
    if (totalImages > 10) {
        console.log(`ℹ️  Multiple images found (${totalImages}) - consider optimization if loading is slow`);
    } else {
        console.log(`✓ Reasonable number of images`);
    }
    
    console.log(`\n=== Recommendations ===`);
    if (stats.size > 1000000 || avgPageSize > 500000 || totalOCGs > 50 || totalFonts > 20) {
        console.log(`1. Consider PDF optimization tools to reduce file size`);
        console.log(`2. Review embedded resources (fonts, images) for potential removal or compression`);
        console.log(`3. Check if Optional Content Groups can be simplified`);
        console.log(`4. Consider splitting large PDFs into smaller files if appropriate`);
    } else {
        console.log(`The PDF appears to be reasonably optimized. No major issues detected.`);
    }
    
    console.log(`\n=== Analysis Complete ===`);
}

simplePdfAnalysis().catch(console.error);