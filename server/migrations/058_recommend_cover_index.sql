-- 058 — busca de empresas (recomendação) instantânea na base global de 28,9M.
--
-- Índice de cobertura para o scan de candidatos do /api/recommend virar
-- Index Only Scan: parcial em (municipio_id) com todas as colunas do score no
-- INCLUDE. Elimina o acesso ao heap de 18GB (o gargalo — antes ~29s no pior
-- caso, São Paulo capital com ~2,7M ativas). Combinado com a query reescrita
-- (ln em float8, regiões como arrays escalares, proximidade por município) leva
-- o pior caso para <1s.
--
-- Custo: ~1,8GB de índice, mantido pelo upsert do ETL. Build único de alguns
-- minutos (SHARE lock — bloqueia escrita, não leitura; o ETL roda em janela
-- própria). Não é CONCURRENTLY porque o runner aplica cada migração numa
-- transação (CREATE INDEX CONCURRENTLY não roda em bloco transacional).
CREATE INDEX IF NOT EXISTS companies_reco_cov_idx
  ON companies (municipio_id)
  INCLUDE (id, uf, regiao, cnae_principal, cnae_divisao, porte, capital_social)
  WHERE situacao_cadastral = 'ativa';

-- São Paulo capital tem ~2,7M ativas (outlier). Com a amostra padrão o planner
-- subestima e cai em plano serial; mais estatística em municipio_id fixa a
-- estimativa e habilita o plano paralelo. (O ETL/autovacuum roda o ANALYZE.)
ALTER TABLE companies ALTER COLUMN municipio_id SET STATISTICS 1000;

-- O Index Only Scan só evita o heap com a visibility map preenchida (VACUUM).
-- VACUUM não roda em transação, então não cabe aqui: o ETL faz VACUUM ANALYZE
-- ao final da carga e o autovacuum mantém depois.
