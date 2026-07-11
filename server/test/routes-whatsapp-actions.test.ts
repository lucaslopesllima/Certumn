// Cobertura das rotas de ação de src/routes/whatsapp.ts: envio de texto/mídia,
// vínculo com empresa, dados de grupo, conciliação (merge), exclusão, abrir a
// partir da empresa e agendamentos. evolution mockada.
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { makeApp, register, bearer, makeCompany, closeAll, type Session } from './helpers.ts';
import { one, query } from '../src/db.ts';

const evoMock = vi.hoisted(() => ({
  sendText: vi.fn(), sendMedia: vi.fn(), sendAudio: vi.fn(), groupDetails: vi.fn(),
  fetchAllGroups: vi.fn(async () => []), markRead: vi.fn(async () => undefined),
  profilePicture: vi.fn(async () => null), groupInfo: vi.fn(async () => ({ subject: null, pictureUrl: null })),
}));
vi.mock('../src/evolution.ts', () => ({ ...evoMock, EvolutionDisabledError: class EvolutionDisabledError extends Error {} }));
const { EvolutionDisabledError } = await import('../src/evolution.ts');

let app: FastifyInstance;
let org = 0;
let s: Session;

const inj = (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: unknown): ReturnType<FastifyInstance['inject']> =>
  app.inject({ method, url, headers: bearer(s.token), payload });
const mkChat = async (jid: string, numero: string | null): Promise<string> =>
  (await one<{ id: string }>('INSERT INTO whatsapp_chats (org_id, remote_jid, numero) VALUES ($1,$2,$3) RETURNING id', [org, jid, numero]))!.id;

beforeAll(async () => {
  app = await makeApp();
  s = await register(app, 'wa-actions');
  org = Number(s.user.org_id);
});
afterAll(() => closeAll(app));
beforeEach(() => {
  for (const f of Object.values(evoMock)) (f as ReturnType<typeof vi.fn>).mockReset();
  evoMock.sendText.mockResolvedValue({ key: { id: 'sent-1' } });
  evoMock.sendMedia.mockResolvedValue({ key: { id: 'media-1' } });
  evoMock.sendAudio.mockResolvedValue({ key: { id: 'audio-1' } });
});

describe('whatsapp — send texto', () => {
  it('404 conversa inexistente', async () => {
    expect((await inj('POST', '/api/whatsapp/chats/999999/send', { text: 'x' })).statusCode).toBe(404);
  });
  it('422 LID sem número', async () => {
    const chat = await mkChat('lidsend@lid', null);
    expect((await inj('POST', `/api/whatsapp/chats/${chat}/send`, { text: 'x' })).statusCode).toBe(422);
  });
  it('envia, persiste e devolve a mensagem', async () => {
    const chat = await mkChat('5511700000001@s.whatsapp.net', '5511700000001');
    const r = await inj('POST', `/api/whatsapp/chats/${chat}/send`, { text: 'olá' });
    expect(r.statusCode).toBe(200);
    expect(r.json().message.corpo).toBe('olá');
    expect(evoMock.sendText).toHaveBeenCalledWith('org_' + org, '5511700000001', 'olá');
  });
  it('503 desligada / 502 erro', async () => {
    const chat = await mkChat('5511700000002@s.whatsapp.net', '5511700000002');
    evoMock.sendText.mockRejectedValueOnce(new EvolutionDisabledError());
    expect((await inj('POST', `/api/whatsapp/chats/${chat}/send`, { text: 'x' })).statusCode).toBe(503);
    evoMock.sendText.mockRejectedValueOnce(new Error('boom'));
    expect((await inj('POST', `/api/whatsapp/chats/${chat}/send`, { text: 'x' })).statusCode).toBe(502);
  });
});

