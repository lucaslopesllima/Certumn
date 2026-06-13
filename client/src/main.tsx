import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { registerSW } from 'virtual:pwa-register';
import { AuthProvider } from './lib/auth.tsx';
import { ErrorBoundary } from './lib/ErrorBoundary.tsx';
import { App } from './App.tsx';
import { initOfflineSync } from './lib/offline.ts';
import 'leaflet/dist/leaflet.css';
import './index.css';

// PWA: registra o service worker (autoUpdate) e liga o flush da fila offline
// de check-in/relatório quando a conexão volta.
registerSW({ immediate: true });
initOfflineSync();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <BrowserRouter>
        <AuthProvider>
          <App />
        </AuthProvider>
      </BrowserRouter>
    </ErrorBoundary>
  </StrictMode>,
);
