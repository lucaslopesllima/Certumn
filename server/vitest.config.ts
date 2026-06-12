import { defineConfig } from 'vitest/config';
import { testDatabaseUrl } from './test/dburl.ts';

// DATABASE_URL é sobrescrito ANTES de qualquer import de src/config.ts,
// apontando os testes para o banco rs_test (criado/migrado no globalSetup).
export default defineConfig({
  test: {
    env: {
      DATABASE_URL: testDatabaseUrl(),
      JWT_SECRET: 'test-secret',
    },
    globalSetup: './test/setup.ts',
    fileParallelism: false,   // suíte compartilha um banco — sem corrida entre arquivos
    testTimeout: 30_000,
  },
});