describe('whatsapp — send-media', () => {
  const b64 = Buffer.from('anexo').toString('base64');
  it('404 e 422 (LID)', async () => {
    expect((await inj('POST', '/api/whatsapp/chats/999999/send-media', { media: b64, mediatype: 'image' })).statusCode).toBe(404);
    const lid = await mkChat('lidmedia@lid', null);
    expect((await inj('POST', `/api/whatsapp/chats/${lid}/send-media`, { media: b64, mediatype: 'image' })).statusCode).toBe(422);
  });
  it('imagem/documento via sendMedia (grava em disco)', async () => {
    const chat = await mkChat('5511700000003@s.whatsapp.net', '5511700000003');
    const r = await inj('POST', `/api/whatsapp/chats/${chat}/send-media`, { media: b64, mediatype: 'image', mimetype: 'image/png', fileName: 'x.png', caption: 'foto' });
    expect(r.statusCode).toBe(200);
    expect(r.json().message.tipo).toBe('imagem');
    expect(evoMock.sendMedia).toHaveBeenCalled();
    const row = await one<{ media_path: string | null }>('SELECT media_path FROM whatsapp_messages WHERE id = $1', [r.json().message.id]);
    expect(row!.media_path).toBeTruthy(); // disco habilitado no container
  });
  it('áudio via sendAudio', async () => {
    const chat = await mkChat('5511700000004@s.whatsapp.net', '5511700000004');
    const r = await inj('POST', `/api/whatsapp/chats/${chat}/send-media`, { media: b64, mediatype: 'audio' });
    expect(r.json().message.tipo).toBe('audio');
    expect(evoMock.sendAudio).toHaveBeenCalled();
  });
  it('503 desligada / 502 erro', async () => {
    const chat = await mkChat('5511700000005@s.whatsapp.net', '5511700000005');
    evoMock.sendMedia.mockRejectedValueOnce(new EvolutionDisabledError());
    expect((await inj('POST', `/api/whatsapp/chats/${chat}/send-media`, { media: b64, mediatype: 'image' })).statusCode).toBe(503);
    evoMock.sendMedia.mockRejectedValueOnce(new Error('x'));
    expect((await inj('POST', `/api/whatsapp/chats/${chat}/send-media`, { media: b64, mediatype: 'image' })).statusCode).toBe(502);
  });
});

describe('whatsapp — link empresa', () => {
  it('404, vincula com relationship e desvincula (null)', async () => {
    expect((await inj('PATCH', '/api/whatsapp/chats/999999/link', { company_id: null })).statusCode).toBe(404);
    const companyId = await makeCompany();
    await query('INSERT INTO company_relationships (org_id, company_id) VALUES ($1, $2)', [org, companyId]);
    const chat = await mkChat('5511700000006@s.whatsapp.net', '5511700000006');
    const r = await inj('PATCH', `/api/whatsapp/chats/${chat}/link`, { company_id: companyId });
    expect(r.statusCode).toBe(200);
    expect(String(r.json().chat.company_id)).toBe(String(companyId));
    const r2 = await inj('PATCH', `/api/whatsapp/chats/${chat}/link`, { company_id: null });
    expect(r2.json().chat.company_id).toBeNull();
  });
});

describe('whatsapp — grupo', () => {
  it('404, 400 não-grupo, detalhes, 503/502', async () => {
    expect((await inj('GET', '/api/whatsapp/chats/999999/group')).statusCode).toBe(404);
    const naoGrupo = await mkChat('5511700000007@s.whatsapp.net', '5511700000007');
    expect((await inj('GET', `/api/whatsapp/chats/${naoGrupo}/group`)).statusCode).toBe(400);
    const grupo = await mkChat('5511700grp@g.us', null);
    evoMock.groupDetails.mockResolvedValueOnce({ subject: 'G', desc: 'd', size: 3, participants: [{ id: '5511@s.whatsapp.net', admin: 'admin' }] });
    const r = await inj('GET', `/api/whatsapp/chats/${grupo}/group`);
    expect(r.json()).toMatchObject({ subject: 'G', size: 3 });
    expect(r.json().participants[0]).toMatchObject({ numero: '5511', admin: 'admin' });
    evoMock.groupDetails.mockRejectedValueOnce(new EvolutionDisabledError());
    expect((await inj('GET', `/api/whatsapp/chats/${grupo}/group`)).statusCode).toBe(503);
    evoMock.groupDetails.mockRejectedValueOnce(new Error('x'));
    expect((await inj('GET', `/api/whatsapp/chats/${grupo}/group`)).statusCode).toBe(502);
  });
});

describe('whatsapp — merge', () => {
  it('400 mesmo id, sucesso, 400 inválido', async () => {
    const a = await mkChat('5511700000008@s.whatsapp.net', '5511700000008');
    const b = await mkChat('5511700000009@s.whatsapp.net', '5511700000009');
    expect((await inj('POST', `/api/whatsapp/chats/${a}/merge`, { other_id: Number(a) })).statusCode).toBe(400);
    const r = await inj('POST', `/api/whatsapp/chats/${a}/merge`, { other_id: Number(b) });
    expect(r.statusCode).toBe(200);
    expect(await one('SELECT id FROM whatsapp_chats WHERE id = $1', [b])).toBeNull();
    expect((await inj('POST', `/api/whatsapp/chats/${a}/merge`, { other_id: 999999 })).statusCode).toBe(400);
  });
});

describe('whatsapp — delete conversa', () => {
  it('404 e sucesso', async () => {
    expect((await inj('DELETE', '/api/whatsapp/chats/999999')).statusCode).toBe(404);
    const chat = await mkChat('5511700000010@s.whatsapp.net', '5511700000010');
    expect((await inj('DELETE', `/api/whatsapp/chats/${chat}`)).json()).toEqual({ ok: true });
  });
});

