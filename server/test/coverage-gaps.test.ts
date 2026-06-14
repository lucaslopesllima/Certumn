// Fecha lacunas de cobertura deixadas pelas features recentes: alíquotas default
// da org (tax), ramos não exercitados de notificações, importação em lote de
// relacionamentos, impressão de pedido para vendedor sem acesso, exclusão de
// categoria financeira e ramos de RBAC/rollback de amostras.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { makeApp, register, bearer, mail, makeCompany, closeAll, type Session } from './helpers.ts';
import { query, one } from '../src/db.ts';

let app: FastifyInstance;
let a: Session;     // org A (admin)
let b: Session;     // org B (admin)
let rep: Session;   // vendedor da org A

const inj = (s: Session, method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: unknown):
  ReturnType<FastifyInstance['inject']> =>
  app.inject({ method, url, headers: bearer(s.token), payload });

async function makeRep(admin: Session, tag: string): Promise<Session> {
  const email = mail(tag);
  expect((await inj(admin, 'POST', '/api/users', { nome: tag, email, senha: 'provisoria1' })).statusCode).toBe(201);
  const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, senha: 'provisoria1' } });
  return login.json() as Session;
}

beforeAll(async () => {
  app = await makeApp();
  a = await register(app, 'gap.a');
  b = await register(app, 'gap.b');
  rep = await makeRep(a, 'gap.rep');
});
afterAll(async () => { await closeAll(app); });

/* ── tax-defaults ────────────────────────────────────────── */
describe('rotas /api/tax-defaults', () => {
  it('GET zera quando não configurado; PATCH faz upsert; admin-only; body vazio só toca updated_at', async () => {
    const zero = (await inj(a, 'GET', '/api/tax-defaults')).json() as { tax: Record<string, number> };
    expect(zero.tax.icms_pct).toBe(0);

    // primeiro PATCH cria a linha
    const ins = await inj(a, 'PATCH', '/api/tax-defaults', { icms_pct: 18, ipi_pct: 5 });
    expect(ins.statusCode).toBe(200);
    expect((ins.json() as { tax: Record<string, number> }).tax.icms_pct).toBe(18);

    // segundo PATCH atualiza via ON CONFLICT
    const upd = await inj(a, 'PATCH', '/api/tax-defaults', { icms_pct: 12 });
    expect((upd.json() as { tax: Record<string, number> }).tax.icms_pct).toBe(12);
    expect((upd.json() as { tax: Record<string, number> }).tax.ipi_pct).toBe(5); // preservado

    // body vazio: nada a setar, só updated_at
    expect((await inj(a, 'PATCH', '/api/tax-defaults', {})).statusCode).toBe(200);

    // vendedor não altera política da org
    expect((await inj(rep, 'PATCH', '/api/tax-defaults', { icms_pct: 1 })).statusCode).toBe(403);
  });
});

/* ── notificações: ramos extras ─────────────────────────── */
describe('notificações: agenda com empresa, negócio parado e marcar tudo lido', () => {
  it('agenda vinculada a empresa + prospect parado viram avisos; read-all zera não-lidas', async () => {
    // compromisso na próxima hora vinculado a uma empresa (ramo company_id != null)
    const cid = await makeCompany();
    const soon = new Date(Date.now() + 30 * 60_000).toISOString();
    expect((await inj(rep, 'POST', '/api/activities', { titulo: 'Visita', start_at: soon, company_id: cid })).statusCode).toBe(200);

    // prospecção parada há 40 dias na carteira do rep
    const cid2 = await makeCompany();
    const rel = (await inj(rep, 'POST', '/api/relationships', { company_id: cid2 })).json() as { relationship: { id: number } };
    await query(
      "UPDATE company_relationships SET status = 'prospect', stage_changed_at = now() - interval '40 days' WHERE id = $1",
      [Number(rel.relationship.id)],
    );

    const r = (await inj(rep, 'GET', '/api/notifications')).json() as { notifications: { tipo: string; payload: Record<string, unknown> }[]; nao_lidas: number };
    const agenda = r.notifications.find((n) => n.tipo === 'agenda')!;
    expect(agenda.payload.company_id).toBe(Number(cid));
    expect(r.notifications.some((n) => n.tipo === 'parado')).toBe(true);
    expect(r.nao_lidas).toBeGreaterThanOrEqual(2);

    expect((await inj(rep, 'POST', '/api/notifications/read-all')).statusCode).toBe(200);
    expect(((await inj(rep, 'GET', '/api/notifications')).json() as { nao_lidas: number }).nao_lidas).toBe(0);
  });
});

