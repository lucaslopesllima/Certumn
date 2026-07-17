-- 065 — vínculo de série entre agendamentos materializados. Quando uma
-- recorrência é criada com quantidade > 1, as N ocorrências (WhatsApp/e-mail)
-- compartilham o mesmo serie_id (uuid gerado pela app). Permite editar/cancelar
-- a série inteira ou uma ocorrência só. NULL = agendamento avulso (sem série).
ALTER TABLE whatsapp_schedules ADD COLUMN IF NOT EXISTS serie_id uuid;
ALTER TABLE email_schedules ADD COLUMN IF NOT EXISTS serie_id uuid;
CREATE INDEX IF NOT EXISTS idx_wa_sched_serie ON whatsapp_schedules (serie_id) WHERE serie_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_email_sched_serie ON email_schedules (serie_id) WHERE serie_id IS NOT NULL;
