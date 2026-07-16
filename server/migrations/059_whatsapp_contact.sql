-- 059 — vincula a conversa do WhatsApp a um contato (pessoa) da base.
-- Complementa company_id/relationship_id: quando a mensagem vem de um número
-- desconhecido, "Salvar contato" cria o contato e grava contact_id aqui. Assim a
-- conversa passa a exibir o nome do contato e o vínculo persiste — sem depender de
-- empresa vinculada. ON DELETE SET NULL: apagar o contato só desfaz o vínculo.
ALTER TABLE whatsapp_chats
  ADD COLUMN IF NOT EXISTS contact_id bigint REFERENCES contacts(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS whatsapp_chats_contact_idx ON whatsapp_chats (contact_id);
