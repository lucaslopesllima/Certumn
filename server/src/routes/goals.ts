import type { FastifyInstance } from 'fastify';
import { one, query } from '../db.ts';
import { requireAuth, requireAdmin } from '../auth.ts';
import { audit } from '../audit.ts';
import { invalidOrgRef } from '../orgRefs.ts';
import { scopeOwner } from '../scope.ts';

// Metas de venda (Fase 3): valor_meta mensal por vendedor, opcionalmente por
// representada (represented_id NULL = meta global do vendedor no mês).
// Admin define; vendedor acompanha a própria. Realizado = soma dos pedidos
// faturados/entregues do vendedor no mês (por faturado_em), filtrado pela
// representada da meta quando houver.

const SELECT = `
  SELECT g.id, g.user_id, g.represented_id, g.competencia::text AS competencia, g.valor_meta,
         g.created_at, u.nome AS vendedor_nome, u.email AS vendedor_email,
         r.nome AS represented_nome
  FROM goals g
  JOIN users u ON u.id = g.user_id
  LEFT JOIN represented_companies r ON r.id = g.represented_id`;

// 'YYYY-MM' -> primeiro dia do mês (a coluna competencia é sempre dia 1).
const monthStart = (comp: string): string => `${comp}-01`;

export function goalRoutes(app: FastifyInstance): void {
  app.get('/api/goals', {
    preHandler: requireAuth,
    schema: {
      querystring: {
        type: 'object',
        properties: {
          competencia: { type: 'string', pattern: '^\\d{4}-\\d{2}$' },
          user_id: { type: 'integer' },
        },
      },
    },
  }, async (req) => {
    const orgId = req.auth!.orgId;
    const q = req.query as { competencia?: string; user_id?: number };
    const where: string[] = ['g.org_id = $1'];
    const params: unknown[] = [orgId];
    scopeOwner(req, where, params, 'g.user_id', q.user_id);
    if (q.competencia) { params.push(monthStart(q.competencia)); where.push(`g.competencia = $${params.length}::date`); }
    const goals = await query(
      `${SELECT} WHERE ${where.join(' AND ')}
       ORDER BY g.competencia DESC, u.nome NULLS LAST, r.nome NULLS FIRST`,
      params,
    );
    return { goals };
  });

  // Meta vs. realizado no mês. Realizado é calculado por meta (mesmo escopo de
  // vendedor/representada) a partir dos pedidos faturados no mês.
  app.get('/api/goals/progress', {
    preHandler: requireAuth,
    schema: {
      querystring: {
        type: 'object',
        required: ['competencia'],
        properties: {
          competencia: { type: 'string', pattern: '^\\d{4}-\\d{2}$' },
          user_id: { type: 'integer' },
        },
      },
    },
  }, async (req) => {
    const orgId = req.auth!.orgId;
    const q = req.query as { competencia: string; user_id?: number };
    const where: string[] = ['g.org_id = $1', 'g.competencia = $2::date'];
    const params: unknown[] = [orgId, monthStart(q.competencia)];
    scopeOwner(req, where, params, 'g.user_id', q.user_id);
    const rows = await query(
      `SELECT g.id, g.user_id, g.represented_id, g.competencia::text AS competencia, g.valor_meta,
              u.nome AS vendedor_nome, u.email AS vendedor_email, r.nome AS represented_nome,
              COALESCE((
                SELECT SUM(o.total) FROM orders o
                WHERE o.org_id = g.org_id
                  AND o.owner_user_id = g.user_id
                  AND o.status IN ('faturado','entregue')
                  AND date_trunc('month', o.faturado_em) = g.competencia
                  AND (g.represented_id IS NULL OR o.represented_id = g.represented_id)
              ), 0) AS realizado
       FROM goals g
       JOIN users u ON u.id = g.user_id
       LEFT JOIN represented_companies r ON r.id = g.represented_id
       WHERE ${where.join(' AND ')}
       ORDER BY u.nome NULLS LAST, r.nome NULLS FIRST`,
      params,
    );
    const progress = rows.map((g) => {
      const meta = Number((g as { valor_meta: string }).valor_meta);
      const realizado = Number((g as { realizado: string }).realizado);
      return { ...g, realizado, pct: meta > 0 ? Math.round((realizado / meta) * 1000) / 10 : null };
    });
    return { progress };
  });

  app.post('/api/goals', {
    preHandler: [requireAuth, requireAdmin],
    schema: {
      body: {
        type: 'object',
        required: ['user_id', 'competencia', 'valor_meta'],
        properties: {
          user_id: { type: 'integer' },
          represented_id: { type: ['integer', 'null'] },
          competencia: { type: 'string', pattern: '^\\d{4}-\\d{2}$' },
          valor_meta: { type: 'number', minimum: 0 },
        },
      },
    },
  }, async (req, reply) => {
    const orgId = req.auth!.orgId;
    const b = req.body as { user_id: number; represented_id?: number | null; competencia: string; valor_meta: number };
    const badRef = await invalidOrgRef(orgId, b, ['user_id', 'represented_id']);
    if (badRef) return reply.code(400).send({ error: `${badRef} inválido` });
    try {
      const row = await one<{ id: string }>(
        `INSERT INTO goals (org_id, user_id, represented_id, competencia, valor_meta)
         VALUES ($1,$2,$3,$4::date,$5) RETURNING id`,
        [orgId, b.user_id, b.represented_id ?? null, monthStart(b.competencia), b.valor_meta],
      );
      const newId = Number(row!.id);
      await audit(req, 'goal', newId, 'create', b);
      const goal = await one(`${SELECT} WHERE g.id = $1`, [newId]);
      return reply.code(201).send({ goal });
    } catch (e: unknown) {
      if (e && typeof e === 'object' && (e as { code?: string }).code === '23505') {
        return reply.code(409).send({ error: 'meta já existe para esse vendedor/representada/mês' });
      }
      throw e;
    }
  });

  app.patch('/api/goals/:id', {
    preHandler: [requireAuth, requireAdmin],
    schema: {
      params: { type: 'object', required: ['id'], properties: { id: { type: 'integer' } } },
      body: { type: 'object', required: ['valor_meta'], properties: { valor_meta: { type: 'number', minimum: 0 } } },
    },
  }, async (req, reply) => {
    const orgId = req.auth!.orgId;
    const { id } = req.params as { id: number };
    const { valor_meta } = req.body as { valor_meta: number };
    const rows = await query(
      'UPDATE goals SET valor_meta = $1 WHERE id = $2 AND org_id = $3 RETURNING id', [valor_meta, id, orgId],
    );
    if (rows.length === 0) return reply.code(404).send({ error: 'não encontrada' });
    await audit(req, 'goal', id, 'update', { valor_meta });
    const goal = await one(`${SELECT} WHERE g.id = $1`, [id]);
    return { goal };
  });

  app.delete('/api/goals/:id', {
    preHandler: [requireAuth, requireAdmin],
    schema: { params: { type: 'object', required: ['id'], properties: { id: { type: 'integer' } } } },
  }, async (req, reply) => {
    const orgId = req.auth!.orgId;
    const { id } = req.params as { id: number };
    const rows = await query('DELETE FROM goals WHERE id = $1 AND org_id = $2 RETURNING id', [id, orgId]);
    if (rows.length === 0) return reply.code(404).send({ error: 'não encontrada' });
    await audit(req, 'goal', id, 'delete');
    return { deleted: true };
  });
}