describe('whatsapp — from-company', () => {
  it('400 número inválido', async () => {
    const companyId = await makeCompany();
    expect((await inj('POST', '/api/whatsapp/chats/from-company', { company_id: companyId, numero: '123' })).statusCode).toBe(400);
  });
  it('cria conversa com nome da empresa e vincula', async () => {
    const companyId = await makeCompany({ fantasia: 'Fantasia SA', razao: 'Razao SA' });
    await query('INSERT INTO company_relationships (org_id, company_id) VALUES ($1, $2)', [org, companyId]);
    const r = await inj('POST', '/api/whatsapp/chats/from-company', { company_id: companyId, numero: '11988887777' });
    expect(r.statusCode).toBe(201);
    expect(r.json().chat.nome).toBe('Fantasia SA');
    expect(String(r.json().chat.company_id)).toBe(String(companyId));
  });
  it('nome explícito tem prioridade sobre o nome da empresa', async () => {
    const companyId = await makeCompany({ fantasia: 'Empresa X' });
    const r = await inj('POST', '/api/whatsapp/chats/from-company', { company_id: companyId, numero: '11977776666', nome: 'Contato Direto' });
    expect(r.statusCode).toBe(201);
    expect(r.json().chat.nome).toBe('Contato Direto');
  });
});

describe('whatsapp — agendamentos', () => {
  it('404, 422 LID, 400 data inválida e criação', async () => {
    expect((await inj('POST', '/api/whatsapp/chats/999999/schedule', { text: 'x', agendado_para: '2030-01-01T10:00:00Z' })).statusCode).toBe(404);
    const lid = await mkChat('lidsched@lid', null);
    expect((await inj('POST', `/api/whatsapp/chats/${lid}/schedule`, { text: 'x', agendado_para: '2030-01-01T10:00:00Z' })).statusCode).toBe(422);
    const chat = await mkChat('5511700000011@s.whatsapp.net', '5511700000011');
    expect((await inj('POST', `/api/whatsapp/chats/${chat}/schedule`, { text: 'x', agendado_para: 'data-ruim' })).statusCode).toBe(400);
    const r = await inj('POST', `/api/whatsapp/chats/${chat}/schedule`, { text: 'a'.repeat(80), agendado_para: '2030-01-01T10:00:00Z' });
    expect(r.statusCode).toBe(201);
    expect(r.json().schedule.status).toBe('pendente');
    // Espelhou compromisso na Agenda.
    const act = await query('SELECT id FROM activities WHERE org_id = $1 AND tipo = $2', [org, 'whatsapp']);
    expect(act.length).toBeGreaterThanOrEqual(1);
  });

  it('lista agendamentos (com e sem filtro de chat) e cancela', async () => {
    const chat = await mkChat('5511700000012@s.whatsapp.net', '5511700000012');
    const created = await inj('POST', `/api/whatsapp/chats/${chat}/schedule`, { text: 'cancelar', agendado_para: '2030-02-01T10:00:00Z' });
    const schedId = created.json().schedule.id;
    expect((await inj('GET', '/api/whatsapp/schedules')).json().schedules.length).toBeGreaterThanOrEqual(1);
    const filtered = await inj('GET', `/api/whatsapp/schedules?chat_id=${chat}`);
    expect(filtered.json().schedules.every((x: { chat_id: string }) => String(x.chat_id) === String(chat))).toBe(true);
    // cancela → remove o compromisso espelho
    expect((await inj('DELETE', `/api/whatsapp/schedules/${schedId}`)).json()).toEqual({ ok: true });
    // cancelar de novo → 404 (não está mais pendente)
    expect((await inj('DELETE', `/api/whatsapp/schedules/${schedId}`)).statusCode).toBe(404);
  });

  it('cancela agendamento sem compromisso espelho (activity_id nulo)', async () => {
    const chat = await mkChat('5511700000013@s.whatsapp.net', '5511700000013');
    const row = await one<{ id: string }>(
      `INSERT INTO whatsapp_schedules (org_id, chat_id, remote_jid, corpo, agendado_para, owner_user_id)
       VALUES ($1,$2,$3,'sem-activity','2030-03-01T10:00:00Z',$4) RETURNING id`,
      [org, chat, '5511700000013@s.whatsapp.net', Number(s.user.id)]);
    expect((await inj('DELETE', `/api/whatsapp/schedules/${row!.id}`)).json()).toEqual({ ok: true });
  });
});

describe('whatsapp — from-company (fallback razão social)', () => {
  it('usa razao_social quando não há nome fantasia', async () => {
    const companyId = await makeCompany({ razao: 'So Razao SA' });
    const r = await inj('POST', '/api/whatsapp/chats/from-company', { company_id: companyId, numero: '11966665555' });
    expect(r.statusCode).toBe(201);
    expect(r.json().chat.nome).toBe('So Razao SA');
  });
});
