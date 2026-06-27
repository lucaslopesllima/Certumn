-- 049 — mídia nas mensagens WhatsApp (paridade WhatsApp Web).
-- O webhook entrega só metadata da mídia; o binário é baixado sob demanda via
-- Evolution (getBase64FromMediaMessage) e cacheado em media_b64 na primeira
-- visualização (evita rebaixar a cada abertura). mime/file_name vêm do metadata.
ALTER TABLE whatsapp_messages ADD COLUMN IF NOT EXISTS mime      text;
ALTER TABLE whatsapp_messages ADD COLUMN IF NOT EXISTS file_name text;
ALTER TABLE whatsapp_messages ADD COLUMN IF NOT EXISTS media_b64 text;
