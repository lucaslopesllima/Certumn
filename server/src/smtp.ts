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

// Dispara um e-mail via SMTP da org. `from` é o remetente do agendamento (e-mail
// do usuário); o envelope/sender usa o from_email configurado (alinhado ao
// domínio autenticado) e replyTo volta pro remetente. Lança em falha — o caller
// decide o que fazer (marcar 'erro').
export async function sendViaSmtp(
  s: SmtpSettings,
  msg: { from: string; to: string; subject: string; body: string },
): Promise<void> {
  const transporter = nodemailer.createTransport({
    host: s.host,
    port: s.port,
    secure: s.secure,
    auth: s.username ? { user: s.username, pass: s.password_enc ? decryptSecret(s.password_enc) : '' } : undefined,
  });
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
