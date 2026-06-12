import type { FastifyInstance } from 'fastify';
import { query } from '../db.ts';
import { requireAuth } from '../auth.ts';
import { audit, pick } from '../audit.ts';

// Módulo financeiro: contas a pagar/receber, org-scoped. SQL parametrizado, sem ORM.
// Vínculos opcionais: empresa prospect (companies), empresa representada
// (represented_companies) e compromisso (activities) — todos LEFT JOIN p/ rótulos.

const SELECT = `
  SELECT f.id, f.kind, f.descricao, f.valor, f.vencimento, f.liquidacao_data, f.status,
         f.categoria, f.notas, f.company_id, f.represented_id, f.activity_id, f.owner_user_id,
         f.created_at,
         c.razao_social  AS company_nome,
         r.nome          AS represented_nome,
         a.titulo        AS activity_titulo
  FROM finance_entries f
  LEFT JOIN companies c            ON c.id = f.company_id
  LEFT JOIN represented_companies r ON r.id = f.represented_id
  LEFT JOIN activities a            ON a.id = f.activity_id`;

// Campos editáveis (mesma lista no POST e no PATCH dinâmico).
const FIELDS = ['kind', 'descricao', 'valor', 'vencimento', 'liquidacao_data', 'status',
  'categoria', 'notas', 'company_id', 'represented_id', 'activity_id', 'owner_user_id'] as const;

const cast = (k: string): string => (k === 'kind' ? '::finance_kind' : k === 'status' ? '::finance_status' : '');

export function financeRoutes(app: FastifyInstance): void {
  app.get('/api/finance', {
    preHandler: requireAuth,
    schema: {
      querystring: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: ['pagar', 'receber'] },
          status: { type: 'string', enum: ['pendente', 'liquidado', 'cancelado'] },
          from: { type: 'string' },
          to: { type: 'string' },
        },
      },
    },
  }, async (req) => {
    const orgId = req.auth!.orgId;
    const { kind, status, from, to } = req.query as Record<string, string | undefined>;
    const where: string[] = ['f.org_id = $1'];
    const params: unknown[] = [orgId];
    if (kind) { params.push(kind); where.push(`f.kind = $${params.length}::finance_kind`); }
    if (status) { params.push(status); where.push(`f.status = $${params.length}::finance_status`); }
    if (from) { params.push(from); where.push(`f.vencimento >= $${params.length}`); }
    if (to) { params.push(to); where.push(`f.vencimento <= $${params.length}`); }
    const entries = await query(
      `${SELECT} WHERE ${where.join(' AND ')} ORDER BY f.vencimento, f.id`,
      params,
    );
    return { entries };
  });

  app.post('/api/finance', {
    preHandler: requireAuth,
    schema: {
      body: {
        type: 'object',
        required: ['kind', 'descricao', 'valor', 'vencimento'],
        properties: {
          kind: { type: 'string', enum: ['pagar', 'receber'] },
          descricao: { type: 'string', minLength: 1 },
          valor: { type: 'number' },
          vencimento: { type: 'string' },
          liquidacao_data: { type: ['string', 'null'] },
          status: { type: 'string', enum: ['pendente', 'liquidado', 'cancelado'] },
          categoria: { type: ['string', 'null'] },
          notas: { type: ['string', 'null'] },
          company_id: { type: ['integer', 'null'] },
          represented_id: { type: ['integer', 'null'] },
          activity_id: { type: ['integer', 'null'] },
        },
      },
    },
  }, async (req) => {
    const orgId = req.auth!.orgId;
    const b = req.body as Record<string, unknown>;
    const rows = await query(
      `INSERT INTO finance_entries
        (org_id, kind, descricao, valor, vencimento, liquidacao_data, status,
         categoria, notas, company_id, represented_id, activity_id, owner_user_id)
       VALUES ($1, $2::finance_kind, $3, $4, $5, $6, COALESCE($7::finance_status,'pendente'),
               $8, $9, $10, $11, $12, $13)
       RETURNING id`,
      [orgId, b.kind, b.descricao, b.valor, b.vencimento, b.liquidacao_data ?? null,
        b.status ?? null, b.categoria ?? null, b.notas ?? null,
        b.company_id ?? null, b.represented_id ?? null, b.activity_id ?? null, req.auth!.userId],
    );
    const newId = (rows[0] as { id: number }).id;
    await audit(req, 'finance', newId, 'create', pick(b, FIELDS));
    const entry = await query(`${SELECT} WHERE f.id = $1`, [newId]);
    return { entry: entry[0] };
  });

  app.patch('/api/finance/:id', {
    preHandler: requireAuth,
    schema: {
      params: { type: 'object', required: ['id'], properties: { id: { type: 'integer' } } },
      body: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: ['pagar', 'receber'] },
          descricao: { type: 'string', minLength: 1 },
          valor: { type: 'number' },
          vencimento: { type: 'string' },
          liquidacao_data: { type: ['string', 'null'] },
          status: { type: 'string', enum: ['pendente', 'liquidado', 'cancelado'] },
          categoria: { type: ['string', 'null'] },
          notas: { type: ['string', 'null'] },
          company_id: { type: ['integer', 'null'] },
          represented_id: { type: ['integer', 'null'] },
          activity_id: { type: ['integer', 'null'] },
        },
      },
    },
  }, async (req, reply) => {
    const orgId = req.auth!.orgId;
    const { id } = req.params as { id: number };
    const b = req.body as Record<string, unknown>;
    const sets: string[] = [];
    const params: unknown[] = [];
    for (const k of FIELDS) {
      if (k in b) { params.push(b[k]); sets.push(`${k} = $${params.length}${cast(k)}`); }
    }
    if (sets.length === 0) return reply.code(400).send({ error: 'nada para atualizar' });
    params.push(id, orgId);
    const rows = await query(
      `UPDATE finance_entries SET ${sets.join(', ')}
       WHERE id = $${params.length - 1} AND org_id = $${params.length} RETURNING id`,
      params,
    );
    if (rows.length === 0) return reply.code(404).send({ error: 'não encontrado' });
    await audit(req, 'finance', id, 'update', pick(b, FIELDS));
    const entry = await query(`${SELECT} WHERE f.id = $1`, [id]);
    return { entry: entry[0] };
  });

  app.delete('/api/finance/:id', {
    preHandler: requireAuth,
    schema: { params: { type: 'object', required: ['id'], properties: { id: { type: 'integer' } } } },
  }, async (req, reply) => {
    const orgId = req.auth!.orgId;
    const { id } = req.params as { id: number };
    const rows = await query('DELETE FROM finance_entries WHERE id = $1 AND org_id = $2 RETURNING id', [id, orgId]);
    if (rows.length === 0) return reply.code(404).send({ error: 'não encontrado' });
    await audit(req, 'finance', id, 'delete');
    return { deleted: true };
  });
}
