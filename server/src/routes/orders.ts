import type { FastifyInstance, FastifyRequest } from 'fastify';
import { query, one, withClient } from '../db.ts';
import { requireAuth, requireAdmin } from '../auth.ts';
import { audit, pick } from '../audit.ts';
import { invalidOrgRef } from '../orgRefs.ts';
import { createCommissionForOrder, cancelCommissionForOrder } from '../commissions.ts';

// Pedidos de venda (Fase 1). Cotação = pedido com status='cotacao' + validade;
// conversão é transição de status. Total SEMPRE recalculado server-side a
// partir dos itens — o client não manda total. Itens guardam snapshot de
// descrição/preço: catálogo e tabela de preço mudam, pedido emitido não.

const SELECT = `
  SELECT o.id, o.numero, o.relationship_id, o.company_id, o.represented_id,
         o.owner_user_id, o.price_table_id, o.status, o.validade,
         o.condicao_pagamento, o.transportadora, o.carrier_id, o.frete, o.observacoes, o.total,
         o.nf_numero, o.emitido_em, o.faturado_em, o.created_at, o.updated_at,
         c.razao_social AS company_nome, c.cnpj AS company_cnpj,
         r.nome AS represented_nome,
         u.email AS owner_email, u.nome AS owner_nome,
         tc.nome AS carrier_nome
  FROM orders o
  JOIN companies c ON c.id = o.company_id
  JOIN represented_companies r ON r.id = o.represented_id
  LEFT JOIN users u ON u.id = o.owner_user_id
  LEFT JOIN carriers tc ON tc.id = o.carrier_id`;

// Campos de cabeçalho editáveis (POST e PATCH).
const FIELDS = ['relationship_id', 'company_id', 'represented_id', 'price_table_id',
  'validade', 'condicao_pagamento', 'transportadora', 'carrier_id', 'frete', 'observacoes'] as const;

// Máquina de estados: fluxo feliz cotacao→rascunho→enviado→faturado→entregue;
// cancelado de qualquer status não-terminal; sem voltar de faturado.
const TRANSITIONS: Record<string, string[]> = {
  cotacao: ['rascunho', 'cancelado'],
  rascunho: ['enviado', 'cancelado'],
  enviado: ['faturado', 'cancelado'],
  faturado: ['entregue', 'cancelado'],
  entregue: [],
  cancelado: [],
};

// Só rascunho/cotação são editáveis — depois de enviado o pedido é imutável
// (exceto transições de status).
const EDITABLE = new Set(['cotacao', 'rascunho']);

const ITEM_SCHEMA = {
  type: 'object',
  required: ['qtd'],
  properties: {
    catalog_item_id: { type: ['integer', 'null'] },
    descricao: { type: ['string', 'null'] },
    qtd: { type: 'number', exclusiveMinimum: 0 },
    preco_unit: { type: ['number', 'null'], minimum: 0 },
    desconto_pct: { type: 'number', minimum: 0, maximum: 100 },
    ipi_pct: { type: 'number', minimum: 0, maximum: 100 },
    st_pct: { type: 'number', minimum: 0, maximum: 100 },
  },
} as const;

const HEADER_PROPS = {
  relationship_id: { type: ['integer', 'null'] },
  company_id: { type: 'integer' },
  represented_id: { type: 'integer' },
  price_table_id: { type: ['integer', 'null'] },
  validade: { type: ['string', 'null'] },
  condicao_pagamento: { type: ['string', 'null'] },
  transportadora: { type: ['string', 'null'] },
  carrier_id: { type: ['integer', 'null'] },
  frete: { type: 'number', minimum: 0 },
  observacoes: { type: ['string', 'null'] },
} as const;

interface ItemInput {
  catalog_item_id?: number | null;
  descricao?: string | null;
  qtd: number;
  preco_unit?: number | null;
  desconto_pct?: number;
  ipi_pct?: number;
  st_pct?: number;
}

