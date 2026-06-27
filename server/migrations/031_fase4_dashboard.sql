-- 031 Fase 4 — dashboard, relatórios e alertas.
--
-- 1) organizations.inatividade_dias: N de dias sem contato que dispara o alerta
--    de inatividade no dashboard (configurável por org, default 30).
-- 2) company_relationships.motivo_descarte: texto livre preenchido ao mover um
--    negócio para status='descartado' (alimenta o relatório de perdas por motivo).
-- 3) company_relationships.stage_changed_at: quando o card entrou no stage atual.
--    Usado pelo alerta "negócio parado no mesmo stage há 30+ dias". Default now()
--    nas linhas existentes (zera o relógio na migration — aceitável).

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS inatividade_dias int NOT NULL DEFAULT 30;

ALTER TABLE company_relationships
  ADD COLUMN IF NOT EXISTS motivo_descarte  text,
  ADD COLUMN IF NOT EXISTS stage_changed_at timestamptz NOT NULL DEFAULT now();

-- Dashboard/relatórios filtram pedidos faturados por mês e vendedor.
CREATE INDEX IF NOT EXISTS orders_org_faturado_idx
  ON orders (org_id, faturado_em)
  WHERE status IN ('faturado', 'entregue');

-- Alerta de negócios parados varre por stage_changed_at dentro do funil ativo.
CREATE INDEX IF NOT EXISTS rel_org_stage_changed_idx
  ON company_relationships (org_id, stage_changed_at);
