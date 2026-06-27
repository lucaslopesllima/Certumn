import { defineConfig } from 'vitest/config';
import { testDatabaseUrl } from './test/dburl.ts';

// DATABASE_URL é sobrescrito ANTES de qualquer import de src/config.ts,
// apontando os testes para o banco rs_test (criado/migrado no globalSetup).
export default defineConfig({
  test: {
    env: {
      DATABASE_URL: testDatabaseUrl(),
      JWT_SECRET: 'test-secret',
      // suíte inteira injeta do mesmo "IP" — o teste dedicado de rate limit
      // usa buildApp({ authRateLimitMax }) para forçar um limite baixo.
      AUTH_RATE_LIMIT_MAX: '1000000',
    },
    globalSetup: './test/setup.ts',
    fileParallelism: false,   // suíte compartilha um banco — sem corrida entre arquivos
    testTimeout: 30_000,
    coverage: {
      provider: 'v8',
      // index.ts é o entrypoint (listen + estáticos) — fora do escopo unitário.
      include: ['src/**'],
      exclude: ['src/index.ts'],
      thresholds: { lines: 100, functions: 100, statements: 100 },
    },
  },
});
