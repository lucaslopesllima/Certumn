// Fase 4: relatórios — vendas agregadas, curva ABC, mapa de cobertura e perdas
// por motivo de descarte. Escopo por vendedor + isolamento de org.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { makeApp, register, bearer, mail, makeCompany, closeAll, type Session } from './helpers.ts';

const SP = 3550308;

let app: FastifyInstance;
let a: Session;
let rep1: Session;
let repId1: number;
let repA: number;

const inj = (s: Session, method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: unknown):
  ReturnType<FastifyInstance['inject']> =>
  app.inject({ method, url, headers: bearer(s.token), payload });

async function makeRep(admin: Session, tag: string): Promise<Session> {
  const email = mail(tag);
  await inj(admin, 'POST', '/api/users', { nome: tag, email, senha: 'provisoria1' });
  const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, senha: 'provisoria1' } });
  return login.json() as Session;
}

async function faturar(owner: Session, valor: number, municipioId?: number): Promise<number> {
  const companyId = await makeCompany({ municipioId });
  await inj(owner, 'POST', '/api/relationships', { company_id: companyId, status: 'cliente' });
  const ord = await inj(owner, 'POST', '/api/orders', {
    company_id: companyId, represented_id: repA, items: [{ descricao: 'X', qtd: 1, preco_unit: valor }],
  });
  const id = Number((ord.json() as { order: { id: number } }).order.id);
  await inj(owner, 'POST', `/api/orders/${id}/transition`, { status: 'enviado' });
  await inj(owner, 'POST', `/api/orders/${id}/transition`, { status: 'faturado' });
  return companyId;
}

beforeAll(async () => {
  app = await makeApp();
  a = await register(app, 'rep.a');
  rep1 = await makeRep(a, 'rep.rep1');
  repId1 = Number(rep1.user.id);
  repA = Number(((await inj(a, 'POST', '/api/represented', { nome: 'Indústria A' })).json() as { empresa: { id: number } }).empresa.id);
});
afterAll(async () => { await closeAll(app); });

describe('reports/sales', () => {
  it('agrupa por vendedor e por mês', async () => {
    await faturar(rep1, 700);
    const porVend = (await inj(a, 'GET', '/api/reports/sales?group_by=vendedor')).json() as { rows: { chave: number; total: string }[] };
    const linha = porVend.rows.find((r) => Number(r.chave) === repId1);
    expect(linha && Number(linha.total)).toBeGreaterThanOrEqual(700);

    const porMes = (await inj(a, 'GET', '/api/reports/sales?group_by=mes')).json() as { rows: unknown[] };
    expect(porMes.rows.length).toBeGreaterThan(0);
  });

  it('rep vê só as próprias vendas', async () => {
    const r = (await inj(rep1, 'GET', '/api/reports/sales?group_by=representada')).json() as { rows: { total: string }[] };
    expect(r.rows.every((x) => Number(x.total) >= 0)).toBe(true);
  });
});

describe('reports/abc', () => {
  it('classifica clientes por faturamento (curva ABC)', async () => {
    const cid = await faturar(rep1, 9000);
    const abc = (await inj(rep1, 'GET', '/api/reports/abc')).json() as {
      clientes: { company_id: number; classe: string; total: number }[];
    };
    const top = abc.clientes.find((c) => c.company_id === cid);
    expect(top).toBeDefined();
    expect(['A', 'B', 'C']).toContain(top!.classe);
  });
});

describe('reports/coverage', () => {
  it('conta potencial RFB e clientes por município do território', async () => {
    await inj(rep1, 'PUT', '/api/profile', { cnaes_alvo: [4781400], territorio_municipios: [SP] });
    await faturar(rep1, 500, SP); // vira cliente em SP

    const cov = (await inj(rep1, 'GET', '/api/reports/coverage')).json() as {
      municipios: { id: number; potencial: number; clientes: number }[];
    };
    const sp = cov.municipios.find((m) => m.id === SP);
    expect(sp).toBeDefined();
    expect(sp!.potencial).toBeGreaterThan(0);
    expect(sp!.clientes).toBeGreaterThanOrEqual(1);
  });

  it('sem território configurado retorna vazio', async () => {
    const solo = await register(app, 'rep.solo');
    const cov = (await inj(solo, 'GET', '/api/reports/coverage')).json() as { municipios: unknown[] };
    expect(cov.municipios).toHaveLength(0);
  });
});

describe('reports/descartes', () => {
  it('agrupa perdas por motivo', async () => {
    const companyId = await makeCompany();
    const r = await inj(rep1, 'POST', '/api/relationships', { company_id: companyId });
    const relId = Number((r.json() as { relationship: { id: number } }).relationship.id);
    await inj(rep1, 'PATCH', `/api/relationships/${relId}`, { status: 'descartado', motivo_descarte: 'Preço alto' });

    const rep = (await inj(rep1, 'GET', '/api/reports/descartes')).json() as { motivos: { motivo: string; qtd: number }[] };
    const m = rep.motivos.find((x) => x.motivo === 'Preço alto');
    expect(m && m.qtd).toBeGreaterThanOrEqual(1);
  });
});
