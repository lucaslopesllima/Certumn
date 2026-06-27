import type { FastifyInstance } from 'fastify';
import { one, query, withClient } from '../db.ts';
import { requireAuth } from '../auth.ts';
import { invalidOrgRef } from '../orgRefs.ts';
import { scopeOwner, canWriteOwned } from '../scope.ts';
import { audit } from '../audit.ts';

// Solicitação de amostra (sample request). Ação de prospecção que vive SÓ dentro
// do funil (relationship_id obrigatório) — não é pedido. Relaciona um produto do
// catálogo (com snapshot do nome), opcionalmente um contato e um compromisso na
// agenda gerado na criação. Total/preço não importam aqui: é brinde/demonstração.

const SELECT = `
  SELECT s.id, s.relationship_id, s.catalog_item_id, s.produto_snapshot,
         s.contact_id, s.activity_id, s.owner_user_id, s.status, s.quantidade,
         s.data_solicitacao::text AS data_solicitacao, s.data_prevista::text AS data_prevista,
         s.notas, s.created_at,
         ci.codigo AS produto_codigo,
         ct.nome AS contato,
         a.titulo AS atividade_titulo, a.start_at AS atividade_start
  FROM sample_requests s
  LEFT JOIN catalog_items ci ON ci.id = s.catalog_item_id
  LEFT JOIN contacts ct ON ct.id = s.contact_id
  LEFT JOIN activities a ON a.id = s.activity_id`;

const STATUS = ['solicitada', 'enviada', 'recebida', 'cancelada'] as const;

const full = (id: number, orgId: number): Promise<Record<string, unknown> | null> =>
  one<Record<string, unknown>>(`${SELECT} WHERE s.id = $1 AND s.org_id = $2`, [id, orgId]);

// Dono da amostra para RBAC de escrita (rep só mexe na própria).
const findSample = (id: number, orgId: number): Promise<{ owner_user_id: string | null } | null> =>
  one('SELECT owner_user_id FROM sample_requests WHERE id = $1 AND org_id = $2', [id, orgId]);

