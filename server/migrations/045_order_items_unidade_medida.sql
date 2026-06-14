-- 045 Snapshot da unidade de medida no item do pedido. Igual a descrição/preço:
-- copiado do produto no momento da inserção — catálogo muda, pedido não.
-- NULL = item sem unidade (ex.: item livre). Ver 044 (catalog_items.unidade_medida).
ALTER TABLE order_items
  ADD COLUMN IF NOT EXISTS unidade_medida_snapshot text;
