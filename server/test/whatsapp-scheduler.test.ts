// Cobertura de src/whatsappScheduler.ts (processDueWhatsapp): varre agendamentos
// vencidos e envia via Evolution (mockada). Cobre: sem instância conectada (trava),
// LID sem número (erro), sucesso (espelha msg + activity 'feito'), erro de envio,
// integração desligada (trava sem erro) e corrida (já processado por outra varredura).
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { makeApp, register, closeAll, type Session } from './helpers.ts';
import { one, query } from '../src/db.ts';

const { sendText, EvolutionDisabledError } = vi.hoisted(() => {
  class EvolutionDisabledError extends Error {}
  return { sendText: vi.fn(), EvolutionDisabledError };
});
vi.mock('../src/evolution.ts', () => ({ sendText, EvolutionDisabledError }));

const { processDueWhatsapp } = await import('../src/whatsappScheduler.ts');

let org = 0;
let userId = 0;
let s: Session;
const past = new Date(Date.now() - 60_000).toISOString();

beforeAll(async () => {
  const app = await makeApp();
  s = await register(app, 'wa-sched');
  org = Number(s.user.org_id);
  userId = Number(s.user.id);
  await app.close();
});
afterAll(() => closeAll());
beforeEach(() => { sendText.mockReset(); sendText.mockResolvedValue({ key: { id: 'msg-x' } }); });

