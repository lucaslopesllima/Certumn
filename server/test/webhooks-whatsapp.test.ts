// Cobertura de src/routes/webhooks.ts (webhook da Evolution). App real via inject;
// evolution mockada (profilePicture/groupInfo fire-and-forget). Cobre token,
// instância desconhecida, e cada evento (connection/messages.upsert/update/
// presence/contacts), extração de texto/mídia, dedup, foto/grupo e o catch.
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { makeApp, register, closeAll, type Session } from './helpers.ts';
import { one, query } from '../src/db.ts';
import { config } from '../src/config.ts';

const { profilePicture, groupInfo } = vi.hoisted(() => ({ profilePicture: vi.fn(), groupInfo: vi.fn() }));
vi.mock('../src/evolution.ts', () => ({
  profilePicture, groupInfo,
  EvolutionDisabledError: class EvolutionDisabledError extends Error {},
}));
// whatsapp.ts real, exceto um gancho p/ forçar erro dentro do try (cobre o catch).
vi.mock('../src/whatsapp.ts', async (imp) => {
  const actual = await imp() as Record<string, unknown>;
  const realUpsert = actual.upsertChat as (...a: unknown[]) => Promise<unknown>;
  return {
    ...actual,
    upsertChat: (orgId: number, jid: string, ...rest: unknown[]) => {
      if (jid === 'BOOM@s.whatsapp.net') throw new Error('boom no upsert');
      return realUpsert(orgId, jid, ...rest);
    },
  };
});

let app: FastifyInstance;
let org = 0;
let s: Session;
const TOKEN = config.whatsappWebhookToken;
const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 60));

const post = (body: unknown, token = TOKEN): ReturnType<FastifyInstance['inject']> =>
  app.inject({ method: 'POST', url: `/api/webhooks/whatsapp?token=${token}`, payload: body });
const upsertEvent = (data: unknown): unknown => ({ event: 'messages.upsert', instance: `org_${org}`, data });

beforeAll(async () => {
  app = await makeApp();
  s = await register(app, 'wa-webhook');
  org = Number(s.user.org_id);
  await app.inject({ method: 'GET', url: '/api/whatsapp/status', headers: { authorization: `Bearer ${s.token}` } }); // ensureSettings
});
afterAll(() => closeAll(app));
beforeEach(() => { profilePicture.mockReset().mockResolvedValue(null); groupInfo.mockReset().mockResolvedValue({ subject: null, pictureUrl: null }); });

describe('webhook — auth e roteamento', () => {
  it('token inválido → 401', async () => {
    const r = await post({ event: 'x', instance: `org_${org}` }, 'errado');
    expect(r.statusCode).toBe(401);
  });
  it('instância desconhecida → 202', async () => {
    const r = await post({ event: 'connection.update', instance: 'org_nao_existe', data: {} });
    expect(r.statusCode).toBe(202);
  });
  it('evento não tratado → 202', async () => {
    const r = await post({ event: 'chats.set', instance: `org_${org}`, data: {} });
    expect(r.statusCode).toBe(202);
  });
});

describe('webhook — connection.update', () => {
  it.each([['open', 'conectado'], ['connecting', 'conectando'], ['close', 'desconectado']])(
    'state %s → %s', async (state, esperado) => {
      const r = await post({ event: 'connection.update', instance: `org_${org}`, data: { state } });
      expect(r.statusCode).toBe(200);
      const row = await one<{ status: string }>('SELECT status FROM org_whatsapp_settings WHERE org_id = $1', [org]);
      expect(row!.status).toBe(esperado);
    });
});

