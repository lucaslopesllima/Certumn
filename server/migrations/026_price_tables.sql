-- 026 Fase 1: tabelas de preço por representada, com vigência.
-- Itens guardam preço acordado + teto de desconto; o pedido copia (snapshot)
-- na hora — alterar a tabela nunca mexe em pedido já criado.

CREATE TABLE IF NOT EXISTS price_tables (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id          bigint NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  represented_id  bigint NOT NULL REFERENCES represented_companies(id) ON DELETE CASCADE,
  nome            text NOT NULL,
  vigencia_inicio date NOT NULL,
  vigencia_fim    date,                  -- NULL = sem fim definido
  ativo           boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS price_tables_org_idx
  ON price_tables (org_id, represented_id, ativo, vigencia_inicio DESC);

CREATE TABLE IF NOT EXISTS price_table_items (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  price_table_id   bigint NOT NULL REFERENCES price_tables(id) ON DELETE CASCADE,
  catalog_item_id  bigint NOT NULL REFERENCES catalog_items(id) ON DELETE CASCADE,
  preco            numeric(16,2) NOT NULL,
  desconto_max_pct numeric(5,2),         -- NULL = sem teto
  UNIQUE (price_table_id, catalog_item_id)
);
CREATE INDEX IF NOT EXISTS price_table_items_catalog_idx
  ON price_table_items (catalog_item_id);
