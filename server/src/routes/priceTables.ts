import type { FastifyInstance } from 'fastify';
import { query, one, withClient } from '../db.ts';
import { requireAuth } from '../auth.ts';
import { audit, pick } from '../audit.ts';
import { invalidOrgRef } from '../orgRefs.ts';

// Tabelas de preço por representada (Fase 1). O pedido copia o preço na
// criação (snapshot em order_items) — editar tabela não afeta pedido emitido.

const COLS = 't.id, t.represented_id, t.nome, t.vigencia_inicio, t.vigencia_fim, t.ativo, t.created_at';
const SELECT = `
  SELECT ${COLS}, r.nome AS represented_nome,
         (SELECT count(*)::int FROM price_table_items i WHERE i.price_table_id = t.id) AS itens
  FROM price_tables t
  JOIN represented_companies r ON r.id = t.represented_id`;

const FIELDS = ['represented_id', 'nome', 'vigencia_inicio', 'vigencia_fim', 'ativo'] as const;

const ITEM_SCHEMA = {
  type: 'object',
  required: ['catalog_item_id', 'preco'],
  properties: {
    catalog_item_id: { type: 'integer' },
    preco: { type: 'number', minimum: 0 },
    desconto_max_pct: { type: ['number', 'null'], minimum: 0, maximum: 100 },
  },
} as const;

async function tableItems(tableId: number): Promise<unknown[]> {
  return query(
    `SELECT i.id, i.catalog_item_id, i.preco, i.desconto_max_pct, c.nome AS catalog_nome, c.codigo
     FROM price_table_items i JOIN catalog_items c ON c.id = i.catalog_item_id
     WHERE i.price_table_id = $1 ORDER BY c.nome`,
    [tableId],
  );
}

// Todos os catalog_item_id do payload precisam ser da org — sem isso um tenant
// referencia produto alheio na própria tabela.
async function invalidCatalogIds(orgId: number, items: { catalog_item_id: number }[]): Promise<boolean> {
  if (items.length === 0) return false;
  const ids = items.map((i) => i.catalog_item_id);
  const rows = await query<{ id: string }>(
    'SELECT id FROM catalog_items WHERE org_id = $1 AND id = ANY($2)', [orgId, ids],
  );
  const ok = new Set(rows.map((r) => Number(r.id)));
  return ids.some((id) => !ok.has(id));
}

async function replaceItems(tableId: number, items: { catalog_item_id: number; preco: number; desconto_max_pct?: number | null }[]): Promise<void> {
  await withClient(async (c) => {
    await c.query('BEGIN');
    try {
      await c.query('DELETE FROM price_table_items WHERE price_table_id = $1', [tableId]);
      for (const it of items) {
        await c.query(
          'INSERT INTO price_table_items (price_table_id, catalog_item_id, preco, desconto_max_pct) VALUES ($1,$2,$3,$4)',
          [tableId, it.catalog_item_id, it.preco, it.desconto_max_pct ?? null],
        );
      }
      await c.query('COMMIT');
    } catch (e) {
      await c.query('ROLLBACK');
      throw e;
    }
  });
}

