import { pdfjs } from 'react-pdf';

// Try to use the local worker file first, fall back to CDN if needed
try {
  // Use the local worker file from node_modules
  const workerUrl = new URL(
    'pdfjs-dist/build/pdf.worker.min.mjs',
    import.meta.url
  ).toString();
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  console.log('Using local PDF.js worker:', workerUrl);
} catch (error) {
  console.warn('Local worker not available, falling back to CDN:', error);
  // Fall back to CDN
  pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;
}

// Log the final configuration
console.log(`PDF.js worker configured with version ${pdfjs.version}`);
console.log('Worker source:', pdfjs.GlobalWorkerOptions.workerSrc);