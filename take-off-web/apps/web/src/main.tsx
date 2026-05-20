import './mupdfConfig'; // MUST be first so MuPDF WASM finds itself

import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { ToastProvider } from './contexts/ToastContext';
import { suppressConsoleWarnings } from './utils/suppressWarnings';
import './index.css';

suppressConsoleWarnings();

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('Could not find root element');

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <ToastProvider>
      <App />
    </ToastProvider>
  </React.StrictMode>
);
