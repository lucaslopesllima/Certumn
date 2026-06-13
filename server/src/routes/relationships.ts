import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { one, query, withClient } from '../db.ts';
import { requireAuth, requireAdmin } from '../auth.ts';
import { audit, pick } from '../audit.ts';
import { invalidOrgRef } from '../orgRefs.ts';
import { scopeOwner, canWriteOwned, invalidOwnerAssignment } from '../scope.ts';

// company_relationships is the tenant's REFERENCE into the global companies pool.
// Creating/updating one NEVER writes the companies table.

// Mutable prospecção fields shared by POST/PATCH allow-lists. Most are FKs into cadastros
// (representada, marca, contato, cenário, ação); só `notas` é texto livre. Dates são `date`.
const EDITABLE = [
  'stage_id', 'status', 'valor_estimado', 'notas', 'owner_user_id',
  'represented_id', 'marca_id', 'cenario_id', 'acao_id',
  'data_contato', 'previsao_data',
] as const;

// Columns returned to the client. Dates cast to text so pg keeps 'YYYY-MM-DD' (no TZ shift).
const REL_COLS = `r.id, r.company_id, r.stage_id, r.status, r.valor_estimado, r.notas,
  r.represented_id, r.marca_id, r.cenario_id, r.acao_id,
  r.data_contato::text AS data_contato, r.previsao_data::text AS previsao_data`;

// Joined labels for the dropdown values + lista de contatos (N:N) agregada como JSON.
const REL_LABELS = `rc.nome AS representada, mb.nome AS marca,
  cen.nome AS cenario, act.nome AS acao,
  COALESCE((
    SELECT json_agg(json_build_object('id', ct.id, 'nome', ct.nome, 'cargo', ct.cargo) ORDER BY ct.nome)
    FROM relationship_contacts rcj JOIN contacts ct ON ct.id = rcj.contact_id
    WHERE rcj.relationship_id = r.id
  ), '[]') AS contatos,
  COALESCE((
    SELECT json_agg(json_build_object('id', ci.id, 'nome', ci.nome, 'codigo', ci.codigo, 'preco', ci.preco) ORDER BY ci.nome)
    FROM relationship_catalog rcc JOIN catalog_items ci ON ci.id = rcc.catalog_item_id
    WHERE rcc.relationship_id = r.id
  ), '[]') AS catalogo`;

// JOINs that resolve the FK labels above. Reused by GET /relationships and /kanban.
// org no join: rótulo de outra org nunca resolve, mesmo que um id alheio escape.
const REL_JOINS = `LEFT JOIN represented_companies rc ON rc.id = r.represented_id AND rc.org_id = r.org_id
  LEFT JOIN represented_brands mb ON mb.id = r.marca_id   AND mb.org_id = r.org_id
  LEFT JOIN funnel_scenarios cen ON cen.id = r.cenario_id AND cen.org_id = r.org_id
  LEFT JOIN funnel_actions act ON act.id = r.acao_id      AND act.org_id = r.org_id`;

// JSON-schema for the mutable fields, shared by POST/PATCH bodies.
const EDITABLE_SCHEMA = {
  stage_id: { type: ['integer', 'null'] },
  status: { type: 'string', enum: ['prospect', 'cliente', 'descartado'] },
  valor_estimado: { type: ['number', 'null'] },
  notas: { type: ['string', 'null'] },
  owner_user_id: { type: ['integer', 'null'] },
  represented_id: { type: ['integer', 'null'] },
  marca_id: { type: ['integer', 'null'] },
  cenario_id: { type: ['integer', 'null'] },
  acao_id: { type: ['integer', 'null'] },
  data_contato: { type: ['string', 'null'] },
  previsao_data: { type: ['string', 'null'] },
  contato_ids: { type: 'array', items: { type: 'integer' } },
  catalogo_ids: { type: 'array', items: { type: 'integer' } },
} as const;

// RETURNING list (no table alias — used in INSERT/UPDATE), dates cast to text.
const RET_COLS = `id, company_id, stage_id, status, valor_estimado, notas, owner_user_id,
  represented_id, marca_id, cenario_id, acao_id,
  data_contato::text AS data_contato, previsao_data::text AS previsao_data`;

// Sincroniza os contatos da prospecção (N:N). Valida que rel e contatos são da org.
// Recebe o client da transação do PATCH — DELETE+INSERT são atômicos com o UPDATE.
async function syncContatos(c: pg.PoolClient, relId: number, orgId: number, ids: number[]): Promise<void> {
  await c.query(
    `DELETE FROM relationship_contacts WHERE relationship_id = $1
     AND EXISTS (SELECT 1 FROM company_relationships r WHERE r.id = $1 AND r.org_id = $2)`,
    [relId, orgId],
  );
  if (ids.length > 0) {
    await c.query(
      `INSERT INTO relationship_contacts (relationship_id, contact_id)
       SELECT $1, c.id FROM contacts c
       WHERE c.id = ANY($2::bigint[]) AND c.org_id = $3
         AND EXISTS (SELECT 1 FROM company_relationships r WHERE r.id = $1 AND r.org_id = $3)
       ON CONFLICT DO NOTHING`,
      [relId, ids, orgId],
    );
  }
}

