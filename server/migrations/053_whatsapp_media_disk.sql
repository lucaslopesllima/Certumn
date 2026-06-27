-- 053 — mídia WhatsApp em disco (em vez de base64 no Postgres). Quando
-- WHATSAPP_MEDIA_DIR está setado, o binário descriptografado é gravado no volume
-- e só o caminho relativo fica aqui; media_b64 segue como fallback p/ linhas
-- antigas (e p/ instalações sem disco configurado).
ALTER TABLE whatsapp_messages ADD COLUMN IF NOT EXISTS media_path text;
