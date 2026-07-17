-- 062 — atendente que enviou a mensagem de WhatsApp pelo sistema.
-- Preenchido só em envios feitos pela aplicação (interativo ou agendado); mensagem
-- enviada direto do celular chega via webhook sem autor e fica NULL.
ALTER TABLE whatsapp_messages
  ADD COLUMN IF NOT EXISTS sender_user_id bigint REFERENCES users(id) ON DELETE SET NULL;
