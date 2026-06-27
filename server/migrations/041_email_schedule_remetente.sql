-- 041 — remetente (e-mail de origem) do agendamento. No POST o front sugere o
-- e-mail do usuário logado, mas é editável; o backend cai pro e-mail do usuário
-- quando vem vazio. Nullable: o processador usa fallback se faltar.
ALTER TABLE email_schedules
  ADD COLUMN IF NOT EXISTS remetente text;
