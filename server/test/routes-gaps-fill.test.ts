// Fecha lacunas de cobertura de rotas: /api/geocode (account.ts), agregado
// ?totais=1 (finance.ts), auto-virada p/ cliente na última coluna do funil
// (relationships.ts) e checagens de escalação de privilégio (users.ts).
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { makeApp, register, bearer, mail, makeCompany, closeAll, type Session } from './helpers.ts';
import { query, one } from '../src/db.ts';

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

let app: FastifyInstance;
let a: Session; // admin org A
const inj = (s: Session, method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: unknown):
  ReturnType<FastifyInstance['inject']> => app.inject({ method, url, headers: bearer(s.token), payload });

beforeAll(async () => {
  app = await makeApp();
  a = await register(app, 'gaps.a');
});
afterAll(async () => { vi.unstubAllGlobals(); await closeAll(app); });

describe('account — /api/geocode (texto livre)', () => {
  it('devolve lat/lon/label do Nominatim', async () => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => [{ lat: '-23.5', lon: '-46.6', display_name: 'Av. Paulista, SP' }] } as unknown as Response);
    const r = await inj(a, 'GET', '/api/geocode?q=Avenida Paulista');
    expect(r.statusCode).toBe(200);
    expect(r.json().geocode).toEqual({ lat: -23.5, lon: -46.6, label: 'Av. Paulista, SP' });
  });
  it('nada encontrado → geocode null', async () => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => [] } as unknown as Response);
    expect((await inj(a, 'GET', '/api/geocode?q=lugar inexistente xyz')).json().geocode).toBeNull();
  });
});

describe('finance — agregado ?totais=1', () => {
  it('soma aberto/liquidado por tipo', async () => {
    const uid = Number(a.user.id);
    const rows: [string, string, number][] = [
      ['receber', 'liquidado', 100], ['receber', 'pendente', 50],
      ['pagar', 'liquidado', 30], ['pagar', 'pendente', 20],
    ];
    for (const [kind, status, valor] of rows) {
      await query(
        `INSERT INTO finance_entries (org_id, kind, descricao, valor, vencimento, status, owner_user_id)
         VALUES ($1, $2::finance_kind, $3, $4, current_date, $5::finance_status, $6)`,
        [a.user.org_id, kind, `${kind}-${status}`, valor, status, uid]);
    }
    const r = await inj(a, 'GET', '/api/finance?totais=true');
    expect(r.statusCode).toBe(200);
    const t = r.json().totais as { receber_aberto: number; pagar_aberto: number; recebido: number; pago: number };
    expect(t.recebido).toBeGreaterThanOrEqual(100);
    expect(t.receber_aberto).toBeGreaterThanOrEqual(50);
    expect(t.pago).toBeGreaterThanOrEqual(30);
    expect(t.pagar_aberto).toBeGreaterThanOrEqual(20);
  });
});

describe('relationships — auto-cliente na última coluna', () => {
  it('mover card p/ o último stage vira status cliente', async () => {
    const stages = (await inj(a, 'GET', '/api/stages')).json().stages as { id: number; ordem: number }[];
    const first = stages[0]!;
    const last = stages[stages.length - 1]!;
    const companyId = await makeCompany();
    const rel = (await inj(a, 'POST', '/api/relationships', { company_id: companyId, stage_id: first.id })).json().relationship as { id: number };
    const moved = await inj(a, 'PATCH', `/api/relationships/${rel.id}`, { stage_id: last.id });
    expect(moved.statusCode).toBe(200);
    const row = await one<{ status: string }>('SELECT status FROM company_relationships WHERE id = $1', [rel.id]);
    expect(row!.status).toBe('cliente');
  });
});

describe('users — escalação de privilégio', () => {
  it('não-admin não promove a admin nem atribui grupo admin; corpo vazio → 400', async () => {
    // grupo custom com users.update (não-admin).
    const grp = await one<{ id: string }>(
      `INSERT INTO permission_groups (org_id, nome, is_admin, permissions)
       VALUES ($1, 'Editor Equipe', false, ARRAY['users.update','users.list','users.create']::text[]) RETURNING id`,
      [a.user.org_id]);
    const adminGrp = await one<{ id: string }>(
      "SELECT id FROM permission_groups WHERE org_id = $1 AND is_admin = true LIMIT 1", [a.user.org_id]);

    // rep (será editor) + alvo.
    const repEmail = mail('gaps-editor');
    expect((await inj(a, 'POST', '/api/users', { nome: 'Editor', email: repEmail, senha: 'provisoria1' })).statusCode).toBe(201);
    const repId = (await one<{ id: string }>('SELECT id FROM users WHERE email = $1', [repEmail]))!.id;
    await inj(a, 'PATCH', `/api/users/${repId}`, { group_id: Number(grp!.id) });
    const rep = (await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: repEmail, senha: 'provisoria1' } })).json() as Session;

    const alvoEmail = mail('gaps-alvo');
    expect((await inj(a, 'POST', '/api/users', { nome: 'Alvo', email: alvoEmail, senha: 'provisoria1' })).statusCode).toBe(201);
    const alvoId = (await one<{ id: string }>('SELECT id FROM users WHERE email = $1', [alvoEmail]))!.id;

    // rep (não-admin) tenta promover a admin → 403
    expect((await inj(rep, 'PATCH', `/api/users/${alvoId}`, { role: 'admin' })).statusCode).toBe(403);
    // rep tenta atribuir o grupo admin → 403
    expect((await inj(rep, 'PATCH', `/api/users/${alvoId}`, { group_id: Number(adminGrp!.id) })).statusCode).toBe(403);
    // corpo sem nada → 400
    expect((await inj(a, 'PATCH', `/api/users/${alvoId}`, {})).statusCode).toBe(400);
    // PATCH com grupo inexistente → resolveGroupId lança → 400
    expect((await inj(a, 'PATCH', `/api/users/${alvoId}`, { group_id: 999999999 })).statusCode).toBe(400);

    // POST: não-admin não cria admin nem atribui grupo admin.
    expect((await inj(rep, 'POST', '/api/users', { nome: 'X', email: mail('gx'), senha: 'provisoria1', role: 'admin' })).statusCode).toBe(403);
    expect((await inj(rep, 'POST', '/api/users', { nome: 'Y', email: mail('gy'), senha: 'provisoria1', group_id: Number(adminGrp!.id) })).statusCode).toBe(403);

    // admin criando admin (defaultGroupId ramo is_admin) e grupo inválido → 400.
    expect((await inj(a, 'POST', '/api/users', { nome: 'ChefeAdmin', email: mail('gadm'), senha: 'provisoria1', role: 'admin' })).statusCode).toBe(201);
    expect((await inj(a, 'POST', '/api/users', { nome: 'Z', email: mail('gz'), senha: 'provisoria1', group_id: 999999999 })).statusCode).toBe(400);

    // self-guard: admin não rebaixa/desativa a si mesmo.
    expect((await inj(a, 'PATCH', `/api/users/${a.user.id}`, { ativo: false })).statusCode).toBe(400);
  });
});
