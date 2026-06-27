-- 052 — agendamento de WhatsApp também aparece na Agenda. Cada agendamento cria
-- um compromisso espelho (activities.tipo='whatsapp'); este FK liga os dois. Ao
-- enviar, o compromisso vira 'feito'; ao cancelar o agendamento, é removido.
-- ON DELETE SET NULL: apagar o compromisso na Agenda não derruba o agendamento.
ALTER TABLE whatsapp_schedules
  ADD COLUMN IF NOT EXISTS activity_id bigint REFERENCES activities(id) ON DELETE SET NULL;