interface ResolvedItem {
  catalog_item_id: number | null;
  descricao_snapshot: string;
  qtd: number;
  preco_unit: number;
  desconto_pct: number;
  ipi_pct: number;
  st_pct: number;
  total: number;
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

// Resolve itens do payload: preço explícito > tabela de preço > catálogo;
// descrição explícita > nome do catálogo. Valida teto de desconto da tabela.
// Retorna string de erro ou a lista pronta para INSERT.
async function resolveItems(
  orgId: number,
  priceTableId: number | null,
  items: ItemInput[],
): Promise<string | ResolvedItem[]> {
  const catIds = items.map((i) => i.catalog_item_id).filter((v): v is number => v != null);
  const catalog = new Map<number, { nome: string; preco: number | null }>();
  if (catIds.length > 0) {
    const rows = await query<{ id: string; nome: string; preco: string | null }>(
      'SELECT id, nome, preco FROM catalog_items WHERE org_id = $1 AND id = ANY($2)', [orgId, catIds],
    );
    for (const r of rows) catalog.set(Number(r.id), { nome: r.nome, preco: r.preco === null ? null : Number(r.preco) });
  }
  const tablePrices = new Map<number, { preco: number; desconto_max_pct: number | null }>();
  if (priceTableId != null) {
    const rows = await query<{ catalog_item_id: string; preco: string; desconto_max_pct: string | null }>(
      'SELECT catalog_item_id, preco, desconto_max_pct FROM price_table_items WHERE price_table_id = $1',
      [priceTableId],
    );
    for (const r of rows) {
      tablePrices.set(Number(r.catalog_item_id), {
        preco: Number(r.preco),
        desconto_max_pct: r.desconto_max_pct === null ? null : Number(r.desconto_max_pct),
      });
    }
  }

  const out: ResolvedItem[] = [];
  for (const it of items) {
    const cat = it.catalog_item_id != null ? catalog.get(it.catalog_item_id) : undefined;
    if (it.catalog_item_id != null && !cat) return 'catalog_item_id inválido';
    const fromTable = it.catalog_item_id != null ? tablePrices.get(it.catalog_item_id) : undefined;
    const preco = it.preco_unit ?? fromTable?.preco ?? cat?.preco ?? null;
    if (preco == null) return 'item sem preço (informe preco_unit ou use item de catálogo/tabela com preço)';
    const descricao = it.descricao ?? cat?.nome ?? null;
    if (descricao == null) return 'item sem descrição (informe descricao ou catalog_item_id)';
    const desconto = it.desconto_pct ?? 0;
    if (fromTable?.desconto_max_pct != null && desconto > fromTable.desconto_max_pct) {
      return `desconto acima do máximo da tabela (${fromTable.desconto_max_pct}%)`;
    }
    const ipi = it.ipi_pct ?? 0;
    const st = it.st_pct ?? 0;
    out.push({
      catalog_item_id: it.catalog_item_id ?? null,
      descricao_snapshot: descricao,
      qtd: it.qtd,
      preco_unit: preco,
      desconto_pct: desconto,
      ipi_pct: ipi,
      st_pct: st,
      total: round2(it.qtd * preco * (1 - desconto / 100) * (1 + (ipi + st) / 100)),
    });
  }
  return out;
}

const orderItems = (orderId: number): Promise<unknown[]> => query(
  `SELECT id, catalog_item_id, descricao_snapshot, qtd, preco_unit, desconto_pct,
          ipi_pct, st_pct, total
   FROM order_items WHERE order_id = $1 ORDER BY id`,
  [orderId],
);

async function fullOrder(orderId: number): Promise<Record<string, unknown>> {
  const order = await one<Record<string, unknown>>(`${SELECT} WHERE o.id = $1`, [orderId]);
  return { ...order!, items: await orderItems(orderId) };
}

// Vendedor só mexe no pedido próprio; admin em todos (visibilidade plena de
// carteira é a Fase 3 — aqui só a regra de escrita).
const canWrite = (req: FastifyRequest, ownerUserId: number | null): boolean =>
  req.auth!.role === 'admin' || ownerUserId === req.auth!.userId;

interface OrderRow {
  id: number; status: string; owner_user_id: string | null;
  price_table_id: string | null; frete: string; numero: number;
}

const findOrder = (id: number, orgId: number): Promise<OrderRow | null> =>
  one<OrderRow>('SELECT id, status, owner_user_id, price_table_id, frete, numero FROM orders WHERE id = $1 AND org_id = $2', [id, orgId]);

export function orderRoutes(app: FastifyInstance): void {
  app.get('/api/orders', {
    preHandler: requireAuth,
    schema: {
      querystring: {
        type: 'object',
        properties: {
          status: { type: 'string', enum: Object.keys(TRANSITIONS) },
          represented_id: { type: 'integer' },
          owner_user_id: { type: 'integer' },
          from: { type: 'string' },
          to: { type: 'string' },
        },
      },
    },
  }, async (req) => {
    const orgId = req.auth!.orgId;
    const q = req.query as { status?: string; represented_id?: number; owner_user_id?: number; from?: string; to?: string };
    const where: string[] = ['o.org_id = $1'];
    const params: unknown[] = [orgId];
    if (q.status) { params.push(q.status); where.push(`o.status = $${params.length}::order_status`); }
    if (q.represented_id !== undefined) { params.push(q.represented_id); where.push(`o.represented_id = $${params.length}`); }
    if (q.owner_user_id !== undefined) { params.push(q.owner_user_id); where.push(`o.owner_user_id = $${params.length}`); }
    if (q.from) { params.push(q.from); where.push(`o.created_at >= $${params.length}`); }
    if (q.to) { params.push(q.to); where.push(`o.created_at < ($${params.length}::date + 1)`); }
    const orders = await query(
      `${SELECT} WHERE ${where.join(' AND ')} ORDER BY o.numero DESC`,
      params,
    );
    return { orders };
  });

  app.get('/api/orders/:id', {
    preHandler: requireAuth,
    schema: { params: { type: 'object', required: ['id'], properties: { id: { type: 'integer' } } } },
  }, async (req, reply) => {
    const orgId = req.auth!.orgId;
    const { id } = req.params as { id: number };
    const order = await findOrder(id, orgId);
    if (!order) return reply.code(404).send({ error: 'não encontrado' });
    return { order: await fullOrder(id) };
  });

  app.post('/api/orders', {
    preHandler: requireAuth,
    schema: {
      body: {
        type: 'object',
        required: ['company_id', 'represented_id'],
        properties: {
          ...HEADER_PROPS,
          status: { type: 'string', enum: ['cotacao', 'rascunho'] },
          items: { type: 'array', items: ITEM_SCHEMA },
        },
      },
    },
  }, async (req, reply) => {
    const orgId = req.auth!.orgId;
    const b = req.body as Record<string, unknown> & { items?: ItemInput[]; status?: string };
    const badRef = await invalidOrgRef(orgId, b, ['represented_id', 'relationship_id', 'price_table_id', 'carrier_id']);
    if (badRef) return reply.code(400).send({ error: `${badRef} inválido` });
    const resolved = await resolveItems(orgId, (b.price_table_id as number | undefined) ?? null, b.items ?? []);
    if (typeof resolved === 'string') return reply.code(400).send({ error: resolved });
    const frete = (b.frete as number | undefined) ?? 0;
    const total = round2(resolved.reduce((s, i) => s + i.total, 0) + frete);

    const newId = await withClient(async (c) => {
      await c.query('BEGIN');
      try {
        // numero sequencial por org: lock por org serializa o MAX+1 — sem isso
        // duas criações simultâneas colidem no UNIQUE(org_id, numero).
        await c.query('SELECT pg_advisory_xact_lock(42, $1)', [orgId]);
        const res = await c.query(
          `INSERT INTO orders (org_id, numero, relationship_id, company_id, represented_id,
             owner_user_id, price_table_id, status, validade, condicao_pagamento,
             transportadora, carrier_id, frete, observacoes, total)
           VALUES ($1, (SELECT COALESCE(MAX(numero),0)+1 FROM orders WHERE org_id = $1),
                   $2, $3, $4, $5, $6, COALESCE($7,'rascunho')::order_status,
                   $8, $9, $10, $11, $12, $13, $14)
           RETURNING id`,
          [orgId, b.relationship_id ?? null, b.company_id, b.represented_id,
            req.auth!.userId, b.price_table_id ?? null, b.status ?? null,
            b.validade ?? null, b.condicao_pagamento ?? null, b.transportadora ?? null,
            b.carrier_id ?? null, frete, b.observacoes ?? null, total],
        );
        const id = Number(res.rows[0].id);
        for (const it of resolved) {
          await c.query(
            `INSERT INTO order_items (order_id, catalog_item_id, descricao_snapshot, qtd,
               preco_unit, desconto_pct, ipi_pct, st_pct, total)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
            [id, it.catalog_item_id, it.descricao_snapshot, it.qtd, it.preco_unit,
              it.desconto_pct, it.ipi_pct, it.st_pct, it.total],
          );
        }
        await c.query('COMMIT');
        return id;
      } catch (e) {
        await c.query('ROLLBACK');
        throw e;
      }
    });
    await audit(req, 'order', newId, 'create', pick(b, [...FIELDS, 'status']));
    return reply.code(201).send({ order: await fullOrder(newId) });
  });

  app.patch('/api/orders/:id', {
    preHandler: requireAuth,
    schema: {
      params: { type: 'object', required: ['id'], properties: { id: { type: 'integer' } } },
      body: {
        type: 'object',
        properties: { ...HEADER_PROPS, items: { type: 'array', items: ITEM_SCHEMA } },
      },
    },
  }, async (req, reply) => {
    const orgId = req.auth!.orgId;
    const { id } = req.params as { id: number };
    const b = req.body as Record<string, unknown> & { items?: ItemInput[] };
    const order = await findOrder(id, orgId);
    if (!order) return reply.code(404).send({ error: 'não encontrado' });
    if (!canWrite(req, order.owner_user_id === null ? null : Number(order.owner_user_id))) {
      return reply.code(403).send({ error: 'pedido de outro vendedor' });
    }
    if (!EDITABLE.has(order.status)) {
      return reply.code(409).send({ error: `pedido ${order.status} não é editável` });
    }
    const badRef = await invalidOrgRef(orgId, b, ['represented_id', 'relationship_id', 'price_table_id', 'carrier_id']);
    if (badRef) return reply.code(400).send({ error: `${badRef} inválido` });

    const sets: string[] = [];
    const params: unknown[] = [];
    for (const k of FIELDS) {
      if (k in b) { params.push(b[k]); sets.push(`${k} = $${params.length}`); }
    }
    if (sets.length === 0 && b.items === undefined) {
      return reply.code(400).send({ error: 'nada para atualizar' });
    }

    let resolved: ResolvedItem[] | null = null;
    if (b.items !== undefined) {
      const priceTableId = 'price_table_id' in b
        ? (b.price_table_id as number | null)
        : (order.price_table_id === null ? null : Number(order.price_table_id));
      const r = await resolveItems(orgId, priceTableId, b.items);
      if (typeof r === 'string') return reply.code(400).send({ error: r });
      resolved = r;
    }

    await withClient(async (c) => {
      await c.query('BEGIN');
      try {
        if (sets.length > 0) {
          await c.query(
            `UPDATE orders SET ${sets.join(', ')}, updated_at = now()
             WHERE id = $${params.length + 1}`,
            [...params, id],
          );
        }
        if (resolved !== null) {
          await c.query('DELETE FROM order_items WHERE order_id = $1', [id]);
          for (const it of resolved) {
            await c.query(
              `INSERT INTO order_items (order_id, catalog_item_id, descricao_snapshot, qtd,
                 preco_unit, desconto_pct, ipi_pct, st_pct, total)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
              [id, it.catalog_item_id, it.descricao_snapshot, it.qtd, it.preco_unit,
                it.desconto_pct, it.ipi_pct, it.st_pct, it.total],
            );
          }
        }
        // total = soma dos itens + frete vigente, sempre recalculado no banco.
        await c.query(
          `UPDATE orders SET total = COALESCE(
             (SELECT round(SUM(total), 2) FROM order_items WHERE order_id = $1), 0) + frete,
           updated_at = now() WHERE id = $1`,
          [id],
        );
        await c.query('COMMIT');
      } catch (e) {
        await c.query('ROLLBACK');
        throw e;
      }
    });
    await audit(req, 'order', id, 'update', pick(b, FIELDS));
    return { order: await fullOrder(id) };
  });

