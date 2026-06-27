import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import { config } from './config.ts';

// Cifra simétrica para segredos at rest (hoje: senha SMTP). Chave derivada do
// jwtSecret via scrypt — sem novo env. Formato do blob: "iv:tag:cipher" (hex).
// AES-256-GCM dá confidencialidade + integridade (tag autentica o conteúdo).
const KEY = scryptSync(config.jwtSecret, 'smtp-creds-v1', 32);

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', KEY, iv);
  const enc = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  const tag = c.getAuthTag();
  return `${iv.toString('hex')}:${tag.toString('hex')}:${enc.toString('hex')}`;
}

export function decryptSecret(blob: string): string {
  const [ivh, tagh, dh] = blob.split(':');
  if (!ivh || !tagh || !dh) throw new Error('blob cifrado inválido');
  const d = createDecipheriv('aes-256-gcm', KEY, Buffer.from(ivh, 'hex'));
  d.setAuthTag(Buffer.from(tagh, 'hex'));
  return Buffer.concat([d.update(Buffer.from(dh, 'hex')), d.final()]).toString('utf8');
}
