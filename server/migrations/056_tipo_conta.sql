-- Tipo de conta do tenant: escritório (multi-usuário, default histórico) ou individual.
-- Individual esconde a dimensão equipe/RBAC/carteiras e o server bloqueia usuários extras.
ALTER TABLE organizations
  ADD COLUMN tipo_conta text NOT NULL DEFAULT 'escritorio'
  CHECK (tipo_conta IN ('escritorio', 'individual'));
