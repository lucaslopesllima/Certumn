import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { registerSW } from 'virtual:pwa-register';
import { AuthProvider } from './lib/auth.tsx';
import { ThemeProvider } from './lib/theme.tsx';
import { ErrorBoundary } from './lib/ErrorBoundary.tsx';
import { ToastHost } from './lib/toast.tsx';
import { App } from './App.tsx';
import { initOfflineSync } from './lib/offline.ts';
import './index.css';

// PWA: registra o service worker (autoUpdate) e liga o flush da fila offline
// de check-in/relatório quando a conexão volta.
registerSW({ immediate: true });
initOfflineSync();

// iOS Safari/PWA ignora `user-scalable=no`; bloqueia o pinch-zoom da página
// pelos gesture events do WebKit. O Leaflet usa touch events próprios, então
// o zoom do mapa continua funcionando.
for (const evt of ['gesturestart', 'gesturechange', 'gestureend']) {
  document.addEventListener(evt, (e) => e.preventDefault(), { passive: false });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <BrowserRouter>
        <ThemeProvider>
          <AuthProvider>
            <App />
            <ToastHost />
          </AuthProvider>
        </ThemeProvider>
      </BrowserRouter>
    </ErrorBoundary>
  </StrictMode>,
);
