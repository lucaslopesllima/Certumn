// Cobertura das rotas de conexão/leitura de src/routes/whatsapp.ts: WebSocket,
// status, connect, connection, disconnect, lista de conversas, mensagens, read e
// o proxy de mídia (disco/base64/download, cache 304, sanitização de content-type).
// evolution mockada. Mídia gravada num diretório temporário isolado.
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import WebSocket from 'ws';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeApp, register, bearer, closeAll, type Session } from './helpers.ts';
import { one, query } from '../src/db.ts';
import { config } from '../src/config.ts';

const evoMock = vi.hoisted(() => ({
  evolutionEnabled: vi.fn(() => true),
  createInstance: vi.fn(), connect: vi.fn(), connectionState: vi.fn(), logout: vi.fn(),
  markRead: vi.fn(), getMediaBase64: vi.fn(), fetchAllGroups: vi.fn(async () => []),
  profilePicture: vi.fn(async () => null), groupInfo: vi.fn(async () => ({ subject: null, pictureUrl: null })),
}));
vi.mock('../src/evolution.ts', () => ({ ...evoMock, EvolutionDisabledError: class EvolutionDisabledError extends Error {} }));
const { EvolutionDisabledError } = await import('../src/evolution.ts');

let app: FastifyInstance;
let org = 0;
let s: Session;
let mediaDir = '';
let mediaDir0 = config.whatsappMediaDir;

const inj = (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: unknown): ReturnType<FastifyInstance['inject']> =>
  app.inject({ method, url, headers: bearer(s.token), payload });
const mkChat = async (jid: string, numero: string | null): Promise<string> =>
  (await one<{ id: string }>('INSERT INTO whatsapp_chats (org_id, remote_jid, numero) VALUES ($1,$2,$3) RETURNING id', [org, jid, numero]))!.id;

beforeAll(async () => {
  mediaDir = await mkdtemp(join(tmpdir(), 'wa-route-media-'));
  mediaDir0 = config.whatsappMediaDir;
  config.whatsappMediaDir = mediaDir;
  app = await makeApp();
  s = await register(app, 'wa-conn');
  org = Number(s.user.org_id);
});
afterAll(async () => { config.whatsappMediaDir = mediaDir0; await closeAll(app); await rm(mediaDir, { recursive: true, force: true }); });
beforeEach(() => {
  for (const f of Object.values(evoMock)) (f as ReturnType<typeof vi.fn>).mockReset();
  evoMock.evolutionEnabled.mockReturnValue(true);
  evoMock.fetchAllGroups.mockResolvedValue([]);
  evoMock.markRead.mockResolvedValue(undefined); // rota faz .catch() no retorno
});

describe('whatsapp — WebSocket', () => {
  it('recusa sem token / com token inválido e aceita token válido', async () => {
    await app.listen({ port: 0, host: '127.0.0.1' });
    const addr = app.server.address() as { port: number };
    const base = `ws://127.0.0.1:${addr.port}/api/whatsapp/ws`;
    const closeCode = (url: string): Promise<number> => new Promise((resolve) => {
      const ws = new WebSocket(url);
      ws.on('close', (c) => resolve(c));
      ws.on('error', () => undefined);
    });
    expect(await closeCode(base)).toBe(1008);                 // sem token
    expect(await closeCode(`${base}?token=lixo`)).toBe(1008); // token inválido
    // token válido: conecta, registra e fecha limpo.
    const opened = await new Promise<boolean>((resolve) => {
      const ws = new WebSocket(`${base}?token=${s.token}`);
      ws.on('open', () => { ws.close(); resolve(true); });
      ws.on('error', () => resolve(false));
    });
    expect(opened).toBe(true);
    await app.close();
    app = await makeApp(); // reabre p/ os demais testes (inject não precisa de listen)
  });
});

