-- 037 Alíquotas de impostos. Default por org (org_tax_defaults) buscado na
-- criação do pedido; cada item do pedido guarda a CÓPIA das alíquotas vigentes
-- naquele momento — catálogo/config mudam, pedido emitido não. Percentuais em
-- numeric(7,4) (mesma escala dos demais % do sistema, ver 035_money_precision).

-- Default da org (uma linha por org). Tudo 0 = sem imposto até o admin configurar.
CREATE TABLE IF NOT EXISTS org_tax_defaults (
  org_id     bigint PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  icms_pct   numeric(7,4) NOT NULL DEFAULT 0,
  ipi_pct    numeric(7,4) NOT NULL DEFAULT 0,
  st_pct     numeric(7,4) NOT NULL DEFAULT 0,
  pis_pct    numeric(7,4) NOT NULL DEFAULT 0,
  cofins_pct numeric(7,4) NOT NULL DEFAULT 0,
  iss_pct    numeric(7,4) NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Cópia das alíquotas por item do pedido. ipi_pct/st_pct já existem (027);
-- adiciona os demais impostos. Defaults 0 (itens antigos não tinham esses).
ALTER TABLE order_items
  ADD COLUMN IF NOT EXISTS icms_pct   numeric(7,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pis_pct    numeric(7,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cofins_pct numeric(7,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS iss_pct    numeric(7,4) NOT NULL DEFAULT 0;

-- Recria a coluna GENERATED total: o banco recalcula cru a partir de qtd/preço/
-- percentuais, agora somando TODOS os impostos por fora (mesmo tratamento de
-- ipi/st em 035). Precisa dropar e recriar — coluna gerada não dá ALTER de fórmula.
ALTER TABLE order_items DROP COLUMN IF EXISTS total;
ALTER TABLE order_items
  ADD COLUMN total numeric(18,6)
    GENERATED ALWAYS AS (
      qtd * preco_unit * (1 - desconto_pct / 100)
          * (1 + (icms_pct + ipi_pct + st_pct + pis_pct + cofins_pct + iss_pct) / 100)
    ) STORED;
