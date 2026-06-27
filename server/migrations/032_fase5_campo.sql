-- 032 Fase 5 — campo: check-in de visita, relatório pós-visita e rotas-template.
--
-- 1) activities ganha check-in geolocalizado (lat/lon/at) + relatorio jsonb
--    (resultado, proximo_passo, texto). O relatório alimenta data_contato do
--    relationship vinculado, que zera o alerta de inatividade da Fase 4.
-- 2) routes ganha template/recorrencia: uma rota marcada como template pode ser
--    "reusada" (re-otimizada) gerando uma rota nova. recorrencia é texto livre
--    por enquanto (ex.: 'semanal-seg').

ALTER TABLE activities
  ADD COLUMN IF NOT EXISTS checkin_lat double precision,
  ADD COLUMN IF NOT EXISTS checkin_lon double precision,
  ADD COLUMN IF NOT EXISTS checkin_at  timestamptz,
  ADD COLUMN IF NOT EXISTS relatorio   jsonb;

ALTER TABLE routes
  ADD COLUMN IF NOT EXISTS template    boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS recorrencia text;

-- "Reusar rota" varre os templates da org (e do vendedor).
CREATE INDEX IF NOT EXISTS routes_org_template_idx ON routes (org_id) WHERE template;
