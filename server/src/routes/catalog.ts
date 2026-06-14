import type { FastifyInstance } from 'fastify';
import { query } from '../db.ts';
import { requireAuth } from '../auth.ts';
import { TAX_FIELDS } from './tax.ts';

const COLS = `id, nome, codigo, descricao, preco, unidade_medida, represented_id, ativo, ${TAX_FIELDS.join(', ')}`;
// alíquotas por produto: null = não definido (cai no default da org no pedido).
const TAX_BODY = Object.fromEntries(
  TAX_FIELDS.map((k) => [k, { type: ['number', 'null'], minimum: 0, maximum: 100 }]),
);
const BODY = {
  nome: { type: 'string', minLength: 1 },
  codigo: { type: ['string', 'null'] },
  descricao: { type: ['string', 'null'] },
  preco: { type: ['number', 'null'] },
  unidade_medida: { type: ['string', 'null'] },
  represented_id: { type: ['integer', 'null'] },
  ativo: { type: 'boolean' },
  ...TAX_BODY,
} as const;

export function catalogRoutes(app: FastifyInstance): void {
  app.get('/api/catalog', { preHandler: requireAuth }, async (req) => {
    const orgId = req.auth!.orgId;
    const items = await query(
      `SELECT ${COLS} FROM catalog_items WHERE org_id = $1 ORDER BY ativo DESC, nome`,
      [orgId],
    );
    return { items };
  });

  app.post('/api/catalog', {
    preHandler: requireAuth,
    schema: { body: { type: 'object', required: ['nome'], properties: { ...BODY } } },
  }, async (req, reply) => {
    const orgId = req.auth!.orgId;
    const b = req.body as Record<string, unknown> & { nome: string };
    const vals = [orgId, b.nome, b.codigo ?? null, b.descricao ?? null, b.preco ?? null,
      b.unidade_medida ?? null, b.represented_id ?? null, ...TAX_FIELDS.map((k) => b[k] ?? null)];
    const placeholders = vals.map((_, i) => `$${i + 1}`).join(',');
    const rows = await query(
      `INSERT INTO catalog_items (org_id, nome, codigo, descricao, preco, unidade_medida, represented_id, ${TAX_FIELDS.join(', ')})
       VALUES (${placeholders}) RETURNING ${COLS}`,
      vals,
    );
    return reply.code(201).send({ item: rows[0] });
  });

  app.patch('/api/catalog/:id', {
    preHandler: requireAuth,
    schema: {
      params: { type: 'object', required: ['id'], properties: { id: { type: 'integer' } } },
      body: { type: 'object', properties: { ...BODY } },
    },
  }, async (req, reply) => {
    const orgId = req.auth!.orgId;
    const { id } = req.params as { id: number };
    const b = req.body as Record<string, unknown>;
    const sets: string[] = [];
    const params: unknown[] = [];
    for (const k of ['nome', 'codigo', 'descricao', 'preco', 'unidade_medida', 'represented_id', 'ativo', ...TAX_FIELDS]) {
      if (k in b) { params.push(b[k]); sets.push(`${k} = $${params.length}`); }
    }
    if (sets.length === 0) return reply.code(400).send({ error: 'nada para atualizar' });
    params.push(id); const idIdx = params.length;
    params.push(orgId); const orgIdx = params.length;
    const rows = await query(
      `UPDATE catalog_items SET ${sets.join(', ')} WHERE id = $${idIdx} AND org_id = $${orgIdx} RETURNING ${COLS}`,
      params,
    );
    if (rows.length === 0) return reply.code(404).send({ error: 'não encontrado' });
    return { item: rows[0] };
  });

  app.delete('/api/catalog/:id', {
    preHandler: requireAuth,
    schema: { params: { type: 'object', required: ['id'], properties: { id: { type: 'integer' } } } },
  }, async (req, reply) => {
    const orgId = req.auth!.orgId;
    const { id } = req.params as { id: number };
    const rows = await query('DELETE FROM catalog_items WHERE id = $1 AND org_id = $2 RETURNING id', [id, orgId]);
    if (rows.length === 0) return reply.code(404).send({ error: 'não encontrado' });
    return { deleted: true };
  });
}