  app.post('/api/orders/:id/transition', {
    preHandler: requireAuth,
    schema: {
      params: { type: 'object', required: ['id'], properties: { id: { type: 'integer' } } },
      body: {
        type: 'object',
        required: ['status'],
        properties: {
          status: { type: 'string', enum: Object.keys(TRANSITIONS) },
          nf_numero: { type: ['string', 'null'] },
        },
      },
    },
  }, async (req, reply) => {
    const orgId = req.auth!.orgId;
    const { id } = req.params as { id: number };
    const { status, nf_numero } = req.body as { status: string; nf_numero?: string | null };
    const order = await findOrder(id, orgId);
    if (!order) return reply.code(404).send({ error: 'não encontrado' });
    if (!canWrite(req, order.owner_user_id === null ? null : Number(order.owner_user_id))) {
      return reply.code(403).send({ error: 'pedido de outro vendedor' });
    }
    if (!(TRANSITIONS[order.status] ?? []).includes(status)) {
      return reply.code(409).send({ error: `transição inválida: ${order.status} → ${status}` });
    }
    await query(
      `UPDATE orders SET status = $2::order_status,
         emitido_em  = CASE WHEN $2 = 'enviado'  THEN now() ELSE emitido_em  END,
         faturado_em = CASE WHEN $2 = 'faturado' THEN now() ELSE faturado_em END,
         nf_numero   = CASE WHEN $2 = 'faturado' THEN COALESCE($3, nf_numero) ELSE nf_numero END,
         updated_at  = now()
       WHERE id = $1`,
      [id, status, nf_numero ?? null],
    );
    // Fase 2: faturar gera a comissão prevista; cancelar pedido faturado
    // cancela a previsão correspondente.
    if (status === 'faturado') await createCommissionForOrder(id);
    if (status === 'cancelado' && order.status === 'faturado') await cancelCommissionForOrder(id);
    await audit(req, 'order', id, 'transition', { de: order.status, para: status, nf_numero: nf_numero ?? null });
    return { order: await fullOrder(id) };
  });

