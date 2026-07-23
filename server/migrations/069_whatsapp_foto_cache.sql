-- 069 — cache local da foto de perfil das conversas. Antes o client apontava o
-- <img> direto pro CDN do WhatsApp (foto_url): quebra em produção (a CSP do app
-- não libera pps.whatsapp.net), as URLs expiram (param `oe`) e o hotlink vaza o
-- IP do usuário pro CDN da Meta. Agora o app baixa os bytes uma vez e serve por
-- /api/whatsapp/chats/:id/foto (mesma origem). foto_url segue guardada como
-- origem: quando muda, o cache é invalidado e rebaixado de novo.
ALTER TABLE whatsapp_chats ADD COLUMN IF NOT EXISTS foto_path text;
ALTER TABLE whatsapp_chats ADD COLUMN IF NOT EXISTS foto_b64 text;
ALTER TABLE whatsapp_chats ADD COLUMN IF NOT EXISTS foto_mime text;
ALTER TABLE whatsapp_chats ADD COLUMN IF NOT EXISTS foto_at timestamptz;
