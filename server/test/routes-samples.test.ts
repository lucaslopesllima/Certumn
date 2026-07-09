// Solicitações de amostra (sample requests): criação (com follow-up na agenda e
// contato), validações de FK/escopo, listagem por prospecção, agregado no
// kanban, edição de status e exclusão. Sempre com isolamento por org/carteira.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { makeApp, register, bearer, mail, makeCompany, closeAll, type Session } from './helpers.ts';

let app: FastifyInstance;
let a: Session;     // org A (admin)
let b: Session;     // org B (admin de outra org)
let rep: Session;   // vendedor da org A
let relA: number;   // prospecção do admin A
let prodA: number;  // produto do catálogo da org A

const inj = (s: Session, method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: unknown):
  ReturnType<FastifyInstance['inject']> =>
  app.inject({ method, url, headers: bearer(s.token), payload });

async function makeRep(admin: Session, tag: string): Promise<Session> {
  const email = mail(tag);
  expect((await inj(admin, 'POST', '/api/users', { nome: tag, email, senha: 'provisoria1' })).statusCode).toBe(201);
  const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, senha: 'provisoria1' } });
  expect(login.statusCode).toBe(200);
  return login.json() as Session;
}

async function addRel(s: Session, owner?: number): Promise<number> {
  const companyId = await makeCompany();
  const payload: Record<string, unknown> = { company_id: companyId };
  if (owner !== undefined) payload.owner_user_id = owner;
  const r = await inj(s, 'POST', '/api/relationships', payload);
  expect(r.statusCode).toBe(201);
  return Number((r.json() as { relationship: { id: number } }).relationship.id);
}

async function makeCatalog(s: Session, nome: string): Promise<number> {
  const r = await inj(s, 'POST', '/api/catalog', { nome });
  expect(r.statusCode).toBe(201);
  return Number((r.json() as { item: { id: number } }).item.id);
}

interface Sample {
  id: number; status: string; produto_snapshot: string; activity_id: number | null;
  contact_id: number | null; owner_user_id: number; atividade_titulo: string | null;
}
async function createSample(s: Session, body: Record<string, unknown>): Promise<Sample> {
  const r = await inj(s, 'POST', '/api/sample-requests', body);
  expect(r.statusCode).toBe(201);
  return (r.json() as { sample: Sample }).sample;
}

beforeAll(async () => {
  app = await makeApp();
  a = await register(app, 'sample.a');
  b = await register(app, 'sample.b');
  rep = await makeRep(a, 'sample.rep');
  relA = await addRel(a);                 // owner = admin A
  prodA = await makeCatalog(a, 'Produto Amostra A');
});
afterAll(async () => { await closeAll(app); });

