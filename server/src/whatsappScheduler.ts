// Processador de mensagens WhatsApp agendadas. Mesmo desenho do processDueEmails
// (email.ts): varre pendentes vencidos no boot + a cada minuto, idempotente
// (UPDATE condiciona em status='pendente'). Sem instância conectada na org o
// envio TRAVA (segue pendente) — só falha real de envio vira 'erro'.
import { query, one } from './db.ts';
import * as evo from './evolution.ts';
import { instanceName, insertMessage, upsertChat } from './whatsapp.ts';
import { broadcast } from './ws.ts';

export async function processDueWhatsapp(now = new Date()): Promise<number> {
  // JOIN no chat: numero/remote_jid de lá são autoritativos (o remote_jid do
  // agendamento pode estar defasado após conciliação). chat_id pode ser null
  // (conversa apagada) — cai no remote_jid do próprio agendamento.
  const due = await query<{
    id: string; org_id: string; chat_id: string | null; remote_jid: string; corpo: string; activity_id: string | null;
    chat_numero: string | null; chat_remote_jid: string | null;
  }>(
    `SELECT s.id, s.org_id, s.chat_id, s.remote_jid, s.corpo, s.activity_id,
            ch.numero AS chat_numero, ch.remote_jid AS chat_remote_jid
       FROM whatsapp_schedules s
       LEFT JOIN whatsapp_chats ch ON ch.id = s.chat_id AND ch.org_id = s.org_id
      WHERE s.status = 'pendente' AND s.agendado_para <= $1
      ORDER BY s.agendado_para
      LIMIT 500`,
    [now.toISOString()],
  );

  // status de conexão por org, cacheado dentro da varredura.
  const conn = new Map<string, boolean>();
  let sent = 0;
  for (const s of due) {
    let ok = conn.get(s.org_id);
    if (ok === undefined) {
      const row = await one<{ status: string }>('SELECT status FROM org_whatsapp_settings WHERE org_id = $1', [s.org_id]);
      ok = row?.status === 'conectado';
      conn.set(s.org_id, ok);
    }
    if (!ok) continue; // sem instância conectada: trava (segue pendente)

    const orgId = Number(s.org_id);
    // Destino igual ao envio interativo: número quando houver, senão o jid. LID
    // sem número não tem destinatário válido — marca erro claro (não fica em loop).
    const remoteJid = s.chat_remote_jid ?? s.remote_jid;
    const dest = s.chat_numero || remoteJid;
    if (!s.chat_numero && remoteJid.endsWith('@lid')) {
      await query(
        `UPDATE whatsapp_schedules SET status = 'erro', erro = $2, updated_at = now()
          WHERE id = $1 AND status = 'pendente'`,
        [s.id, 'Contato sem número de telefone (LID). Concilie a conversa com a de telefone para enviar.'],
      );
      continue;
    }
    try {
      const res = await evo.sendText(instanceName(orgId), dest, s.corpo);
      const evolutionId = res.key?.id ?? null;

      // garante a conversa (caso o chat_id tenha sumido) e espelha a mensagem.
      const chat = await upsertChat(orgId, remoteJid, { preview: s.corpo, incNaoLidas: false });
      const chatId = s.chat_id ?? chat.id;
      const msg = await insertMessage(orgId, chatId, { evolutionId, fromMe: true, corpo: s.corpo, status: 'enviado' });

      const rows = await query(
        `UPDATE whatsapp_schedules SET status = 'enviado', enviado_em = now(), erro = NULL, updated_at = now()
          WHERE id = $1 AND status = 'pendente' RETURNING id`,
        [s.id],
      );
      if (rows.length === 0) continue; // já processado por outra varredura
      // Compromisso espelho na Agenda vira 'feito' quando a mensagem sai.
      if (s.activity_id != null) {
        await query("UPDATE activities SET status = 'feito' WHERE id = $1 AND org_id = $2", [s.activity_id, orgId]);
      }
      sent++;
      if (msg) broadcast(orgId, 'message', { chat_id: Number(chatId), message: msg });
    } catch (err) {
      // Integração desligada globalmente também trava (não marca erro).
      if (err instanceof evo.EvolutionDisabledError) continue;
      await query(
        `UPDATE whatsapp_schedules SET status = 'erro', erro = $2, updated_at = now()
          WHERE id = $1 AND status = 'pendente'`,
        [s.id, err instanceof Error ? err.message : String(err)],
      );
    }
  }
  return sent;
}