export function sampleRequestRoutes(app: FastifyInstance): void {
  // Lista amostras de uma prospecção (ou da carteira toda). Escopo por dono.
  app.get('/api/sample-requests', {
    preHandler: requireAuth,
    schema: {
      querystring: {
        type: 'object',
        properties: {
          relationship_id: { type: 'integer' },
          status: { type: 'string', enum: [...STATUS] },
          owner_user_id: { type: 'integer' },
        },
      },
    },
  }, async (req) => {
    const orgId = req.auth!.orgId;
    const q = req.query as { relationship_id?: number; status?: string; owner_user_id?: number };
    const where: string[] = ['s.org_id = $1'];
    const params: unknown[] = [orgId];
    scopeOwner(req, where, params, 's.owner_user_id', q.owner_user_id);
    if (q.relationship_id !== undefined) { params.push(q.relationship_id); where.push(`s.relationship_id = $${params.length}`); }
    if (q.status) { params.push(q.status); where.push(`s.status = $${params.length}::sample_status`); }
    const rows = await query(`${SELECT} WHERE ${where.join(' AND ')} ORDER BY s.created_at DESC`, params);
    return { samples: rows };
  });

  app.post('/api/sample-requests', {
    preHandler: requireAuth,
    schema: {
      body: {
        type: 'object',
        required: ['relationship_id', 'catalog_item_id'],
        properties: {
          relationship_id: { type: 'integer' },
          catalog_item_id: { type: 'integer' },
          contact_id: { type: ['integer', 'null'] },
          quantidade: { type: ['number', 'null'], exclusiveMinimum: 0 },
          data_prevista: { type: ['string', 'null'] },
          notas: { type: ['string', 'null'] },
          // Compromisso de follow-up gerado junto (opcional).
          agenda: {
            type: ['object', 'null'],
            required: ['titulo', 'start_at'],
            properties: {
              titulo: { type: 'string', minLength: 1 },
              start_at: { type: 'string' },
              tipo: { type: 'string' },
            },
          },
        },
      },
    },
  }, async (req, reply) => {
    const orgId = req.auth!.orgId;
    const b = req.body as {
      relationship_id: number; catalog_item_id: number; contact_id?: number | null;
      quantidade?: number | null; data_prevista?: string | null; notas?: string | null;
      agenda?: { titulo: string; start_at: string; tipo?: string } | null;
    };
    // relationship_id NÃO entra no invalidOrgRef: o SELECT abaixo já é org-scoped
    // e devolve 404 (prospecção não encontrada) p/ id inexistente ou de outra org.
    const badRef = await invalidOrgRef(orgId, b as Record<string, unknown>,
      ['catalog_item_id', 'contact_id']);
    if (badRef) return reply.code(400).send({ error: `${badRef} inválido` });

    // A amostra herda dono e empresa da prospecção. Rep só cria na própria carteira.
    const rel = await one<{ owner_user_id: string | null; company_id: string }>(
      'SELECT owner_user_id, company_id FROM company_relationships WHERE id = $1 AND org_id = $2',
      [b.relationship_id, orgId],
    );
    if (!rel) return reply.code(404).send({ error: 'prospecção não encontrada' });
    if (!canWriteOwned(req, rel.owner_user_id === null ? null : Number(rel.owner_user_id))) {
      return reply.code(403).send({ error: 'prospecção de outro vendedor' });
    }
    const prod = await one<{ nome: string }>(
      'SELECT nome FROM catalog_items WHERE id = $1 AND org_id = $2', [b.catalog_item_id, orgId],
    );
    if (!prod) return reply.code(400).send({ error: 'catalog_item_id inválido' });

    const id = await withClient(async (c) => {
      await c.query('BEGIN');
      try {
        // Compromisso opcional: vinculado à empresa da prospecção e ao dono dela.
        let activityId: number | null = null;
        if (b.agenda) {
          const a = await c.query(
            `INSERT INTO activities (org_id, tipo, titulo, start_at, owner_user_id, company_id)
             VALUES ($1, COALESCE($2,'tarefa'), $3, $4, $5, $6) RETURNING id`,
            [orgId, b.agenda.tipo ?? null, b.agenda.titulo, b.agenda.start_at,
              rel.owner_user_id ?? req.auth!.userId, Number(rel.company_id)],
          );
          activityId = Number(a.rows[0].id);
        }
        const res = await c.query(
          `INSERT INTO sample_requests (org_id, relationship_id, catalog_item_id, produto_snapshot,
             contact_id, activity_id, owner_user_id, quantidade, data_prevista, notas)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
          [orgId, b.relationship_id, b.catalog_item_id, prod.nome,
            b.contact_id ?? null, activityId, rel.owner_user_id ?? req.auth!.userId,
            b.quantidade ?? null, b.data_prevista ?? null, b.notas ?? null],
        );
        await c.query('COMMIT');
        return Number(res.rows[0].id);
      } catch (e) {
        await c.query('ROLLBACK');
        throw e;
      }
    });
    await audit(req, 'sample_request', id, 'create',
      { relationship_id: b.relationship_id, catalog_item_id: b.catalog_item_id, agenda: !!b.agenda });
    return reply.code(201).send({ sample: await full(id, orgId) });
  });

  app.patch('/api/sample-requests/:id', {
    preHandler: requireAuth,
    schema: {
      params: { type: 'object', required: ['id'], properties: { id: { type: 'integer' } } },
      body: {
        type: 'object',
        properties: {
          status: { type: 'string', enum: [...STATUS] },
          contact_id: { type: ['integer', 'null'] },
          quantidade: { type: ['number', 'null'], exclusiveMinimum: 0 },
          data_prevista: { type: ['string', 'null'] },
          notas: { type: ['string', 'null'] },
        },
      },
    },
  }, async (req, reply) => {
    const orgId = req.auth!.orgId;
    const { id } = req.params as { id: number };
    const b = req.body as Record<string, unknown>;
    const current = await findSample(id, orgId);
    if (!current) return reply.code(404).send({ error: 'não encontrado' });
    if (!canWriteOwned(req, current.owner_user_id === null ? null : Number(current.owner_user_id))) {
      return reply.code(403).send({ error: 'amostra de outro vendedor' });
    }
    const badRef = await invalidOrgRef(orgId, b, ['contact_id']);
    if (badRef) return reply.code(400).send({ error: `${badRef} inválido` });
    const sets: string[] = [];
    const params: unknown[] = [];
    for (const k of ['status', 'contact_id', 'quantidade', 'data_prevista', 'notas'] as const) {
      if (k in b) {
        params.push(b[k]);
        sets.push(k === 'status' ? `${k} = $${params.length}::sample_status` : `${k} = $${params.length}`);
      }
    }
    if (sets.length === 0) return reply.code(400).send({ error: 'nada para atualizar' });
    params.push(id, orgId);
    const rows = await query(
      `UPDATE sample_requests SET ${sets.join(', ')}, updated_at = now()
       WHERE id = $${params.length - 1} AND org_id = $${params.length} RETURNING id`,
      params,
    );
    if (rows.length === 0) return reply.code(404).send({ error: 'não encontrado' });
    await audit(req, 'sample_request', id, 'update', b);
    return { sample: await full(id, orgId) };
  });

  app.delete('/api/sample-requests/:id', {
    preHandler: requireAuth,
    schema: { params: { type: 'object', required: ['id'], properties: { id: { type: 'integer' } } } },
  }, async (req, reply) => {
    const orgId = req.auth!.orgId;
    const { id } = req.params as { id: number };
    const current = await findSample(id, orgId);
    if (!current) return reply.code(404).send({ error: 'não encontrado' });
    if (!canWriteOwned(req, current.owner_user_id === null ? null : Number(current.owner_user_id))) {
      return reply.code(403).send({ error: 'amostra de outro vendedor' });
    }
    await query('DELETE FROM sample_requests WHERE id = $1 AND org_id = $2', [id, orgId]);
    await audit(req, 'sample_request', id, 'delete');
    return { deleted: true };
  });
}
