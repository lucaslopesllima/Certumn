import type { FastifyInstance } from 'fastify';
import { one, query } from '../db.ts';
import { requireAuth } from '../auth.ts';
import { scopeOwner, canWriteOwned } from '../scope.ts';

// Cadastro de veículos (org-scoped). Consumo/preço alimentam o cálculo de
// combustível do planejador de rota. Padrão idêntico a represented.ts.
// Fase 3: veículo tem dono (owner NULL = compartilhado da org).
const COLS = 'id, nome, placa, combustivel, consumo_kml, tanque_litros, preco_litro, ativo, owner_user_id';
const FIELDS = ['nome', 'placa', 'combustivel', 'consumo_kml', 'tanque_litros', 'preco_litro', 'ativo'] as const;

const FIELD_SCHEMA = {
  nome: { type: 'string', minLength: 1 },
  placa: { type: ['string', 'null'] },
  combustivel: { type: 'string', enum: ['gasolina', 'etanol', 'diesel', 'flex'] },
  consumo_kml: { type: 'number', exclusiveMinimum: 0 },
  tanque_litros: { type: ['number', 'null'] },
  preco_litro: { type: ['number', 'null'] },
} as const;

export function vehicleRoutes(app: FastifyInstance): void {
  app.get('/api/vehicles', {
    preHandler: requireAuth,
    schema: { querystring: { type: 'object', properties: { owner_user_id: { type: 'integer' } } } },
  }, async (req) => {
    const orgId = req.auth!.orgId;
    const { owner_user_id } = req.query as { owner_user_id?: number };
    const where: string[] = ['org_id = $1'];
    const params: unknown[] = [orgId];
    scopeOwner(req, where, params, 'owner_user_id', owner_user_id, { nullVisible: true });
    const vehicles = await query(
      `SELECT ${COLS} FROM vehicles WHERE ${where.join(' AND ')} ORDER BY ativo DESC, nome`,
      params,
    );
    return { vehicles };
  });

  app.post('/api/vehicles', {
    preHandler: requireAuth,
    schema: {
      body: {
        type: 'object',
        required: ['nome', 'consumo_kml'],
        properties: FIELD_SCHEMA,
      },
    },
  }, async (req) => {
    const orgId = req.auth!.orgId;
    const b = req.body as Record<string, unknown>;
    const rows = await query(
      `INSERT INTO vehicles (org_id, owner_user_id, nome, placa, combustivel, consumo_kml, tanque_litros, preco_litro)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING ${COLS}`,
      [orgId, req.auth!.userId, b.nome, b.placa ?? null, b.combustivel ?? 'gasolina', b.consumo_kml,
        b.tanque_litros ?? null, b.preco_litro ?? null],
    );
    return { vehicle: rows[0] };
  });

  app.patch('/api/vehicles/:id', {
    preHandler: requireAuth,
    schema: {
      params: { type: 'object', required: ['id'], properties: { id: { type: 'integer' } } },
      body: { type: 'object', properties: { ...FIELD_SCHEMA, ativo: { type: 'boolean' } } },
    },
  }, async (req, reply) => {
    const orgId = req.auth!.orgId;
    const { id } = req.params as { id: number };
    const b = req.body as Record<string, unknown>;
    const cur = await one<{ owner_user_id: string | null }>(
      'SELECT owner_user_id FROM vehicles WHERE id = $1 AND org_id = $2', [id, orgId],
    );
    if (!cur) return reply.code(404).send({ error: 'não encontrado' });
    if (!canWriteOwned(req, cur.owner_user_id === null ? null : Number(cur.owner_user_id), { nullWritable: true })) {
      return reply.code(403).send({ error: 'veículo de outro vendedor' });
    }
    const sets: string[] = [];
    const params: unknown[] = [];
    for (const k of [...FIELDS] as const) {
      if (b[k] !== undefined) { params.push(b[k]); sets.push(`${k} = $${params.length}`); }
    }
    if (sets.length === 0) return reply.code(400).send({ error: 'nada para atualizar' });
    params.push(id, orgId);
    const rows = await query(
      `UPDATE vehicles SET ${sets.join(', ')}
       WHERE id = $${params.length - 1} AND org_id = $${params.length} RETURNING ${COLS}`,
      params,
    );
    if (rows.length === 0) return reply.code(404).send({ error: 'não encontrado' });
    return { vehicle: rows[0] };
  });

  app.delete('/api/vehicles/:id', {
    preHandler: requireAuth,
    schema: { params: { type: 'object', required: ['id'], properties: { id: { type: 'integer' } } } },
  }, async (req, reply) => {
    const orgId = req.auth!.orgId;
    const { id } = req.params as { id: number };
    const cur = await one<{ owner_user_id: string | null }>(
      'SELECT owner_user_id FROM vehicles WHERE id = $1 AND org_id = $2', [id, orgId],
    );
    if (!cur) return reply.code(404).send({ error: 'não encontrado' });
    if (!canWriteOwned(req, cur.owner_user_id === null ? null : Number(cur.owner_user_id), { nullWritable: true })) {
      return reply.code(403).send({ error: 'veículo de outro vendedor' });
    }
    // soft delete: preserva o vínculo com rotas já salvas (vehicle_id SET NULL no hard delete também).
    const rows = await query(
      'UPDATE vehicles SET ativo = false WHERE id = $1 AND org_id = $2 RETURNING id', [id, orgId],
    );
    if (rows.length === 0) return reply.code(404).send({ error: 'não encontrado' });
    return { deleted: true };
  });
}
