import type { FastifyInstance } from 'fastify';
import { one, query } from '../db.ts';
import { requireAuth, requirePermission, hashPassword } from '../auth.ts';
import { audit } from '../audit.ts';

// Valida que o group_id informado pertence à org do admin. Retorna o id (number)
// se válido, null se ausente, ou lança quando o grupo é de outra org/inexistente.
async function resolveGroupId(orgId: number, groupId: unknown): Promise<number | null | undefined> {
  if (groupId === undefined) return undefined;
  if (groupId === null) return null;
  const g = await one<{ id: number }>('SELECT id FROM permission_groups WHERE id = $1 AND org_id = $2', [groupId, orgId]);
  if (!g) throw new Error('grupo inválido');
  return Number(g.id);
}

// Um group_id resolvido é de um grupo admin (is_admin=true)? Usado para impedir
// que não-admin atribua o grupo administrador (escalação de privilégio).
async function groupIsAdmin(orgId: number, groupId: number): Promise<boolean> {
  const g = await one<{ is_admin: boolean }>(
    'SELECT is_admin FROM permission_groups WHERE id = $1 AND org_id = $2', [groupId, orgId],
  );
  return !!g?.is_admin;
}

// Grupo padrão por papel quando o admin não escolhe um: admin → Administrador,
// demais → Vendedor. Espelha o seed do boot e evita criar usuário sem permissão.
async function defaultGroupId(orgId: number, role: string): Promise<number | null> {
  const g = role === 'admin'
    ? await one<{ id: number }>('SELECT id FROM permission_groups WHERE org_id = $1 AND is_admin = true', [orgId])
    : await one<{ id: number }>("SELECT id FROM permission_groups WHERE org_id = $1 AND nome = 'Vendedor'", [orgId]);
  return g ? Number(g.id) : null;
}

// Gestão de usuários da org (admin only). Sem SMTP nesta fase: admin cria o
// vendedor com senha provisória e must_change_password=true — o primeiro
// login força a troca. Desativar (ativo=false) bloqueia login e derruba
// sessões existentes (requireAuth checa ativo a cada requisição).

const USER_COLS = 'u.id, u.nome, u.email, u.role, u.ativo, u.must_change_password, u.group_id, g.nome AS group_nome';
const FROM_USERS = 'FROM users u LEFT JOIN permission_groups g ON g.id = u.group_id';
// RETURNING após INSERT/UPDATE não pode usar JOIN — sem group_nome (a UI recarrega a lista).
const RETURNING_COLS = 'id, nome, email, role, ativo, must_change_password, group_id';
const guard = (code: string) => [requireAuth, requirePermission(code)];

