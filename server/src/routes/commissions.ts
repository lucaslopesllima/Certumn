import type { FastifyInstance, FastifyRequest } from 'fastify';
import { query, one } from '../db.ts';
import { requireAuth, requirePermission } from '../auth.ts';
import { audit, pick } from '../audit.ts';
import { invalidOrgRef } from '../orgRefs.ts';
import { scopeOwner } from '../scope.ts';

// Comissionamento (Fase 2): extrato de comissões previstas/recebidas, baixa
// individual e conciliação CSV em lote, e CRUD das regras. A geração do
// lançamento acontece em src/commissions.ts quando o pedido fatura.
// Escrita é de admin: percentual e recebimento são política do escritório.

const SELECT = `
  SELECT e.id, e.order_id, e.user_id, e.represented_id, e.competencia,
         e.valor_previsto, e.valor_recebido, e.percent_aplicado, e.vendedor_split_pct,
         e.status, e.recebida_em, e.observacao, e.finance_entry_id, e.created_at,
         o.numero AS order_numero, o.nf_numero, o.total AS order_total,
         c.razao_social AS company_nome,
         r.nome AS represented_nome,
         u.nome AS vendedor_nome, u.email AS vendedor_email,
         COALESCE(e.valor_recebido, e.valor_previsto) * e.vendedor_split_pct / 100 AS valor_vendedor
  FROM commission_entries e
  JOIN orders o ON o.id = e.order_id
  JOIN companies c ON c.id = o.company_id
  JOIN represented_companies r ON r.id = e.represented_id
  LEFT JOIN users u ON u.id = e.user_id`;

const RULE_SELECT = `
  SELECT cr.id, cr.represented_id, cr.catalog_item_id, cr.company_id, cr.user_id,
         cr.percent, cr.vendedor_split_pct, cr.vigencia_inicio, cr.vigencia_fim,
         cr.ativo, cr.created_at,
         r.nome AS represented_nome,
         ci.nome AS catalog_nome,
         c.razao_social AS company_nome,
         u.nome AS user_nome, u.email AS user_email
  FROM commission_rules cr
  JOIN represented_companies r ON r.id = cr.represented_id
  LEFT JOIN catalog_items ci ON ci.id = cr.catalog_item_id
  LEFT JOIN companies c ON c.id = cr.company_id
  LEFT JOIN users u ON u.id = cr.user_id`;

const RULE_FIELDS = ['represented_id', 'catalog_item_id', 'company_id', 'user_id',
  'percent', 'vendedor_split_pct', 'vigencia_inicio', 'vigencia_fim', 'ativo'] as const;

interface EntryRow {
  id: string; org_id: string; user_id: string | null; represented_id: string;
  valor_previsto: string; status: string; finance_entry_id: string | null;
  order_numero: number; company_id: string; represented_nome: string;
}

const findEntry = (id: number, orgId: number): Promise<EntryRow | null> =>
  one<EntryRow>(
    `SELECT e.id, e.org_id, e.user_id, e.represented_id, e.valor_previsto, e.status,
            e.finance_entry_id, o.numero AS order_numero, o.company_id, r.nome AS represented_nome
     FROM commission_entries e
     JOIN orders o ON o.id = e.order_id
     JOIN represented_companies r ON r.id = e.represented_id
     WHERE e.id = $1 AND e.org_id = $2`,
    [id, orgId],
  );

// Baixa de uma comissão: marca recebida (ou divergente, fora da tolerância) e
// espelha no financeiro como conta recebida/liquidada. Re-baixa atualiza o
// mesmo finance_entry — sem duplicar lançamento.
async function settleEntry(
  req: FastifyRequest,
  entry: EntryRow,
  valorRecebido: number,
  recebidaEm: string,
  observacao: string | null,
  tolerancia: number,
): Promise<string> {
  const status = Math.abs(valorRecebido - Number(entry.valor_previsto)) <= tolerancia
    ? 'recebida' : 'divergente';

  let financeId = entry.finance_entry_id === null ? null : Number(entry.finance_entry_id);
  if (financeId !== null) {
    await query(
      `UPDATE finance_entries SET valor = $2, vencimento = $3, liquidacao_data = $3,
         status = 'liquidado' WHERE id = $1`,
      [financeId, valorRecebido, recebidaEm],
    );
  } else {
    const row = await one<{ id: string }>(
      `INSERT INTO finance_entries
         (org_id, kind, descricao, valor, vencimento, liquidacao_data, status,
          categoria, company_id, represented_id, owner_user_id)
       VALUES ($1, 'receber', $2, $3, $4, $4, 'liquidado', 'comissao', $5, $6, $7)
       RETURNING id`,
      [entry.org_id, `Comissão pedido #${entry.order_numero} · ${entry.represented_nome}`,
        valorRecebido, recebidaEm, entry.company_id, entry.represented_id, entry.user_id],
    );
    financeId = Number(row!.id);
  }

  await query(
    `UPDATE commission_entries
     SET valor_recebido = $2, recebida_em = $3, status = $4::commission_status,
         observacao = COALESCE($5, observacao), finance_entry_id = $6
     WHERE id = $1`,
    [Number(entry.id), valorRecebido, recebidaEm, status, observacao, financeId],
  );
  await audit(req, 'commission', Number(entry.id), 'settle',
    { valor_recebido: valorRecebido, recebida_em: recebidaEm, status });
  return status;
}

