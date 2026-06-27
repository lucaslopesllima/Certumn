-- Precisão monetária exata (Fase 0 fundação): todo valor/quantidade/percentual
-- passa a numeric com escala ampla (18,6 p/ dinheiro e qtd; 7,4 p/ %), pra que
-- o banco guarde e calcule cru — sem arredondar no meio. Arredondamento só na
-- borda: emissão de NF e apresentação em tela. order_items.total vira coluna
-- GENERATED: o banco recalcula o total do item a partir dos componentes em
-- numeric exato, nunca o client/JS. orders.total continua recalculado por SUM
-- (agregado de outra tabela não cabe em GENERATED).

-- ── Catálogo / tabelas de preço ─────────────────────────────
ALTER TABLE catalog_items     ALTER COLUMN preco            TYPE numeric(18,6);
ALTER TABLE price_table_items ALTER COLUMN preco            TYPE numeric(18,6);
ALTER TABLE price_table_items ALTER COLUMN desconto_max_pct TYPE numeric(7,4);

-- ── Pedidos ─────────────────────────────────────────────────
ALTER TABLE orders ALTER COLUMN frete TYPE numeric(18,6);
ALTER TABLE orders ALTER COLUMN total TYPE numeric(18,6);

-- order_items.total é derivado: dropa a coluna plana, amplia os componentes e
-- recria como GENERATED (recalcula cru a partir de qtd/preço/percentuais).
ALTER TABLE order_items DROP COLUMN total;
ALTER TABLE order_items
  ALTER COLUMN qtd          TYPE numeric(18,6),
  ALTER COLUMN preco_unit   TYPE numeric(18,6),
  ALTER COLUMN desconto_pct TYPE numeric(7,4),
  ALTER COLUMN ipi_pct      TYPE numeric(7,4),
  ALTER COLUMN st_pct       TYPE numeric(7,4);
ALTER TABLE order_items
  ADD COLUMN total numeric(18,6)
    GENERATED ALWAYS AS (
      qtd * preco_unit * (1 - desconto_pct / 100) * (1 + (ipi_pct + st_pct) / 100)
    ) STORED;

-- ── Comissões ───────────────────────────────────────────────
ALTER TABLE commission_rules   ALTER COLUMN percent            TYPE numeric(7,4);
ALTER TABLE commission_rules   ALTER COLUMN vendedor_split_pct TYPE numeric(7,4);
ALTER TABLE commission_entries ALTER COLUMN valor_previsto     TYPE numeric(18,6);
ALTER TABLE commission_entries ALTER COLUMN valor_recebido     TYPE numeric(18,6);
ALTER TABLE commission_entries ALTER COLUMN percent_aplicado   TYPE numeric(7,4);
ALTER TABLE commission_entries ALTER COLUMN vendedor_split_pct TYPE numeric(7,4);

-- ── Financeiro / metas / prospecção ─────────────────────────
ALTER TABLE finance_entries      ALTER COLUMN valor          TYPE numeric(18,6);
ALTER TABLE goals                ALTER COLUMN valor_meta     TYPE numeric(18,6);
ALTER TABLE company_relationships ALTER COLUMN valor_estimado TYPE numeric(18,6);
