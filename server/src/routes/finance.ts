import type { FastifyInstance } from 'fastify';
import { query } from '../db.ts';
import { requireAuth, requireAdmin } from '../auth.ts';
import { audit, pick } from '../audit.ts';
import { invalidOrgRef } from '../orgRefs.ts';
import { materializeRecurrences } from '../recurrence.ts';

// Módulo financeiro: contas a pagar/receber, org-scoped. SQL parametrizado, sem ORM.
// Vínculos opcionais: empresa prospect (companies), empresa representada
// (represented_companies), compromisso (activities) e rota (routes, despesa de
// viagem) — todos LEFT JOIN p/ rótulos. Lançamentos com `recorrencia` são modelos
// mensais materializados por recurrence.ts.

const SELECT = `
  SELECT f.id, f.kind, f.descricao, f.valor, f.vencimento, f.liquidacao_data, f.status,
         f.categoria, f.categoria_id, f.notas, f.company_id, f.represented_id, f.activity_id,
         f.owner_user_id, f.route_id, f.recorrencia, f.recorrencia_fim, f.recorrencia_origem_id,
         f.created_at,
         c.razao_social  AS company_nome,
         r.nome          AS represented_nome,
         a.titulo        AS activity_titulo,
         rt.nome         AS route_nome,
         fc.nome         AS categoria_nome,
         fc.grupo_dre    AS categoria_grupo_dre
  FROM finance_entries f
  LEFT JOIN companies c            ON c.id = f.company_id
  LEFT JOIN represented_companies r ON r.id = f.represented_id AND r.org_id = f.org_id
  LEFT JOIN activities a            ON a.id = f.activity_id    AND a.org_id = f.org_id
  LEFT JOIN routes rt               ON rt.id = f.route_id      AND rt.org_id = f.org_id
  LEFT JOIN finance_categories fc   ON fc.id = f.categoria_id  AND fc.org_id = f.org_id`;

