// Core do migration runner, reutilizado pelo CLI (scripts/migrate.ts) e pelo
// globalSetup dos testes (cria/migra o banco rs_test). Idempotente: aplica
// migrations/*.sql em ordem, registra em schema_migrations, sempre re-roda seeds.
// Advisory lock serializa boots concorrentes; checksum detecta migration
// editada depois de aplicada (warn — não derruba o boot).
import { readdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(here, '..', 'migrations');
const seedsDir = join(migrationsDir, 'seeds');

// Chave fixa do advisory lock de migração (qualquer int64 estável serve).
const MIGRATE_LOCK_KEY = 752026;

async function sqlFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir);
  return entries.filter((f) => f.endsWith('.sql')).sort();
}

const sha256 = (s: string): string => createHash('sha256').update(s).digest('hex');

export async function runMigrations(databaseUrl: string): Promise<void> {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    // Dois containers subindo juntos: o segundo espera aqui em vez de
    // re-aplicar a mesma migration e crashar no INSERT duplicado.
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATE_LOCK_KEY]);

    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      filename text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
    await client.query('ALTER TABLE schema_migrations ADD COLUMN IF NOT EXISTS checksum text');

    const applied = new Map(
      (await client.query('SELECT filename, checksum FROM schema_migrations')).rows
        .map((r) => [r.filename as string, r.checksum as string | null]),
    );

    const migrations = await sqlFiles(migrationsDir);
    for (const f of migrations) {
      const sql = await readFile(join(migrationsDir, f), 'utf8');
      const sum = sha256(sql);
      if (applied.has(f)) {
        const prev = applied.get(f);
        if (prev == null) {
          // migration anterior à coluna checksum — registra agora
          await client.query('UPDATE schema_migrations SET checksum = $1 WHERE filename = $2', [sum, f]);
        } else if (prev !== sum) {
          console.warn(`WARN  ${f} foi alterada depois de aplicada (checksum divergente)`);
        }
        console.log(`skip  ${f}`);
        continue;
      }
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (filename, checksum) VALUES ($1, $2)', [f, sum]);
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
    // lock é da sessão — client.end() libera mesmo em erro, mas solta explícito.
    await client.query('SELECT pg_advisory_unlock($1)', [MIGRATE_LOCK_KEY]).catch(() => {});
    await client.end();
  }
}
