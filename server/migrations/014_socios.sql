-- 014 quadro societário (arquivo SOCIOCSV da RFB). Uma linha por sócio.
-- Ligado à empresa pelo cnpj_base (nível raiz do CNPJ, 8 dígitos).
CREATE TABLE IF NOT EXISTS socios (
  id                        bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  cnpj_base                 char(8) NOT NULL,
  identificador             smallint,          -- 1=PJ, 2=PF, 3=estrangeiro
  nome                      text,              -- nome do sócio (ou razão social se PJ)
  cnpj_cpf                  text,              -- CPF mascarado (***NNNNNN**) ou CNPJ
  qualificacao              smallint,          -- ref rfb_qualificacao
  data_entrada              date,
  pais                      integer,           -- ref rfb_pais
  representante_legal       text,              -- CPF do representante
  nome_representante        text,
  qualificacao_representante smallint,         -- ref rfb_qualificacao
  faixa_etaria              smallint,          -- 1..9 (faixas de idade)
  source                    company_source NOT NULL DEFAULT 'rfb'
);
CREATE INDEX IF NOT EXISTS idx_socios_cnpj_base ON socios (cnpj_base);
CREATE INDEX IF NOT EXISTS idx_socios_source ON socios (source);
