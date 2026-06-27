import type { FastifyInstance } from 'fastify';
import { query } from '../db.ts';
import { requireAuth } from '../auth.ts';
import { invalidOrgRef } from '../orgRefs.ts';

// Cadastros que alimentam os dropdowns da prospecção: marcas, contatos, cenários e ações.
export function cadastroRoutes(app: FastifyInstance): void {
  // ── Marcas das empresas representadas ──────────────────────
  app.get('/api/brands', {
    preHandler: requireAuth,
    schema: { querystring: { type: 'object', properties: { represented_id: { type: 'integer' } } } },
  }, async (req) => {
    const orgId = req.auth!.orgId;
    const { represented_id } = req.query as { represented_id?: number };
    const where = ['org_id = $1'];
    const params: unknown[] = [orgId];
    if (represented_id !== undefined) { params.push(represented_id); where.push(`represented_id = $${params.length}`); }
    const brands = await query(
      `SELECT id, represented_id, nome FROM represented_brands WHERE ${where.join(' AND ')} ORDER BY nome`,
      params,
    );
    return { brands };
  });

  app.post('/api/brands', {
    preHandler: requireAuth,
    schema: {
      body: {
        type: 'object',
        required: ['represented_id', 'nome'],
        properties: { represented_id: { type: 'integer' }, nome: { type: 'string', minLength: 1 } },
      },
    },
  }, async (req, reply) => {
    const orgId = req.auth!.orgId;
    const b = req.body as { represented_id: number; nome: string };
    // garante que a representada é da org
    const rows = await query(
      `INSERT INTO represented_brands (org_id, represented_id, nome)
       SELECT $1, $2, $3 WHERE EXISTS (SELECT 1 FROM represented_companies WHERE id = $2 AND org_id = $1)
       RETURNING id, represented_id, nome`,
      [orgId, b.represented_id, b.nome.trim()],
    );
    if (rows.length === 0) return reply.code(400).send({ error: 'representada inválida' });
    return reply.code(201).send({ brand: rows[0] });
  });

  app.delete('/api/brands/:id', {
    preHandler: requireAuth,
    schema: { params: { type: 'object', required: ['id'], properties: { id: { type: 'integer' } } } },
  }, async (req, reply) => {
    const orgId = req.auth!.orgId;
    const { id } = req.params as { id: number };
    const rows = await query('DELETE FROM represented_brands WHERE id = $1 AND org_id = $2 RETURNING id', [id, orgId]);
    if (rows.length === 0) return reply.code(404).send({ error: 'não encontrado' });
    return { deleted: true };
  });

  // ── Contatos ───────────────────────────────────────────────
  app.get('/api/contacts', {
    preHandler: requireAuth,
    schema: {
      querystring: {
        type: 'object',
        properties: { company_id: { type: 'integer' }, represented_id: { type: 'integer' } },
      },
    },
  }, async (req) => {
    const orgId = req.auth!.orgId;
    const { company_id, represented_id } = req.query as { company_id?: number; represented_id?: number };
    const where = ['org_id = $1'];
    const params: unknown[] = [orgId];
    if (company_id !== undefined) { params.push(company_id); where.push(`company_id = $${params.length}`); }
    if (represented_id !== undefined) { params.push(represented_id); where.push(`represented_id = $${params.length}`); }
    const contacts = await query(
      `SELECT id, nome, cargo, email, telefone, company_id, represented_id
       FROM contacts WHERE ${where.join(' AND ')} ORDER BY nome`,
      params,
    );
    return { contacts };
  });

  const contactBody = {
    nome: { type: 'string', minLength: 1 },
    cargo: { type: ['string', 'null'] },
    email: { type: ['string', 'null'] },
    telefone: { type: ['string', 'null'] },
    company_id: { type: ['integer', 'null'] },
    represented_id: { type: ['integer', 'null'] },
  } as const;
  const CONTACT_COLS = 'id, nome, cargo, email, telefone, company_id, represented_id';

  app.post('/api/contacts', {
    preHandler: requireAuth,
    schema: { body: { type: 'object', required: ['nome'], properties: { ...contactBody } } },
  }, async (req, reply) => {
    const orgId = req.auth!.orgId;
    const b = req.body as Record<string, unknown> & { nome: string };
    const badRef = await invalidOrgRef(orgId, b, ['represented_id']);
    if (badRef) return reply.code(400).send({ error: `${badRef} inválido` });
    const rows = await query(
      `INSERT INTO contacts (org_id, nome, cargo, email, telefone, company_id, represented_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING ${CONTACT_COLS}`,
      [orgId, b.nome, b.cargo ?? null, b.email ?? null, b.telefone ?? null,
        b.company_id ?? null, b.represented_id ?? null],
    );
    return reply.code(201).send({ contact: rows[0] });
  });

  app.patch('/api/contacts/:id', {
    preHandler: requireAuth,
    schema: {
      params: { type: 'object', required: ['id'], properties: { id: { type: 'integer' } } },
      body: { type: 'object', properties: { ...contactBody } },
    },
  }, async (req, reply) => {
    const orgId = req.auth!.orgId;
    const { id } = req.params as { id: number };
    const b = req.body as Record<string, unknown>;
    const badRef = await invalidOrgRef(orgId, b, ['represented_id']);
    if (badRef) return reply.code(400).send({ error: `${badRef} inválido` });
    const sets: string[] = [];
    const params: unknown[] = [];
    for (const k of ['nome', 'cargo', 'email', 'telefone', 'company_id', 'represented_id']) {
      if (k in b) { params.push(b[k]); sets.push(`${k} = $${params.length}`); }
    }
    if (sets.length === 0) return reply.code(400).send({ error: 'nada para atualizar' });
    params.push(id); const idIdx = params.length;
    params.push(orgId); const orgIdx = params.length;
    const rows = await query(
      `UPDATE contacts SET ${sets.join(', ')} WHERE id = $${idIdx} AND org_id = $${orgIdx} RETURNING ${CONTACT_COLS}`,
      params,
    );
    if (rows.length === 0) return reply.code(404).send({ error: 'não encontrado' });
    return { contact: rows[0] };
  });

  app.delete('/api/contacts/:id', {
    preHandler: requireAuth,
    schema: { params: { type: 'object', required: ['id'], properties: { id: { type: 'integer' } } } },
  }, async (req, reply) => {
    const orgId = req.auth!.orgId;
    const { id } = req.params as { id: number };
    const rows = await query('DELETE FROM contacts WHERE id = $1 AND org_id = $2 RETURNING id', [id, orgId]);
    if (rows.length === 0) return reply.code(404).send({ error: 'não encontrado' });
    return { deleted: true };
  });

  // ── Listas simples: cenários e ações (nome só) ─────────────
  registerSimpleList(app, 'scenarios', 'funnel_scenarios');
  registerSimpleList(app, 'actions', 'funnel_actions');
}

