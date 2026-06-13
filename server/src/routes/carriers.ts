import type { FastifyInstance } from 'fastify';
import { query } from '../db.ts';
import { requireAuth } from '../auth.ts';
import { audit, pick } from '../audit.ts';

// Transportadoras da org. Pedido referencia carrier_id; por isso DELETE é
// soft (ativo=false) — pedido emitido não perde o rótulo.

const COLS = 'id, nome, cnpj, telefone, email, contato, observacoes, ativo, created_at';
const FIELDS = ['nome', 'cnpj', 'telefone', 'email', 'contato', 'observacoes', 'ativo'] as const;

const BODY = {
  nome: { type: 'string', minLength: 1 },
  cnpj: { type: ['string', 'null'] },
  telefone: { type: ['string', 'null'] },
  email: { type: ['string', 'null'] },
  contato: { type: ['string', 'null'] },
  observacoes: { type: ['string', 'null'] },
  ativo: { type: 'boolean' },
} as const;

export function carrierRoutes(app: FastifyInstance): void {
  app.get('/api/carriers', { preHandler: requireAuth }, async (req) => {
    const orgId = req.auth!.orgId;
    const carriers = await query(
      `SELECT ${COLS} FROM carriers WHERE org_id = $1 ORDER BY ativo DESC, nome`,
      [orgId],
    );
    return { carriers };
  });

  app.post('/api/carriers', {
    preHandler: requireAuth,
    schema: { body: { type: 'object', required: ['nome'], properties: { ...BODY } } },
  }, async (req, reply) => {
    const orgId = req.auth!.orgId;
    const b = req.body as Record<string, unknown> & { nome: string };
    const rows = await query<{ id: number }>(
      `INSERT INTO carriers (org_id, nome, cnpj, telefone, email, contato, observacoes)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING ${COLS}`,
      [orgId, b.nome, b.cnpj ?? null, b.telefone ?? null, b.email ?? null,
        b.contato ?? null, b.observacoes ?? null],
    );
    await audit(req, 'carrier', Number(rows[0]!.id), 'create', pick(b, FIELDS));
    return reply.code(201).send({ carrier: rows[0] });
  });

  app.patch('/api/carriers/:id', {
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
    for (const k of FIELDS) {
      if (k in b) { params.push(b[k]); sets.push(`${k} = $${params.length}`); }
    }
    if (sets.length === 0) return reply.code(400).send({ error: 'nada para atualizar' });
    params.push(id, orgId);
    const rows = await query(
      `UPDATE carriers SET ${sets.join(', ')}
       WHERE id = $${params.length - 1} AND org_id = $${params.length} RETURNING ${COLS}`,
      params,
    );
    if (rows.length === 0) return reply.code(404).send({ error: 'não encontrada' });
    await audit(req, 'carrier', id, 'update', pick(b, FIELDS));
    return { carrier: rows[0] };
  });

  // Soft delete: pedidos apontam para carriers — a linha fica, sai das listas ativas.
  app.delete('/api/carriers/:id', {
    preHandler: requireAuth,
    schema: { params: { type: 'object', required: ['id'], properties: { id: { type: 'integer' } } } },
  }, async (req, reply) => {
    const orgId = req.auth!.orgId;
    const { id } = req.params as { id: number };
    const rows = await query(
      'UPDATE carriers SET ativo = false WHERE id = $1 AND org_id = $2 RETURNING id',
      [id, orgId],
    );
    if (rows.length === 0) return reply.code(404).send({ error: 'não encontrada' });
    await audit(req, 'carrier', id, 'delete');
    return { deleted: true };
  });
}
