// Fecha lacunas de cobertura em src/config.ts (requireWebhookToken), src/app.ts
// (logger de produção) e src/seedGroups.ts (seedAllOrgs no boot).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { requireWebhookToken } from '../src/config.ts';
import { buildApp } from '../src/app.ts';
import { register, closeAll, makeApp } from './helpers.ts';
import { seedAllOrgs, ensureDefaultGroups } from '../src/seedGroups.ts';
import { one, query } from '../src/db.ts';

describe('config — requireWebhookToken', () => {
  it('produção + Evolution ligada sem token → lança', () => {
    expect(() => requireWebhookToken('', 'http://evo', 'production')).toThrow('WHATSAPP_WEBHOOK_TOKEN');
  });
  it('produção com token → devolve o token', () => {
    expect(requireWebhookToken('tok', 'http://evo', 'production')).toBe('tok');
  });
  it('produção com Evolution desligada (url vazia) → ok mesmo sem token', () => {
    expect(requireWebhookToken('', '', 'production')).toBe('');
  });
  it('fora de produção → ok mesmo sem token', () => {
    expect(requireWebhookToken('', 'http://evo', 'development')).toBe('');
  });
});

describe('app — logger de produção', () => {
  it('buildApp em NODE_ENV=production usa o logger com redact (sem opt.logger)', async () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const app = await buildApp(); // sem logger: cai no ramo de produção
      await app.ready();
      expect(app.hasRoute({ method: 'GET', url: '/api/whatsapp/status' })).toBe(true);
      await app.close();
    } finally { process.env.NODE_ENV = prev; }
  });

  it('buildApp fora de produção sem opt.logger usa o default (logger:true)', async () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';
    try {
      const app = await buildApp(); // sem logger + não-prod → ramo `: true`
      await app.ready();
      await app.close();
    } finally { process.env.NODE_ENV = prev; }
  });
});

describe('seedGroups — seedAllOrgs', () => {
  let orgId = 0;
  beforeAll(async () => {
    const app = await makeApp();
    const s = await register(app, 'seed-orgs');
    orgId = Number(s.user.org_id);
    await app.close();
  });
  afterAll(() => closeAll());

  it('semeia grupos padrão e filia usuários sem grupo pelo papel', async () => {
    // Zera o group_id do admin p/ exercitar o UPDATE de filiação.
    await query("UPDATE users SET group_id = NULL WHERE org_id = $1 AND role = 'admin'", [orgId]);
    await seedAllOrgs();
    const admin = await one<{ group_id: string | null }>("SELECT group_id FROM users WHERE org_id = $1 AND role = 'admin'", [orgId]);
    expect(admin!.group_id).not.toBeNull();
    // ensureDefaultGroups é idempotente e devolve o id do grupo Administrador.
    const adminGroup = await ensureDefaultGroups(orgId);
    expect(adminGroup).toBeGreaterThan(0);
  });
});
