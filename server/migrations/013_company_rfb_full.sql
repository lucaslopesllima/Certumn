-- 013 demais campos da empresa/estabelecimento (RFB) que faltavam.
-- Códigos ficam como int/smallint (decodificáveis pelas tabelas rfb_* da 015).
ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS data_inicio_atividade   date,
  ADD COLUMN IF NOT EXISTS matriz_filial           smallint,   -- 1=matriz, 2=filial
  ADD COLUMN IF NOT EXISTS natureza_juridica        integer,
  ADD COLUMN IF NOT EXISTS qualificacao_responsavel smallint,
  ADD COLUMN IF NOT EXISTS ente_federativo          text,
  ADD COLUMN IF NOT EXISTS motivo_situacao          smallint,
  ADD COLUMN IF NOT EXISTS data_situacao_cadastral  date,
  ADD COLUMN IF NOT EXISTS situacao_especial        text,
  ADD COLUMN IF NOT EXISTS data_situacao_especial   date,
  ADD COLUMN IF NOT EXISTS nome_cidade_exterior     text,
  ADD COLUMN IF NOT EXISTS pais                     integer,
  ADD COLUMN IF NOT EXISTS fax                      text,
  -- Simples Nacional / MEI (do arquivo SIMPLES)
  ADD COLUMN IF NOT EXISTS opcao_simples            char(1),    -- S / N
  ADD COLUMN IF NOT EXISTS data_opcao_simples       date,
  ADD COLUMN IF NOT EXISTS data_exclusao_simples    date,
  ADD COLUMN IF NOT EXISTS opcao_mei                char(1),
  ADD COLUMN IF NOT EXISTS data_opcao_mei           date,
  ADD COLUMN IF NOT EXISTS data_exclusao_mei        date;