// CRUD mínimo para tabelas {id, org_id, nome}. `table` é interpolado no SQL —
// o union literal garante em compile-time que só essas duas tabelas entram.
function registerSimpleList(
  app: FastifyInstance,
  path: 'scenarios' | 'actions',
  table: 'funnel_scenarios' | 'funnel_actions',
): void {
  app.get(`/api/${path}`, { preHandler: requireAuth }, async (req) => {
    const orgId = req.auth!.orgId;
    const items = await query(`SELECT id, nome FROM ${table} WHERE org_id = $1 ORDER BY nome`, [orgId]);
    return { items };
  });

  app.post(`/api/${path}`, {
    preHandler: requireAuth,
    schema: { body: { type: 'object', required: ['nome'], properties: { nome: { type: 'string', minLength: 1 } } } },
  }, async (req, reply) => {
    const orgId = req.auth!.orgId;
    const { nome } = req.body as { nome: string };
    const rows = await query(`INSERT INTO ${table} (org_id, nome) VALUES ($1,$2) RETURNING id, nome`, [orgId, nome.trim()]);
    return reply.code(201).send({ item: rows[0] });
  });

  app.patch(`/api/${path}/:id`, {
    preHandler: requireAuth,
    schema: {
      params: { type: 'object', required: ['id'], properties: { id: { type: 'integer' } } },
      body: { type: 'object', required: ['nome'], properties: { nome: { type: 'string', minLength: 1 } } },
    },
  }, async (req, reply) => {
    const orgId = req.auth!.orgId;
    const { id } = req.params as { id: number };
    const { nome } = req.body as { nome: string };
    const rows = await query(`UPDATE ${table} SET nome = $1 WHERE id = $2 AND org_id = $3 RETURNING id, nome`, [nome.trim(), id, orgId]);
    if (rows.length === 0) return reply.code(404).send({ error: 'não encontrado' });
    return { item: rows[0] };
  });

  app.delete(`/api/${path}/:id`, {
    preHandler: requireAuth,
    schema: { params: { type: 'object', required: ['id'], properties: { id: { type: 'integer' } } } },
  }, async (req, reply) => {
    const orgId = req.auth!.orgId;
    const { id } = req.params as { id: number };
    const rows = await query(`DELETE FROM ${table} WHERE id = $1 AND org_id = $2 RETURNING id`, [id, orgId]);
    if (rows.length === 0) return reply.code(404).send({ error: 'não encontrado' });
    return { deleted: true };
  });
}
