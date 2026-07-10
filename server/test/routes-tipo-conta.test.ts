// Tipo de conta: escritório (default, multi-usuário) vs individual (single-user).
// Cobre register/login/me, guard de POST /api/users e upgrade one-way.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { makeApp, register, bearer, mail, closeAll, type Session } from './helpers.ts';

let app: FastifyInstance;

const inj = (s: Session, method: 'GET' | 'POST' | 'PATCH', url: string, payload?: unknown):
  ReturnType<FastifyInstance['inject']> =>
  app.inject({ method, url, headers: bearer(s.token), payload });

beforeAll(async () => { app = await makeApp(); });
afterAll(async () => { await closeAll(app); });

describe('register/login/me', () => {
  it('sem tipo_conta → default escritorio', async () => {
    const s = await register(app, 'tc.default');
    const me = await inj(s, 'GET', '/api/auth/me');
    expect((me.json() as { user: { tipo_conta: string } }).user.tipo_conta).toBe('escritorio');
  });

  it('individual → refletido em register, me e login', async () => {
    const email = mail('tc.ind');
    const reg = await app.inject({
      method: 'POST', url: '/api/auth/register',
      payload: { org_nome: 'Ind', email, senha: 'senha123', tipo_conta: 'individual' },
    });
    expect(reg.statusCode).toBe(201);
    const s = reg.json() as Session & { user: { tipo_conta: string } };
    expect(s.user.tipo_conta).toBe('individual');

    const me = await inj(s, 'GET', '/api/auth/me');
    expect((me.json() as { user: { tipo_conta: string } }).user.tipo_conta).toBe('individual');

    const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, senha: 'senha123' } });
    expect((login.json() as { user: { tipo_conta: string } }).user.tipo_conta).toBe('individual');
  });

  it('valor inválido → 400', async () => {
    const r = await app.inject({
      method: 'POST', url: '/api/auth/register',
      payload: { org_nome: 'X', email: mail('tc.bad'), senha: 'senha123', tipo_conta: 'xyz' },
    });
    expect(r.statusCode).toBe(400);
  });
});

describe('guard POST /api/users', () => {
  it('escritorio permite criar usuário; individual bloqueia (403)', async () => {
    const office = await register(app, 'tc.office', { tipo_conta: 'escritorio' });
    const okCreate = await inj(office, 'POST', '/api/users', { nome: 'Rep', email: mail('tc.rep'), senha: 'provisoria1' });
    expect(okCreate.statusCode).toBe(201);

    const solo = await register(app, 'tc.solo', { tipo_conta: 'individual' });
    const blocked = await inj(solo, 'POST', '/api/users', { nome: 'Rep', email: mail('tc.rep2'), senha: 'provisoria1' });
    expect(blocked.statusCode).toBe(403);
  });
});

describe('upgrade', () => {
  it('individual (admin) → 200, habilita criação de usuário', async () => {
    const s = await register(app, 'tc.up', { tipo_conta: 'individual' });
    const up = await inj(s, 'POST', '/api/account/upgrade');
    expect(up.statusCode).toBe(200);
    expect((up.json() as { org: { tipo_conta: string } }).org.tipo_conta).toBe('escritorio');

    const create = await inj(s, 'POST', '/api/users', { nome: 'Rep', email: mail('tc.rep3'), senha: 'provisoria1' });
    expect(create.statusCode).toBe(201);
  });

  it('conta já escritório → 409', async () => {
    const s = await register(app, 'tc.already', { tipo_conta: 'escritorio' });
    const up = await inj(s, 'POST', '/api/account/upgrade');
    expect(up.statusCode).toBe(409);
  });

  it('não-admin → 403', async () => {
    const admin = await register(app, 'tc.na', { tipo_conta: 'individual' });
    // vira escritório p/ poder criar um rep, depois testa upgrade pelo rep (já escritório).
    await inj(admin, 'POST', '/api/account/upgrade');
    const email = mail('tc.narep');
    await inj(admin, 'POST', '/api/users', { nome: 'Rep', email, senha: 'provisoria1' });
    const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, senha: 'provisoria1' } });
    const rep = login.json() as Session;
    const up = await inj(rep, 'POST', '/api/account/upgrade');
    expect(up.statusCode).toBe(403);
  });
});

describe('account', () => {
  it('GET /api/account traz tipo_conta; PATCH não altera', async () => {
    const s = await register(app, 'tc.acc', { tipo_conta: 'individual' });
    const get = await inj(s, 'GET', '/api/account');
    expect((get.json() as { org: { tipo_conta: string } }).org.tipo_conta).toBe('individual');

    // tipo_conta não está no schema do PATCH — ignorado, permanece individual.
    await inj(s, 'PATCH', '/api/account', { nome: 'Novo Nome', tipo_conta: 'escritorio' });
    const after = await inj(s, 'GET', '/api/account');
    expect((after.json() as { org: { tipo_conta: string } }).org.tipo_conta).toBe('individual');
  });
});