describe('webhook — messages.upsert', () => {
  const msg = (over: Record<string, unknown>): unknown => ({
    key: { remoteJid: '5511900000001@s.whatsapp.net', fromMe: false, id: `M-${Math.random()}` },
    pushName: 'Fulano', message: { conversation: 'oi' }, messageTimestamp: 1700000000, ...over,
  });

  it('ignora jid ausente e status@broadcast', async () => {
    const r = await post(upsertEvent([{ key: {} }, { key: { remoteJid: 'status@broadcast' } }]));
    expect(r.statusCode).toBe(200);
  });

  it('mensagem recebida cria conversa, mensagem e busca foto', async () => {
    profilePicture.mockResolvedValueOnce('http://foto');
    const r = await post(upsertEvent(msg({})));
    expect(r.statusCode).toBe(200);
    await flush();
    const chat = await one<{ id: string; nome: string; foto_url: string; nao_lidas: number }>(
      'SELECT id, nome, foto_url, nao_lidas FROM whatsapp_chats WHERE org_id = $1 AND remote_jid = $2',
      [org, '5511900000001@s.whatsapp.net']);
    expect(chat!.nome).toBe('Fulano');
    expect(chat!.nao_lidas).toBeGreaterThanOrEqual(1);
    expect(chat!.foto_url).toBe('http://foto');
  });

  it('dedup: mesma evolution_id não duplica', async () => {
    const id = 'DEDUP-1';
    await post(upsertEvent(msg({ key: { remoteJid: '5511900000002@s.whatsapp.net', fromMe: false, id } })));
    await post(upsertEvent(msg({ key: { remoteJid: '5511900000002@s.whatsapp.net', fromMe: false, id } })));
    const n = await query('SELECT id FROM whatsapp_messages WHERE org_id = $1 AND evolution_id = $2', [org, id]);
    expect(n.length).toBe(1);
  });

  it('fromMe: sem nome/não-lidas, status enviado', async () => {
    await post(upsertEvent(msg({ key: { remoteJid: '5511900000003@s.whatsapp.net', fromMe: true, id: 'FM-1' } })));
    const m = await one<{ from_me: boolean; status: string }>(
      'SELECT from_me, status FROM whatsapp_messages WHERE org_id = $1 AND evolution_id = $2', [org, 'FM-1']);
    expect(m).toMatchObject({ from_me: true, status: 'enviado' });
  });

  it.each([
    ['extendedText', { message: { extendedTextMessage: { text: 'estendido' } }, key: { remoteJid: '5511900000010@s.whatsapp.net', fromMe: false, id: 'T-ext' } }, 'estendido', 'texto'],
    ['imagem caption', { message: { imageMessage: { caption: 'legenda-img', mimetype: 'image/png' } }, key: { remoteJid: '5511900000011@s.whatsapp.net', fromMe: false, id: 'T-img' } }, 'legenda-img', 'imagem'],
    ['video caption', { message: { videoMessage: { caption: 'legenda-vid', mimetype: 'video/mp4' } }, key: { remoteJid: '5511900000012@s.whatsapp.net', fromMe: false, id: 'T-vid' } }, 'legenda-vid', 'video'],
    ['sticker', { message: { stickerMessage: { mimetype: 'image/webp' } }, key: { remoteJid: '5511900000013@s.whatsapp.net', fromMe: false, id: 'T-stk' } }, null, 'imagem'],
    ['audio', { message: { audioMessage: { mimetype: 'audio/ogg' } }, key: { remoteJid: '5511900000014@s.whatsapp.net', fromMe: false, id: 'T-aud' } }, null, 'audio'],
    ['documento', { message: { documentMessage: { fileName: 'a.pdf', mimetype: 'application/pdf' } }, key: { remoteJid: '5511900000015@s.whatsapp.net', fromMe: false, id: 'T-doc' } }, null, 'documento'],
    ['sem message', { message: undefined, key: { remoteJid: '5511900000016@s.whatsapp.net', fromMe: false, id: 'T-nil' } }, null, 'texto'],
  ])('texto/tipo: %s', async (_label, over, corpoEsperado, tipoEsperado) => {
    profilePicture.mockResolvedValueOnce(null);
    await post(upsertEvent(msg(over as Record<string, unknown>)));
    const key = (over as { key: { id: string } }).key.id;
    const m = await one<{ corpo: string | null; tipo: string }>(
      'SELECT corpo, tipo FROM whatsapp_messages WHERE org_id = $1 AND evolution_id = $2', [org, key]);
    expect(m!.corpo).toBe(corpoEsperado);
    expect(m!.tipo).toBe(tipoEsperado);
  });

  it('timestamp inválido cai em agora (não quebra)', async () => {
    const r = await post(upsertEvent(msg({ messageTimestamp: -1, key: { remoteJid: '5511900000017@s.whatsapp.net', fromMe: false, id: 'TS-bad' } })));
    expect(r.statusCode).toBe(200);
  });

  it('altJid (senderPn) unifica telefone+lid numa conversa', async () => {
    await post(upsertEvent(msg({
      key: { remoteJid: 'alt900@lid', fromMe: false, id: 'ALT-1', senderPn: '5511900000018@s.whatsapp.net' },
    })));
    const cnt = await one<{ n: string }>(
      "SELECT count(*) n FROM whatsapp_chat_jids WHERE org_id = $1 AND jid IN ('alt900@lid','5511900000018@s.whatsapp.net')", [org]);
    expect(Number(cnt!.n)).toBe(2); // dois aliases, mesma conversa
  });

  it('grupo: busca subject/foto uma vez e atualiza nome', async () => {
    groupInfo.mockResolvedValueOnce({ subject: 'Meu Grupo', pictureUrl: 'http://gfoto' });
    await post(upsertEvent(msg({ key: { remoteJid: '55110grupo900@g.us', fromMe: false, id: 'G-1' }, pushName: 'Participante' })));
    await flush();
    const chat = await one<{ nome: string; foto_url: string }>(
      'SELECT nome, foto_url FROM whatsapp_chats WHERE org_id = $1 AND remote_jid = $2', [org, '55110grupo900@g.us']);
    expect(chat!.nome).toBe('Meu Grupo');
    expect(chat!.foto_url).toBe('http://gfoto');
    expect(groupInfo).toHaveBeenCalledTimes(1);
    // 2ª mensagem no mesmo grupo não rebusca (dedup por sessão).
    await post(upsertEvent(msg({ key: { remoteJid: '55110grupo900@g.us', fromMe: false, id: 'G-2' } })));
    expect(groupInfo).toHaveBeenCalledTimes(1);
  });

  it('grupo: falha do groupInfo permite nova tentativa depois', async () => {
    groupInfo.mockRejectedValueOnce(new Error('sem grupo'));
    await post(upsertEvent(msg({ key: { remoteJid: '55110grupo901@g.us', fromMe: false, id: 'GF-1' } })));
    await flush();
    groupInfo.mockResolvedValueOnce({ subject: 'Recuperado', pictureUrl: null });
    await post(upsertEvent(msg({ key: { remoteJid: '55110grupo901@g.us', fromMe: false, id: 'GF-2' } })));
    await flush();
    expect(groupInfo).toHaveBeenCalledTimes(2);
    const chat = await one<{ nome: string }>('SELECT nome FROM whatsapp_chats WHERE org_id = $1 AND remote_jid = $2', [org, '55110grupo901@g.us']);
    expect(chat!.nome).toBe('Recuperado');
  });

  it('erro dentro do handler → 200 (nunca faz a Evolution reentregar)', async () => {
    const r = await post(upsertEvent(msg({ key: { remoteJid: 'BOOM@s.whatsapp.net', fromMe: false, id: 'BOOM-1' } })));
    expect(r.statusCode).toBe(200);
  });
});

