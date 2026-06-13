// Fase 3: multi-vendedor. Visibilidade por carteira (rep só vê o próprio),
// transferência de carteira, perfil-alvo por vendedor + simulação no recommend,
// e metas (meta vs. realizado). Sempre com teste de isolamento por vendedor.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { makeApp, register, bearer, mail, makeCompany, closeAll, type Session } from './helpers.ts';

let app: FastifyInstance;
let a: Session;     // org A (admin)
let b: Session;     // org B (admin/vendedor de outra org)
let rep1: Session;  // vendedor 1 da org A
let rep2: Session;  // vendedor 2 da org A
let repId1: number;
let repId2: number;
let repA: number;   // representada da org A

const inj = (s: Session, method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', url: string, payload?: unknown):
  ReturnType<FastifyInstance['inject']> =>
  app.inject({ method, url, headers: bearer(s.token), payload });

async function makeRep(admin: Session, tag: string): Promise<Session> {
  const email = mail(tag);
  const created = await inj(admin, 'POST', '/api/users', { nome: tag, email, senha: 'provisoria1' });
  expect(created.statusCode).toBe(201);
  const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, senha: 'provisoria1' } });
  expect(login.statusCode).toBe(200);
  return login.json() as Session;
}

beforeAll(async () => {
  app = await makeApp();
  a = await register(app, 'mv.a');
  b = await register(app, 'mv.b');
  rep1 = await makeRep(a, 'mv.rep1');
  rep2 = await makeRep(a, 'mv.rep2');
  repId1 = Number(rep1.user.id);
  repId2 = Number(rep2.user.id);
  repA = Number(((await inj(a, 'POST', '/api/represented', { nome: 'Indústria A' })).json() as { empresa: { id: number } }).empresa.id);
});
afterAll(async () => { await closeAll(app); });

// Cria relationship para o `dono` (admin) com owner explícito, ou para o
// próprio caller quando owner ausente.
async function mkRel(s: Session, owner?: number): Promise<number> {
  const companyId = await makeCompany();
  const payload: Record<string, unknown> = { company_id: companyId };
  if (owner !== undefined) payload.owner_user_id = owner;
  const r = await inj(s, 'POST', '/api/relationships', payload);
  expect(r.statusCode).toBe(201);
  return Number((r.json() as { relationship: { id: number } }).relationship.id);
}

describe('visibilidade por carteira (relationships)', () => {
  it('rep só enxerga a própria carteira; admin vê tudo e filtra por vendedor', async () => {
    const r1 = await mkRel(rep1);
    const r2 = await mkRel(rep2);

    const lista1 = (await inj(rep1, 'GET', '/api/relationships')).json() as { relationships: { id: number }[] };
    expect(lista1.relationships.some((x) => Number(x.id) === r1)).toBe(true);
    expect(lista1.relationships.some((x) => Number(x.id) === r2)).toBe(false);

    const adminAll = (await inj(a, 'GET', '/api/relationships')).json() as { relationships: { id: number }[] };
    expect(adminAll.relationships.some((x) => Number(x.id) === r1)).toBe(true);
    expect(adminAll.relationships.some((x) => Number(x.id) === r2)).toBe(true);

    const adminFiltro = (await inj(a, 'GET', `/api/relationships?owner_user_id=${repId2}`)).json() as { relationships: { id: number }[] };
    expect(adminFiltro.relationships.some((x) => Number(x.id) === r2)).toBe(true);
    expect(adminFiltro.relationships.some((x) => Number(x.id) === r1)).toBe(false);
  });

  it('kanban também respeita a carteira do rep', async () => {
    const r1 = await mkRel(rep1);
    const k1 = (await inj(rep1, 'GET', '/api/kanban')).json() as { cards: { id: number; owner_user_id: number | string }[] };
    expect(k1.cards.every((c) => Number(c.owner_user_id) === repId1)).toBe(true);
    expect(k1.cards.some((c) => Number(c.id) === r1)).toBe(true);
  });

  it('rep não edita nem apaga registro de outro vendedor', async () => {
    const r2 = await mkRel(rep2);
    expect((await inj(rep1, 'PATCH', `/api/relationships/${r2}`, { notas: 'invadindo' })).statusCode).toBe(403);
    expect((await inj(rep1, 'DELETE', `/api/relationships/${r2}`)).statusCode).toBe(403);
  });

  it('rep não atribui carteira a outro vendedor', async () => {
    const companyId = await makeCompany();
    const r = await inj(rep1, 'POST', '/api/relationships', { company_id: companyId, owner_user_id: repId2 });
    expect(r.statusCode).toBe(403);
  });
});

