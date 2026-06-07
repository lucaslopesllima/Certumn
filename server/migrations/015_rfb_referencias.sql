-- 015 tabelas de referência da RFB (decodificam os códigos em companies/socios).
-- Carregadas a cada atualização a partir dos arquivos auxiliares (NATJU, QUALS,
-- MOTI, PAIS). CNAE já vive em cnae_reference; município em municipios.
CREATE TABLE IF NOT EXISTS rfb_natureza (
  codigo integer PRIMARY KEY, descricao text NOT NULL);
CREATE TABLE IF NOT EXISTS rfb_qualificacao (
  codigo smallint PRIMARY KEY, descricao text NOT NULL);
CREATE TABLE IF NOT EXISTS rfb_motivo (
  codigo smallint PRIMARY KEY, descricao text NOT NULL);
CREATE TABLE IF NOT EXISTS rfb_pais (
  codigo integer PRIMARY KEY, descricao text NOT NULL);
