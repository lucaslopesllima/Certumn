-- 012 endereço e contato do estabelecimento (origem RFB), por empresa.
-- Campos vindos do arquivo ESTABELE que antes eram descartados. Tudo opcional
-- (estabelecimento pode não ter telefone/email/endereço completo).
ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS logradouro   text,
  ADD COLUMN IF NOT EXISTS numero       text,
  ADD COLUMN IF NOT EXISTS complemento  text,
  ADD COLUMN IF NOT EXISTS bairro       text,
  ADD COLUMN IF NOT EXISTS cep          char(8),
  ADD COLUMN IF NOT EXISTS telefone1    text,
  ADD COLUMN IF NOT EXISTS telefone2    text,
  ADD COLUMN IF NOT EXISTS email        text;
