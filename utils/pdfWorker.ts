import { pdfjs } from 'react-pdf';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

// React-PDF v10 uses pdfjs-dist v4, which outputs the worker as an .mjs file.
// We use the local worker file bundled by Vite via the ?url import.
pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;