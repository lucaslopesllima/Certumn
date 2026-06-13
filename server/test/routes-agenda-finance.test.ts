// Agenda (activities) e financeiro (finance_entries): CRUD, filtros, validação
// de FK por org e o guard de org nos JOINs de rótulo (anti-vazamento).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { query } from '../src/db.ts';
import { makeApp, register, bearer, makeCompany, closeAll, type Session } from './helpers.ts';

let app: FastifyInstance;
let a: Session;
let b: Session;
let companyId: number;

beforeAll(async () => {
  app = await makeApp();
  a = await register(app, 'fin.a');
  b = await register(app, 'fin.b');
  companyId = await makeCompany();
});
afterAll(async () => { await closeAll(app); });

const inj = (s: Session, method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: unknown):
  ReturnType<FastifyInstance['inject']> =>
  app.inject({ method, url, headers: bearer(s.token), payload });

describe('activities', () => {
  it('cria com owner default (usuário do token) e lista com filtros', async () => {
    const created = await inj(a, 'POST', '/api/activities',
      { titulo: 'Visita', start_at: '2026-06-10T10:00:00Z', company_id: companyId });
    expect(created.statusCode).toBe(200);
    const act = (created.json() as { activity: { id: number; owner_user_id: number } }).activity;
    expect(act.owner_user_id).toBe(a.user.id);

    const list = await inj(a, 'GET',
      '/api/activities?from=2026-06-01T00:00:00Z&to=2026-06-30T00:00:00Z&status=pendente');
    expect((list.json() as { activities: { id: number }[] }).activities.some((x) => x.id === act.id)).toBe(true);

    // org B não vê
    const listB = await inj(b, 'GET', '/api/activities');
    expect((listB.json() as { activities: { id: number }[] }).activities.some((x) => x.id === act.id)).toBe(false);
  });

  it('owner_user_id de outra org -> 400 no POST e no PATCH', async () => {
    const r = await inj(a, 'POST', '/api/activities',
      { titulo: 'Inv', start_at: '2026-06-10T10:00:00Z', owner_user_id: b.user.id });
    expect(r.statusCode).toBe(400);
    expect((r.json() as { error: string }).error).toContain('owner_user_id');

    const mine = (await inj(a, 'POST', '/api/activities',
      { titulo: 'Minha', start_at: '2026-06-10T10:00:00Z' })).json() as { activity: { id: number } };
    expect((await inj(a, 'PATCH', `/api/activities/${mine.activity.id}`,
      { owner_user_id: b.user.id })).statusCode).toBe(400);
  });

  it('PATCH branches: vazio 400, status com cast, 404 cross-org; DELETE 404/ok', async () => {
    const act = (await inj(a, 'POST', '/api/activities',
      { titulo: 'Patch', start_at: '2026-06-11T09:00:00Z' })).json() as { activity: { id: number } };
    const id = act.activity.id;

    expect((await inj(a, 'PATCH', `/api/activities/${id}`, {})).statusCode).toBe(400);
    const up = await inj(a, 'PATCH', `/api/activities/${id}`,
      { status: 'feito', titulo: 'Patch 2', end_at: '2026-06-11T10:00:00Z' });
    expect((up.json() as { activity: { status: string } }).activity.status).toBe('feito');
    expect((await inj(b, 'PATCH', `/api/activities/${id}`, { titulo: 'inv' })).statusCode).toBe(404);

    expect((await inj(b, 'DELETE', `/api/activities/${id}`)).statusCode).toBe(404);
    expect((await inj(a, 'DELETE', `/api/activities/${id}`)).statusCode).toBe(200);
  });
});

describe('check-in e relatório de visita (Fase 5)', () => {
  it('check-in grava geo; alheio 404/403', async () => {
    const act = (await inj(a, 'POST', '/api/activities',
      { titulo: 'Visita check-in', start_at: '2026-06-12T09:00:00Z', company_id: companyId })).json() as { activity: { id: number } };
    const id = act.activity.id;

    const ok = await inj(a, 'POST', `/api/activities/${id}/checkin`, { lat: -23.5, lon: -46.6 });
    expect(ok.statusCode).toBe(200);
    expect((ok.json() as { activity: { checkin_lat: number } }).activity.checkin_lat).toBe(-23.5);

    // aparece no GET com checkin_at
    const list = await inj(a, 'GET', '/api/activities');
    const got = (list.json() as { activities: { id: number; checkin_at: string | null }[] }).activities.find((x) => x.id === id);
    expect(got?.checkin_at).not.toBeNull();

    // outra org não acha
    expect((await inj(b, 'POST', `/api/activities/${id}/checkin`, { lat: 0, lon: 0 })).statusCode).toBe(404);
  });

  it('relatório marca feito e atualiza data_contato do funil', async () => {
    const company = await makeCompany();
    // empresa no funil de A para checar a baixa de data_contato
    const rel = await inj(a, 'POST', '/api/relationships', { company_id: company });
    expect(rel.statusCode).toBe(201);

    const act = (await inj(a, 'POST', '/api/activities',
      { titulo: 'Visita relatório', start_at: '2026-06-12T11:00:00Z', company_id: company })).json() as { activity: { id: number } };
    const id = act.activity.id;

    const r = await inj(a, 'POST', `/api/activities/${id}/report`,
      { resultado: 'vendeu', proximo_passo: 'follow-up', texto: 'cliente fechou pedido' });
    expect(r.statusCode).toBe(200);
    const j = r.json() as { activity: { status: string; relatorio: { resultado: string } } };
    expect(j.activity.status).toBe('feito');
    expect(j.activity.relatorio.resultado).toBe('vendeu');

    const dc = await query<{ data_contato: string | null }>(
      'SELECT data_contato::text AS data_contato FROM company_relationships WHERE org_id = $1 AND company_id = $2',
      [a.user.org_id, company]);
    expect(dc[0]!.data_contato).not.toBeNull();

    // resultado obrigatório; alheio 404
    expect((await inj(a, 'POST', `/api/activities/${id}/report`, {})).statusCode).toBe(400);
    expect((await inj(b, 'POST', `/api/activities/${id}/report`, { resultado: 'x' })).statusCode).toBe(404);
  });
});

