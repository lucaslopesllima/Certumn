import { query } from './db.ts';
import { getSmtpSettings, sendViaSmtp, type SmtpSettings } from './smtp.ts';

// Avança um ISO pelo intervalo da recorrência. Retorna null se não há repetição.
// Exportada p/ teste unitário (o guard de data inválida é inalcançável via
// processDueEmails, que sempre passa um timestamp já validado pelo pg).
export function addInterval(iso: string, rec: string | null): string | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  if (rec === 'diaria') d.setUTCDate(d.getUTCDate() + 1);
  else if (rec === 'semanal') d.setUTCDate(d.getUTCDate() + 7);
  else if (rec === 'mensal') d.setUTCMonth(d.getUTCMonth() + 1);
  else return null;
  return d.toISOString();
}

// Próxima ocorrência estritamente futura (evita backlog de catch-up: se o
// agendamento estava muito atrasado, salta direto pra frente de `now`).
export function nextOccurrence(iso: string, rec: string | null, now: Date): string | null {
  let next = addInterval(iso, rec);
  if (!next) return null;
  let guard = 0;
  while (new Date(next) <= now && guard < 1000) { next = addInterval(next, rec)!; guard++; }
  return next;
}

// Processa agendamentos pendentes já vencidos (agendado_para <= agora): envia de
// fato via SMTP da org e marca 'enviado'. Idempotente — o UPDATE condiciona em
// status='pendente', então rodar no boot e em intervalo não reenvia.
//
// Sem SMTP ativo na org o envio é apenas TRAVADO: o agendamento fica 'pendente'
// e dispara assim que o SMTP for configurado — não vira 'erro'. 'erro' fica só
// para falha real de envio (host fora, auth recusada…). A varredura nunca
// derruba a app: cada e-mail é isolado e a chamada no boot já trata rejeição.
// As settings são cacheadas por org dentro da varredura. `now` injetável p/ teste.
export async function processDueEmails(now = new Date()): Promise<number> {
  const due = await query<{
    id: string; org_id: string; template_id: string | null; company_id: string | null;
    remetente: string | null; destinatario: string; assunto: string; corpo: string;
    agendado_para: string; recorrencia: string | null; owner_user_id: string | null;
  }>(
    `SELECT id, org_id, template_id, company_id, remetente, destinatario, assunto, corpo,
            agendado_para, recorrencia, owner_user_id
       FROM email_schedules
      WHERE status = 'pendente' AND agendado_para <= $1
      ORDER BY agendado_para
      LIMIT 500`,
    [now.toISOString()],
  );

  // Cache de settings por org (promise: dedupe mesmo com fetches concorrentes).
  const cache = new Map<string, Promise<SmtpSettings | null>>();
  let sent = 0;
  // Concorrência limitada: 5 envios em paralelo por vez (o transporter é pooled),
  // em vez de estritamente sequencial — cada item continua isolado (try/catch).
  const CONCURRENCY = 5;
  for (let i = 0; i < due.length; i += CONCURRENCY) {
    await Promise.all(due.slice(i, i + CONCURRENCY).map(async (e) => {
      // Sem SMTP ativo na org: trava o envio sem tocar no registro (segue pendente).
      let p = cache.get(e.org_id);
      if (p === undefined) { p = getSmtpSettings(Number(e.org_id)); cache.set(e.org_id, p); }
      const s = await p;
      if (!s || !s.enabled) return;

      try {
        await sendViaSmtp(s, { from: e.remetente ?? '', to: e.destinatario, subject: e.assunto, body: e.corpo });

        const rows = await query(
          `UPDATE email_schedules
              SET status = 'enviado', enviado_em = now(), erro = NULL, updated_at = now()
            WHERE id = $1 AND status = 'pendente'
            RETURNING id`,
          [e.id],
        );
        if (rows.length === 0) return; // já processado por outra varredura
        sent++;

        // Recorrência: agenda a próxima ocorrência como nova linha pendente.
        const next = nextOccurrence(new Date(e.agendado_para).toISOString(), e.recorrencia, now);
        if (next) {
          await query(
            `INSERT INTO email_schedules
               (org_id, template_id, company_id, remetente, destinatario, assunto, corpo,
                agendado_para, recorrencia, owner_user_id)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
            [e.org_id, e.template_id, e.company_id, e.remetente, e.destinatario, e.assunto, e.corpo,
              next, e.recorrencia, e.owner_user_id],
          );
        }
      } catch (err) {
        await query(
          `UPDATE email_schedules
              SET status = 'erro', erro = $2, updated_at = now()
            WHERE id = $1 AND status = 'pendente'`,
          [e.id, err instanceof Error ? err.message : String(err)],
        );
      }
    }));
  }
  return sent;
}