export function commissionRoutes(app: FastifyInstance): void {
  app.get('/api/commissions', {
    preHandler: [requireAuth, requirePermission('commissions.list')],
    schema: {
      querystring: {
        type: 'object',
        properties: {
          competencia: { type: 'string', pattern: '^\\d{4}-\\d{2}$' },
          represented_id: { type: 'integer' },
          status: { type: 'string', enum: ['prevista', 'recebida', 'divergente', 'cancelada'] },
          order_id: { type: 'integer' },
          user_id: { type: 'integer' },
        },
      },
    },
  }, async (req) => {
    const orgId = req.auth!.orgId;
    const q = req.query as { competencia?: string; represented_id?: number; status?: string; order_id?: number; user_id?: number };
    const where: string[] = ['e.org_id = $1'];
    const params: unknown[] = [orgId];
    // rep vê só a comissão própria; admin tudo + filtro por vendedor.
    scopeOwner(req, where, params, 'e.user_id', q.user_id);
    if (q.competencia) { params.push(`${q.competencia}-01`); where.push(`e.competencia = $${params.length}::date`); }
    if (q.represented_id !== undefined) { params.push(q.represented_id); where.push(`e.represented_id = $${params.length}`); }
    if (q.status) { params.push(q.status); where.push(`e.status = $${params.length}::commission_status`); }
    if (q.order_id !== undefined) { params.push(q.order_id); where.push(`e.order_id = $${params.length}`); }
    const entries = await query(
      `${SELECT} WHERE ${where.join(' AND ')} ORDER BY e.competencia DESC, o.numero DESC`,
      params,
    );
    return { entries };
  });

  app.patch('/api/commissions/:id/settle', {
    preHandler: [requireAuth, requirePermission('commissions.settle')],
    schema: {
      params: { type: 'object', required: ['id'], properties: { id: { type: 'integer' } } },
      body: {
        type: 'object',
        required: ['valor_recebido', 'recebida_em'],
        properties: {
          valor_recebido: { type: 'number', minimum: 0 },
          recebida_em: { type: 'string' },
          observacao: { type: ['string', 'null'] },
          tolerancia: { type: 'number', minimum: 0 },
        },
      },
    },
  }, async (req, reply) => {
    const orgId = req.auth!.orgId;
    const { id } = req.params as { id: number };
    const b = req.body as { valor_recebido: number; recebida_em: string; observacao?: string | null; tolerancia?: number };
    const entry = await findEntry(id, orgId);
    if (!entry) return reply.code(404).send({ error: 'não encontrada' });
    if (entry.status === 'cancelada') return reply.code(409).send({ error: 'comissão cancelada' });
    // valor recebido gravado cru (sem arredondar) — fonte de verdade do extrato.
    await settleEntry(req, entry, b.valor_recebido, b.recebida_em, b.observacao ?? null, b.tolerancia ?? 0.01);
    const updated = await one(`${SELECT} WHERE e.id = $1`, [id]);
    return { entry: updated };
  });

  // Conciliação em lote: CSV de pagamentos da representada com colunas
  // pedido OU nf + valor (+ data opcional; sem data = hoje). Cada linha dá
  // baixa na comissão do pedido correspondente; fora da tolerância vira
  // divergente. Mesmo formato de retorno do import de NF.
  app.post('/api/commissions/reconcile', {
    preHandler: [requireAuth, requirePermission('commissions.reconcile')],
    schema: {
      body: {
        type: 'object',
        required: ['csv'],
        properties: {
          csv: { type: 'string', minLength: 1, maxLength: 1_000_000 },
          tolerancia: { type: 'number', minimum: 0 },
        },
      },
    },
  }, async (req, reply) => {
    const orgId = req.auth!.orgId;
    const { csv, tolerancia } = req.body as { csv: string; tolerancia?: number };
    const tol = tolerancia ?? 0.01;
    const lines = csv.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
    const head = lines[0];
    if (head === undefined) return reply.code(400).send({ error: 'csv vazio' });
    const delim = head.includes(';') ? ';' : ',';
    const header = head.split(delim).map((h) => h.trim().toLowerCase());
    const col = (name: string): number => header.findIndex((h) => h.includes(name));
    const iPedido = col('pedido'); const iNf = col('nf'); const iValor = col('valor'); const iData = col('data');
    if (iValor < 0 || (iPedido < 0 && iNf < 0)) {
      return reply.code(400).send({ error: 'cabeçalho deve conter coluna valor e pedido ou nf' });
    }

    const usados = new Set<number>();
    const results: { linha: number; ref: string; commission_id: number | null; status?: string; motivo?: string }[] = [];
    for (let n = 1; n < lines.length; n++) {
      const f = (lines[n] ?? '').split(delim).map((s) => s.trim());
      const pedido = iPedido >= 0 ? (f[iPedido] ?? '') : '';
      const nf = iNf >= 0 ? (f[iNf] ?? '') : '';
      const ref = pedido || nf;
      const rawValor = f[iValor] ?? '';
      const valor = Number(rawValor.includes(',') ? rawValor.replace(/\./g, '').replace(',', '.') : rawValor);
      const rawData = iData >= 0 ? (f[iData] ?? '') : '';
      const br = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(rawData);
      const data = br ? `${br[3]}-${br[2]}-${br[1]}` : (/^\d{4}-\d{2}-\d{2}/.test(rawData) ? rawData.slice(0, 10) : null);
      if (!ref || !Number.isFinite(valor)) {
        results.push({ linha: n + 1, ref, commission_id: null, motivo: 'linha inválida' });
        continue;
      }
      const match = await one<{ id: string }>(
        `SELECT e.id FROM commission_entries e JOIN orders o ON o.id = e.order_id
         WHERE e.org_id = $1 AND e.status <> 'cancelada'
           AND ${pedido ? 'o.numero = $2::int' : 'o.nf_numero = $2'}
         ORDER BY e.id LIMIT 1`,
        [orgId, pedido || nf],
      );
      const cid = match === null ? null : Number(match.id);
      if (cid === null || usados.has(cid)) {
        results.push({ linha: n + 1, ref, commission_id: null, motivo: 'sem comissão correspondente' });
        continue;
      }
      usados.add(cid);
      const entry = (await findEntry(cid, orgId))!;
      const status = await settleEntry(req, entry, valor, data ?? new Date().toISOString().slice(0, 10), null, tol);
      results.push({ linha: n + 1, ref, commission_id: cid, status });
    }
    return {
      processadas: results.length,
      baixadas: results.filter((r) => r.commission_id !== null).length,
      divergentes: results.filter((r) => r.status === 'divergente').length,
      results,
    };
  });

  /* ── Regras de comissão ─────────────────────────────────── */

  app.get('/api/commission-rules', {
    preHandler: [requireAuth, requirePermission('commission_rules.list')],
    schema: {
      querystring: { type: 'object', properties: { represented_id: { type: 'integer' } } },
    },
  }, async (req) => {
    const orgId = req.auth!.orgId;
    const { represented_id } = req.query as { represented_id?: number };
    const where: string[] = ['cr.org_id = $1'];
    const params: unknown[] = [orgId];
    if (represented_id !== undefined) { params.push(represented_id); where.push(`cr.represented_id = $${params.length}`); }
    const rules = await query(
      `${RULE_SELECT} WHERE ${where.join(' AND ')}
       ORDER BY r.nome,
         (cr.catalog_item_id IS NULL), (cr.company_id IS NULL), (cr.user_id IS NULL),
         cr.vigencia_inicio DESC, cr.id DESC`,
      params,
    );
    return { rules };
  });

  const RULE_PROPS = {
    represented_id: { type: 'integer' },
    catalog_item_id: { type: ['integer', 'null'] },
    company_id: { type: ['integer', 'null'] },
    user_id: { type: ['integer', 'null'] },
    percent: { type: 'number', minimum: 0, maximum: 100 },
    vendedor_split_pct: { type: 'number', minimum: 0, maximum: 100 },
    vigencia_inicio: { type: 'string' },
    vigencia_fim: { type: ['string', 'null'] },
    ativo: { type: 'boolean' },
  } as const;

  // company_id aponta para o pool global (sem org) — só checa existência.
  const badCompany = async (b: Record<string, unknown>): Promise<boolean> =>
    b.company_id != null && !(await one('SELECT 1 FROM companies WHERE id = $1', [b.company_id]));

  app.post('/api/commission-rules', {
    preHandler: [requireAuth, requirePermission('commission_rules.create')],
    schema: {
      body: {
        type: 'object',
        required: ['represented_id', 'percent', 'vigencia_inicio'],
        properties: RULE_PROPS,
      },
    },
  }, async (req, reply) => {
    const orgId = req.auth!.orgId;
    const b = req.body as Record<string, unknown>;
    const badRef = await invalidOrgRef(orgId, b, ['represented_id', 'catalog_item_id', 'user_id']);
    if (badRef) return reply.code(400).send({ error: `${badRef} inválido` });
    if (await badCompany(b)) return reply.code(400).send({ error: 'company_id inválido' });
    const row = await one<{ id: string }>(
      `INSERT INTO commission_rules
         (org_id, represented_id, catalog_item_id, company_id, user_id,
          percent, vendedor_split_pct, vigencia_inicio, vigencia_fim, ativo)
       VALUES ($1,$2,$3,$4,$5,$6,COALESCE($7,100),$8,$9,COALESCE($10,true))
       RETURNING id`,
      [orgId, b.represented_id, b.catalog_item_id ?? null, b.company_id ?? null,
        b.user_id ?? null, b.percent, b.vendedor_split_pct ?? null,
        b.vigencia_inicio, b.vigencia_fim ?? null, b.ativo ?? null],
    );
    const newId = Number(row!.id);
    await audit(req, 'commission_rule', newId, 'create', pick(b, RULE_FIELDS));
    const rule = await one(`${RULE_SELECT} WHERE cr.id = $1`, [newId]);
    return reply.code(201).send({ rule });
  });

  app.patch('/api/commission-rules/:id', {
    preHandler: [requireAuth, requirePermission('commission_rules.update')],
    schema: {
      params: { type: 'object', required: ['id'], properties: { id: { type: 'integer' } } },
      body: { type: 'object', properties: RULE_PROPS },
    },
  }, async (req, reply) => {
    const orgId = req.auth!.orgId;
    const { id } = req.params as { id: number };
    const b = req.body as Record<string, unknown>;
    const badRef = await invalidOrgRef(orgId, b, ['represented_id', 'catalog_item_id', 'user_id']);
    if (badRef) return reply.code(400).send({ error: `${badRef} inválido` });
    if (await badCompany(b)) return reply.code(400).send({ error: 'company_id inválido' });
    const sets: string[] = [];
    const params: unknown[] = [];
    for (const k of RULE_FIELDS) {
      if (k in b) { params.push(b[k]); sets.push(`${k} = $${params.length}`); }
    }
    if (sets.length === 0) return reply.code(400).send({ error: 'nada para atualizar' });
    params.push(id, orgId);
    const rows = await query(
      `UPDATE commission_rules SET ${sets.join(', ')}
       WHERE id = $${params.length - 1} AND org_id = $${params.length} RETURNING id`,
      params,
    );
    if (rows.length === 0) return reply.code(404).send({ error: 'não encontrada' });
    await audit(req, 'commission_rule', id, 'update', pick(b, RULE_FIELDS));
    const rule = await one(`${RULE_SELECT} WHERE cr.id = $1`, [id]);
    return { rule };
  });

  app.delete('/api/commission-rules/:id', {
    preHandler: [requireAuth, requirePermission('commission_rules.delete')],
    schema: { params: { type: 'object', required: ['id'], properties: { id: { type: 'integer' } } } },
  }, async (req, reply) => {
    const orgId = req.auth!.orgId;
    const { id } = req.params as { id: number };
    const rows = await query('DELETE FROM commission_rules WHERE id = $1 AND org_id = $2 RETURNING id', [id, orgId]);
    if (rows.length === 0) return reply.code(404).send({ error: 'não encontrada' });
    await audit(req, 'commission_rule', id, 'delete');
    return { deleted: true };
  });
}
