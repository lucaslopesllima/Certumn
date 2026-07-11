-- 057 — agendamento de e-mail também aparece na Agenda. Espelha 052 (WhatsApp):
-- cada agendamento cria um compromisso (activities.tipo='email'); este FK liga os
-- dois. Ao enviar, o compromisso vira 'feito'; ao cancelar/remover, é apagado.
-- ON DELETE SET NULL: apagar o compromisso na Agenda não derruba o agendamento.
ALTER TABLE email_schedules
  ADD COLUMN IF NOT EXISTS activity_id bigint REFERENCES activities(id) ON DELETE SET NULL;
