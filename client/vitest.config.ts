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
    testTimeout: 15_000, // suíte cheia (38 arquivos) sob carga: 5s default estoura em testes de paginação
    coverage: {
      provider: 'v8',
      include: ['src/**'],
      // Excluídos: entrypoint (createRoot) e arquivos só-tipo (sem código executável).
      exclude: ['src/main.tsx', 'src/lib/types.ts', 'src/vite-env.d.ts'],
      thresholds: { lines: 100, functions: 100, statements: 100 },
    },
  },
});
