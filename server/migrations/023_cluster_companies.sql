-- 023 ordenação física de companies por território.
--
-- Toda busca é territorial (municípios ou raio), mas as linhas estão na ordem
-- de carga do ETL (grupos por hash do CNPJ) — os ~500k candidatos de um raio de
-- 50km ficam espalhados por ~370k páginas (≈3GB lidas por busca; 50s frio).
-- CLUSTER por municipio_id coloca empresas do mesmo município contíguas no
-- disco (código IBGE prefixa a UF -> ordem ≈ geográfica).
--
-- CLUSTER exige índice NÃO-parcial; os índices existentes de municipio são
-- parciais (WHERE ativa), então criamos um pleno só p/ isso.
--
-- Manutenção: CLUSTER não se mantém sozinho — o UPSERT mensal degrada a ordem
-- aos poucos. Re-rodar `CLUSTER companies` (reusa este índice) após algumas
-- cargas, em janela de manutenção (lock exclusivo, ~minutos).
CREATE INDEX IF NOT EXISTS companies_municipio_full_idx ON companies (municipio_id);

CLUSTER companies USING companies_municipio_full_idx;

ANALYZE companies;