describe('whatsapp — status/connect/connection/disconnect', () => {
  it('status cria settings e reporta enabled', async () => {
    evoMock.evolutionEnabled.mockReturnValue(true);
    const r = await inj('GET', '/api/whatsapp/status');
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ enabled: true, status: 'desconectado', numero: null });
  });

  it('connect devolve QR (com repesca no loop até o base64)', async () => {
    evoMock.connect
      .mockResolvedValueOnce({ code: null, base64: null, state: 'connecting' }) // 1ª: sem QR ainda
      .mockResolvedValueOnce({ code: 'C', base64: 'QRDATA', state: 'connecting' });
    const r = await inj('POST', '/api/whatsapp/connect');
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ qr: 'QRDATA', status: 'conectando' });
    expect(evoMock.createInstance).toHaveBeenCalled();
  });

  it('connect: createInstance falha é engolido; state open encerra loop', async () => {
    evoMock.createInstance.mockRejectedValueOnce(new Error('já existe'));
    evoMock.connect.mockResolvedValueOnce({ code: null, base64: null, state: 'open' });
    const r = await inj('POST', '/api/whatsapp/connect');
    expect(r.json()).toMatchObject({ status: 'conectado' });
  });

  it('connect: integração desligada → 503; erro → 502', async () => {
    evoMock.connect.mockRejectedValueOnce(new EvolutionDisabledError());
    expect((await inj('POST', '/api/whatsapp/connect')).statusCode).toBe(503);
    evoMock.connect.mockRejectedValueOnce(new Error('falhou'));
    expect((await inj('POST', '/api/whatsapp/connect')).statusCode).toBe(502);
  });

  it('connection reporta estado / 503 / 502', async () => {
    evoMock.connectionState.mockResolvedValueOnce('open');
    expect((await inj('GET', '/api/whatsapp/connection')).json()).toEqual({ status: 'conectado' });
    evoMock.connectionState.mockResolvedValueOnce('connecting');
    expect((await inj('GET', '/api/whatsapp/connection')).json()).toEqual({ status: 'conectando' });
    evoMock.connectionState.mockResolvedValueOnce('close'); // mapState default → desconectado
    expect((await inj('GET', '/api/whatsapp/connection')).json()).toEqual({ status: 'desconectado' });
    evoMock.connectionState.mockRejectedValueOnce(new EvolutionDisabledError());
    expect((await inj('GET', '/api/whatsapp/connection')).statusCode).toBe(503);
    evoMock.connectionState.mockRejectedValueOnce(new Error('x'));
    expect((await inj('GET', '/api/whatsapp/connection')).statusCode).toBe(502);
  });

  it('disconnect: sucesso, erro engolido e desligada → 503', async () => {
    evoMock.logout.mockResolvedValueOnce(undefined);
    expect((await inj('POST', '/api/whatsapp/disconnect')).json()).toEqual({ ok: true });
    evoMock.logout.mockRejectedValueOnce(new Error('já fora')); // engolido
    expect((await inj('POST', '/api/whatsapp/disconnect')).json()).toEqual({ ok: true });
    evoMock.logout.mockRejectedValueOnce(new EvolutionDisabledError());
    expect((await inj('POST', '/api/whatsapp/disconnect')).statusCode).toBe(503);
  });
});

describe('whatsapp — chats/messages/read', () => {
  it('lista conversas e dispara syncGroupNames uma vez (com falha reabilitando)', async () => {
    evoMock.fetchAllGroups.mockRejectedValueOnce(new Error('desconectado'));
    await mkChat('5511800000001@s.whatsapp.net', '5511800000001');
    const r = await inj('GET', '/api/whatsapp/chats');
    expect(r.statusCode).toBe(200);
    expect(Array.isArray(r.json().chats)).toBe(true);
    await new Promise((res) => setTimeout(res, 30)); // deixa o sync assíncrono falhar e re-habilitar
    // 2ª chamada: sync roda de novo (n=0, sem broadcast)
    await inj('GET', '/api/whatsapp/chats');
  });

  it('messages: 404, marca lida quando há não-lidas', async () => {
    expect((await inj('GET', '/api/whatsapp/chats/999999/messages')).statusCode).toBe(404);
    const chat = await mkChat('5511800000002@s.whatsapp.net', '5511800000002');
    await query('UPDATE whatsapp_chats SET nao_lidas = 2 WHERE id = $1', [chat]);
    await query("INSERT INTO whatsapp_messages (org_id, chat_id, evolution_id, from_me, corpo) VALUES ($1,$2,'RX-1',false,'oi')", [org, chat]);
    const r = await inj('GET', `/api/whatsapp/chats/${chat}/messages`);
    expect(r.statusCode).toBe(200);
    expect(r.json().messages.length).toBe(1);
    expect(evoMock.markRead).toHaveBeenCalled();
    const after = await one<{ nao_lidas: number }>('SELECT nao_lidas FROM whatsapp_chats WHERE id = $1', [chat]);
    expect(after!.nao_lidas).toBe(0);
  });

  it('messages: sem não-lidas não chama markRead', async () => {
    const chat = await mkChat('5511800000003@s.whatsapp.net', '5511800000003');
    await inj('GET', `/api/whatsapp/chats/${chat}/messages`);
    expect(evoMock.markRead).not.toHaveBeenCalled();
  });

  it('read: 404, com não-lidas marca, sem não-lidas só zera', async () => {
    expect((await inj('POST', '/api/whatsapp/chats/999999/read')).statusCode).toBe(404);
    const chat = await mkChat('5511800000004@s.whatsapp.net', '5511800000004');
    await query('UPDATE whatsapp_chats SET nao_lidas = 3 WHERE id = $1', [chat]);
    await query("INSERT INTO whatsapp_messages (org_id, chat_id, evolution_id, from_me) VALUES ($1,$2,'RX-2',false)", [org, chat]);
    expect((await inj('POST', `/api/whatsapp/chats/${chat}/read`)).json()).toEqual({ ok: true });
    expect(evoMock.markRead).toHaveBeenCalled();
    evoMock.markRead.mockClear();
    expect((await inj('POST', `/api/whatsapp/chats/${chat}/read`)).json()).toEqual({ ok: true }); // já zerado
    expect(evoMock.markRead).not.toHaveBeenCalled();
  });
});

