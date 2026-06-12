import type { FastifyInstance } from 'fastify';
import { pool, query, one } from '../db.ts';
import { hashPassword, verifyPassword, signToken, requireAuth } from '../auth.ts';

const DEFAULT_STAGES = [
  'Prospecção', 'Conscientização', 'Interesse', 'Avaliação', 'Negociação', 'Compra', 'Fidelização',
];

export function authRoutes(app: FastifyInstance): void {
  // Register a new tenant (org + admin user + default kanban stages + empty target profile).
  app.post('/api/auth/register', {
    schema: {
      body: {
        type: 'object',
        required: ['org_nome', 'email', 'senha'],
        properties: {
          org_nome: { type: 'string', minLength: 1 },
          email: { type: 'string', minLength: 3 },
          senha: { type: 'string', minLength: 6 },
        },
      },
    },
  }, async (req, reply) => {
    const { org_nome, email, senha } = req.body as { org_nome: string; email: string; senha: string };
    const normEmail = email.trim().toLowerCase();

    const existing = await one('SELECT id FROM users WHERE email = $1', [normEmail]);
    if (existing) return reply.code(409).send({ error: 'email já cadastrado' });

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const org = (await client.query('INSERT INTO organizations (nome) VALUES ($1) RETURNING id', [org_nome])).rows[0];
      const senhaHash = await hashPassword(senha);
      const user = (await client.query(
        'INSERT INTO users (org_id, email, senha_hash, role) VALUES ($1,$2,$3,$4) RETURNING id, role',
        [org.id, normEmail, senhaHash, 'admin'],
      )).rows[0];
      await client.query('INSERT INTO target_profiles (org_id) VALUES ($1)', [org.id]);
      for (let i = 0; i < DEFAULT_STAGES.length; i++) {
        await client.query('INSERT INTO stages (org_id, nome, ordem) VALUES ($1,$2,$3)', [org.id, DEFAULT_STAGES[i], i + 1]);
      }
      await client.query('COMMIT');
      const token = await signToken({ userId: user.id, orgId: org.id, role: user.role });
      return reply.code(201).send({ token, user: { id: user.id, email: normEmail, role: user.role, org_id: org.id } });
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  });

  app.post('/api/auth/login', {
    schema: {
      body: {
        type: 'object',
        required: ['email', 'senha'],
        properties: { email: { type: 'string' }, senha: { type: 'string' } },
      },
    },
  }, async (req, reply) => {
    const { email, senha } = req.body as { email: string; senha: string };
    const user = await one<{
      id: number; org_id: number; senha_hash: string; role: string;
      nome: string | null; ativo: boolean; must_change_password: boolean;
    }>(
      'SELECT id, org_id, senha_hash, role, nome, ativo, must_change_password FROM users WHERE email = $1',
      [email.trim().toLowerCase()],
    );
    if (!user || !(await verifyPassword(senha, user.senha_hash))) {
      return reply.code(401).send({ error: 'credenciais inválidas' });
    }
    if (!user.ativo) return reply.code(403).send({ error: 'usuário desativado' });
    const token = await signToken({ userId: user.id, orgId: user.org_id, role: user.role });
    return {
      token,
      user: {
        id: user.id, email: email.trim().toLowerCase(), role: user.role, org_id: user.org_id,
        nome: user.nome, must_change_password: user.must_change_password,
      },
    };
  });

  app.get('/api/auth/me', { preHandler: requireAuth }, async (req) => {
    const { userId, orgId } = req.auth!;
    const user = await one(
      `SELECT u.id, u.email, u.nome, u.role, u.must_change_password, o.nome AS org_nome, o.id AS org_id
       FROM users u JOIN organizations o ON o.id = u.org_id WHERE u.id = $1 AND u.org_id = $2`,
      [userId, orgId],
    );
    return { user };
  });
}