describe('POST /api/sample-requests', () => {
  it('cria amostra com snapshot do produto, dono herdado e status default', async () => {
    const s = await createSample(a, { relationship_id: relA, catalog_item_id: prodA });
    expect(s.produto_snapshot).toBe('Produto Amostra A');
    expect(s.status).toBe('solicitada');
    expect(Number(s.owner_user_id)).toBe(Number(a.user.id));
    expect(s.activity_id).toBeNull();
  });

  it('campos obrigatórios faltando -> 400', async () => {
    expect((await inj(a, 'POST', '/api/sample-requests', { relationship_id: relA })).statusCode).toBe(400);
    expect((await inj(a, 'POST', '/api/sample-requests', { catalog_item_id: prodA })).statusCode).toBe(400);
  });

  it('prospecção inexistente -> 404; de outra org -> 404 (isolamento)', async () => {
    expect((await inj(a, 'POST', '/api/sample-requests',
      { relationship_id: 999_999_999, catalog_item_id: prodA })).statusCode).toBe(404);
    // b tenta usar a prospecção de a (não existe no escopo de b) — com produto
    // próprio, p/ que o 404 venha do relationship, não do catalog_item_id.
    const prodB = await makeCatalog(b, 'Produto B iso');
    expect((await inj(b, 'POST', '/api/sample-requests',
      { relationship_id: relA, catalog_item_id: prodB })).statusCode).toBe(404);
  });

  it('produto de outra org -> 400 (catalog_item_id inválido)', async () => {
    const prodB = await makeCatalog(b, 'Produto B');
    const r = await inj(a, 'POST', '/api/sample-requests', { relationship_id: relA, catalog_item_id: prodB });
    expect(r.statusCode).toBe(400);
    expect((r.json() as { error: string }).error).toContain('catalog_item_id');
  });

  it('contato de outra org -> 400 (contact_id inválido)', async () => {
    const ctB = (await inj(b, 'POST', '/api/contacts', { nome: 'Contato B' })).json() as { contact: { id: number } };
    const r = await inj(a, 'POST', '/api/sample-requests',
      { relationship_id: relA, catalog_item_id: prodA, contact_id: ctB.contact.id });
    expect(r.statusCode).toBe(400);
    expect((r.json() as { error: string }).error).toContain('contact_id');
  });

  it('gera compromisso na agenda quando agenda informada', async () => {
    const s = await createSample(a, {
      relationship_id: relA, catalog_item_id: prodA,
      agenda: { titulo: 'Follow-up amostra', start_at: '2026-07-01T12:00:00.000Z' },
    });
    expect(s.activity_id).not.toBeNull();
    expect(s.atividade_titulo).toBe('Follow-up amostra');
    // o compromisso aparece na agenda da org
    const acts = (await inj(a, 'GET', '/api/activities')).json() as { activities: { id: number; titulo: string }[] };
    expect(acts.activities.some((x) => Number(x.id) === Number(s.activity_id))).toBe(true);
  });

  it('vendedor não cria amostra na prospecção de outro (403)', async () => {
    const r = await inj(rep, 'POST', '/api/sample-requests', { relationship_id: relA, catalog_item_id: prodA });
    expect(r.statusCode).toBe(403);
  });
});

describe('GET /api/sample-requests + kanban', () => {
  it('lista por prospecção; isolada por org; agregada no card do kanban', async () => {
    const rel = await addRel(a);
    const s = await createSample(a, { relationship_id: rel, catalog_item_id: prodA, quantidade: 2 });

    const list = (await inj(a, 'GET', `/api/sample-requests?relationship_id=${rel}`)).json() as { samples: { id: number }[] };
    expect(list.samples.some((x) => Number(x.id) === Number(s.id))).toBe(true);

    // outra org não enxerga
    const fromB = (await inj(b, 'GET', `/api/sample-requests?relationship_id=${rel}`)).json() as { samples: unknown[] };
    expect(fromB.samples).toHaveLength(0);

    // card do kanban traz só a contagem de amostras (detalhe carrega sob demanda)
    const board = (await inj(a, 'GET', '/api/kanban')).json() as { cards: { id: number; amostras_count: number }[] };
    const card = board.cards.find((c) => Number(c.id) === rel)!;
    expect(card.amostras_count).toBe(1);
  });
});

describe('PATCH /api/sample-requests/:id', () => {
  it('atualiza status; body vazio 400; cross-org 404; vendedor de fora 403', async () => {
    const s = await createSample(a, { relationship_id: relA, catalog_item_id: prodA });

    const up = await inj(a, 'PATCH', `/api/sample-requests/${s.id}`, { status: 'enviada' });
    expect(up.statusCode).toBe(200);
    expect((up.json() as { sample: { status: string } }).sample.status).toBe('enviada');

    expect((await inj(a, 'PATCH', `/api/sample-requests/${s.id}`, {})).statusCode).toBe(400);
    expect((await inj(b, 'PATCH', `/api/sample-requests/${s.id}`, { status: 'recebida' })).statusCode).toBe(404);
    expect((await inj(rep, 'PATCH', `/api/sample-requests/${s.id}`, { status: 'recebida' })).statusCode).toBe(403);
  });
});

describe('DELETE /api/sample-requests/:id', () => {
  it('cross-org 404; dono exclui; some da lista', async () => {
    const s = await createSample(a, { relationship_id: relA, catalog_item_id: prodA });

    expect((await inj(b, 'DELETE', `/api/sample-requests/${s.id}`)).statusCode).toBe(404);
    expect((await inj(a, 'DELETE', `/api/sample-requests/${s.id}`)).statusCode).toBe(200);

    const list = (await inj(a, 'GET', `/api/sample-requests?relationship_id=${relA}`)).json() as { samples: { id: number }[] };
    expect(list.samples.some((x) => Number(x.id) === Number(s.id))).toBe(false);
  });
});
