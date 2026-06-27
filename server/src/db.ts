import pg from 'pg';
import { config } from './config.ts';

// Colunas DATE (OID 1082) voltam como string 'YYYY-MM-DD', não como Date — o
// parser padrão do pg cria um Date em meia-noite LOCAL, que ao virar JSON
// (toISOString) ganha um horário/fuso e quebra inputs type=date e fmtDate no
// front (data de vencimento sumindo). Mantém o valor cru, sem shift de fuso.
pg.types.setTypeParser(1082, (v) => v);

// Single shared pool. Raw parameterized SQL everywhere — no ORM.
export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  max: Number(process.env.PG_POOL_MAX ?? 10),
  idleTimeoutMillis: 30_000,
  // Query patológica não pode segurar conexão do pool indefinidamente.
  // 30s cobre o recommend frio na base inteira; ETL usa Client próprio, não passa por aqui.
  statement_timeout: Number(process.env.PG_STATEMENT_TIMEOUT_MS ?? 30_000),
});

export type Row = Record<string, unknown>;

export async function query<T = Row>(text: string, params: unknown[] = []): Promise<T[]> {
  const res = await pool.query(text, params);
  return res.rows as T[];
}

export async function one<T = Row>(text: string, params: unknown[] = []): Promise<T | null> {
  const rows = await query<T>(text, params);
  return rows[0] ?? null;
}

// Run several statements on a single connection (used by recommend to SET work_mem then SELECT).
export async function withClient<T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}
