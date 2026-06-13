import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

// Dev: proxy /api to the Fastify server. Prod: Fastify serves the built assets.
// In docker-compose.dev the API service is reachable at http://app:8080 (VITE_PROXY_TARGET).
const proxyTarget = process.env.VITE_PROXY_TARGET ?? 'http://localhost:8080';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    // PWA (Fase 5.4): precache do shell/assets + cache da agenda do dia e da
    // rota ativa (NetworkFirst — online sempre tenta a rede, offline cai no
    // cache). Mutação de campo (check-in/relatório) tem fila própria em
    // lib/offline.ts; o SW NÃO intercepta POST.
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg'],
      manifest: {
        name: 'Prospecta — Representação Comercial',
        short_name: 'Prospecta',
        description: 'Prospecção, pedidos e rotas em campo.',
        theme_color: '#0f172a',
        background_color: '#0f172a',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' },
        ],
      },
      workbox: {
        navigateFallbackDenylist: [/^\/api/],
        runtimeCaching: [
          {
            // agenda do dia + rotas: leitura cacheada p/ uso offline em campo.
            urlPattern: ({ url, request }) =>
              request.method === 'GET' && (url.pathname.startsWith('/api/activities') || url.pathname.startsWith('/api/routes')),
            handler: 'NetworkFirst',
            options: {
              cacheName: 'rs-api-campo',
              networkTimeoutSeconds: 5,
              expiration: { maxEntries: 64, maxAgeSeconds: 60 * 60 * 24 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
  server: {
    host: true, // listen on 0.0.0.0 so the container port is reachable
    port: 5173,
    proxy: {
      '/api': { target: proxyTarget, changeOrigin: true },
    },
    watch: {
      // inotify works for bind mounts on native Linux; flip on if HMR misses changes (e.g. on a VM/WSL)
      usePolling: process.env.VITE_USE_POLLING === '1',
    },
  },
  build: { outDir: 'dist' },
});
