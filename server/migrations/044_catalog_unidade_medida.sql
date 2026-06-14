-- 044 Unidade de medida por produto (ex.: UN, KG, L, M, M2, CX, PC).
-- Texto livre, opcional. NULL = não informado.
ALTER TABLE catalog_items
  ADD COLUMN IF NOT EXISTS unidade_medida text;