/* ── notificações: comissão divergente ──────────────────── */
describe('notificações: comissão divergente', () => {
  it('comissão baixada fora da tolerância vira aviso', async () => {
    const repId = Number(((await inj(a, 'POST', '/api/represented', { nome: 'Repr Comissao' })).json() as { empresa: { id: number } }).empresa.id);
    await inj(a, 'POST', '/api/commission-rules', { represented_id: repId, percent: 10, vigencia_inicio: '2026-01-01' });
    const cid = await makeCompany();
    const prod = Number(((await inj(a, 'POST', '/api/catalog', { nome: 'Prod Comissao', preco: 100 })).json() as { item: { id: number } }).item.id);
    const order = (await inj(a, 'POST', '/api/orders', { company_id: cid, represented_id: repId, items: [{ catalog_item_id: prod, qtd: 1 }] })).json() as { order: { id: number } };
    await inj(a, 'POST', `/api/orders/${order.order.id}/transition`, { status: 'enviado' });
    await inj(a, 'POST', `/api/orders/${order.order.id}/transition`, { status: 'faturado', nf_numero: 'NF-COM' });
    const ce = ((await inj(a, 'GET', `/api/commissions?order_id=${order.order.id}`)).json() as { entries: { id: number; valor_previsto: string }[] }).entries[0]!;
    // recebe metade do previsto com tolerância zero → divergente
    await inj(a, 'PATCH', `/api/commissions/${ce.id}/settle`, { valor_recebido: Number(ce.valor_previsto) / 2, recebida_em: '2026-06-14', tolerancia: 0 });

    const notifs = (await inj(a, 'GET', '/api/notifications')).json() as { notifications: { tipo: string }[] };
    expect(notifs.notifications.some((n) => n.tipo === 'comissao')).toBe(true);
  });
});

/* ── routes: reuse com veículo excluído + despesa RBAC ───── */
describe('rotas /api/routes: reuse e despesa', () => {
  it('reuse de rota cujo veículo foi excluído reusa sem veículo', async () => {
    const veh = Number(((await inj(a, 'POST', '/api/vehicles', { nome: 'Van', consumo_kml: 10 })).json() as { vehicle: { id: number } }).vehicle.id);
    const cid = await makeCompany({ lat: -23.5, lon: -46.6 });
    const route = (await inj(a, 'POST', '/api/routes', {
      nome: 'Rota com veículo', vehicle_id: veh, origem_lat: -23.5, origem_lon: -46.6,
      stops: [{ company_id: cid, seq: 0, lat: -23.5, lon: -46.6 }],
    })).json() as { route: { id: number } };

    expect((await inj(a, 'DELETE', `/api/vehicles/${veh}`)).statusCode).toBe(200);
    // o reuse reavalia o veículo (excluído → reusa sem veículo) antes de recalcular
    // a rota; o cálculo em si pode falhar sem OSRM no ambiente de teste (400).
    const reuse = await inj(a, 'POST', `/api/routes/${route.route.id}/reuse`, {});
    expect([201, 400]).toContain(reuse.statusCode);
  });

  it('despesa de rota de outro vendedor → 403', async () => {
    const cid = await makeCompany({ lat: -22, lon: -43 });
    const route = (await inj(a, 'POST', '/api/routes', {
      nome: 'Rota do admin', origem_lat: -22, origem_lon: -43, custo_total: 50,
      stops: [{ company_id: cid, seq: 0, lat: -22, lon: -43 }],
    })).json() as { route: { id: number } };
    expect((await inj(rep, 'POST', `/api/routes/${route.route.id}/expense`, {})).statusCode).toBe(403);
  });
});

