-- 043 — repetição do envio agendado. null/'nenhuma' = envio único; 'diaria',
-- 'semanal', 'mensal' = ao enviar, o processador agenda a próxima ocorrência
-- (nova linha pendente) avançando agendado_para pelo intervalo.
ALTER TABLE email_schedules
  ADD COLUMN IF NOT EXISTS recorrencia text;
