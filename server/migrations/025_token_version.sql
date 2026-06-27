-- Versão de sessão por usuário: o JWT carrega `ver` e o requireAuth compara.
-- Incrementar (troca/reset de senha) derruba todos os tokens já emitidos.
ALTER TABLE users ADD COLUMN IF NOT EXISTS token_version int NOT NULL DEFAULT 0;