describe('finance', () => {
  it('CRUD com vínculos válidos + filtros', async () => {
    const rep = (await inj(a, 'POST', '/api/represented', { nome: 'Fornecedora' }))
      .json() as { empresa: { id: number } };
    const act = (await inj(a, 'POST', '/api/activities',
      { titulo: 'Reunião', start_at: '2026-06-12T08:00:00Z' })).json() as { activity: { id: number } };

    const created = await inj(a, 'POST', '/api/finance', {
      kind: 'receber', descricao: 'Comissão', valor: 1500.5, vencimento: '2026-07-01',
      company_id: companyId, represented_id: rep.empresa.id, activity_id: act.activity.id,
      categoria: 'comissao',
    });
    expect(created.statusCode).toBe(200);
    const entry = (created.json() as { entry: { id: number; represented_nome: string; activity_titulo: string } }).entry;
    expect(entry.represented_nome).toBe('Fornecedora');
    expect(entry.activity_titulo).toBe('Reunião');

    const list = await inj(a, 'GET',
      '/api/finance?kind=receber&status=pendente&from=2026-06-01&to=2026-12-31');
    expect((list.json() as { entries: { id: number }[] }).entries.some((e) => e.id === entry.id)).toBe(true);

    expect((await inj(a, 'PATCH', `/api/finance/${entry.id}`, {})).statusCode).toBe(400);
    const up = await inj(a, 'PATCH', `/api/finance/${entry.id}`,
      { status: 'liquidado', liquidacao_data: '2026-07-02', kind: 'receber' });
    expect(up.statusCode).toBe(200);
    expect((await inj(b, 'PATCH', `/api/finance/${entry.id}`, { descricao: 'inv' })).statusCode).toBe(404);

    expect((await inj(b, 'DELETE', `/api/finance/${entry.id}`)).statusCode).toBe(404);
    expect((await inj(a, 'DELETE', `/api/finance/${entry.id}`)).statusCode).toBe(200);
  });

  it('FK de outra org -> 400 (represented, activity, owner) no POST e PATCH', async () => {
    const repB = (await inj(b, 'POST', '/api/represented', { nome: 'Da Org B' }))
      .json() as { empresa: { id: number } };
    const actB = (await inj(b, 'POST', '/api/activities',
      { titulo: 'De B', start_at: '2026-06-12T08:00:00Z' })).json() as { activity: { id: number } };

    const base = { kind: 'pagar', descricao: 'x', valor: 10, vencimento: '2026-07-01' };
    for (const extra of [
      { represented_id: repB.empresa.id },
      { activity_id: actB.activity.id },
      { owner_user_id: b.user.id },
    ]) {
      const r = await inj(a, 'POST', '/api/finance', { ...base, ...extra });
      expect(r.statusCode).toBe(400);
    }

    const mine = (await inj(a, 'POST', '/api/finance', base)).json() as { entry: { id: number } };
    expect((await inj(a, 'PATCH', `/api/finance/${mine.entry.id}`,
      { represented_id: repB.empresa.id })).statusCode).toBe(400);
  });

  it('JOIN de rótulo é org-scoped: vínculo alheio pré-existente não vaza nome', async () => {
    // simula dado legado gravado antes da validação: FK aponta p/ org B
    const repB = (await inj(b, 'POST', '/api/represented', { nome: 'Segredo da B' }))
      .json() as { empresa: { id: number } };
    const leaked = await query<{ id: number }>(
      `INSERT INTO finance_entries (org_id, kind, descricao, valor, vencimento, represented_id)
       VALUES ($1, 'pagar', 'legado', 1, '2026-07-01', $2) RETURNING id`,
      [a.user.org_id, repB.empresa.id],
    );
    const list = await inj(a, 'GET', '/api/finance');
    const row = (list.json() as { entries: { id: number; represented_nome: string | null }[] })
      .entries.find((e) => e.id === leaked[0]!.id);
    expect(row).toBeDefined();
    expect(row!.represented_nome).toBeNull(); // nome da org B não aparece
  });
});
