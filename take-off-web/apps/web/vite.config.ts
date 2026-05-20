import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://127.0.0.1:8787',
      '/mcp': 'http://127.0.0.1:8787',
      '/xero': 'http://127.0.0.1:8787',
    },
  },
  worker: {
    format: 'es',
  },
  optimizeDeps: {
    exclude: ['mupdf'],
  },
  build: {
    // MuPDF (and modern wasm loaders) use top-level await.
    target: 'esnext',
  },
});
