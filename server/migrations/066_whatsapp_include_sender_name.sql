-- 066 — opção por org: incluir o nome de quem enviou no texto da mensagem de WhatsApp.
-- Quando ligado, o envio (interativo, mídia com legenda ou agendado) prefixa o texto
-- que vai pro contato com "*Nome*:\n" — o mesmo nome já exibido no balão do app
-- (COALESCE(u.nome, o.nome, u.email)). O corpo guardado/prévia continuam crus (o app
-- já rotula o remetente). Default desligado (mantém o comportamento atual).
ALTER TABLE org_whatsapp_settings
  ADD COLUMN IF NOT EXISTS include_sender_name boolean NOT NULL DEFAULT false;
