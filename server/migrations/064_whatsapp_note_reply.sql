-- Nota "pendurada" numa mensagem: referência opcional à mensagem citada. Usada
-- só por notas internas (menu de ações do balão), mas genérica. ON DELETE SET
-- NULL: apagar a mensagem citada não apaga a nota, só solta a âncora.
ALTER TABLE whatsapp_messages
  ADD COLUMN IF NOT EXISTS reply_to_id bigint REFERENCES whatsapp_messages(id) ON DELETE SET NULL;
