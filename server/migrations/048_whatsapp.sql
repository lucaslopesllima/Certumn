-- 048 — integração WhatsApp via Evolution API (Fase 1: espelho de chat).
-- Três objetos, todos multi-tenant por org_id (isolamento igual ao resto):
--  org_whatsapp_settings: 1 linha por org. instance_name = instância na Evolution
--    (única); numero/status preenchidos após conectar (QR). Sem segredo aqui — a
--    API key da Evolution é global e fica no env do servidor, não por org.
--  whatsapp_chats: uma conversa por (org, remote_jid). last_message_* alimenta a
--    lista lateral; relationship_id/company_id ligam a conversa ao funil (Fase 2).
--  whatsapp_messages: mensagens espelhadas. evolution_id deduplica reentrega de
--    webhook (UNIQUE parcial — ids nulos não colidem).

CREATE TABLE IF NOT EXISTS org_whatsapp_settings (
  org_id        bigint PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  instance_name text NOT NULL UNIQUE,
  numero        text,
  status        text NOT NULL DEFAULT 'desconectado',  -- desconectado|conectando|conectado
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS whatsapp_chats (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id           bigint NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  remote_jid       text NOT NULL,            -- ex.: 5511999999999@s.whatsapp.net
  numero           text,                     -- só dígitos, derivado do jid
  nome             text,                     -- pushName/contato
  foto_url         text,
  company_id       bigint REFERENCES companies(id),
  relationship_id  bigint REFERENCES company_relationships(id) ON DELETE SET NULL,
  last_message_at  timestamptz,
  last_preview     text,
  nao_lidas        int NOT NULL DEFAULT 0,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, remote_jid)
);
CREATE INDEX IF NOT EXISTS whatsapp_chats_org_idx
  ON whatsapp_chats (org_id, last_message_at DESC NULLS LAST);

CREATE TABLE IF NOT EXISTS whatsapp_messages (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id       bigint NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  chat_id      bigint NOT NULL REFERENCES whatsapp_chats(id) ON DELETE CASCADE,
  evolution_id text,                         -- id da mensagem no WhatsApp (dedup)
  from_me      boolean NOT NULL,
  tipo         text NOT NULL DEFAULT 'texto', -- texto|imagem|audio|video|documento|outro
  corpo        text,
  media_url    text,
  status       text,                         -- enviado|entregue|lido (saída)
  momento      timestamptz NOT NULL DEFAULT now(),
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS whatsapp_messages_chat_idx
  ON whatsapp_messages (chat_id, momento);
-- dedup de reentrega: mesma mensagem (org, evolution_id) entra uma vez só.
CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_messages_dedup_idx
  ON whatsapp_messages (org_id, evolution_id) WHERE evolution_id IS NOT NULL;