// Sincroniza os itens de catálogo da prospecção (N:N). Valida org.
async function syncCatalogo(c: pg.PoolClient, relId: number, orgId: number, ids: number[]): Promise<void> {
  await c.query(
    `DELETE FROM relationship_catalog WHERE relationship_id = $1
     AND EXISTS (SELECT 1 FROM company_relationships r WHERE r.id = $1 AND r.org_id = $2)`,
    [relId, orgId],
  );
  if (ids.length > 0) {
    await c.query(
      `INSERT INTO relationship_catalog (relationship_id, catalog_item_id)
       SELECT $1, ci.id FROM catalog_items ci
       WHERE ci.id = ANY($2::bigint[]) AND ci.org_id = $3
         AND EXISTS (SELECT 1 FROM company_relationships r WHERE r.id = $1 AND r.org_id = $3)
       ON CONFLICT DO NOTHING`,
      [relId, ids, orgId],
    );
  }
}

export function relationshipRoutes(app: FastifyInstance): void {
  // My funnel: relationships JOIN companies WHERE org_id = me.
  app.get('/api/relationships', {
    preHandler: requireAuth,
    schema: {
      querystring: {
        type: 'object',
        properties: {
          stage_id: { type: 'integer' },
          status: { type: 'string' },
          q: { type: 'string' },
          owner_user_id: { type: 'integer' },
          limit: { type: 'integer', minimum: 1, maximum: 200, default: 100 },
          offset: { type: 'integer', minimum: 0, default: 0 },
        },
      },
    },
  }, async (req) => {
    const orgId = req.auth!.orgId;
    const { stage_id, status, q, owner_user_id, limit = 100, offset = 0 } = req.query as {
      stage_id?: number; status?: string; q?: string; owner_user_id?: number; limit?: number; offset?: number;
    };
    const where: string[] = ['r.org_id = $1'];
    const params: unknown[] = [orgId];
    scopeOwner(req, where, params, 'r.owner_user_id', owner_user_id);
    if (stage_id !== undefined) { params.push(stage_id); where.push(`r.stage_id = $${params.length}`); }
    if (status) { params.push(status); where.push(`r.status = $${params.length}::rel_status`); }
    if (q) { params.push(`%${q}%`); where.push(`(c.razao_social ILIKE $${params.length} OR c.nome_fantasia ILIKE $${params.length})`); }
    params.push(limit); const limIdx = params.length;
    params.push(offset); const offIdx = params.length;

    const rows = await query(
      `SELECT ${REL_COLS}, r.owner_user_id, r.updated_at, ${REL_LABELS},
              c.razao_social, c.nome_fantasia, c.cnpj, c.cnae_principal, c.municipio_id, c.uf,
              ST_Y(c.geom::geometry) AS lat, ST_X(c.geom::geometry) AS lon
       FROM company_relationships r
       JOIN companies c ON c.id = r.company_id
       ${REL_JOINS}
       WHERE ${where.join(' AND ')}
       ORDER BY r.updated_at DESC
       LIMIT $${limIdx} OFFSET $${offIdx}`,
      params,
    );
    return { relationships: rows };
  });

  // Add a company from the global pool to my funnel (create a reference).
  app.post('/api/relationships', {
    preHandler: requireAuth,
    schema: {
      body: {
        type: 'object',
        required: ['company_id'],
        properties: { company_id: { type: 'integer' }, ...EDITABLE_SCHEMA },
      },
    },
  }, async (req, reply) => {
    const orgId = req.auth!.orgId;
    const b = req.body as Record<string, unknown> & { company_id: number };

    const company = await one('SELECT id FROM companies WHERE id = $1', [b.company_id]);
    if (!company) return reply.code(404).send({ error: 'empresa não existe na base' });

    if (invalidOwnerAssignment(req, b)) {
      return reply.code(403).send({ error: 'vendedor não atribui carteira a outro usuário' });
    }

    const badRef = await invalidOrgRef(orgId, b,
      ['owner_user_id', 'represented_id', 'marca_id', 'cenario_id', 'acao_id']);
    if (badRef) return reply.code(400).send({ error: `${badRef} inválido` });

    // default stage = first stage of the org
    let stageId = (b.stage_id as number | null | undefined) ?? null;
    if (stageId === null) {
      const s = await one<{ id: number }>('SELECT id FROM stages WHERE org_id = $1 ORDER BY ordem LIMIT 1', [orgId]);
      stageId = s?.id ?? null;
    } else {
      // validate stage belongs to org
      const s = await one('SELECT id FROM stages WHERE id = $1 AND org_id = $2', [stageId, orgId]);
      if (!s) return reply.code(400).send({ error: 'stage inválido' });
    }

    // Base columns always set; extra editable fields appended when present in body.
    const cols = ['org_id', 'company_id', 'owner_user_id', 'stage_id', 'status'];
    const vals: unknown[] = [orgId, b.company_id, b.owner_user_id ?? req.auth!.userId, stageId, b.status ?? null];
    const ph = ['$1', '$2', '$3', '$4', `COALESCE($5::rel_status,'prospect')`];
    for (const k of EDITABLE) {
      if (k === 'stage_id' || k === 'status' || k === 'owner_user_id') continue; // handled above
      if (k in b) { vals.push(b[k]); cols.push(k); ph.push(`$${vals.length}`); }
    }

    try {
      const rows = await query(
        `INSERT INTO company_relationships (${cols.join(', ')})
         VALUES (${ph.join(', ')})
         RETURNING ${RET_COLS}`,
        vals,
      );
      await audit(req, 'relationship', (rows[0] as { id: number }).id, 'create',
        { company_id: b.company_id, ...pick(b, EDITABLE) });
      return reply.code(201).send({ relationship: rows[0] });
    } catch (e: unknown) {
      if (e && typeof e === 'object' && (e as { code?: string }).code === '23505') {
        return reply.code(409).send({ error: 'empresa já está no seu funil' });
      }
      throw e;
    }
  });

  // Update relationship state (kanban move, status, value, notes, owner).
  app.patch('/api/relationships/:id', {
    preHandler: requireAuth,
    schema: {
      params: { type: 'object', required: ['id'], properties: { id: { type: 'integer' } } },
      body: { type: 'object', properties: { ...EDITABLE_SCHEMA } },
    },
  }, async (req, reply) => {
    const orgId = req.auth!.orgId;
    const { id } = req.params as { id: number };
    const b = req.body as Record<string, unknown>;

    const hasContatos = Array.isArray(b.contato_ids);
    const hasCatalogo = Array.isArray(b.catalogo_ids);

    // RBAC de carteira: rep só edita o próprio registro e não o repassa a outro.
    const current = await one<{ owner_user_id: string | null }>(
      'SELECT owner_user_id FROM company_relationships WHERE id = $1 AND org_id = $2', [id, orgId],
    );
    if (!current) return reply.code(404).send({ error: 'não encontrado' });
    if (!canWriteOwned(req, current.owner_user_id === null ? null : Number(current.owner_user_id))) {
      return reply.code(403).send({ error: 'registro de outro vendedor' });
    }
    if (invalidOwnerAssignment(req, b)) {
      return reply.code(403).send({ error: 'vendedor não atribui carteira a outro usuário' });
    }

    const badRef = await invalidOrgRef(orgId, b,
      ['owner_user_id', 'represented_id', 'marca_id', 'cenario_id', 'acao_id']);
    if (badRef) return reply.code(400).send({ error: `${badRef} inválido` });

    const sets: string[] = [];
    const params: unknown[] = [];
    for (const k of EDITABLE) {
      if (k in b) {
        params.push(b[k]);
        sets.push(k === 'status' ? `${k} = $${params.length}::rel_status` : `${k} = $${params.length}`);
      }
    }
    if (sets.length === 0 && !hasContatos && !hasCatalogo) return reply.code(400).send({ error: 'nada para atualizar' });

    // UPDATE + syncs numa transação só: falha no meio não deixa estado parcial.
    const row = await withClient(async (c) => {
      await c.query('BEGIN');
      try {
        let r: Record<string, unknown> | undefined;
        if (sets.length > 0) {
          const p = [...params];
          p.push(id); const idIdx = p.length;
          p.push(orgId); const orgIdx = p.length;
          const rows = (await c.query(
            `UPDATE company_relationships SET ${sets.join(', ')}, updated_at = now()
             WHERE id = $${idIdx} AND org_id = $${orgIdx}
             RETURNING ${RET_COLS}`,
            p,
          )).rows as Record<string, unknown>[];
          r = rows[0];
        } else {
          const rows = (await c.query(
            `SELECT ${RET_COLS} FROM company_relationships WHERE id = $1 AND org_id = $2`, [id, orgId],
          )).rows as Record<string, unknown>[];
          r = rows[0];
        }
        if (r) {
          if (hasContatos) await syncContatos(c, id, orgId, b.contato_ids as number[]);
          if (hasCatalogo) await syncCatalogo(c, id, orgId, b.catalogo_ids as number[]);
        }
        await c.query('COMMIT');
        return r;
      } catch (e) {
        await c.query('ROLLBACK');
        throw e;
      }
    });
    if (!row) return reply.code(404).send({ error: 'não encontrado' });

    await audit(req, 'relationship', id, 'update', pick(b, [...EDITABLE, 'contato_ids', 'catalogo_ids']));
    return { relationship: row };
  });

  app.delete('/api/relationships/:id', {
    preHandler: requireAuth,
    schema: { params: { type: 'object', required: ['id'], properties: { id: { type: 'integer' } } } },
  }, async (req, reply) => {
    const orgId = req.auth!.orgId;
    const { id } = req.params as { id: number };
    const current = await one<{ owner_user_id: string | null }>(
      'SELECT owner_user_id FROM company_relationships WHERE id = $1 AND org_id = $2', [id, orgId],
    );
    if (!current) return reply.code(404).send({ error: 'não encontrado' });
    if (!canWriteOwned(req, current.owner_user_id === null ? null : Number(current.owner_user_id))) {
      return reply.code(403).send({ error: 'registro de outro vendedor' });
    }
    const rows = await query('DELETE FROM company_relationships WHERE id = $1 AND org_id = $2 RETURNING id', [id, orgId]);
    if (rows.length === 0) return reply.code(404).send({ error: 'não encontrado' });
    await audit(req, 'relationship', id, 'delete');
    return { deleted: true };
  });

  // Transferência de carteira (Fase 3): em lote (ids) ou total (sem ids —
  // desligamento de vendedor). Admin only; auditada com a contagem e os ids.
  app.post('/api/relationships/transfer', {
    preHandler: [requireAuth, requireAdmin],
    schema: {
      body: {
        type: 'object',
        required: ['from_user_id', 'to_user_id'],
        properties: {
          from_user_id: { type: 'integer' },
          to_user_id: { type: 'integer' },
          ids: { type: 'array', items: { type: 'integer' }, minItems: 1 },
        },
      },
    },
  }, async (req, reply) => {
    const orgId = req.auth!.orgId;
    const b = req.body as { from_user_id: number; to_user_id: number; ids?: number[] };
    if (b.from_user_id === b.to_user_id) {
      return reply.code(400).send({ error: 'origem e destino são o mesmo usuário' });
    }
    const badRef = await invalidOrgRef(orgId, b, ['from_user_id', 'to_user_id']);
    if (badRef) return reply.code(400).send({ error: `${badRef} inválido` });

    const params: unknown[] = [b.to_user_id, orgId, b.from_user_id];
    let filtroIds = '';
    if (b.ids) { params.push(b.ids); filtroIds = ` AND id = ANY($${params.length}::bigint[])`; }
    const rows = await query<{ id: string }>(
      `UPDATE company_relationships SET owner_user_id = $1, updated_at = now()
       WHERE org_id = $2 AND owner_user_id = $3${filtroIds}
       RETURNING id`,
      params,
    );
    const ids = rows.map((r) => Number(r.id));
    await audit(req, 'relationship', 0, 'transfer', {
      from_user_id: b.from_user_id, to_user_id: b.to_user_id, count: ids.length, ids,
    });
    return { transferred: ids.length, ids };
  });

  // Kanban board: stages + cards (relationships) grouped by stage.
  // Rep vê só a própria carteira; admin vê tudo + filtro por vendedor.
  app.get('/api/kanban', {
    preHandler: requireAuth,
    schema: {
      querystring: {
        type: 'object',
        properties: { owner_user_id: { type: 'integer' } },
      },
    },
  }, async (req) => {
    const orgId = req.auth!.orgId;
    const { owner_user_id } = req.query as { owner_user_id?: number };
    const stages = await query('SELECT id, nome, ordem FROM stages WHERE org_id = $1 ORDER BY ordem', [orgId]);
    const where: string[] = ['r.org_id = $1'];
    const params: unknown[] = [orgId];
    scopeOwner(req, where, params, 'r.owner_user_id', owner_user_id);
    const cards = await query(
      `SELECT ${REL_COLS}, r.owner_user_id, ${REL_LABELS},
              c.razao_social, c.nome_fantasia, c.uf, c.municipio_id, m.nome AS cidade,
              c.cnpj, c.cnae_principal, c.porte, c.capital_social
       FROM company_relationships r
       JOIN companies c ON c.id = r.company_id
       LEFT JOIN municipios m ON m.id = c.municipio_id
       ${REL_JOINS}
       WHERE ${where.join(' AND ')}
       ORDER BY r.updated_at DESC`,
      params,
    );
    return { stages, cards };
  });
}