export function priceTableRoutes(app: FastifyInstance): void {
  app.get('/api/price-tables', {
    preHandler: requireAuth,
    schema: {
      querystring: { type: 'object', properties: { represented_id: { type: 'integer' } } },
    },
  }, async (req) => {
    const orgId = req.auth!.orgId;
    const { represented_id } = req.query as { represented_id?: number };
    const where: string[] = ['t.org_id = $1'];
    const params: unknown[] = [orgId];
    if (represented_id !== undefined) {
      params.push(represented_id);
      where.push(`t.represented_id = $${params.length}`);
    }
    const tables = await query(
      `${SELECT} WHERE ${where.join(' AND ')} ORDER BY t.ativo DESC, t.vigencia_inicio DESC, t.id DESC`,
      params,
    );
    return { tables };
  });

  // Tabela vigente hoje para a representada: ativa, início <= hoje <= fim
  // (fim NULL = aberta). Empate resolve pela vigência mais recente.
  app.get('/api/price-tables/active', {
    preHandler: requireAuth,
    schema: {
      querystring: {
        type: 'object',
        required: ['represented_id'],
        properties: { represented_id: { type: 'integer' } },
      },
    },
  }, async (req) => {
    const orgId = req.auth!.orgId;
    const { represented_id } = req.query as { represented_id: number };
    const table = await one<{ id: number }>(
      `${SELECT}
       WHERE t.org_id = $1 AND t.represented_id = $2 AND t.ativo
         AND t.vigencia_inicio <= CURRENT_DATE
         AND (t.vigencia_fim IS NULL OR t.vigencia_fim >= CURRENT_DATE)
       ORDER BY t.vigencia_inicio DESC, t.id DESC LIMIT 1`,
      [orgId, represented_id],
    );
    if (!table) return { table: null };
    return { table: { ...table, items: await tableItems(table.id) } };
  });

  app.get('/api/price-tables/:id', {
    preHandler: requireAuth,
    schema: { params: { type: 'object', required: ['id'], properties: { id: { type: 'integer' } } } },
  }, async (req, reply) => {
    const orgId = req.auth!.orgId;
    const { id } = req.params as { id: number };
    const table = await one<{ id: number }>(`${SELECT} WHERE t.id = $1 AND t.org_id = $2`, [id, orgId]);
    if (!table) return reply.code(404).send({ error: 'não encontrada' });
    return { table: { ...table, items: await tableItems(table.id) } };
  });

  app.post('/api/price-tables', {
    preHandler: requireAuth,
    schema: {
      body: {
        type: 'object',
        required: ['represented_id', 'nome', 'vigencia_inicio'],
        properties: {
          represented_id: { type: 'integer' },
          nome: { type: 'string', minLength: 1 },
          vigencia_inicio: { type: 'string' },
          vigencia_fim: { type: ['string', 'null'] },
          ativo: { type: 'boolean' },
          items: { type: 'array', items: ITEM_SCHEMA },
        },
      },
    },
  }, async (req, reply) => {
    const orgId = req.auth!.orgId;
    const b = req.body as Record<string, unknown> & { items?: { catalog_item_id: number; preco: number; desconto_max_pct?: number | null }[] };
    const badRef = await invalidOrgRef(orgId, b, ['represented_id']);
    if (badRef) return reply.code(400).send({ error: `${badRef} inválido` });
    const items = b.items ?? [];
    if (await invalidCatalogIds(orgId, items)) {
      return reply.code(400).send({ error: 'catalog_item_id inválido' });
    }
    const row = await one<{ id: number }>(
      `INSERT INTO price_tables (org_id, represented_id, nome, vigencia_inicio, vigencia_fim, ativo)
       VALUES ($1,$2,$3,$4,$5,COALESCE($6,true)) RETURNING id`,
      [orgId, b.represented_id, b.nome, b.vigencia_inicio, b.vigencia_fim ?? null, b.ativo ?? null],
    );
    const newId = Number(row!.id);
    await replaceItems(newId, items);
    await audit(req, 'price_table', newId, 'create', pick(b, FIELDS));
    const table = await one<{ id: number }>(`${SELECT} WHERE t.id = $1`, [newId]);
    return reply.code(201).send({ table: { ...table!, items: await tableItems(newId) } });
  });

  app.patch('/api/price-tables/:id', {
    preHandler: requireAuth,
    schema: {
      params: { type: 'object', required: ['id'], properties: { id: { type: 'integer' } } },
      body: {
        type: 'object',
        properties: {
          represented_id: { type: 'integer' },
          nome: { type: 'string', minLength: 1 },
          vigencia_inicio: { type: 'string' },
          vigencia_fim: { type: ['string', 'null'] },
          ativo: { type: 'boolean' },
        },
      },
    },
  }, async (req, reply) => {
    const orgId = req.auth!.orgId;
    const { id } = req.params as { id: number };
    const b = req.body as Record<string, unknown>;
    const badRef = await invalidOrgRef(orgId, b, ['represented_id']);
    if (badRef) return reply.code(400).send({ error: `${badRef} inválido` });
    const sets: string[] = [];
    const params: unknown[] = [];
    for (const k of FIELDS) {
      if (k in b) { params.push(b[k]); sets.push(`${k} = $${params.length}`); }
    }
    if (sets.length === 0) return reply.code(400).send({ error: 'nada para atualizar' });
    params.push(id, orgId);
    const rows = await query(
      `UPDATE price_tables SET ${sets.join(', ')}
       WHERE id = $${params.length - 1} AND org_id = $${params.length} RETURNING id`,
      params,
    );
    if (rows.length === 0) return reply.code(404).send({ error: 'não encontrada' });
    await audit(req, 'price_table', id, 'update', pick(b, FIELDS));
    const table = await one<{ id: number }>(`${SELECT} WHERE t.id = $1`, [id]);
    return { table: { ...table!, items: await tableItems(id) } };
  });

  // Substitui TODOS os itens da tabela (a UI edita a lista inteira de uma vez).
  app.put('/api/price-tables/:id/items', {
    preHandler: requireAuth,
    schema: {
      params: { type: 'object', required: ['id'], properties: { id: { type: 'integer' } } },
      body: {
        type: 'object',
        required: ['items'],
        properties: { items: { type: 'array', items: ITEM_SCHEMA } },
      },
    },
  }, async (req, reply) => {
    const orgId = req.auth!.orgId;
    const { id } = req.params as { id: number };
    const { items } = req.body as { items: { catalog_item_id: number; preco: number; desconto_max_pct?: number | null }[] };
    const table = await one('SELECT id FROM price_tables WHERE id = $1 AND org_id = $2', [id, orgId]);
    if (!table) return reply.code(404).send({ error: 'não encontrada' });
    if (await invalidCatalogIds(orgId, items)) {
      return reply.code(400).send({ error: 'catalog_item_id inválido' });
    }
    await replaceItems(id, items);
    await audit(req, 'price_table', id, 'update', { items: items.length });
    return { items: await tableItems(id) };
  });

  app.delete('/api/price-tables/:id', {
    preHandler: requireAuth,
    schema: { params: { type: 'object', required: ['id'], properties: { id: { type: 'integer' } } } },
  }, async (req, reply) => {
    const orgId = req.auth!.orgId;
    const { id } = req.params as { id: number };
    const rows = await query('DELETE FROM price_tables WHERE id = $1 AND org_id = $2 RETURNING id', [id, orgId]);
    if (rows.length === 0) return reply.code(404).send({ error: 'não encontrada' });
    await audit(req, 'price_table', id, 'delete');
    return { deleted: true };
  });
}
