// Simple, idempotent migration runner CLI. Run: node scripts/migrate.ts
// Lógica em migrate-lib.ts (compartilhada com o setup dos testes).
import { config } from '../src/config.ts';
import { runMigrations } from './migrate-lib.ts';

runMigrations(config.databaseUrl).catch((e) => { console.error(e); process.exit(1); });
