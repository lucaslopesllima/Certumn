// Helpers compartilhados pela suíte. Cada arquivo de teste tem seu próprio
// registro de módulos (pool próprio) — feche com closeAll() no afterAll.
import { expect } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.ts';
import { pool, one } from '../src/db.ts';

let seq = 0;
const run = Date.now();
export const uniq = (tag: string): string => `${tag}.${run}.${++seq}`;
export const mail = (tag: string): string => `${uniq(tag)}@teste.com`;

export interface Session { token: string; user: { id: number; role: string; org_id: number } }

export const bearer = (t: string): Record<string, string> => ({ authorization: `Bearer ${t}` });

export async function makeApp(): Promise<FastifyInstance> {
  const app = await buildApp({ logger: false });
  await app.ready();
  return app;
}

export async function register(app: FastifyInstance, tag: string): Promise<Session> {
  const r = await app.inject({
    method: 'POST', url: '/api/auth/register',
    payload: { org_nome: `Org ${tag}`, email: mail(tag), senha: 'senha123' },
  });
  expect(r.statusCode).toBe(201);
  return r.json() as Session;
}

// Empresa no pool global (cnpj único por chamada). municipio/geom opcionais.
export async function makeCompany(opts: {
  municipioId?: number; lat?: number; lon?: number; cnae?: number; uf?: string;
  regiao?: string; porte?: string; capital?: number; razao?: string; fantasia?: string;
} = {}): Promise<number> {
  // 8 dígitos do timestamp + 5 de sequência: módulos de arquivos diferentes
  // (run próprio cada um) não colidem — com %1000 bastava carregar dois
  // arquivos em ms congruentes para duplicar cnpj.
  const cnpj = `${run % 100_000_000}${String(++seq).padStart(5, '0')}`.padStart(14, '9').slice(-14);
  const geom = opts.lat != null && opts.lon != null
    ? `ST_SetSRID(ST_MakePoint(${opts.lon}, ${opts.lat}), 4326)::geography` : 'NULL';
  const c = await one<{ id: number }>(
    `INSERT INTO companies (cnpj, razao_social, nome_fantasia, cnae_principal, municipio_id, uf, regiao,
                            geom, porte, capital_social, situacao_cadastral)
     VALUES ($1, $2, $3, $4, $5, $6, $7::regiao_br, ${geom}, COALESCE($8::porte_emp,'pequeno'), $9, 'ativa')
     RETURNING id`,
    [cnpj, opts.razao ?? `Empresa ${cnpj}`, opts.fantasia ?? null, opts.cnae ?? 4781400,
      opts.municipioId ?? null, opts.uf ?? 'SP', opts.regiao ?? 'SE', opts.porte ?? null,
      opts.capital ?? 100000],
  );
  return Number(c!.id); // bigint vem como string do driver
}

export async function closeAll(app?: FastifyInstance): Promise<void> {
  if (app) await app.close();
  await pool.end();
}
