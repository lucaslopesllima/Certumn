-- 042 — configuração SMTP por organização (envio real de e-mail agendado).
-- Uma linha por org. password_enc guarda a senha cifrada (AES-256-GCM,
-- server/src/crypto.ts) — nunca trafega em claro pro client. enabled=false
-- desliga o disparo (o processador marca 'erro' se não houver SMTP ativo).
CREATE TABLE IF NOT EXISTS org_smtp_settings (
  org_id       bigint PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  host         text NOT NULL,
  port         integer NOT NULL DEFAULT 587,
  secure       boolean NOT NULL DEFAULT false,
  username     text,
  password_enc text,
  from_email   text NOT NULL,
  from_name    text,
  enabled      boolean NOT NULL DEFAULT false,
  updated_at   timestamptz NOT NULL DEFAULT now()
);
