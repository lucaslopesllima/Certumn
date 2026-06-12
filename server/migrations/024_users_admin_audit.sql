-- 024 Fase 0: gestão de usuários pelo admin + trilha de auditoria.
-- users ganha nome/ativo/must_change_password (admin cria vendedor com senha
-- provisória; primeiro login força troca). audit_log registra mutações de
-- entidades de negócio (relationships, finance, users) — escrito pela aplicação.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS nome text,
  ADD COLUMN IF NOT EXISTS ativo boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS must_change_password boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS audit_log (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id      bigint NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id     bigint REFERENCES users(id) ON DELETE SET NULL,
  entity      text NOT NULL,          -- 'relationship' | 'finance' | 'user' | ...
  entity_id   bigint NOT NULL,
  action      text NOT NULL,          -- 'create' | 'update' | 'delete' | ...
  diff        jsonb,                  -- campos enviados na mutação (nunca senhas)
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS audit_org_entity_idx
  ON audit_log (org_id, entity, entity_id, created_at DESC);
