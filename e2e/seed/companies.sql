-- Seed determinístico de `companies` para e2e (pool global, não escopado por
-- org — replica o papel do ETL da Receita Federal ausente em dev). Aplicado
-- pelo global-setup.ts após TRUNCATE companies CASCADE.
--
-- 160 empresas "normais" espalhadas em 4 municípios reais (São Paulo, Campinas,
-- Rio de Janeiro, Curitiba), cnae/porte variados, situação ativa.
-- 30 empresas em CLUSTER geográfico denso (bairro fictício em São Paulo) — usado
-- pelo teste de agrupamento de marcadores no mapa (10-prospeccao/mapa.spec.ts).
-- 5 empresas SEM geom (situação ativa, mas não geocodificáveis) — usado pelo
-- teste "aparece na lista mas não no mapa" (10-prospeccao/acao.spec.ts).
-- 5 empresas com situação BAIXADA — usado pelo teste de filtro por situação.
-- CNPJ prefixo 9 (nunca colide com CNPJ real de 14 dígitos começando por 9 em
-- volume relevante) + sequência — mesmo padrão de server/test/helpers.ts.

-- /api/recommend só devolve candidatos de UF/região "habilitada" (gate que, em
-- produção, o ETL liga UF por UF conforme importa a Receita — server/etl/etl.ts).
-- Sem isso a tabela enabled_regions fica vazia e a recomendação SEMPRE devolve
-- zero resultados, não importa o território escolhido. Habilita as UFs do seed.
INSERT INTO enabled_regions (uf, regiao) VALUES
  ('SP', 'SE'), ('RJ', 'SE'), ('PR', 'S')
ON CONFLICT (uf) DO NOTHING;

WITH municipios_alvo (municipio_id, lat, lon) AS (
  VALUES (3550308, -23.5505, -46.6333),  -- São Paulo/SP
         (3509502, -22.9099, -47.0626),  -- Campinas/SP
         (3304557, -22.9068, -43.1729),  -- Rio de Janeiro/RJ
         (4106902, -25.4284, -49.2733)   -- Curitiba/PR
),
cnaes_alvo (cnae, uf_hint) AS (
  VALUES (4781400, 'SP'), (4711302, 'SP'), (6201501, 'SP'), (4930202, 'SP'),
         (4110700, 'RJ'), (1091101, 'PR'), (4520001, 'PR'), (6920601, 'SP')
),
normais AS (
  SELECT
    gs AS i,
    (SELECT municipio_id FROM municipios_alvo OFFSET (gs % 4) LIMIT 1) AS municipio_id,
    (SELECT lat FROM municipios_alvo OFFSET (gs % 4) LIMIT 1) AS base_lat,
    (SELECT lon FROM municipios_alvo OFFSET (gs % 4) LIMIT 1) AS base_lon,
    (SELECT cnae FROM cnaes_alvo OFFSET (gs % 8) LIMIT 1) AS cnae,
    (ARRAY['micro','pequeno','demais']::porte_emp[])[1 + (gs % 3)] AS porte,
    (ARRAY['SP','SP','RJ','PR'])[1 + (gs % 4)] AS uf
  FROM generate_series(1, 160) AS gs
)
INSERT INTO companies (cnpj, razao_social, nome_fantasia, cnae_principal, municipio_id, uf, regiao, geom, porte, capital_social, situacao_cadastral, source)
SELECT
  lpad((90000000000000 + i)::text, 14, '0'),
  'Empresa E2E ' || i || ' Ltda',
  'E2E Fantasia ' || i,
  cnae,
  municipio_id,
  uf,
  CASE uf WHEN 'PR' THEN 'S' ELSE 'SE' END::regiao_br,
  ST_SetSRID(ST_MakePoint(base_lon + ((i % 21) - 10) * 0.01, base_lat + ((i % 17) - 8) * 0.01), 4326)::geography,
  porte,
  10000 + (i * 1000),
  'ativa',
  'manual'
FROM normais;

-- Cluster denso: 30 empresas num raio de ~200m em São Paulo (bairro fictício).
INSERT INTO companies (cnpj, razao_social, nome_fantasia, cnae_principal, municipio_id, uf, regiao, geom, porte, capital_social, situacao_cadastral, source)
SELECT
  lpad((90000000000200 + gs)::text, 14, '0'),
  'Empresa E2E Cluster ' || gs || ' Ltda',
  'E2E Cluster ' || gs,
  4781400,
  3550308, 'SP', 'SE',
  ST_SetSRID(ST_MakePoint(-46.6500 + (gs % 6) * 0.0006, -23.5600 + (gs % 5) * 0.0006), 4326)::geography,
  'pequeno', 50000, 'ativa', 'manual'
FROM generate_series(1, 30) AS gs;

-- Sem geom: situação ativa mas sem localização (não aparece no mapa, aparece na lista).
INSERT INTO companies (cnpj, razao_social, nome_fantasia, cnae_principal, municipio_id, uf, regiao, geom, porte, capital_social, situacao_cadastral, source)
SELECT
  lpad((90000000000300 + gs)::text, 14, '0'),
  'Empresa E2E SemGeo ' || gs || ' Ltda',
  'E2E SemGeo ' || gs,
  4781400,
  3550308, 'SP', 'SE', NULL,
  'micro', 5000, 'ativa', 'manual'
FROM generate_series(1, 5) AS gs;

-- Baixada: situação cadastral não-ativa, usada pra testar filtro de situação.
INSERT INTO companies (cnpj, razao_social, nome_fantasia, cnae_principal, municipio_id, uf, regiao, geom, porte, capital_social, situacao_cadastral, source)
SELECT
  lpad((90000000000400 + gs)::text, 14, '0'),
  'Empresa E2E Baixada ' || gs || ' Ltda',
  'E2E Baixada ' || gs,
  4781400,
  3550308, 'SP', 'SE',
  ST_SetSRID(ST_MakePoint(-46.63 + gs * 0.001, -23.55 + gs * 0.001), 4326)::geography,
  'micro', 5000, 'baixada', 'manual'
FROM generate_series(1, 5) AS gs;
