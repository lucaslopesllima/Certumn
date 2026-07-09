// Armazenamento de mídia WhatsApp em disco local (volume). A alternativa barata
// ao base64-no-Postgres: descriptografa uma vez (via Evolution) e grava o binário
// num volume, guardando só o caminho relativo no banco. Vazio em config =
// desligado (cai no base64 legado).
import { mkdir, writeFile, readFile, stat } from 'node:fs/promises';
import { createReadStream, type ReadStream } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { config } from './config.ts';

export function mediaEnabled(): boolean {
  return config.whatsappMediaDir !== '';
}

// Extensão a partir do mimetype (cosmética — o content-type servido vem da coluna
// mime). Cai no fileName e, por fim, em 'bin'.
const EXT: Record<string, string> = {
  'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif',
  'video/mp4': 'mp4', 'video/3gpp': '3gp', 'video/quicktime': 'mov',
  'audio/ogg': 'ogg', 'audio/mpeg': 'mp3', 'audio/mp4': 'm4a', 'audio/amr': 'amr', 'audio/wav': 'wav',
  'application/pdf': 'pdf',
};
function extFor(mime: string | null, fileName?: string | null): string {
  if (mime && EXT[mime]) return EXT[mime]!;
  if (mime) {
    const sub = mime.split('/')[1]?.replace(/[^a-z0-9]+/gi, '');
    if (sub) return sub.slice(0, 8).toLowerCase();
  }
  const fe = fileName?.split('.').pop();
  if (fe && /^[a-z0-9]{1,8}$/i.test(fe)) return fe.toLowerCase();
  return 'bin';
}

// Grava a mídia (base64) em <dir>/<orgId>/<msgId>.<ext> e devolve o caminho
// relativo guardado no banco. Nome gerado por nós — sem entrada do usuário.
export async function saveMedia(
  orgId: number, msgId: string, b64: string, mime: string | null, fileName?: string | null,
): Promise<string> {
  const rel = `${orgId}/${msgId}.${extFor(mime, fileName)}`;
  await mkdir(join(config.whatsappMediaDir, String(orgId)), { recursive: true });
  await writeFile(join(config.whatsappMediaDir, rel), Buffer.from(b64, 'base64'));
  return rel;
}

// Resolve o caminho absoluto validando que fica dentro do diretório configurado
// (defesa em profundidade contra path traversal) — relPath vem do banco.
function resolveMediaPath(relPath: string): string {
  const root = resolve(config.whatsappMediaDir);
  const abs = resolve(root, relPath);
  if (abs !== root && !abs.startsWith(root + sep)) throw new Error('caminho de mídia inválido');
  return abs;
}

// Lê a mídia do disco (buffer inteiro — usar mediaStream para servir via HTTP).
export async function readMedia(relPath: string): Promise<Buffer> {
  return readFile(resolveMediaPath(relPath));
}

// Stream da mídia do disco — serve arquivos grandes sem carregar tudo em memória.
// stat antes do createReadStream: arquivo sumido lança aqui e o caller cai no
// fallback (base64/Evolution); o size alimenta o content-length.
export async function mediaStream(relPath: string): Promise<{ stream: ReadStream; size: number }> {
  const abs = resolveMediaPath(relPath);
  const st = await stat(abs);
  return { stream: createReadStream(abs), size: st.size };
}
