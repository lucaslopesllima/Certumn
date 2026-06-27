import { query, one } from './db.ts';

// Motor de comissão (Fase 2). Ao faturar um pedido, resolve a regra vigente
// POR ITEM com precedência produto > cliente > vendedor > regra geral da
// representada e cria 1 commission_entry por pedido (UNIQUE(order_id) torna a
// chamada idempotente — transição manual e import CSV podem repetir).
// Frete fica fora da base: comissão incide sobre mercadoria (soma dos itens).

interface Rule {
  id: string;
  catalog_item_id: string | null;
  company_id: string | null;
  user_id: string | null;
  percent: string;
  vendedor_split_pct: string;
}

// Especificidade da regra: produto vence cliente, que vence vendedor, que
// vence a regra geral. Dimensões NULL são curinga (regra vale para todos).
const rank = (r: Rule): number =>
  r.catalog_item_id !== null ? 0 : r.company_id !== null ? 1 : r.user_id !== null ? 2 : 3;

// Cria a comissão prevista do pedido faturado. No-op se o pedido não está
// faturado, se já tem entry ou se nenhuma regra vigente cobre algum item.
export async function createCommissionForOrder(orderId: number): Promise<void> {
  const order = await one<{
    org_id: string; company_id: string; represented_id: string;
    owner_user_id: string | null; faturado_em: string | null;
  }>(
    `SELECT org_id, company_id, represented_id, owner_user_id, faturado_em
     FROM orders WHERE id = $1 AND status = 'faturado'`,
    [orderId],
  );
  if (!order || order.faturado_em === null) return;

  const items = await query<{ catalog_item_id: string | null; total: string }>(
    'SELECT catalog_item_id, total FROM order_items WHERE order_id = $1',
    [orderId],
  );
  if (items.length === 0) return;

  // Regras vigentes na data do faturamento cujas dimensões batem com o pedido
  // (catalog_item_id é filtrado por item, abaixo).
  const rules = await query<Rule>(
    `SELECT id, catalog_item_id, company_id, user_id, percent, vendedor_split_pct
     FROM commission_rules
     WHERE org_id = $1 AND represented_id = $2 AND ativo
       AND vigencia_inicio <= $3::date
       AND (vigencia_fim IS NULL OR vigencia_fim >= $3::date)
       AND (company_id IS NULL OR company_id = $4)
       AND (user_id IS NULL OR user_id = $5)
     ORDER BY vigencia_inicio DESC, id DESC`,
    [order.org_id, order.represented_id, order.faturado_em, order.company_id, order.owner_user_id],
  );
  if (rules.length === 0) return;

  // Por item: resolve a regra (precedência) e monta (total cru, percent, split).
  // Item sem regra entra na base com percent/split = 0 (não comissiona, mas pesa
  // na média ponderada do percent_aplicado). Aritmética monetária é feita no
  // banco em numeric — JS só seleciona a regra, nunca multiplica dinheiro.
  const totals: string[] = [];   // order_items.total cru (string numeric do banco)
  const percents: string[] = []; // % da regra aplicável ('0' se nenhuma)
  const splits: string[] = [];   // split vendedor da regra ('0' se nenhuma)
  for (const it of items) {
    const rule = rules
      .filter((r) => r.catalog_item_id === null || r.catalog_item_id === it.catalog_item_id)
      .sort((a, b) => rank(a) - rank(b))[0];
    totals.push(it.total);
    percents.push(rule ? rule.percent : '0');
    splits.push(rule ? rule.vendedor_split_pct : '0');
  }

  // Agrega em numeric exato e só insere se houver comissão (previsto > 0).
  //   base     = Σ total
  //   previsto = Σ total·percent/100
  //   vendedor = Σ total·percent/100·split/100
  // percent_aplicado = previsto/base·100 (média ponderada); split = vendedor/previsto·100.
  await query(
    `INSERT INTO commission_entries
       (org_id, order_id, user_id, represented_id, competencia,
        valor_previsto, percent_aplicado, vendedor_split_pct)
     SELECT $1, $2, $3, $4, date_trunc('month', $5::timestamptz)::date,
            agg.previsto,
            CASE WHEN agg.base > 0     THEN agg.previsto / agg.base * 100     ELSE 0 END,
            CASE WHEN agg.previsto > 0 THEN agg.vendedor / agg.previsto * 100 ELSE 0 END
     FROM (
       SELECT COALESCE(SUM(t.total), 0)                              AS base,
              COALESCE(SUM(t.total * t.percent / 100), 0)            AS previsto,
              COALESCE(SUM(t.total * t.percent / 100 * t.split / 100), 0) AS vendedor
       FROM unnest($6::numeric[], $7::numeric[], $8::numeric[]) AS t(total, percent, split)
     ) agg
     WHERE agg.previsto > 0
     ON CONFLICT (order_id) DO NOTHING`,
    [order.org_id, orderId, order.owner_user_id, order.represented_id,
      order.faturado_em, totals, percents, splits],
  );
}

// Pedido faturado que foi cancelado: a previsão morre junto (recebida fica —
// dinheiro que entrou não some do extrato).
export async function cancelCommissionForOrder(orderId: number): Promise<void> {
  await query(
    `UPDATE commission_entries SET status = 'cancelada'
     WHERE order_id = $1 AND status = 'prevista'`,
    [orderId],
  );
}
