import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.ts';
import { pool, one } from '../src/db.ts';

// Fluxos críticos da Fase 0: auth, isolamento multi-tenant, gestão de
// usuários (senha provisória / desativação) e trilha de auditoria.
// Banco: rs_test (criado/migrado no globalSetup). Dados únicos por execução
// via sufixo de timestamp — a suíte não depende de banco zerado.

const run = Date.now();
const mail = (tag: string): string => `${tag}.${run}@teste.com`;

interface LoginResp { token: string; user: { id: number; role: string; must_change_password?: boolean } }

let app: FastifyInstance;
let companyId: number;

async function register(orgNome: string, email: string): Promise<LoginResp> {
  const r = await app.inject({
    method: 'POST', url: '/api/auth/register',
    payload: { org_nome: orgNome, email, senha: 'senha123' },
  });
  expect(r.statusCode).toBe(201);
  return r.json() as LoginResp;
}

async function login(email: string, senha: string): Promise<ReturnType<FastifyInstance['inject']>> {
  return app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, senha } });
}

const bearer = (t: string): Record<string, string> => ({ authorization: `Bearer ${t}` });

beforeAll(async () => {
  app = await buildApp({ logger: false });
  await app.ready();
  // empresa do pool global para os testes de funil (cnpj único por execução)
  const cnpj = String(run).padStart(14, '0').slice(-14);
  const c = await one<{ id: number }>(
    `INSERT INTO companies (cnpj, razao_social, cnae_principal, uf, regiao)
     VALUES ($1, 'Empresa Teste LTDA', 4781400, 'SP', 'SE') RETURNING id`,
    [cnpj],
  );
  companyId = c!.id;
});

afterAll(async () => {
  await app.close();
  await pool.end();
});

describe('auth', () => {
  it('register cria org + admin e /me responde', async () => {
    const a = await register('Org Auth', mail('auth'));
    expect(a.user.role).toBe('admin');
    const me = await app.inject({ method: 'GET', url: '/api/auth/me', headers: bearer(a.token) });
    expect(me.statusCode).toBe(200);
    expect((me.json() as { user: { email: string } }).user.email).toBe(mail('auth'));
  });

  it('login com senha errada falha', async () => {
    await register('Org Auth2', mail('auth2'));
    const r = await login(mail('auth2'), 'errada123');
    expect(r.statusCode).toBe(401);
  });

  it('login com email inexistente falha 401 (caminho do hash dummy)', async () => {
    const r = await login(mail('fantasma'), 'qualquer1');
    expect(r.statusCode).toBe(401);
  });

  it('register com email duplicado -> 409', async () => {
    const email = `fixo.${run}@teste.com`;
    const a = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { org_nome: 'A', email, senha: 'senha123' } });
    expect(a.statusCode).toBe(201);
    const dup = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { org_nome: 'B', email, senha: 'senha123' } });
    expect(dup.statusCode).toBe(409);
  });

  it('falha no meio do register dá ROLLBACK e propaga 500', async () => {
    // byte NUL passa no JSON-schema mas o Postgres rejeita em text — o INSERT
    // da organização falha DENTRO da transação e o catch faz ROLLBACK.
    const email = mail('boom');
    const r = await app.inject({
      method: 'POST', url: '/api/auth/register',
      payload: { org_nome: 'Org\u0000Boom', email, senha: 'senha123' },
    });
    expect(r.statusCode).toBe(500);
    // rollback: nenhum resíduo da tentativa
    expect(await one('SELECT id FROM users WHERE email = $1', [email])).toBeNull();
  });

  it('requireAuth: sem header e token inválido -> 401', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/auth/me' })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/api/auth/me', headers: bearer('lixo') })).statusCode).toBe(401);
  });

  it('health responde ok', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/health' });
    expect(r.json()).toEqual({ ok: true });
  });
});

describe('rate limit de autenticação', () => {
  it('estoura 429 após o limite por IP', async () => {
    const app2 = await buildApp({ logger: false, authRateLimitMax: 2 });
    await app2.ready();
    try {
      const tryLogin = (): ReturnType<FastifyInstance['inject']> =>
        app2.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'x@y.z', senha: 'errada1' } });
      expect((await tryLogin()).statusCode).toBe(401);
      expect((await tryLogin()).statusCode).toBe(401);
      expect((await tryLogin()).statusCode).toBe(429);
    } finally {
      await app2.close();
    }
  });
});

