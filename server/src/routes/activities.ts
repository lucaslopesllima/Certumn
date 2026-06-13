import type { FastifyInstance } from 'fastify';
import { one, query } from '../db.ts';
import { requireAuth } from '../auth.ts';
import { invalidOrgRef } from '../orgRefs.ts';
import { scopeOwner, canWriteOwned, invalidOwnerAssignment } from '../scope.ts';

// Lightweight agenda (no real-time). All rows scoped by org_id.
// Fase 3: rep vê/edita só os próprios compromissos; admin tudo + filtro.
export function activityRoutes(app: FastifyInstance): void {
  app.get('/api/activities', {
    preHandler: requireAuth,
    schema: {
      querystring: {
        type: 'object',
        properties: {
          from: { type: 'string' }, // ISO datetime
          to: { type: 'string' },
          status: { type: 'string' },
          owner_user_id: { type: 'integer' },
        },
      },
    },
  }, async (req) => {
    const orgId = req.auth!.orgId;
    const { from, to, status, owner_user_id } = req.query as { from?: string; to?: string; status?: string; owner_user_id?: number };
    const where: string[] = ['a.org_id = $1'];
    const params: unknown[] = [orgId];
    scopeOwner(req, where, params, 'a.owner_user_id', owner_user_id);
    if (from) { params.push(from); where.push(`a.start_at >= $${params.length}`); }
    if (to) { params.push(to); where.push(`a.start_at <= $${params.length}`); }
    if (status) { params.push(status); where.push(`a.status = $${params.length}::activity_status`); }
    const rows = await query(
      `SELECT a.id, a.tipo, a.titulo, a.start_at, a.end_at, a.owner_user_id, a.company_id, a.status,
              c.razao_social
       FROM activities a
       LEFT JOIN companies c ON c.id = a.company_id
       WHERE ${where.join(' AND ')}
       ORDER BY a.start_at`,
      params,
    );
    return { activities: rows };
  });

  app.post('/api/activities', {
    preHandler: requireAuth,
    schema: {
      body: {
        type: 'object',
        required: ['titulo', 'start_at'],
        properties: {
          tipo: { type: 'string' },
          titulo: { type: 'string', minLength: 1 },
          start_at: { type: 'string' },
          end_at: { type: ['string', 'null'] },
          company_id: { type: ['integer', 'null'] },
          owner_user_id: { type: ['integer', 'null'] },
          status: { type: 'string', enum: ['pendente', 'feito', 'cancelado'] },
        },
      },
    },
  }, async (req, reply) => {
    const orgId = req.auth!.orgId;
    const b = req.body as Record<string, unknown>;
    if (invalidOwnerAssignment(req, b)) {
      return reply.code(403).send({ error: 'vendedor não atribui compromisso a outro usuário' });
    }
    const badRef = await invalidOrgRef(orgId, b, ['owner_user_id']);
    if (badRef) return reply.code(400).send({ error: `${badRef} inválido` });
    const rows = await query(
      `INSERT INTO activities (org_id, tipo, titulo, start_at, end_at, owner_user_id, company_id, status)
       VALUES ($1, COALESCE($2,'tarefa'), $3, $4, $5, $6, $7, COALESCE($8::activity_status,'pendente'))
       RETURNING id, tipo, titulo, start_at, end_at, owner_user_id, company_id, status`,
      [orgId, b.tipo ?? null, b.titulo, b.start_at, b.end_at ?? null,
        b.owner_user_id ?? req.auth!.userId, b.company_id ?? null, b.status ?? null],
    );
    return { activity: rows[0] };
  });

  app.patch('/api/activities/:id', {
    preHandler: requireAuth,
    schema: {
      params: { type: 'object', required: ['id'], properties: { id: { type: 'integer' } } },
      body: {
        type: 'object',
        properties: {
          tipo: { type: 'string' }, titulo: { type: 'string' },
          start_at: { type: 'string' }, end_at: { type: ['string', 'null'] },
          company_id: { type: ['integer', 'null'] }, owner_user_id: { type: ['integer', 'null'] },
          status: { type: 'string', enum: ['pendente', 'feito', 'cancelado'] },
        },
      },
    },
  }, async (req, reply) => {
    const orgId = req.auth!.orgId;
    const { id } = req.params as { id: number };
    const b = req.body as Record<string, unknown>;
    const current = await one<{ owner_user_id: string | null }>(
      'SELECT owner_user_id FROM activities WHERE id = $1 AND org_id = $2', [id, orgId],
    );
    if (!current) return reply.code(404).send({ error: 'não encontrado' });
    if (!canWriteOwned(req, current.owner_user_id === null ? null : Number(current.owner_user_id))) {
      return reply.code(403).send({ error: 'compromisso de outro vendedor' });
    }
    if (invalidOwnerAssignment(req, b)) {
      return reply.code(403).send({ error: 'vendedor não atribui compromisso a outro usuário' });
    }
    const badRef = await invalidOrgRef(orgId, b, ['owner_user_id']);
    if (badRef) return reply.code(400).send({ error: `${badRef} inválido` });
    const sets: string[] = [];
    const params: unknown[] = [];
    for (const k of ['tipo', 'titulo', 'start_at', 'end_at', 'company_id', 'owner_user_id', 'status'] as const) {
      if (k in b) {
        params.push(b[k]);
        sets.push(k === 'status' ? `${k} = $${params.length}::activity_status` : `${k} = $${params.length}`);
      }
    }
    if (sets.length === 0) return reply.code(400).send({ error: 'nada para atualizar' });
    params.push(id, orgId);
    const rows = await query(
      `UPDATE activities SET ${sets.join(', ')} WHERE id = $${params.length - 1} AND org_id = $${params.length}
       RETURNING id, tipo, titulo, start_at, end_at, owner_user_id, company_id, status`,
      params,
    );
    if (rows.length === 0) return reply.code(404).send({ error: 'não encontrado' });
    return { activity: rows[0] };
  });

  app.delete('/api/activities/:id', {
    preHandler: requireAuth,
    schema: { params: { type: 'object', required: ['id'], properties: { id: { type: 'integer' } } } },
  }, async (req, reply) => {
    const orgId = req.auth!.orgId;
    const { id } = req.params as { id: number };
    const current = await one<{ owner_user_id: string | null }>(
      'SELECT owner_user_id FROM activities WHERE id = $1 AND org_id = $2', [id, orgId],
    );
    if (!current) return reply.code(404).send({ error: 'não encontrado' });
    if (!canWriteOwned(req, current.owner_user_id === null ? null : Number(current.owner_user_id))) {
      return reply.code(403).send({ error: 'compromisso de outro vendedor' });
    }
    const rows = await query('DELETE FROM activities WHERE id = $1 AND org_id = $2 RETURNING id', [id, orgId]);
    if (rows.length === 0) return reply.code(404).send({ error: 'não encontrado' });
    return { deleted: true };
  });
}
