// Fase 4: dashboard agregado (funil, vendas vs. meta, comissões, agenda,
// alertas de inatividade/estagnação, ranking) com escopo por vendedor e
// isolamento de org.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { makeApp, register, bearer, mail, makeCompany, closeAll, type Session } from './helpers.ts';
import { query } from '../src/db.ts';

let app: FastifyInstance;
let a: Session;     // org A admin
let b: Session;     // org B (isolamento)
let rep1: Session;
let rep2: Session;
let repId1: number;
let repId2: number;
let repA: number;   // representada A
const mesAtual = new Date().toISOString().slice(0, 7);

const inj = (s: Session, method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: unknown):
  ReturnType<FastifyInstance['inject']> =>
  app.inject({ method, url, headers: bearer(s.token), payload });

async function makeRep(admin: Session, tag: string): Promise<Session> {
  const email = mail(tag);
  expect((await inj(admin, 'POST', '/api/users', { nome: tag, email, senha: 'provisoria1' })).statusCode).toBe(201);
  const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, senha: 'provisoria1' } });
  return login.json() as Session;
}

// pedido faturado para `dono`: cria (admin atribui owner), envia e fatura.
async function faturarPedido(owner: Session, valor: number): Promise<number> {
  const companyId = await makeCompany({ municipioId: 3550308 });
  await inj(owner, 'POST', '/api/relationships', { company_id: companyId, status: 'cliente' });
  const ord = await inj(owner, 'POST', '/api/orders', {
    company_id: companyId, represented_id: repA,
    items: [{ descricao: 'Item', qtd: 1, preco_unit: valor }],
  });
  const id = Number((ord.json() as { order: { id: number } }).order.id);
  await inj(owner, 'POST', `/api/orders/${id}/transition`, { status: 'enviado' });
  await inj(owner, 'POST', `/api/orders/${id}/transition`, { status: 'faturado', nf_numero: `NF-${id}` });
  return id;
}

beforeAll(async () => {
  app = await makeApp();
  a = await register(app, 'dash.a');
  b = await register(app, 'dash.b');
  rep1 = await makeRep(a, 'dash.rep1');
  rep2 = await makeRep(a, 'dash.rep2');
  repId1 = Number(rep1.user.id);
  repId2 = Number(rep2.user.id);
  repA = Number(((await inj(a, 'POST', '/api/represented', { nome: 'Indústria A' })).json() as { empresa: { id: number } }).empresa.id);
});
afterAll(async () => { await closeAll(app); });

describe('dashboard: vendas, meta e escopo', () => {
  it('rep vê só os próprios números; vendas e meta do mês conferem', async () => {
    await faturarPedido(rep1, 1000);
    await inj(a, 'POST', '/api/goals', { user_id: repId1, competencia: mesAtual, valor_meta: 5000 });

    const d = (await inj(rep1, 'GET', '/api/dashboard')).json() as {
      vendas: { total: number; qtd: number; meta: number }; ranking: unknown[];
    };
    expect(d.vendas.total).toBe(1000);
    expect(d.vendas.qtd).toBe(1);
    expect(d.vendas.meta).toBe(5000);
    expect(d.ranking).toHaveLength(0); // rep não recebe ranking
  });

  it('rep2 não enxerga as vendas de rep1', async () => {
    const d = (await inj(rep2, 'GET', '/api/dashboard')).json() as { vendas: { total: number } };
    expect(d.vendas.total).toBe(0);
  });

  it('admin vê consolidado e ranking por vendedor; filtra por ?user_id', async () => {
    const d = (await inj(a, 'GET', '/api/dashboard')).json() as {
      vendas: { total: number }; ranking: { user_id: number; total: string }[];
    };
    expect(d.vendas.total).toBeGreaterThanOrEqual(1000);
    const r1 = d.ranking.find((x) => Number(x.user_id) === repId1);
    expect(r1 && Number(r1.total)).toBe(1000);

    const foco = (await inj(a, 'GET', `/api/dashboard?user_id=${repId2}`)).json() as { vendas: { total: number }; ranking: unknown[] };
    expect(foco.vendas.total).toBe(0);
    expect(foco.ranking).toHaveLength(0); // foco em 1 vendedor => sem ranking
  });

  it('org B não vê dados da org A', async () => {
    const d = (await inj(b, 'GET', '/api/dashboard')).json() as { vendas: { total: number } };
    expect(d.vendas.total).toBe(0);
  });
});

describe('dashboard: funil e alertas', () => {
  it('funil agrupa por stage e conta negócios ativos do rep', async () => {
    const companyId = await makeCompany();
    await inj(rep1, 'POST', '/api/relationships', { company_id: companyId });
    const d = (await inj(rep1, 'GET', '/api/dashboard')).json() as { funil: { qtd: number }[] };
    expect(d.funil.length).toBeGreaterThan(0);
    expect(d.funil.reduce((s, f) => s + f.qtd, 0)).toBeGreaterThan(0);
  });

  it('alerta de inatividade aponta prospect sem contato há mais de N dias', async () => {
    const companyId = await makeCompany();
    await inj(rep1, 'POST', '/api/relationships', { company_id: companyId, data_contato: '2020-01-01' });
    const d = (await inj(rep1, 'GET', '/api/dashboard')).json() as {
      alertas: { sem_contato: { company_id: number; dias: number }[] };
    };
    const hit = d.alertas.sem_contato.find((x) => Number(x.company_id) === companyId);
    expect(hit).toBeDefined();
    expect(hit!.dias).toBeGreaterThan(30);
  });

  it('alerta de estagnação aponta negócio parado 30+ dias no stage', async () => {
    const companyId = await makeCompany();
    const r = await inj(rep1, 'POST', '/api/relationships', { company_id: companyId });
    const relId = Number((r.json() as { relationship: { id: number } }).relationship.id);
    await query("UPDATE company_relationships SET stage_changed_at = now() - interval '40 days' WHERE id = $1", [relId]);
    const d = (await inj(rep1, 'GET', '/api/dashboard')).json() as {
      alertas: { parados: { id: number; dias: number }[] };
    };
    const hit = d.alertas.parados.find((x) => Number(x.id) === relId);
    expect(hit).toBeDefined();
    expect(hit!.dias).toBeGreaterThanOrEqual(40);
  });
});
