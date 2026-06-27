import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Config própria (não estende vite.config.ts): o plugin do Tailwind e o proxy
// de dev não fazem sentido em jsdom.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./test/setup.ts'],
    css: false,
    coverage: {
      provider: 'v8',
      include: ['src/**'],
      exclude: ['src/main.tsx'], // entrypoint (createRoot)
    },
  },
});
