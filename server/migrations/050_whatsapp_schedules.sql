-- 050 — agendamento de mensagens WhatsApp (Fase 2). Espelha email_schedules:
-- um processador no boot + a cada minuto varre os pendentes vencidos e envia via
-- Evolution. Sem instância conectada o envio TRAVA (segue pendente), não vira
-- 'erro' — igual ao SMTP. chat_id liga ao espelho; remote_jid é o destino real.
DO $$ BEGIN
  CREATE TYPE wa_schedule_status AS ENUM ('pendente','enviado','cancelado','erro');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS whatsapp_schedules (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id        bigint NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  chat_id       bigint REFERENCES whatsapp_chats(id) ON DELETE CASCADE,
  remote_jid    text NOT NULL,
  corpo         text NOT NULL,
  agendado_para timestamptz NOT NULL,
  status        wa_schedule_status NOT NULL DEFAULT 'pendente',
  enviado_em    timestamptz,
  erro          text,
  owner_user_id bigint REFERENCES users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS whatsapp_schedules_org_idx ON whatsapp_schedules (org_id, status);
CREATE INDEX IF NOT EXISTS whatsapp_schedules_due_idx ON whatsapp_schedules (agendado_para) WHERE status = 'pendente';
