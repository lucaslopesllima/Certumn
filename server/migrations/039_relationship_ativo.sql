-- 039 Flag ativo/inativo no relacionamento (cliente ativo vs. inativo).
-- Soft-state separado do status (prospect/cliente/descartado): um cliente pode
-- ficar inativo sem virar 'descartado'. Default true = todos os atuais ativos.
ALTER TABLE company_relationships
  ADD COLUMN IF NOT EXISTS ativo boolean NOT NULL DEFAULT true;