export function userRoutes(app: FastifyInstance): void {
  app.get('/api/users', { preHandler: guard('users.list') }, async (req) => {
    const users = await query(
      `SELECT ${USER_COLS} ${FROM_USERS} WHERE u.org_id = $1 ORDER BY u.ativo DESC, u.nome NULLS LAST, u.email`,
      [req.auth!.orgId],
    );
    return { users };
  });

  app.post('/api/users', {
    preHandler: guard('users.create'),
    schema: {
      body: {
        type: 'object',
        required: ['nome', 'email', 'senha'],
        properties: {
          nome: { type: 'string', minLength: 1 },
          email: { type: 'string', minLength: 3 },
          senha: { type: 'string', minLength: 6 },   // provisória
          role: { type: 'string', enum: ['admin', 'rep'] },
          group_id: { type: ['integer', 'null'] },
        },
      },
    },
  }, async (req, reply) => {
    const orgId = req.auth!.orgId;
    const b = req.body as { nome: string; email: string; senha: string; role?: string; group_id?: number | null };

    // Conta individual é single-user por definição — não admite usuários extras.
    const org = await one<{ tipo_conta: string }>('SELECT tipo_conta FROM organizations WHERE id = $1', [orgId]);
    if (org?.tipo_conta === 'individual') {
      return reply.code(403).send({ error: 'conta individual não permite usuários adicionais — migre para escritório em Conta' });
    }

    const email = b.email.trim().toLowerCase();
    const dup = await one('SELECT id FROM users WHERE email = $1', [email]);
    if (dup) return reply.code(409).send({ error: 'email já cadastrado' });

    const role = b.role ?? 'rep';
    let groupId: number | null;
    try {
      const resolved = await resolveGroupId(orgId, b.group_id);
      // group_id omitido → grupo padrão pelo papel; informado (id/null) → respeita.
      groupId = resolved === undefined ? await defaultGroupId(orgId, role) : resolved;
    } catch { return reply.code(400).send({ error: 'grupo inválido' }); }

    // Escalação de privilégio: só admin pode criar admin ou atribuir grupo admin.
    // A permissão users.create sozinha (grupo customizado) não basta.
    if (!req.auth!.isAdmin) {
      if (role === 'admin') return reply.code(403).send({ error: 'apenas administradores podem criar administradores' });
      if (groupId != null && await groupIsAdmin(orgId, groupId)) {
        return reply.code(403).send({ error: 'apenas administradores podem atribuir o grupo administrador' });
      }
    }

    const rows = await query(
      `INSERT INTO users (org_id, nome, email, senha_hash, role, group_id, must_change_password)
       VALUES ($1,$2,$3,$4,$5,$6,true) RETURNING ${RETURNING_COLS}`,
      [orgId, b.nome.trim(), email, await hashPassword(b.senha), role, groupId],
    );
    const user = rows[0] as { id: number };
    await audit(req, 'user', user.id, 'create', { nome: b.nome, email, role, group_id: groupId });
    return reply.code(201).send({ user: rows[0] });
  });

  app.patch('/api/users/:id', {
    preHandler: guard('users.update'),
    schema: {
      params: { type: 'object', required: ['id'], properties: { id: { type: 'integer' } } },
      body: {
        type: 'object',
        properties: {
          nome: { type: 'string', minLength: 1 },
          role: { type: 'string', enum: ['admin', 'rep'] },
          ativo: { type: 'boolean' },
          group_id: { type: ['integer', 'null'] },
        },
      },
    },
  }, async (req, reply) => {
    const orgId = req.auth!.orgId;
    const { id } = req.params as { id: number };
    const b = req.body as { nome?: string; role?: string; ativo?: boolean; group_id?: number | null };

    // admin não rebaixa nem desativa a si mesmo — evita org sem admin ativo.
    if (id === req.auth!.userId && (b.role === 'rep' || b.ativo === false)) {
      return reply.code(400).send({ error: 'não é possível rebaixar ou desativar a si mesmo' });
    }

    let groupId: number | null | undefined;
    try { groupId = await resolveGroupId(orgId, b.group_id); }
    catch { return reply.code(400).send({ error: 'grupo inválido' }); }

    // Escalação de privilégio: só admin promove a admin ou atribui grupo admin.
    if (!req.auth!.isAdmin) {
      if (b.role === 'admin') return reply.code(403).send({ error: 'apenas administradores podem promover a administrador' });
      if (groupId != null && await groupIsAdmin(orgId, groupId)) {
        return reply.code(403).send({ error: 'apenas administradores podem atribuir o grupo administrador' });
      }
    }

    const sets: string[] = [];
    const params: unknown[] = [];
    for (const k of ['nome', 'role', 'ativo'] as const) {
      if (b[k] !== undefined) {
        params.push(b[k]);
        sets.push(k === 'role' ? `role = $${params.length}::user_role` : `${k} = $${params.length}`);
      }
    }
    if (groupId !== undefined) {
      params.push(groupId);
      sets.push(`group_id = $${params.length}`);
    }
    if (sets.length === 0) return reply.code(400).send({ error: 'nada para atualizar' });
    params.push(id, orgId);
    const rows = await query(
      `UPDATE users SET ${sets.join(', ')}
       WHERE id = $${params.length - 1} AND org_id = $${params.length} RETURNING ${RETURNING_COLS}`,
      params,
    );
    if (rows.length === 0) return reply.code(404).send({ error: 'não encontrado' });
    await audit(req, 'user', id, 'update', b);
    return { user: rows[0] };
  });

  // Reset de senha pelo admin: define nova provisória e força troca no próximo login.
  app.post('/api/users/:id/password', {
    preHandler: guard('users.reset_password'),
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
