// Configure MuPDF WASM path (must be done before mupdf is imported anywhere that loads it)
// This file is imported first in index.tsx to ensure it runs before any other imports are evaluated.

// @ts-ignore
if (typeof window !== 'undefined') {
    // @ts-ignore
    window["$libmupdf_wasm_Module"] = {
        locateFile: (path: string) => {
            if (path.endsWith('.wasm')) {
                return '/mupdf-wasm.wasm';
            }
            return path;
        }
    };
}
