import type { FastifyInstance } from 'fastify';
import { one, query } from '../db.ts';
import { requireAuth, requireAdmin, hashPassword } from '../auth.ts';
import { audit } from '../audit.ts';

// Gestão de usuários da org (admin only). Sem SMTP nesta fase: admin cria o
// vendedor com senha provisória e must_change_password=true — o primeiro
// login força a troca. Desativar (ativo=false) bloqueia login e derruba
// sessões existentes (requireAuth checa ativo a cada requisição).

const USER_COLS = 'id, nome, email, role, ativo, must_change_password';
const ADMIN = [requireAuth, requireAdmin];

export function userRoutes(app: FastifyInstance): void {
  app.get('/api/users', { preHandler: ADMIN }, async (req) => {
    const users = await query(
      `SELECT ${USER_COLS} FROM users WHERE org_id = $1 ORDER BY ativo DESC, nome NULLS LAST, email`,
      [req.auth!.orgId],
    );
    return { users };
  });

  app.post('/api/users', {
    preHandler: ADMIN,
    schema: {
      body: {
        type: 'object',
        required: ['nome', 'email', 'senha'],
        properties: {
          nome: { type: 'string', minLength: 1 },
          email: { type: 'string', minLength: 3 },
          senha: { type: 'string', minLength: 6 },   // provisória
          role: { type: 'string', enum: ['admin', 'rep'] },
        },
      },
    },
  }, async (req, reply) => {
    const orgId = req.auth!.orgId;
    const b = req.body as { nome: string; email: string; senha: string; role?: string };
    const email = b.email.trim().toLowerCase();
    const dup = await one('SELECT id FROM users WHERE email = $1', [email]);
    if (dup) return reply.code(409).send({ error: 'email já cadastrado' });

    const rows = await query(
      `INSERT INTO users (org_id, nome, email, senha_hash, role, must_change_password)
       VALUES ($1,$2,$3,$4,$5,true) RETURNING ${USER_COLS}`,
      [orgId, b.nome.trim(), email, await hashPassword(b.senha), b.role ?? 'rep'],
    );
    const user = rows[0] as { id: number };
    await audit(req, 'user', user.id, 'create', { nome: b.nome, email, role: b.role ?? 'rep' });
    return reply.code(201).send({ user: rows[0] });
  });

  app.patch('/api/users/:id', {
    preHandler: ADMIN,
    schema: {
      params: { type: 'object', required: ['id'], properties: { id: { type: 'integer' } } },
      body: {
        type: 'object',
        properties: {
          nome: { type: 'string', minLength: 1 },
          role: { type: 'string', enum: ['admin', 'rep'] },
          ativo: { type: 'boolean' },
        },
      },
    },
  }, async (req, reply) => {
    const orgId = req.auth!.orgId;
    const { id } = req.params as { id: number };
    const b = req.body as { nome?: string; role?: string; ativo?: boolean };

    // admin não rebaixa nem desativa a si mesmo — evita org sem admin ativo.
    if (id === req.auth!.userId && (b.role === 'rep' || b.ativo === false)) {
      return reply.code(400).send({ error: 'não é possível rebaixar ou desativar a si mesmo' });
    }

    const sets: string[] = [];
    const params: unknown[] = [];
    for (const k of ['nome', 'role', 'ativo'] as const) {
      if (b[k] !== undefined) {
        params.push(b[k]);
        sets.push(k === 'role' ? `role = $${params.length}::user_role` : `${k} = $${params.length}`);
      }
    }
    if (sets.length === 0) return reply.code(400).send({ error: 'nada para atualizar' });
    params.push(id, orgId);
    const rows = await query(
      `UPDATE users SET ${sets.join(', ')}
       WHERE id = $${params.length - 1} AND org_id = $${params.length} RETURNING ${USER_COLS}`,
      params,
    );
    if (rows.length === 0) return reply.code(404).send({ error: 'não encontrado' });
    await audit(req, 'user', id, 'update', b);
    return { user: rows[0] };
  });

  // Reset de senha pelo admin: define nova provisória e força troca no próximo login.
  app.post('/api/users/:id/password', {
    preHandler: ADMIN,
    schema: {
      params: { type: 'object', required: ['id'], properties: { id: { type: 'integer' } } },
      body: {
        type: 'object',
        required: ['senha'],
        properties: { senha: { type: 'string', minLength: 6 } },
      },
    },
  }, async (req, reply) => {
    const orgId = req.auth!.orgId;
    const { id } = req.params as { id: number };
    if (id === req.auth!.userId) {
      return reply.code(400).send({ error: 'use a troca de senha da própria conta' });
    }
    const { senha } = req.body as { senha: string };
    // token_version++ derruba imediatamente as sessões abertas do usuário resetado.
    const rows = await query(
      `UPDATE users SET senha_hash = $1, must_change_password = true, token_version = token_version + 1
       WHERE id = $2 AND org_id = $3 RETURNING id`,
      [await hashPassword(senha), id, orgId],
    );
    if (rows.length === 0) return reply.code(404).send({ error: 'não encontrado' });
    await audit(req, 'user', id, 'reset_password');
    return { ok: true };
  });
}
