-- 029 Fase 2: comissionamento. Regras por representada com precedência
-- (produto > cliente > vendedor > regra geral) e lançamentos gerados ao
-- faturar o pedido (1 por pedido — UNIQUE(order_id) garante idempotência).
-- A entry guarda snapshot de percent/split aplicados: regra muda, lançamento
-- emitido não. finance_entry_id liga o espelho criado na liquidação.

CREATE TABLE IF NOT EXISTS commission_rules (
  id                 bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id             bigint NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  represented_id     bigint NOT NULL REFERENCES represented_companies(id) ON DELETE CASCADE,
  catalog_item_id    bigint REFERENCES catalog_items(id) ON DELETE CASCADE,  -- regra por produto
  company_id         bigint REFERENCES companies(id) ON DELETE CASCADE,      -- regra por cliente
  user_id            bigint REFERENCES users(id) ON DELETE CASCADE,          -- regra por vendedor
  percent            numeric(5,2) NOT NULL,
  vendedor_split_pct numeric(5,2) NOT NULL DEFAULT 100,  -- % da comissão p/ vendedor
  vigencia_inicio    date NOT NULL,
  vigencia_fim       date,
  ativo              boolean NOT NULL DEFAULT true,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS commission_rules_org_repr_idx
  ON commission_rules (org_id, represented_id, ativo);

DO $$ BEGIN
  CREATE TYPE commission_status AS ENUM ('prevista','recebida','divergente','cancelada');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS commission_entries (
  id                 bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id             bigint NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  order_id           bigint NOT NULL UNIQUE REFERENCES orders(id) ON DELETE CASCADE,
  user_id            bigint REFERENCES users(id) ON DELETE SET NULL,
  represented_id     bigint NOT NULL REFERENCES represented_companies(id) ON DELETE CASCADE,
  competencia        date NOT NULL,                -- 1º dia do mês do faturamento
  valor_previsto     numeric(16,2) NOT NULL,
  valor_recebido     numeric(16,2),
  percent_aplicado   numeric(5,2) NOT NULL,        -- efetivo (média ponderada por item)
  vendedor_split_pct numeric(5,2) NOT NULL,
  status             commission_status NOT NULL DEFAULT 'prevista',
  recebida_em        date,
  observacao         text,
  finance_entry_id   bigint REFERENCES finance_entries(id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS commission_entries_org_comp_idx
  ON commission_entries (org_id, competencia, status);
CREATE INDEX IF NOT EXISTS commission_entries_org_repr_idx
  ON commission_entries (org_id, represented_id);