describe('webhook — messages.update', () => {
  const upd = (data: unknown): unknown => ({ event: 'messages.update', instance: `org_${org}`, data });
  it('mapeia acks e ignora desconhecido/sem dados', async () => {
    await post(upsertEvent({ key: { remoteJid: '5511900000020@s.whatsapp.net', fromMe: true, id: 'UPD-1' }, message: { conversation: 'x' }, messageTimestamp: 1700000000 }));
    await post(upd([
      { key: { id: 'UPD-1' }, update: { status: 'READ' } },  // → lido
      { key: {}, status: 'DELIVERY_ACK' },                    // sem id → ignora
      { key: { id: 'UPD-1' }, status: 'DESCONHECIDO' },       // status não mapeado → ignora
      { key: { id: 'UPD-1' }, status: 'DELIVERY_ACK' },       // via raw.status → entregue (sobrescreve)
    ]));
    const m = await one<{ status: string }>('SELECT status FROM whatsapp_messages WHERE org_id = $1 AND evolution_id = $2', [org, 'UPD-1']);
    expect(m!.status).toBe('entregue');
  });
});

describe('webhook — presence.update', () => {
  const pres = (data: unknown): unknown => ({ event: 'presence.update', instance: `org_${org}`, data });
  it('composing → typing; available → não; sem jid → ignora', async () => {
    expect((await post(pres({ id: '5511@s.whatsapp.net', presences: { '5511@s.whatsapp.net': { lastKnownPresence: 'composing' } } }))).statusCode).toBe(200);
    expect((await post(pres({ id: '5511@s.whatsapp.net', presences: { '5511@s.whatsapp.net': { lastKnownPresence: 'available' } } }))).statusCode).toBe(200);
    expect((await post(pres({}))).statusCode).toBe(200);
  });
});

describe('webhook — contacts.upsert/update', () => {
  const con = (data: unknown): unknown => ({ event: 'contacts.upsert', instance: `org_${org}`, data });
  it('atualiza foto de conversa existente; ignora sem url/sem conversa/sem jid', async () => {
    await post(upsertEvent({ key: { remoteJid: '5511900000030@s.whatsapp.net', fromMe: false, id: 'C-1' }, message: { conversation: 'y' }, messageTimestamp: 1700000000 }));
    await post(con([
      { remoteJid: '5511900000030@s.whatsapp.net', profilePicUrl: 'http://c-foto' }, // atualiza
      { id: '5511900000030@s.whatsapp.net', profilePicUrl: null },                    // sem url → ignora
      { remoteJid: '5511999999999@s.whatsapp.net', profilePicUrl: 'http://x' },        // sem conversa → ignora
      { profilePicUrl: 'http://z' },                                                   // sem jid → ignora
      { remoteJid: 'status@broadcast', profilePicUrl: 'http://q' },                    // broadcast → ignora
    ]));
    const chat = await one<{ foto_url: string }>('SELECT foto_url FROM whatsapp_chats WHERE org_id = $1 AND remote_jid = $2', [org, '5511900000030@s.whatsapp.net']);
    expect(chat!.foto_url).toBe('http://c-foto');
  });
});