describe('whatsapp — proxy de mídia', () => {
  const b64 = Buffer.from('binario-midia').toString('base64');
  async function mkMedia(over: Partial<{ tipo: string; mime: string | null; file_name: string | null; media_b64: string | null; media_path: string | null; evolution_id: string | null }> = {}): Promise<string> {
    const chat = await mkChat(`5511810${Math.floor(Math.random() * 1e6)}@s.whatsapp.net`, '5511810');
    const r = await one<{ id: string }>(
      `INSERT INTO whatsapp_messages (org_id, chat_id, from_me, tipo, mime, file_name, media_b64, media_path, evolution_id)
       VALUES ($1,$2,false,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [org, chat, over.tipo ?? 'imagem', over.mime ?? 'image/png', over.file_name ?? null,
        over.media_b64 ?? null, over.media_path ?? null, over.evolution_id ?? null]);
    return r!.id;
  }
  const media = (id: string, headers: Record<string, string> = {}): ReturnType<FastifyInstance['inject']> =>
    app.inject({ method: 'GET', url: `/api/whatsapp/messages/${id}/media`, headers });
  const auth = (): Record<string, string> => ({ authorization: `Bearer ${s.token}` });

  it('sem token 401; token inválido 401; token via query vale', async () => {
    const id = await mkMedia({ media_b64: b64 });
    expect((await media(id)).statusCode).toBe(401);
    // token malformado: authorizeToken lança → catch devolve 401 (não AuthError).
    expect((await media(id, { authorization: 'Bearer lixo.invalido' })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: `/api/whatsapp/messages/${id}/media?token=${s.token}` })).statusCode).toBe(200);
  });

  it('mensagem inexistente/texto → 404', async () => {
    expect((await media('999999', auth())).statusCode).toBe(404);
    const txt = await mkMedia({ tipo: 'texto' });
    expect((await media(txt, auth())).statusCode).toBe(404);
  });

  it('base64 legado é servido inline com nosniff', async () => {
    const id = await mkMedia({ media_b64: b64, mime: 'image/png' });
    const r = await media(id, auth());
    expect(r.statusCode).toBe(200);
    expect(r.headers['content-type']).toContain('image/png');
    expect(r.headers['x-content-type-options']).toBe('nosniff');
    expect(r.headers['content-disposition']).toBe('inline');
  });

  it('mime perigoso vira octet-stream + attachment e filename sanitizado', async () => {
    const id = await mkMedia({ media_b64: b64, mime: 'text/html', file_name: 'a\r\n"evil.html' });
    const r = await media(id, auth());
    expect(r.headers['content-type']).toContain('application/octet-stream');
    expect(r.headers['content-disposition']).toBe('attachment; filename="aevil.html"');
  });

  it('If-None-Match devolve 304', async () => {
    const id = await mkMedia({ media_b64: b64 });
    const r = await media(id, { ...auth(), 'if-none-match': `"wa-media-${id}"` });
    expect(r.statusCode).toBe(304);
  });

  it('serve do disco quando media_path existe', async () => {
    const { saveMedia } = await import('../src/mediaStore.ts');
    const id = await mkMedia({ mime: 'image/png' });
    const rel = await saveMedia(org, id, b64, 'image/png', null);
    await query('UPDATE whatsapp_messages SET media_path = $2 WHERE id = $1', [id, rel]);
    const r = await media(id, auth());
    expect(r.statusCode).toBe(200);
    expect(r.rawPayload.equals(Buffer.from('binario-midia'))).toBe(true);
  });

  it('media_path quebrado cai no download da Evolution e persiste', async () => {
    evoMock.getMediaBase64.mockResolvedValueOnce({ base64: b64, mimetype: 'image/jpeg' });
    const id = await mkMedia({ media_path: `${org}/inexistente.png`, mime: null, evolution_id: 'EV-1' });
    const r = await media(id, auth());
    expect(r.statusCode).toBe(200);
    const row = await one<{ media_path: string }>('SELECT media_path FROM whatsapp_messages WHERE id = $1', [id]);
    expect(row!.media_path).not.toBe(`${org}/inexistente.png`); // regravado
  });

  it('download com disco desligado cacheia base64 na linha', async () => {
    config.whatsappMediaDir = '';
    try {
      evoMock.getMediaBase64.mockResolvedValueOnce({ base64: b64, mimetype: 'image/png' });
      const id = await mkMedia({ evolution_id: 'EV-2', mime: null });
      const r = await media(id, auth());
      expect(r.statusCode).toBe(200);
      const row = await one<{ media_b64: string }>('SELECT media_b64 FROM whatsapp_messages WHERE id = $1', [id]);
      expect(row!.media_b64).toBe(b64);
    } finally { config.whatsappMediaDir = mediaDir; }
  });

  it('sem evolution_id e sem bytes → 404', async () => {
    const id = await mkMedia({ evolution_id: null });
    expect((await media(id, auth())).statusCode).toBe(404);
  });

  it('download: desligada → 503; erro → 502', async () => {
    evoMock.getMediaBase64.mockRejectedValueOnce(new EvolutionDisabledError());
    const id1 = await mkMedia({ evolution_id: 'EV-3' });
    expect((await media(id1, auth())).statusCode).toBe(503);
    evoMock.getMediaBase64.mockRejectedValueOnce(new Error('falha'));
    const id2 = await mkMedia({ evolution_id: 'EV-4' });
    expect((await media(id2, auth())).statusCode).toBe(502);
  });
});

describe('whatsapp — proxy da foto de perfil', () => {
  const png = Buffer.from('89504e470d0a1a0a-fake-png', 'utf8');
  const CDN = 'https://pps.whatsapp.net/v/t61/foto.jpg?oe=abc';
  let fetchMock: ReturnType<typeof vi.fn>;

  // fetch global mockado: downloadFoto (whatsapp.ts) sai pra internet.
  beforeEach(() => {
    fetchMock = vi.fn(async () => new Response(png, { headers: { 'content-type': 'image/jpeg' } }));
    vi.stubGlobal('fetch', fetchMock);
  });
  afterAll(() => { vi.unstubAllGlobals(); });

  const foto = (id: string, headers: Record<string, string> = {}): ReturnType<FastifyInstance['inject']> =>
    app.inject({ method: 'GET', url: `/api/whatsapp/chats/${id}/foto`, headers });
  const auth = (): Record<string, string> => ({ authorization: `Bearer ${s.token}` });
  const mkFoto = async (url: string | null, jid = `5511820${Math.floor(Math.random() * 1e6)}@s.whatsapp.net`): Promise<string> => {
    const id = await mkChat(jid, '5511820');
    if (url) await query('UPDATE whatsapp_chats SET foto_url = $2 WHERE id = $1', [id, url]);
    return id;
  };

  it('sem token 401; token inválido 401; token via query vale', async () => {
    const id = await mkFoto(CDN);
    expect((await foto(id)).statusCode).toBe(401);
    expect((await foto(id, { authorization: 'Bearer lixo.invalido' })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: `/api/whatsapp/chats/${id}/foto?token=${s.token}` })).statusCode).toBe(200);
  });

  it('conversa inexistente → 404', async () => {
    expect((await foto('999999', auth())).statusCode).toBe(404);
  });

  it('baixa do CDN, serve inline com nosniff e cacheia em disco', async () => {
    const id = await mkFoto(CDN);
    const r = await foto(id, auth());
    expect(r.statusCode).toBe(200);
    expect(r.headers['content-type']).toContain('image/jpeg');
    expect(r.headers['x-content-type-options']).toBe('nosniff');
    expect(r.headers['cache-control']).toBe('private, no-cache');
    expect(r.rawPayload.equals(png)).toBe(true);
    const row = await one<{ foto_path: string | null; foto_mime: string | null; foto_at: string | null }>(
      'SELECT foto_path, foto_mime, foto_at FROM whatsapp_chats WHERE id = $1', [id]);
    expect(row!.foto_path).toBe(`${org}/avatar-${id}.jpg`);
    expect(row!.foto_mime).toBe('image/jpeg');
    expect(row!.foto_at).toBeTruthy();
    // 2ª leitura vem do disco: não bate de novo no CDN.
    fetchMock.mockClear();
    const r2 = await foto(id, auth());
    expect(r2.statusCode).toBe(200);
    expect(r2.rawPayload.equals(png)).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('If-None-Match com a foto cacheada devolve 304', async () => {
    const id = await mkFoto(CDN);
    const r = await foto(id, auth());
    const r2 = await foto(id, { ...auth(), 'if-none-match': r.headers.etag as string });
    expect(r2.statusCode).toBe(304);
  });

  it('disco desligado cacheia base64 na linha', async () => {
    config.whatsappMediaDir = '';
    try {
      const id = await mkFoto(CDN);
      expect((await foto(id, auth())).statusCode).toBe(200);
      const row = await one<{ foto_b64: string | null }>('SELECT foto_b64 FROM whatsapp_chats WHERE id = $1', [id]);
      expect(row!.foto_b64).toBe(png.toString('base64'));
    } finally { config.whatsappMediaDir = mediaDir; }
  });

  it('URL expirada: rebaixa na Evolution, grava a nova e serve', async () => {
    const id = await mkFoto(CDN);
    const nova = 'https://pps.whatsapp.net/v/t61/nova.jpg?oe=def';
    fetchMock.mockImplementationOnce(async () => new Response('', { status: 403 })); // URL velha caducou
    evoMock.profilePicture.mockResolvedValueOnce(nova);
    const r = await foto(id, auth());
    expect(r.statusCode).toBe(200);
    expect(fetchMock.mock.calls[1]![0]!.toString()).toBe(nova);
    const row = await one<{ foto_url: string }>('SELECT foto_url FROM whatsapp_chats WHERE id = $1', [id]);
    expect(row!.foto_url).toBe(nova);
  });

  it('grupo usa groupInfo pra descobrir a foto', async () => {
    const id = await mkFoto(null, `12036304@g.us`);
    evoMock.groupInfo.mockResolvedValueOnce({ subject: 'G', pictureUrl: CDN });
    expect((await foto(id, auth())).statusCode).toBe(200);
    expect(evoMock.profilePicture).not.toHaveBeenCalled();
  });

  it('sem foto no WhatsApp → 404 (client cai na inicial)', async () => {
    const id = await mkFoto(null);
    evoMock.profilePicture.mockResolvedValueOnce(null);
    expect((await foto(id, auth())).statusCode).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('URL fora do CDN da Meta não é buscada (anti-SSRF)', async () => {
    const id = await mkFoto('http://evolution:8080/interno');
    evoMock.profilePicture.mockResolvedValueOnce(null);
    expect((await foto(id, auth())).statusCode).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled(); // nem tentou bater no host interno
  });

  it('resposta que não é imagem é descartada', async () => {
    const id = await mkFoto(CDN);
    fetchMock.mockImplementationOnce(async () => new Response('<html>', { headers: { 'content-type': 'text/html' } }));
    evoMock.profilePicture.mockResolvedValueOnce(null);
    expect((await foto(id, auth())).statusCode).toBe(404);
    const row = await one<{ foto_path: string | null }>('SELECT foto_path FROM whatsapp_chats WHERE id = $1', [id]);
    expect(row!.foto_path).toBeNull();
  });

  it('troca da foto no WhatsApp invalida o cache', async () => {
    const id = await mkFoto(CDN);
    await foto(id, auth());
    const { updateFotoById } = await import('../src/whatsapp.ts');
    await updateFotoById(org, id, 'https://pps.whatsapp.net/v/t61/outra.jpg?oe=999');
    const row = await one<{ foto_path: string | null; foto_at: string | null }>(
      'SELECT foto_path, foto_at FROM whatsapp_chats WHERE id = $1', [id]);
    expect(row!.foto_path).toBeNull();
    expect(row!.foto_at).toBeNull();
  });
});