// Campos editáveis (mesma lista no POST e no PATCH dinâmico).
const FIELDS = ['kind', 'descricao', 'valor', 'vencimento', 'liquidacao_data', 'status',
  'categoria', 'categoria_id', 'notas', 'company_id', 'represented_id', 'activity_id', 'owner_user_id',
  'route_id', 'recorrencia', 'recorrencia_fim'] as const;

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
          route_id: { type: ['integer', 'null'] },
          categoria_id: { type: ['integer', 'null'] },
          recorrencia: { type: ['string', 'null'] },
          recorrencia_fim: { type: ['string', 'null'] },
        },
      },
    },
  }, async (req, reply) => {
    const orgId = req.auth!.orgId;
    const b = req.body as Record<string, unknown>;
    const badRef = await invalidOrgRef(orgId, b, ['represented_id', 'activity_id', 'owner_user_id', 'route_id', 'categoria_id']);
    if (badRef) return reply.code(400).send({ error: `${badRef} inválido` });
    const rows = await query(
      `INSERT INTO finance_entries
        (org_id, kind, descricao, valor, vencimento, liquidacao_data, status,
         categoria, categoria_id, notas, company_id, represented_id, activity_id, owner_user_id,
         route_id, recorrencia, recorrencia_fim)
       VALUES ($1, $2::finance_kind, $3, $4, $5, $6, COALESCE($7::finance_status,'pendente'),
               $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
       RETURNING id`,
      [orgId, b.kind, b.descricao, b.valor, b.vencimento, b.liquidacao_data ?? null,
        b.status ?? null, b.categoria ?? null, b.categoria_id ?? null, b.notas ?? null,
        b.company_id ?? null, b.represented_id ?? null, b.activity_id ?? null, req.auth!.userId,
        b.route_id ?? null, b.recorrencia ?? null, b.recorrencia_fim ?? null],
    );
    const newId = (rows[0] as { id: number }).id;
    await audit(req, 'finance', newId, 'create', pick(b, FIELDS));
    // Lançamento-modelo: já materializa os meses decorridos até hoje.
    if (b.recorrencia === 'mensal') await materializeRecurrences(orgId);
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
          owner_user_id: { type: ['integer', 'null'] },
          route_id: { type: ['integer', 'null'] },
          categoria_id: { type: ['integer', 'null'] },
          recorrencia: { type: ['string', 'null'] },
          recorrencia_fim: { type: ['string', 'null'] },
        },
      },
    },
  }, async (req, reply) => {
    const orgId = req.auth!.orgId;
    const { id } = req.params as { id: number };
    const b = req.body as Record<string, unknown>;
    const badRef = await invalidOrgRef(orgId, b, ['represented_id', 'activity_id', 'owner_user_id', 'route_id', 'categoria_id']);
    if (badRef) return reply.code(400).send({ error: `${badRef} inválido` });
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

  // Materializa lançamentos recorrentes da org sob demanda (cron/deploy). O boot
  // já roda para todas as orgs; este endpoint é o gatilho manual (admin).
  app.post('/api/finance/recurrences/run', {
    preHandler: [requireAuth, requireAdmin],
  }, async (req) => {
    const created = await materializeRecurrences(req.auth!.orgId);
    return { created };
  });

  // Fluxo de caixa projetado (Fase 6.1): vencimentos pendentes (a pagar/receber)
  // + comissões previstas ainda não recebidas, agrupados por semana (segunda a
  // segunda) nos próximos N meses. Saldo = receber + comissão − pagar.
  app.get('/api/finance/cashflow', {
    preHandler: requireAuth,
    schema: { querystring: { type: 'object', properties: { months: { type: 'integer', minimum: 1, maximum: 12 } } } },
  }, async (req) => {
    const orgId = req.auth!.orgId;
    const { months } = req.query as { months?: number };
    const horizonte = months ?? 3;

    const fin = await query<{ semana: string; receber: string; pagar: string }>(
      `SELECT to_char(date_trunc('week', vencimento), 'YYYY-MM-DD') AS semana,
              COALESCE(sum(valor) FILTER (WHERE kind = 'receber'), 0) AS receber,
              COALESCE(sum(valor) FILTER (WHERE kind = 'pagar'),   0) AS pagar
       FROM finance_entries
       WHERE org_id = $1 AND status = 'pendente'
         AND vencimento >= current_date
         AND vencimento < (date_trunc('month', current_date) + ($2 || ' months')::interval)
       GROUP BY 1`,
      [orgId, horizonte],
    );
    // Comissões previstas: usa recebida_em prevista? Não há data de previsão —
    // projeta no vencimento esperado = 1º dia da competência (mês de referência).
    const com = await query<{ semana: string; comissao: string }>(
      `SELECT to_char(date_trunc('week', competencia), 'YYYY-MM-DD') AS semana,
              COALESCE(sum(valor_previsto), 0) AS comissao
       FROM commission_entries
       WHERE org_id = $1 AND status = 'prevista'
         AND competencia >= date_trunc('month', current_date)
         AND competencia < (date_trunc('month', current_date) + ($2 || ' months')::interval)
       GROUP BY 1`,
      [orgId, horizonte],
    );

    const map = new Map<string, { semana: string; receber: number; pagar: number; comissao_prevista: number }>();
    const bucket = (s: string): { semana: string; receber: number; pagar: number; comissao_prevista: number } => {
      let b = map.get(s);
      if (!b) { b = { semana: s, receber: 0, pagar: 0, comissao_prevista: 0 }; map.set(s, b); }
      return b;
    };
    for (const r of fin) { const b = bucket(r.semana); b.receber += Number(r.receber); b.pagar += Number(r.pagar); }
    for (const r of com) bucket(r.semana).comissao_prevista += Number(r.comissao);

    const semanas = [...map.values()]
      .sort((a, b) => a.semana.localeCompare(b.semana))
      .map((b) => ({ ...b, saldo: Number((b.receber + b.comissao_prevista - b.pagar).toFixed(2)) }));
    return { months: horizonte, semanas };
  });

  // DRE simplificado mensal (Fase 6.1): receita = comissões recebidas no mês;
  // despesas = lançamentos 'pagar' liquidados, abertos por categoria. Resultado
  // = receita − despesa total. Ano default = corrente.
  app.get('/api/finance/dre', {
    preHandler: requireAuth,
    schema: { querystring: { type: 'object', properties: { ano: { type: 'integer', minimum: 2000, maximum: 2100 } } } },
  }, async (req) => {
    const orgId = req.auth!.orgId;
    const { ano } = req.query as { ano?: number };
    const year = ano ?? new Date().getFullYear();

    const receita = await query<{ mes: number; valor: string }>(
      `SELECT extract(month FROM competencia)::int AS mes,
              COALESCE(sum(valor_recebido), 0) AS valor
       FROM commission_entries
       WHERE org_id = $1 AND status IN ('recebida','divergente')
         AND extract(year FROM competencia) = $2
       GROUP BY 1`,
      [orgId, year],
    );
    // Agrupa por grupo_dre da categoria vinculada; sem vínculo, cai no texto
    // livre `categoria` e, na falta, em 'sem categoria'.
    const despesas = await query<{ mes: number; grupo: string; valor: string }>(
      `SELECT extract(month FROM COALESCE(f.liquidacao_data, f.vencimento))::int AS mes,
              COALESCE(fc.grupo_dre, f.categoria, 'sem categoria') AS grupo,
              COALESCE(sum(f.valor), 0) AS valor
       FROM finance_entries f
       LEFT JOIN finance_categories fc ON fc.id = f.categoria_id AND fc.org_id = f.org_id
       WHERE f.org_id = $1 AND f.kind = 'pagar' AND f.status = 'liquidado'
         AND extract(year FROM COALESCE(f.liquidacao_data, f.vencimento)) = $2
       GROUP BY 1, 2`,
      [orgId, year],
    );

    const meses = Array.from({ length: 12 }, (_, i) => ({
      mes: i + 1, receita: 0, despesa: 0, resultado: 0,
      despesas_por_categoria: {} as Record<string, number>,
    }));
    for (const r of receita) meses[r.mes - 1]!.receita = Number(r.valor);
    for (const d of despesas) {
      const m = meses[d.mes - 1]!;
      const grupo = d.grupo || 'sem categoria';
      const v = Number(d.valor);
      m.despesa += v;
      m.despesas_por_categoria[grupo] = (m.despesas_por_categoria[grupo] ?? 0) + v;
    }
    for (const m of meses) m.resultado = Number((m.receita - m.despesa).toFixed(2));
    return { ano: year, meses };
  });

  // ───── Categorias financeiras (cadastro leve + grupo de DRE) ─────
  app.get('/api/finance/categories', {
    preHandler: requireAuth,
    schema: { querystring: { type: 'object', properties: { kind: { type: 'string', enum: ['pagar', 'receber'] }, ativo: { type: 'boolean' } } } },
  }, async (req) => {
    const orgId = req.auth!.orgId;
    const { kind, ativo } = req.query as { kind?: string; ativo?: boolean };
    const where: string[] = ['org_id = $1'];
    const params: unknown[] = [orgId];
    if (kind) { params.push(kind); where.push(`(kind IS NULL OR kind = $${params.length}::finance_kind)`); }
    if (ativo !== undefined) { params.push(ativo); where.push(`ativo = $${params.length}`); }
    const categories = await query(
      `SELECT id, nome, grupo_dre, kind, ativo, created_at
       FROM finance_categories WHERE ${where.join(' AND ')} ORDER BY grupo_dre, nome`,
      params,
    );
    return { categories };
  });

  app.post('/api/finance/categories', {
    preHandler: requireAuth,
    schema: {
      body: {
        type: 'object', required: ['nome'],
        properties: {
          nome: { type: 'string', minLength: 1 },
          grupo_dre: { type: ['string', 'null'] },
          kind: { type: ['string', 'null'], enum: ['pagar', 'receber', null] },
          ativo: { type: 'boolean' },
        },
      },
    },
  }, async (req, reply) => {
    const orgId = req.auth!.orgId;
    const b = req.body as { nome: string; grupo_dre?: string | null; kind?: string | null; ativo?: boolean };
    const dup = await query('SELECT 1 FROM finance_categories WHERE org_id = $1 AND lower(nome) = lower($2)', [orgId, b.nome]);
    if (dup.length > 0) return reply.code(409).send({ error: 'já existe categoria com esse nome' });
    const rows = await query<{ id: string }>(
      `INSERT INTO finance_categories (org_id, nome, grupo_dre, kind, ativo)
       VALUES ($1, $2, COALESCE($3,'Outras'), $4::finance_kind, COALESCE($5, true))
       RETURNING id, nome, grupo_dre, kind, ativo, created_at`,
      [orgId, b.nome, b.grupo_dre ?? null, b.kind ?? null, b.ativo ?? null],
    );
    await audit(req, 'finance_category', Number(rows[0]!.id), 'create', pick(b as Record<string, unknown>, ['nome', 'grupo_dre', 'kind', 'ativo']));
    return reply.code(201).send({ category: rows[0] });
  });

  app.patch('/api/finance/categories/:id', {
    preHandler: requireAuth,
    schema: {
      params: { type: 'object', required: ['id'], properties: { id: { type: 'integer' } } },
      body: {
        type: 'object',
        properties: {
          nome: { type: 'string', minLength: 1 },
          grupo_dre: { type: 'string', minLength: 1 },
          kind: { type: ['string', 'null'], enum: ['pagar', 'receber', null] },
          ativo: { type: 'boolean' },
        },
      },
    },
  }, async (req, reply) => {
    const orgId = req.auth!.orgId;
    const { id } = req.params as { id: number };
    const b = req.body as Record<string, unknown>;
    const sets: string[] = [];
    const params: unknown[] = [];
    for (const k of ['nome', 'grupo_dre', 'kind', 'ativo'] as const) {
      if (k in b) { params.push(b[k]); sets.push(`${k} = $${params.length}${k === 'kind' ? '::finance_kind' : ''}`); }
    }
    if (sets.length === 0) return reply.code(400).send({ error: 'nada para atualizar' });
    params.push(id, orgId);
    const rows = await query(
      `UPDATE finance_categories SET ${sets.join(', ')}
       WHERE id = $${params.length - 1} AND org_id = $${params.length}
       RETURNING id, nome, grupo_dre, kind, ativo, created_at`,
      params,
    );
    if (rows.length === 0) return reply.code(404).send({ error: 'não encontrado' });
    await audit(req, 'finance_category', id, 'update', pick(b, ['nome', 'grupo_dre', 'kind', 'ativo']));
    return { category: rows[0] };
  });

  app.delete('/api/finance/categories/:id', {
    preHandler: requireAuth,
    schema: { params: { type: 'object', required: ['id'], properties: { id: { type: 'integer' } } } },
  }, async (req, reply) => {
    const orgId = req.auth!.orgId;
    const { id } = req.params as { id: number };
    // FK ON DELETE SET NULL: lançamentos ficam sem categoria_id (caem no texto livre).
    const rows = await query('DELETE FROM finance_categories WHERE id = $1 AND org_id = $2 RETURNING id', [id, orgId]);
    if (rows.length === 0) return reply.code(404).send({ error: 'não encontrado' });
    await audit(req, 'finance_category', id, 'delete');
    return { deleted: true };
  });
}
