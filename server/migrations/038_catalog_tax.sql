-- 038 Alíquotas por produto. Cada produto do catálogo pode definir suas próprias
-- alíquotas; ao criar pedido o item herda do produto e, SÓ se o produto não tiver
-- NENHUM imposto definido, cai no default da org (org_tax_defaults, ver 037).
-- NULL = não definido (distingue de 0 = isento). numeric(7,4), mesma escala dos
-- demais % do sistema (035_money_precision).
ALTER TABLE catalog_items
  ADD COLUMN IF NOT EXISTS icms_pct   numeric(7,4),
  ADD COLUMN IF NOT EXISTS ipi_pct    numeric(7,4),
  ADD COLUMN IF NOT EXISTS st_pct     numeric(7,4),
  ADD COLUMN IF NOT EXISTS pis_pct    numeric(7,4),
  ADD COLUMN IF NOT EXISTS cofins_pct numeric(7,4),
  ADD COLUMN IF NOT EXISTS iss_pct    numeric(7,4);
