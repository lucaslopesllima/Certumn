-- 034 Cadastro de categorias financeiras + agrupador de DRE.
--
-- `categoria` (texto livre) continua existindo para lançamentos avulsos e
-- legados; `categoria_id` é o vínculo curado. O DRE agrupa por `grupo_dre`
-- (linha contábil: Operacional, Administrativa, etc.), caindo no texto livre
-- quando não há categoria vinculada.

CREATE TABLE IF NOT EXISTS finance_categories (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id      bigint NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  nome        text NOT NULL,
  grupo_dre   text NOT NULL DEFAULT 'Outras',     -- linha do DRE
  kind        finance_kind,                        -- típica de pagar/receber (null = ambos)
  ativo       boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, nome)
);

CREATE INDEX IF NOT EXISTS finance_categories_org_idx ON finance_categories (org_id, ativo);

ALTER TABLE finance_entries
  ADD COLUMN IF NOT EXISTS categoria_id bigint REFERENCES finance_categories(id) ON DELETE SET NULL;
