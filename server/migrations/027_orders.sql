-- 027 Fase 1: pedidos de venda. Cotação é pedido com status='cotacao' +
-- validade; conversão é transição de status (sem tabela paralela).
-- order_items guarda snapshot de descrição/preço — catálogo muda, pedido não.

DO $$ BEGIN
  CREATE TYPE order_status AS ENUM
    ('cotacao','rascunho','enviado','faturado','entregue','cancelado');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS orders (
  id                 bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id             bigint NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  numero             int NOT NULL,        -- sequencial por org (advisory lock no INSERT)
  relationship_id    bigint REFERENCES company_relationships(id) ON DELETE SET NULL,
  company_id         bigint NOT NULL REFERENCES companies(id),
  represented_id     bigint NOT NULL REFERENCES represented_companies(id),
  owner_user_id      bigint REFERENCES users(id) ON DELETE SET NULL,
  price_table_id     bigint REFERENCES price_tables(id) ON DELETE SET NULL,
  status             order_status NOT NULL DEFAULT 'rascunho',
  validade           date,                -- p/ cotação
  condicao_pagamento text,
  transportadora     text,
  frete              numeric(16,2) NOT NULL DEFAULT 0,
  observacoes        text,
  total              numeric(16,2) NOT NULL DEFAULT 0,  -- recalculado server-side
  nf_numero          text,
  emitido_em         timestamptz,         -- quando saiu de rascunho (enviado)
  faturado_em        timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, numero)
);
CREATE INDEX IF NOT EXISTS orders_org_status_idx ON orders (org_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS orders_org_repr_idx   ON orders (org_id, represented_id);
CREATE INDEX IF NOT EXISTS orders_company_idx    ON orders (company_id);

CREATE TABLE IF NOT EXISTS order_items (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id          bigint NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  catalog_item_id   bigint REFERENCES catalog_items(id) ON DELETE SET NULL,
  descricao_snapshot text NOT NULL,
  qtd               numeric(16,3) NOT NULL,
  preco_unit        numeric(16,2) NOT NULL,
  desconto_pct      numeric(5,2) NOT NULL DEFAULT 0,
  ipi_pct           numeric(5,2) NOT NULL DEFAULT 0,
  st_pct            numeric(5,2) NOT NULL DEFAULT 0,
  total             numeric(16,2) NOT NULL
);
CREATE INDEX IF NOT EXISTS order_items_order_idx ON order_items (order_id);
