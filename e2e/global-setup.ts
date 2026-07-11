// globalSetup do Playwright: cria o banco rs_e2e (se não existir), aplica as
// migrations do server (mesmo runner conceitual de server/test/setup.ts, mas
// reimplementado aqui — importar ../server/scripts/migrate-lib.ts cruzaria a
// fronteira do workspace e arrastaria a resolução de módulos do server), e
// carrega o seed de companies fake (prospecção/mapa/rotas não têm ETL em dev).
// Roda 1x por execução da suíte, antes de qualquer teste.
import 'dotenv/config';
import { readdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(here, '..', 'server', 'migrations');
const seedsDir = join(migrationsDir, 'seeds');
const e2eSeedFile = join(here, 'seed', 'companies.sql');

const MIGRATE_LOCK_KEY = 752027; // diferente do 752026 do vitest — banco separado, mas evita confusão

const sha256 = (s: string): string => createHash('sha256').update(s).digest('hex');

async function sqlFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir);
  return entries.filter((f) => f.endsWith('.sql')).sort();
}

async function runMigrations(databaseUrl: string): Promise<void> {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATE_LOCK_KEY]);
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      filename text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
    await client.query('ALTER TABLE schema_migrations ADD COLUMN IF NOT EXISTS checksum text');

    const applied = new Set(
      (await client.query('SELECT filename FROM schema_migrations')).rows.map((r) => r.filename as string),
    );

    for (const f of await sqlFiles(migrationsDir)) {
      if (applied.has(f)) { console.log(`skip  ${f}`); continue; }
      const sql = await readFile(join(migrationsDir, f), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (filename, checksum) VALUES ($1, $2)', [f, sha256(sql)]);
        await client.query('COMMIT');
        console.log(`apply ${f}`);
      } catch (e) {
        await client.query('ROLLBACK');
        throw new Error(`migration ${f} failed: ${(e as Error).message}`);
      }
    }

    // Seeds de referência (municípios/CNAE) são idempotentes — sempre re-rodam.
    for (const f of await sqlFiles(seedsDir)) {
      await client.query(await readFile(join(seedsDir, f), 'utf8'));
      console.log(`seed  ${f}`);
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [MIGRATE_LOCK_KEY]).catch(() => {});
    await client.end();
  }
}

export default async function globalSetup(): Promise<void> {
  const e2eUrl = process.env.E2E_DATABASE_URL ?? 'postgres://postgres:postgres@localhost:55432/rs_e2e';
  const admin = new URL(e2eUrl);
  const dbName = admin.pathname.replace(/^\//, '') || 'rs_e2e';
  admin.pathname = '/postgres';

  const adminClient = new pg.Client({ connectionString: admin.toString() });
  await adminClient.connect();
  try {
    const exists = await adminClient.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName]);
    if (exists.rowCount === 0) await adminClient.query(`CREATE DATABASE ${dbName}`);
  } finally {
    await adminClient.end();
  }

  await runMigrations(e2eUrl);

  // companies é um pool global (não escopado por org) — zera e recarrega o seed
  // fixo a cada execução da suíte pra manter os testes de prospecção/mapa/rotas
  // determinísticos (CASCADE limpa relationships/orders/geocode de runs anteriores).
  const db = new pg.Client({ connectionString: e2eUrl });
  await db.connect();
  try {
    await db.query('TRUNCATE companies CASCADE');
    await db.query(await readFile(e2eSeedFile, 'utf8'));
    console.log('seed  e2e/seed/companies.sql');
  } finally {
    await db.end();
  }
}