  app.delete('/api/orders/:id', {
    preHandler: requireAuth,
    schema: { params: { type: 'object', required: ['id'], properties: { id: { type: 'integer' } } } },
  }, async (req, reply) => {
    const orgId = req.auth!.orgId;
    const { id } = req.params as { id: number };
    const order = await findOrder(id, orgId);
    if (!order) return reply.code(404).send({ error: 'não encontrado' });
    if (!canWrite(req, order.owner_user_id === null ? null : Number(order.owner_user_id))) {
      return reply.code(403).send({ error: 'pedido de outro vendedor' });
    }
    if (!EDITABLE.has(order.status)) {
      return reply.code(409).send({ error: `pedido ${order.status} não pode ser excluído (use cancelar)` });
    }
    await query('DELETE FROM orders WHERE id = $1', [id]);
    await audit(req, 'order', id, 'delete');
    return { deleted: true };
  });

  // Importação de faturamento: CSV com colunas nf, data, cnpj, valor (header
  // obrigatório, ',' ou ';'). Match com pedido 'enviado' da org pelo CNPJ do
  // cliente + valor (tolerância 1 centavo); marca faturado + nf_numero.
  // Admin only — fatura pedido de qualquer vendedor.
  app.post('/api/orders/import', {
    preHandler: [requireAuth, requireAdmin],
    schema: {
      body: {
        type: 'object',
        required: ['csv'],
        properties: { csv: { type: 'string', minLength: 1 } },
      },
    },
  }, async (req, reply) => {
    const orgId = req.auth!.orgId;
    const { csv } = req.body as { csv: string };
    const lines = csv.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
    const head = lines[0];
    if (head === undefined) return reply.code(400).send({ error: 'csv vazio' });
    const delim = head.includes(';') ? ';' : ',';
    const header = head.split(delim).map((h) => h.trim().toLowerCase());
    const col = (name: string): number => header.findIndex((h) => h.includes(name));
    const iNf = col('nf'); const iData = col('data'); const iCnpj = col('cnpj'); const iValor = col('valor');
    if (iNf < 0 || iData < 0 || iCnpj < 0 || iValor < 0) {
      return reply.code(400).send({ error: 'cabeçalho deve conter colunas nf, data, cnpj, valor' });
    }

    const usados = new Set<number>();
    const results: { linha: number; nf: string; order_id: number | null; motivo?: string }[] = [];
    for (let n = 1; n < lines.length; n++) {
      const f = (lines[n] ?? '').split(delim).map((s) => s.trim());
      const nf = f[iNf] ?? '';
      const cnpj = (f[iCnpj] ?? '').replace(/\D/g, '');
      // valor BR "1.234,56" ou já decimal "1234.56"
      const rawValor = f[iValor] ?? '';
      const valor = Number(rawValor.includes(',') ? rawValor.replace(/\./g, '').replace(',', '.') : rawValor);
      // data ISO (2026-06-01) ou BR (01/06/2026); outro formato → now() no UPDATE
      const rawData = f[iData] ?? '';
      const br = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(rawData);
      const data = br ? `${br[3]}-${br[2]}-${br[1]}` : (/^\d{4}-\d{2}-\d{2}/.test(rawData) ? rawData : '');
      if (!nf || !cnpj || !Number.isFinite(valor)) {
        results.push({ linha: n + 1, nf, order_id: null, motivo: 'linha inválida' });
        continue;
      }
      const candidates = await query<{ id: string }>(
        `SELECT o.id FROM orders o JOIN companies c ON c.id = o.company_id
         WHERE o.org_id = $1 AND o.status = 'enviado' AND c.cnpj = $2
           AND abs(o.total - $3) <= 0.01
         ORDER BY o.numero`,
        [orgId, cnpj, valor],
      );
      const match = candidates.map((r) => Number(r.id)).find((oid) => !usados.has(oid));
      if (match === undefined) {
        results.push({ linha: n + 1, nf, order_id: null, motivo: 'sem pedido enviado correspondente' });
        continue;
      }
      usados.add(match);
      await query(
        `UPDATE orders SET status = 'faturado', nf_numero = $2,
           faturado_em = COALESCE($3::timestamptz, now()), updated_at = now()
         WHERE id = $1`,
        [match, nf, data || null],
      );
      await createCommissionForOrder(match);
      await audit(req, 'order', match, 'transition', { de: 'enviado', para: 'faturado', nf_numero: nf, import: true });
      results.push({ linha: n + 1, nf, order_id: match });
    }
    return { processadas: results.length, faturadas: results.filter((r) => r.order_id !== null).length, results };
  });
}
