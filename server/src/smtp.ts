import nodemailer from 'nodemailer';
import { one } from './db.ts';
import { decryptSecret } from './crypto.ts';

// Config SMTP de uma org (linha de org_smtp_settings). password_enc é cifrado;
// só é decifrado na hora de montar o transporter, nunca exposto fora daqui.
export interface SmtpSettings {
  org_id: string;
  host: string;
  port: number;
  secure: boolean;
  username: string | null;
  password_enc: string | null;
  from_email: string;
  from_name: string | null;
  enabled: boolean;
}

export function getSmtpSettings(orgId: number): Promise<SmtpSettings | null> {
  return one<SmtpSettings>('SELECT * FROM org_smtp_settings WHERE org_id = $1', [orgId]);
}

// Cache de transporters por org (pool de conexões SMTP reutilizado entre envios,
// em vez de handshake TLS+auth a cada e-mail). A chave inclui a config — se o
// usuário trocar host/porta/credencial, o transporter antigo é fechado e um novo
// é criado. password_enc (cifrado) serve de chave sem decifrar a senha à toa.
const transporters = new Map<string, { key: string; transporter: nodemailer.Transporter }>();

function getTransporter(s: SmtpSettings): nodemailer.Transporter {
  const key = [s.host, s.port, s.secure, s.username ?? '', s.password_enc ?? ''].join('|');
  const hit = transporters.get(s.org_id);
  if (hit && hit.key === key) return hit.transporter;
  hit?.transporter.close?.(); // encerra o pool antigo (opcional: mocks de teste não têm close)
  const transporter = nodemailer.createTransport({
    pool: true,
    host: s.host,
    port: s.port,
    secure: s.secure,
    auth: s.username ? { user: s.username, pass: s.password_enc ? decryptSecret(s.password_enc) : '' } : undefined,
  });
  transporters.set(s.org_id, { key, transporter });
  return transporter;
}

// Dispara um e-mail via SMTP da org. `from` é o remetente do agendamento (e-mail
// do usuário); o envelope/sender usa o from_email configurado (alinhado ao
// domínio autenticado) e replyTo volta pro remetente. Lança em falha — o caller
// decide o que fazer (marcar 'erro').
export async function sendViaSmtp(
  s: SmtpSettings,
  msg: { from: string; to: string; subject: string; body: string },
): Promise<void> {
  const transporter = getTransporter(s);
  const fromAddr = msg.from || s.from_email;
  await transporter.sendMail({
    from: s.from_name ? `${s.from_name} <${fromAddr}>` : fromAddr,
    sender: s.from_email,
    replyTo: msg.from || undefined,
    to: msg.to,
    subject: msg.subject,
    text: msg.body,
  });
}
