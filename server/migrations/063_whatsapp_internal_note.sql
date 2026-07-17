-- Notas internas: balões que a equipe cria na conversa mas NUNCA são enviados
-- ao contato do WhatsApp (sem evolution_id, sem chamada à Evolution). Visíveis a
-- toda a organização, distinguidos deste flag.
ALTER TABLE whatsapp_messages
  ADD COLUMN IF NOT EXISTS internal boolean NOT NULL DEFAULT false;