describe('isolamento multi-tenant', () => {
  it('org B não enxerga nem altera o funil da org A', async () => {
    const a = await register('Org A', mail('iso.a'));
    const b = await register('Org B', mail('iso.b'));

    const created = await app.inject({
      method: 'POST', url: '/api/relationships', headers: bearer(a.token),
      payload: { company_id: companyId },
    });
    expect(created.statusCode).toBe(201);
    const relId = (created.json() as { relationship: { id: number } }).relationship.id;

    const listB = await app.inject({ method: 'GET', url: '/api/relationships', headers: bearer(b.token) });
    const relsB = (listB.json() as { relationships: { id: number }[] }).relationships;
    expect(relsB.find((r) => r.id === relId)).toBeUndefined();

    const patchB = await app.inject({
      method: 'PATCH', url: `/api/relationships/${relId}`, headers: bearer(b.token),
      payload: { notas: 'invasão' },
    });
    expect(patchB.statusCode).toBe(404);
  });
});

describe('gestão de usuários (admin)', () => {
  it('admin cria vendedor; provisória força troca; rep não administra; desativado cai na hora', async () => {
    const admin = await register('Org Equipe', mail('equipe.admin'));

    // cria vendedor com senha provisória
    const created = await app.inject({
      method: 'POST', url: '/api/users', headers: bearer(admin.token),
      payload: { nome: 'Vendedor Um', email: mail('equipe.rep'), senha: 'provisoria1' },
    });
    expect(created.statusCode).toBe(201);
    const repId = (created.json() as { user: { id: number; must_change_password: boolean } }).user;
    expect(repId.must_change_password).toBe(true);

    // login do vendedor sinaliza troca obrigatória
    const repLogin = await login(mail('equipe.rep'), 'provisoria1');
    expect(repLogin.statusCode).toBe(200);
    const rep = repLogin.json() as LoginResp;
    expect(rep.user.must_change_password).toBe(true);

    // rep não acessa rotas de administração
    const forbidden = await app.inject({
      method: 'POST', url: '/api/users', headers: bearer(rep.token),
      payload: { nome: 'X', email: mail('equipe.x'), senha: 'senha123' },
    });
    expect(forbidden.statusCode).toBe(403);

    // troca de senha limpa a flag e rotaciona o token (token_version++):
    // o antigo morre, a resposta traz o novo para a sessão atual.
    const pwd = await app.inject({
      method: 'POST', url: '/api/account/password', headers: bearer(rep.token),
      payload: { senha_atual: 'provisoria1', nova_senha: 'definitiva1' },
    });
    expect(pwd.statusCode).toBe(200);
    const freshToken = (pwd.json() as { token: string }).token;
    const stale = await app.inject({ method: 'GET', url: '/api/auth/me', headers: bearer(rep.token) });
    expect(stale.statusCode).toBe(401);
    const me = await app.inject({ method: 'GET', url: '/api/auth/me', headers: bearer(freshToken) });
    expect((me.json() as { user: { must_change_password: boolean } }).user.must_change_password).toBe(false);

    // admin não desativa a si mesmo
    const self = await app.inject({
      method: 'PATCH', url: `/api/users/${admin.user.id}`, headers: bearer(admin.token),
      payload: { ativo: false },
    });
    expect(self.statusCode).toBe(400);

    // desativa o vendedor: login bloqueado E token vigente derrubado
    const deact = await app.inject({
      method: 'PATCH', url: `/api/users/${repId.id}`, headers: bearer(admin.token),
      payload: { ativo: false },
    });
    expect(deact.statusCode).toBe(200);
    expect((await login(mail('equipe.rep'), 'definitiva1')).statusCode).toBe(403);
    const dead = await app.inject({ method: 'GET', url: '/api/relationships', headers: bearer(rep.token) });
    expect(dead.statusCode).toBe(401);
  });
});

describe('auditoria', () => {
  it('mutações de funil geram trilha consultável', async () => {
    const a = await register('Org Audit', mail('audit'));
    const created = await app.inject({
      method: 'POST', url: '/api/relationships', headers: bearer(a.token),
      payload: { company_id: companyId },
    });
    const relId = (created.json() as { relationship: { id: number } }).relationship.id;
    await app.inject({
      method: 'PATCH', url: `/api/relationships/${relId}`, headers: bearer(a.token),
      payload: { notas: 'primeira visita feita', valor_estimado: 5000 },
    });

    const log = await app.inject({
      method: 'GET', url: `/api/audit?entity=relationship&entity_id=${relId}`, headers: bearer(a.token),
    });
    expect(log.statusCode).toBe(200);
    const entries = (log.json() as { entries: { action: string; diff: Record<string, unknown> | null }[] }).entries;
    expect(entries.map((e) => e.action)).toEqual(expect.arrayContaining(['create', 'update']));
    const upd = entries.find((e) => e.action === 'update');
    expect(upd?.diff).toMatchObject({ notas: 'primeira visita feita' });

    // trilha é org-scoped: outra org não vê
    const b = await register('Org Audit B', mail('audit.b'));
    const logB = await app.inject({
      method: 'GET', url: `/api/audit?entity=relationship&entity_id=${relId}`, headers: bearer(b.token),
    });
    expect((logB.json() as { entries: unknown[] }).entries).toHaveLength(0);
  });
});