/* ── relationships: importação em lote ──────────────────── */
describe('POST /api/relationships/import', () => {
  it('classifica created/alreadyExists/notFound/invalid e cobre os atalhos', async () => {
    const cid = await makeCompany();
    const cnpj = (await one<{ cnpj: string }>('SELECT TRIM(cnpj) AS cnpj FROM companies WHERE id = $1', [cid]))!.cnpj;

    // só inválidos → atalho valid.length === 0
    const allBad = await inj(a, 'POST', '/api/relationships/import', { cnpjs: ['abc', '   '] });
    expect((allBad.json() as { created: number; invalid: string[] }).created).toBe(0);
    expect((allBad.json() as { invalid: string[] }).invalid).toContain('abc');

    // só ausente (14 dígitos, fora da base) → atalho foundRows.length === 0
    const absent = await inj(a, 'POST', '/api/relationships/import', { cnpjs: ['00000000000000'] });
    expect((absent.json() as { notFound: string[] }).notFound).toContain('00000000000000');

    // misto: cnpj real (dup), ausente, inválido
    const first = await inj(a, 'POST', '/api/relationships/import', { cnpjs: [cnpj, cnpj, '00000000000000', 'xyz'] });
    const j1 = first.json() as { created: number; notFound: string[]; invalid: string[] };
    expect(j1.created).toBe(1);
    expect(j1.notFound).toContain('00000000000000');
    expect(j1.invalid).toContain('xyz');

    // reimport do mesmo → alreadyExists (created 0, foundRows > 0)
    const again = await inj(a, 'POST', '/api/relationships/import', { cnpjs: [cnpj] });
    const j2 = again.json() as { created: number; alreadyExists: string[] };
    expect(j2.created).toBe(0);
    expect(j2.alreadyExists).toContain(cnpj);
  });
});

/* ── orders: impressão para vendedor sem acesso ─────────── */
describe('GET /api/orders/:id/print — RBAC', () => {
  it('vendedor sem acesso ao pedido do admin recebe 404', async () => {
    const repId = Number(((await inj(a, 'POST', '/api/represented', { nome: 'Repr Print' })).json() as { empresa: { id: number } }).empresa.id);
    const cid = await makeCompany();
    const prod = Number(((await inj(a, 'POST', '/api/catalog', { nome: 'Prod Print', preco: 50 })).json() as { item: { id: number } }).item.id);
    const order = (await inj(a, 'POST', '/api/orders', { company_id: cid, represented_id: repId, items: [{ catalog_item_id: prod, qtd: 1 }] })).json() as { order: { id: number } };

    expect((await inj(rep, 'GET', `/api/orders/${order.order.id}/print`)).statusCode).toBe(404);
  });
});

/* ── finance: exclusão de categoria ─────────────────────── */
describe('DELETE /api/finance/categories/:id', () => {
  it('dono exclui a categoria', async () => {
    const cat = (await inj(a, 'POST', '/api/finance/categories', { nome: 'Temporária' })).json() as { category: { id: number } };
    const del = await inj(a, 'DELETE', `/api/finance/categories/${cat.category.id}`);
    expect(del.statusCode).toBe(200);
    expect((del.json() as { deleted: boolean }).deleted).toBe(true);
  });
});

/* ── sample-requests: ramos de RBAC e rollback ──────────── */
describe('sample-requests: exclusão por vendedor de fora e rollback de agenda', () => {
  it('vendedor não exclui amostra de outro dono (403)', async () => {
    const cid = await makeCompany();
    const rel = (await inj(a, 'POST', '/api/relationships', { company_id: cid })).json() as { relationship: { id: number } };
    const prod = (await inj(a, 'POST', '/api/catalog', { nome: 'Prod Amostra Gap' })).json() as { item: { id: number } };
    const sample = (await inj(a, 'POST', '/api/sample-requests', {
      relationship_id: Number(rel.relationship.id), catalog_item_id: Number(prod.item.id),
    })).json() as { sample: { id: number } };

    expect((await inj(rep, 'DELETE', `/api/sample-requests/${sample.sample.id}`)).statusCode).toBe(403);
  });

  it('agenda com data inválida aborta a transação (rollback) → 500', async () => {
    const cid = await makeCompany();
    const rel = (await inj(a, 'POST', '/api/relationships', { company_id: cid })).json() as { relationship: { id: number } };
    const prod = (await inj(a, 'POST', '/api/catalog', { nome: 'Prod Rollback' })).json() as { item: { id: number } };
    const r = await inj(a, 'POST', '/api/sample-requests', {
      relationship_id: Number(rel.relationship.id), catalog_item_id: Number(prod.item.id),
      agenda: { titulo: 'Quebra', start_at: 'data-totalmente-invalida' },
    });
    expect(r.statusCode).toBe(500);
  });
});