async function mkChat(jid: string, numero: string | null): Promise<string> {
  const r = await one<{ id: string }>(
    'INSERT INTO whatsapp_chats (org_id, remote_jid, numero) VALUES ($1,$2,$3) RETURNING id', [org, jid, numero]);
  return r!.id;
}
async function mkSchedule(opts: { chatId: string | null; jid: string; corpo?: string; activityId?: string | null }): Promise<string> {
  const r = await one<{ id: string }>(
    `INSERT INTO whatsapp_schedules (org_id, chat_id, remote_jid, corpo, agendado_para, owner_user_id, activity_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
    [org, opts.chatId, opts.jid, opts.corpo ?? 'agendada', past, userId, opts.activityId ?? null]);
  return r!.id;
}
const statusOf = async (id: string): Promise<{ status: string; erro: string | null }> =>
  (await one<{ status: string; erro: string | null }>('SELECT status, erro FROM whatsapp_schedules WHERE id = $1', [id]))!;

async function setConn(status: string): Promise<void> {
  await query(`INSERT INTO org_whatsapp_settings (org_id, instance_name, status)
               VALUES ($1,$2,$3) ON CONFLICT (org_id) DO UPDATE SET status = $3`, [org, `org_${org}`, status]);
}

describe('processDueWhatsapp', () => {
  it('sem instância conectada: trava (segue pendente), não chama envio', async () => {
    await setConn('desconectado');
    const chat = await mkChat('5511200000001@s.whatsapp.net', '5511200000001');
    const id = await mkSchedule({ chatId: chat, jid: '5511200000001@s.whatsapp.net' });
    const sent = await processDueWhatsapp();
    expect(sent).toBe(0);
    expect((await statusOf(id)).status).toBe('pendente');
    expect(sendText).not.toHaveBeenCalled();
    await query("UPDATE whatsapp_schedules SET status='cancelado' WHERE id=$1", [id]); // não interfere nos próximos
  });

  it('LID sem número: marca erro claro sem enviar', async () => {
    await setConn('conectado');
    const chat = await mkChat('lid200@lid', null);
    const id = await mkSchedule({ chatId: chat, jid: 'lid200@lid' });
    await processDueWhatsapp();
    const r = await statusOf(id);
    expect(r.status).toBe('erro');
    expect(r.erro).toContain('LID');
    await query("UPDATE whatsapp_schedules SET status='cancelado' WHERE id=$1", [id]);
  });

  it('sucesso: envia, espelha mensagem e marca activity feito', async () => {
    await setConn('conectado');
    const chat = await mkChat('5511200000003@s.whatsapp.net', '5511200000003');
    const act = await one<{ id: string }>(
      `INSERT INTO activities (org_id, tipo, titulo, start_at, owner_user_id, status)
       VALUES ($1,'whatsapp','t', now(), $2, 'pendente') RETURNING id`, [org, userId]);
    const id = await mkSchedule({ chatId: chat, jid: '5511200000003@s.whatsapp.net', corpo: 'ola', activityId: act!.id });
    const sent = await processDueWhatsapp();
    expect(sent).toBeGreaterThanOrEqual(1);
    expect((await statusOf(id)).status).toBe('enviado');
    expect(sendText).toHaveBeenCalledWith('org_' + org, '5511200000003', 'ola');
    const a = await one<{ status: string }>('SELECT status FROM activities WHERE id = $1', [act!.id]);
    expect(a!.status).toBe('feito');
    const msg = await query('SELECT id FROM whatsapp_messages WHERE chat_id = $1 AND corpo = $2', [chat, 'ola']);
    expect(msg.length).toBe(1);
  });

  it('chat_id nulo (conversa apagada): usa remote_jid do agendamento', async () => {
    await setConn('conectado');
    const id = await mkSchedule({ chatId: null, jid: '5511200000004@s.whatsapp.net', corpo: 'sem-chat' });
    const sent = await processDueWhatsapp();
    expect(sent).toBeGreaterThanOrEqual(1);
    expect((await statusOf(id)).status).toBe('enviado');
    expect(sendText).toHaveBeenCalledWith('org_' + org, '5511200000004@s.whatsapp.net', 'sem-chat');
  });

  it('erro real de envio: marca erro com a mensagem', async () => {
    await setConn('conectado');
    sendText.mockRejectedValueOnce(new Error('Evolution 500'));
    const chat = await mkChat('5511200000005@s.whatsapp.net', '5511200000005');
    const id = await mkSchedule({ chatId: chat, jid: '5511200000005@s.whatsapp.net', corpo: 'falha' });
    await processDueWhatsapp();
    const r = await statusOf(id);
    expect(r.status).toBe('erro');
    expect(r.erro).toBe('Evolution 500');
  });

  it('integração desligada: trava sem marcar erro', async () => {
    await setConn('conectado');
    sendText.mockRejectedValueOnce(new EvolutionDisabledError('off'));
    const chat = await mkChat('5511200000006@s.whatsapp.net', '5511200000006');
    const id = await mkSchedule({ chatId: chat, jid: '5511200000006@s.whatsapp.net', corpo: 'off' });
    await processDueWhatsapp();
    expect((await statusOf(id)).status).toBe('pendente');
    await query("UPDATE whatsapp_schedules SET status='cancelado' WHERE id=$1", [id]);
  });

  it('corrida: outra varredura já processou → não conta como enviado', async () => {
    await setConn('conectado');
    const chat = await mkChat('5511200000007@s.whatsapp.net', '5511200000007');
    const id = await mkSchedule({ chatId: chat, jid: '5511200000007@s.whatsapp.net', corpo: 'RACE' });
    // Simula a corrida: durante o "envio", o registro sai de 'pendente' — o UPDATE
    // final casa 0 linhas e o item é ignorado (sem incrementar sent).
    sendText.mockImplementationOnce(async () => {
      await query("UPDATE whatsapp_schedules SET status='enviado', enviado_em=now() WHERE id=$1", [id]);
      return { key: { id: 'race' } };
    });
    const sent = await processDueWhatsapp();
    expect(sent).toBe(0);
    expect((await statusOf(id)).status).toBe('enviado');
  });

  it('varre em lotes (CONCURRENCY) e dedupe status de conexão por org', async () => {
    await setConn('conectado');
    const ids: string[] = [];
    for (let i = 0; i < 7; i++) {
      const chat = await mkChat(`551130000000${i}@s.whatsapp.net`, `551130000000${i}`);
      ids.push(await mkSchedule({ chatId: chat, jid: `551130000000${i}@s.whatsapp.net`, corpo: `lote-${i}` }));
    }
    const sent = await processDueWhatsapp();
    expect(sent).toBeGreaterThanOrEqual(7);
    for (const id of ids) expect((await statusOf(id)).status).toBe('enviado');
  });
});
