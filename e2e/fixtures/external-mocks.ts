// Intercepta as tiles do OpenStreetMap (Leaflet) no browser — evita tráfego de
// rede real e load lento/flaky em todo teste que abre um mapa. As chamadas
// server-side (Nominatim/BrasilAPI/OSRM) NÃO passam por aqui: são interceptadas
// no nível de rede pelo stub-server (ver docker-compose.e2e.yml, envs
// NOMINATIM_URL/BRASILAPI_URL/OSRM_URL apontando pro stub).
import { test as base } from '@playwright/test';

// PNG 1x1 transparente — suficiente pro Leaflet marcar o tile como carregado.
const BLANK_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

export const test = base.extend<Record<string, never>>({
  page: async ({ page }, use) => {
    await page.route('https://*.tile.openstreetmap.org/**', (route) =>
      route.fulfill({ status: 200, contentType: 'image/png', body: BLANK_PNG }));
    await use(page);
  },
});
