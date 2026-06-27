-- 051 — conciliação de conversas (LID). O WhatsApp pode entregar a mesma pessoa
-- por dois jids: o do telefone (@s.whatsapp.net) e o LID (@lid), que oculta o
-- número. Isso gera DUAS conversas pro mesmo contato. Solução:
--  - whatsapp_chat_jids: 1..N jids por conversa. A resolução de mensagem passa a
--    ser jid -> chat_id por esta tabela (não mais só pelo remote_jid da conversa).
--  - whatsapp_chats.lid: guarda o jid @lid do contato (remote_jid segue como o
--    jid primário/telefone quando houver).
-- Merge (na rota) move mensagens/agendamentos/aliases de uma conversa pra outra
-- e funde os metadados — virando um contato único com telefone E lid.

ALTER TABLE whatsapp_chats ADD COLUMN IF NOT EXISTS lid text;

CREATE TABLE IF NOT EXISTS whatsapp_chat_jids (
  org_id     bigint NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  jid        text   NOT NULL,
  chat_id    bigint NOT NULL REFERENCES whatsapp_chats(id) ON DELETE CASCADE,
  tipo       text   NOT NULL DEFAULT 'phone',  -- phone (@s.whatsapp.net) | lid (@lid) | grupo
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, jid)
);
CREATE INDEX IF NOT EXISTS whatsapp_chat_jids_chat_idx ON whatsapp_chat_jids (chat_id);

-- Backfill: cada conversa existente vira um alias do seu próprio remote_jid.
INSERT INTO whatsapp_chat_jids (org_id, jid, chat_id, tipo)
SELECT org_id, remote_jid, id,
       CASE WHEN remote_jid LIKE '%@lid' THEN 'lid'
            WHEN remote_jid LIKE '%@g.us' THEN 'grupo' ELSE 'phone' END
  FROM whatsapp_chats
ON CONFLICT (org_id, jid) DO NOTHING;

-- Conversas que já chegaram como @lid: registra o lid na coluna dedicada.
UPDATE whatsapp_chats SET lid = remote_jid WHERE remote_jid LIKE '%@lid' AND lid IS NULL;
