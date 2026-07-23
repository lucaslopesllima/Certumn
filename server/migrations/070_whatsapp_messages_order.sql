-- 070 — ordem estável das mensagens de WhatsApp.
-- momento vem do messageTimestamp do WhatsApp, que tem resolução de SEGUNDO:
-- duas mensagens no mesmo segundo (rajada, mídia + legenda, envio em sequência)
-- empatam e o Postgres devolve em ordem arbitrária — a conversa embaralha e a
-- ordem pode até mudar entre dois fetches iguais. O desempate é o id (identity,
-- monotônico e na ordem de gravação). Índice acompanha a chave de ordenação
-- pra manter a leitura por índice, sem sort.
DROP INDEX IF EXISTS whatsapp_messages_chat_idx;
CREATE INDEX IF NOT EXISTS whatsapp_messages_chat_idx
  ON whatsapp_messages (chat_id, momento, id);
