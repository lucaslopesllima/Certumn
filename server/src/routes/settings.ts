import type { FastifyInstance } from 'fastify';
import { one, query } from '../db.ts';
import { requireAuth, requireAdmin } from '../auth.ts';
import { encryptSecret } from '../crypto.ts';
import { getSmtpSettings, sendViaSmtp } from '../smtp.ts';
import { audit } from '../audit.ts';

// Config SMTP da org (admin). A senha entra cifrada e NUNCA volta ao client:
// o GET expõe só has_password. PUT faz upsert; senha vazia/omitida mantém a atual.
export function settingsRoutes(app: FastifyInstance): void {
  app.get('/api/settings/smtp', { preHandler: [requireAuth, requireAdmin] }, async (req) => {
    const orgId = req.auth!.orgId;
    const s = await getSmtpSettings(orgId);
    if (!s) return { smtp: null };
    return {
      smtp: {
        host: s.host, port: s.port, secure: s.secure, username: s.username,
        from_email: s.from_email, from_name: s.from_name, enabled: s.enabled,
        has_password: !!s.password_enc,
      },
    };
  });

  app.put('/api/settings/smtp', {
    preHandler: [requireAuth, requireAdmin],
    schema: {
      body: {
        type: 'object',
        required: ['host', 'from_email'],
        properties: {
          host: { type: 'string', minLength: 1 },
          port: { type: 'integer', minimum: 1, maximum: 65535 },
          secure: { type: 'boolean' },
          username: { type: ['string', 'null'] },
          password: { type: ['string', 'null'] },
          from_email: { type: 'string', minLength: 3 },
          from_name: { type: ['string', 'null'] },
          enabled: { type: 'boolean' },
        },
      },
    },
  }, async (req) => {
    const orgId = req.auth!.orgId;
    const b = req.body as {
      host: string; port?: number; secure?: boolean; username?: string | null;
      password?: string | null; from_email: string; from_name?: string | null; enabled?: boolean;
    };
    // senha cifrada só quando veio preenchida; senão COALESCE mantém a existente.
    const pwdEnc = b.password ? encryptSecret(b.password) : null;
    await query(
      `INSERT INTO org_smtp_settings
         (org_id, host, port, secure, username, password_enc, from_email, from_name, enabled, updated_at)
       VALUES ($1, $2, COALESCE($3, 587), COALESCE($4, false), $5, $6, $7, $8, COALESCE($9, false), now())
       ON CONFLICT (org_id) DO UPDATE SET
         host = EXCLUDED.host,
         port = EXCLUDED.port,
         secure = EXCLUDED.secure,
         username = EXCLUDED.username,
         password_enc = COALESCE($6, org_smtp_settings.password_enc),
         from_email = EXCLUDED.from_email,
         from_name = EXCLUDED.from_name,
         enabled = EXCLUDED.enabled,
         updated_at = now()`,
      [orgId, b.host, b.port ?? null, b.secure ?? null, b.username ?? null, pwdEnc,
        b.from_email, b.from_name ?? null, b.enabled ?? null],
    );
    await audit(req, 'org_smtp_settings', orgId, 'update',
      { host: b.host, from_email: b.from_email, enabled: b.enabled ?? false, password_changed: !!b.password });
    return { ok: true };
  });

  // Envia um e-mail de teste pro próprio usuário com a config SMTP salva.
  app.post('/api/settings/smtp/test', { preHandler: [requireAuth, requireAdmin] }, async (req, reply) => {
    const orgId = req.auth!.orgId;
    const s = await getSmtpSettings(orgId);
    if (!s) return reply.code(400).send({ error: 'configure o SMTP antes de testar' });
    const u = await one<{ email: string }>('SELECT email FROM users WHERE id = $1', [req.auth!.userId]);
    if (!u?.email) return reply.code(400).send({ error: 'usuário sem e-mail' });
    try {
      await sendViaSmtp(s, {
        from: u.email, to: u.email,
        subject: 'Teste de SMTP — Prospecta',
        body: 'Este é um e-mail de teste. Se você recebeu, o envio SMTP está funcionando.',
      });
      return { ok: true, to: u.email };
    } catch (e) {
      return reply.code(502).send({ error: e instanceof Error ? e.message : 'falha no envio de teste' });
    }
  });
}
