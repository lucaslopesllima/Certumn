-- 061 — recorrência de mensagens agendadas de WhatsApp. NULL = envio único.
-- Modelo rolante: só a próxima ocorrência existe como agendamento pendente (com
-- compromisso espelho na Agenda); quando o processador envia, ele mesmo agenda a
-- ocorrência seguinte. Cancelar o pendente encerra a série.
ALTER TABLE whatsapp_schedules
  ADD COLUMN IF NOT EXISTS recorrencia text
  CHECK (recorrencia IN ('diaria','semanal','mensal','anual'));
