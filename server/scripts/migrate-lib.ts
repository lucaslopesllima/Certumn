// Core do migration runner, reutilizado pelo CLI (scripts/migrate.ts) e pelo
// globalSetup dos testes (cria/migra o banco rs_test). Idempotente: aplica
// migrations/*.sql em ordem, registra em schema_migrations, sempre re-roda seeds.
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(here, '..', 'migrations');
const seedsDir = join(migrationsDir, 'seeds');

async function sqlFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir);
  return entries.filter((f) => f.endsWith('.sql')).sort();
}

export async function runMigrations(databaseUrl: string): Promise<void> {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      filename text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);

    const applied = new Set(
      (await client.query('SELECT filename FROM schema_migrations')).rows.map((r) => r.filename as string),
    );

    const migrations = await sqlFiles(migrationsDir);
    for (const f of migrations) {
      if (applied.has(f)) { console.log(`skip  ${f}`); continue; }
      const sql = await readFile(join(migrationsDir, f), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [f]);
        await client.query('COMMIT');
        console.log(`apply ${f}`);
      } catch (e) {
        await client.query('ROLLBACK');
        throw new Error(`migration ${f} failed: ${(e as Error).message}`);
      }
    }

    // Seeds are idempotent (ON CONFLICT) — always re-run, not tracked.
    const seeds = await sqlFiles(seedsDir);
    for (const f of seeds) {
      const sql = await readFile(join(seedsDir, f), 'utf8');
      await client.query(sql);
      console.log(`seed  ${f}`);
    }
    console.log('migrations done');
  } finally {
    await client.end();
  }
}
