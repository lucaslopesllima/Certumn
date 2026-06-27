-- 040 — agendamento de envio de e-mail (scaffold). Dois objetos:
--  email_templates: modelos reutilizáveis (nome/assunto/corpo) por org.
--  email_schedules: e-mails agendados; destinatário vem de uma empresa da base
--    (company_id, e-mail puxado direto) OU digitado manual (destinatario livre).
-- O envio em si é STUB por ora (server/src/email.ts): um processador no boot +
-- intervalo varre os pendentes vencidos e marca 'enviado' sem SMTP real. Trocar
-- sendEmail() por integração real quando houver credencial.

DO $$ BEGIN
  CREATE TYPE email_schedule_status AS ENUM ('pendente','enviado','cancelado','erro');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS email_templates (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id        bigint NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  nome          text NOT NULL,
  assunto       text NOT NULL,
  corpo         text NOT NULL,
  owner_user_id bigint REFERENCES users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS email_templates_org_idx ON email_templates (org_id);

CREATE TABLE IF NOT EXISTS email_schedules (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id        bigint NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  template_id   bigint REFERENCES email_templates(id) ON DELETE SET NULL,
  company_id    bigint REFERENCES companies(id),
  destinatario  text NOT NULL,
  assunto       text NOT NULL,
  corpo         text NOT NULL,
  agendado_para timestamptz NOT NULL,
  status        email_schedule_status NOT NULL DEFAULT 'pendente',
  enviado_em    timestamptz,
  erro          text,
  owner_user_id bigint REFERENCES users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS email_schedules_org_status_idx ON email_schedules (org_id, status);
-- índice parcial p/ o processador: só pendentes, ordenados pelo horário-alvo.
CREATE INDEX IF NOT EXISTS email_schedules_due_idx ON email_schedules (agendado_para) WHERE status = 'pendente';
