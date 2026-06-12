-- 022 performance p/ base de milhões de linhas.
--
-- 1) Busca digitada por CNPJ (recommend f.q com dígitos) usa c.cnpj LIKE 'NNN%'.
--    O índice UNIQUE de cnpj NÃO atende LIKE com a collation padrão (não-C),
--    então cada tecla virava seq scan na base inteira. bpchar_pattern_ops
--    habilita o prefix match por índice (cnpj é char(14) -> bpchar).
CREATE INDEX IF NOT EXISTS companies_cnpj_prefix_idx
  ON companies (cnpj bpchar_pattern_ops);

-- 2) Autovacuum por tabela. Defaults (20% de linhas mortas p/ vacuum, 10% p/
--    analyze) significam milhões de dead tuples acumulados após o UPSERT mensal
--    do ETL antes de qualquer limpeza — bloat e estatísticas velhas degradam
--    todos os planos. Thresholds proporcionais menores p/ as duas tabelas RFB.
ALTER TABLE companies SET (
  autovacuum_vacuum_scale_factor  = 0.02,
  autovacuum_analyze_scale_factor = 0.01
);

-- socios é recarregada por DELETE total + COPY a cada atualização da RFB:
-- a tabela inteira vira dead tuples de uma vez.
ALTER TABLE socios SET (
  autovacuum_vacuum_scale_factor  = 0.02,
  autovacuum_analyze_scale_factor = 0.01
);

-- 3) Estatísticas podem estar velhas em bases já carregadas (ETL antigo nunca
--    rodou ANALYZE em companies/socios). Atualiza uma vez aqui; daqui em diante
--    o ETL e o autovacuum mantêm.
ANALYZE companies;
ANALYZE socios;
