// globalSetup do vitest: cria o banco rs_test (se não existir) e aplica as
// migrations. Roda uma vez por execução da suíte, em processo separado.
import pg from 'pg';
import { runMigrations } from '../scripts/migrate-lib.ts';
import { testDatabaseUrl } from './dburl.ts';

export default async function setup(): Promise<void> {
  const testUrl = testDatabaseUrl();
  const admin = new URL(testUrl);
  admin.pathname = '/postgres';

  const client = new pg.Client({ connectionString: admin.toString() });
  await client.connect();
  try {
    const exists = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', ['rs_test']);
    if (exists.rowCount === 0) await client.query('CREATE DATABASE rs_test');
  } finally {
    await client.end();
  }

  await runMigrations(testUrl);

  // companies é um pool GLOBAL (não escopado por org) e persiste no rs_test
  // compartilhado entre execuções. Sem limpar, as empresas de makeCompany()
  // acumulam e poluem busca/recommend: com dezenas de "Transportes Zeta Ltda"
  // acumuladas, o LIMIT 10 derruba a empresa criada no run atual e o teste falha.
  // Zera uma vez no início da suíte (CASCADE limpa relationships/orders/geocode
  // de runs anteriores — todos dados de teste). municipios/cnae (seed, referenciados
  // POR companies) não são afetados.
  const db = new pg.Client({ connectionString: testUrl });
  await db.connect();
  try { await db.query('TRUNCATE companies CASCADE'); } finally { await db.end(); }
}