describe('transferência de carteira', () => {
  it('transfere em lote, audita e troca a visibilidade', async () => {
    const r1 = await mkRel(rep1);
    const t = await inj(a, 'POST', '/api/relationships/transfer', {
      from_user_id: repId1, to_user_id: repId2, ids: [r1],
    });
    expect(t.statusCode).toBe(200);
    expect((t.json() as { transferred: number }).transferred).toBe(1);

    const v1 = (await inj(rep1, 'GET', '/api/relationships')).json() as { relationships: { id: number }[] };
    expect(v1.relationships.some((x) => Number(x.id) === r1)).toBe(false);
    const v2 = (await inj(rep2, 'GET', '/api/relationships')).json() as { relationships: { id: number }[] };
    expect(v2.relationships.some((x) => Number(x.id) === r1)).toBe(true);
  });

  it('rep não pode transferir (admin only)', async () => {
    expect((await inj(rep1, 'POST', '/api/relationships/transfer', { from_user_id: repId1, to_user_id: repId2 })).statusCode).toBe(403);
  });

  it('transfer com usuário de outra org -> 400', async () => {
    const outroOrg = Number(b.user.id);
    expect((await inj(a, 'POST', '/api/relationships/transfer', { from_user_id: repId1, to_user_id: outroOrg })).statusCode).toBe(400);
  });
});

describe('pedidos: isolamento por vendedor', () => {
  it('rep não lista nem lê pedido de outro vendedor', async () => {
    const companyId = await makeCompany();
    await inj(rep1, 'POST', '/api/relationships', { company_id: companyId });
    const ord = await inj(rep1, 'POST', '/api/orders', {
      company_id: companyId, represented_id: repA,
      items: [{ descricao: 'X', qtd: 1, preco_unit: 50 }],
    });
    expect(ord.statusCode).toBe(201);
    const orderId = Number((ord.json() as { order: { id: number } }).order.id);

    const lista2 = (await inj(rep2, 'GET', '/api/orders')).json() as { orders: { id: number }[] };
    expect(lista2.orders.some((o) => Number(o.id) === orderId)).toBe(false);
    expect((await inj(rep2, 'GET', `/api/orders/${orderId}`)).statusCode).toBe(404);

    const adminLista = (await inj(a, 'GET', `/api/orders?owner_user_id=${repId1}`)).json() as { orders: { id: number }[] };
    expect(adminLista.orders.some((o) => Number(o.id) === orderId)).toBe(true);
  });
});

describe('perfil-alvo por vendedor', () => {
  it('rep define o próprio território e o recommend o utiliza', async () => {
    // org default sem território; rep1 define o próprio.
    const put = await inj(rep1, 'PUT', '/api/profile', {
      cnaes_alvo: [4781400], territorio_municipios: [3550308],
    });
    expect(put.statusCode).toBe(200);
    const got = (await inj(rep1, 'GET', '/api/profile')).json() as { profile: { territorio_municipios: number[] }; own: boolean };
    expect(got.own).toBe(true);
    expect(got.profile.territorio_municipios).toContain(3550308);

    // recommend do rep não dá erro de perfil ausente (território configurado).
    const rec = await inj(rep1, 'GET', '/api/recommend?limit=1');
    expect(rec.statusCode).toBe(200);
  });

  it('admin simula o perfil de um vendedor via ?user_id', async () => {
    await inj(rep2, 'PUT', '/api/profile', { cnaes_alvo: [4781400], territorio_municipios: [3304557] });
    const got = (await inj(a, 'GET', `/api/profile?user_id=${repId2}`)).json() as { profile: { territorio_municipios: number[] }; scope_user_id: number };
    expect(got.scope_user_id).toBe(repId2);
    expect(got.profile.territorio_municipios).toContain(3304557);
    expect((await inj(a, 'GET', `/api/recommend?limit=1&user_id=${repId2}`)).statusCode).toBe(200);
  });
});

describe('metas (goals)', () => {
  it('admin cria meta; rep acompanha a própria; rep não cria', async () => {
    const criar = await inj(a, 'POST', '/api/goals', {
      user_id: repId1, competencia: '2026-06', valor_meta: 10000,
    });
    expect(criar.statusCode).toBe(201);

    const prog = (await inj(rep1, 'GET', '/api/goals/progress?competencia=2026-06')).json() as { progress: { user_id: number; valor_meta: string; realizado: number }[] };
    expect(prog.progress.some((g) => Number(g.user_id) === repId1)).toBe(true);

    // rep2 não vê a meta de rep1
    const prog2 = (await inj(rep2, 'GET', '/api/goals/progress?competencia=2026-06')).json() as { progress: { user_id: number }[] };
    expect(prog2.progress.some((g) => Number(g.user_id) === repId1)).toBe(false);

    // rep não cria meta
    expect((await inj(rep1, 'POST', '/api/goals', { user_id: repId1, competencia: '2026-07', valor_meta: 1 })).statusCode).toBe(403);
  });

  it('meta duplicada (mesmo vendedor/mês/representada) -> 409', async () => {
    expect((await inj(a, 'POST', '/api/goals', { user_id: repId2, competencia: '2026-06', valor_meta: 5000 })).statusCode).toBe(201);
    expect((await inj(a, 'POST', '/api/goals', { user_id: repId2, competencia: '2026-06', valor_meta: 6000 })).statusCode).toBe(409);
  });
});
