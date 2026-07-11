// Cobertura da lógica de domínio em src/whatsapp.ts (SQL cru, DB real): helpers
// de jid/número, upsert/merge de conversas com dedup telefone↔LID, aliases,
// insert com dedup, sync de nomes de grupo. evolution mockado (só fetchAllGroups).
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { makeApp, register, closeAll, makeCompany, type Session } from './helpers.ts';
import { one, query } from '../src/db.ts';

const { fetchAllGroups } = vi.hoisted(() => ({ fetchAllGroups: vi.fn() }));
vi.mock('../src/evolution.ts', () => ({
  fetchAllGroups,
  EvolutionDisabledError: class EvolutionDisabledError extends Error {},
}));

const wa = await import('../src/whatsapp.ts');

let org = 0;
let s: Session;

beforeAll(async () => {
  const app = await makeApp();
  s = await register(app, 'wa-domain');
  org = Number(s.user.org_id);
  await app.close();
});
afterAll(() => closeAll());
beforeEach(() => fetchAllGroups.mockReset());

describe('whatsapp — helpers puros', () => {
  it('instanceName determinístico', () => {
    expect(wa.instanceName(7)).toBe('org_7');
  });
  it('jidToNumero: telefone, grupo, vazio', () => {
    expect(wa.jidToNumero('5511999999999@s.whatsapp.net')).toBe('5511999999999');
    expect(wa.jidToNumero('123-45@g.us')).toBe('12345');
    expect(wa.jidToNumero('@x')).toBe('');
  });
  it('normalizeNumero: vazio, sem DDI, com DDI', () => {
    expect(wa.normalizeNumero('()-')).toBe('');
    expect(wa.normalizeNumero('(47) 99229-7790')).toBe('5547992297790');
    expect(wa.normalizeNumero('5547992297790')).toBe('5547992297790');
  });
  it('numeroToJid', () => {
    expect(wa.numeroToJid('47992297790')).toBe('5547992297790@s.whatsapp.net');
  });
});

describe('whatsapp — settings/org', () => {
  it('ensureSettings é idempotente e orgByInstance reverte', async () => {
    expect(await wa.ensureSettings(org)).toBe(`org_${org}`);
    await wa.ensureSettings(org); // ON CONFLICT DO NOTHING
    expect(await wa.orgByInstance(`org_${org}`)).toBe(org);
    expect(await wa.orgByInstance('org_inexistente')).toBeNull();
  });
  it('setStatus atualiza status e numero', async () => {
    await wa.ensureSettings(org);
    await wa.setStatus(org, 'conectado', '5511');
    const r = await one<{ status: string; numero: string }>('SELECT status, numero FROM org_whatsapp_settings WHERE org_id = $1', [org]);
    expect(r).toMatchObject({ status: 'conectado', numero: '5511' });
    await wa.setStatus(org, 'desconectado'); // numero preservado (COALESCE)
    const r2 = await one<{ numero: string }>('SELECT numero FROM org_whatsapp_settings WHERE org_id = $1', [org]);
    expect(r2!.numero).toBe('5511');
  });
});

describe('whatsapp — relationshipForCompany', () => {
  it('null sem vínculo, id com vínculo', async () => {
    const companyId = await makeCompany();
    expect(await wa.relationshipForCompany(org, companyId)).toBeNull();
    const rel = await one<{ id: string }>(
      'INSERT INTO company_relationships (org_id, company_id) VALUES ($1, $2) RETURNING id', [org, companyId]);
    const got = await wa.relationshipForCompany(org, companyId);
    expect(got!.id).toBe(rel!.id);
  });
});

describe('whatsapp — upsertChat / aliases / merge', () => {
  it('cria conversa nova de telefone e registra alias/numero', async () => {
    const chat = await wa.upsertChat(org, '5511100000001@s.whatsapp.net', { nome: 'Ana', preview: 'oi', incNaoLidas: true });
    expect(chat.numero).toBe('5511100000001');
    expect(chat.nome).toBe('Ana');
    expect(chat.nao_lidas).toBe(1);
    expect(await wa.resolveChatId(org, '5511100000001@s.whatsapp.net')).toBe(chat.id);
  });

  it('envio próprio (incNaoLidas:false) zera não-lidas', async () => {
    const jid = '5511100000002@s.whatsapp.net';
    await wa.upsertChat(org, jid, { incNaoLidas: true });
    const chat = await wa.upsertChat(org, jid, { preview: 'eu', incNaoLidas: false });
    expect(chat.nao_lidas).toBe(0);
  });

  it('cria com altJid (telefone+lid): telefone vira primário, lid gravado', async () => {
    const chat = await wa.upsertChat(org, '5511100000003@s.whatsapp.net', {}, '333@lid');
    expect(chat.remote_jid).toBe('5511100000003@s.whatsapp.net');
    expect(chat.numero).toBe('5511100000003');
    expect(chat.lid).toBe('333@lid');
    expect(await wa.resolveChatId(org, '333@lid')).toBe(chat.id);
  });

  it('jid novo reaproveita a conversa do altJid já conhecido', async () => {
    const base = await wa.upsertChat(org, '5511100000004@s.whatsapp.net');
    const again = await wa.upsertChat(org, '444novo@lid', {}, '5511100000004@s.whatsapp.net');
    expect(again.id).toBe(base.id);
    expect(await wa.resolveChatId(org, '444novo@lid')).toBe(base.id);
  });

  it('conversa só-LID: sem numero, lid vira primário', async () => {
    const chat = await wa.upsertChat(org, 'sonolid555@lid');
    expect(chat.remote_jid).toBe('sonolid555@lid');
    expect(chat.numero).toBeNull();
    expect(chat.lid).toBe('sonolid555@lid');
  });

  it('remote_jid pré-existente sem alias: ON CONFLICT reaproveita', async () => {
    const jid = '5511100000006@s.whatsapp.net';
    await query('INSERT INTO whatsapp_chats (org_id, remote_jid) VALUES ($1, $2)', [org, jid]);
    const chat = await wa.upsertChat(org, jid, { preview: 'x' });
    const cnt = await one<{ n: string }>('SELECT count(*) n FROM whatsapp_chats WHERE org_id = $1 AND remote_jid = $2', [org, jid]);
    expect(Number(cnt!.n)).toBe(1);
    expect(chat.remote_jid).toBe(jid);
  });

  it('concilia (merge) quando telefone e lid já são conversas distintas', async () => {
    const phone = '5511100000007@s.whatsapp.net';
    const lid = '777@lid';
    const a = await wa.upsertChat(org, phone);
    const b = await wa.upsertChat(org, lid);
    expect(a.id).not.toBe(b.id);
    const merged = await wa.upsertChat(org, phone, {}, lid);
    const keep = Number(a.id) <= Number(b.id) ? a.id : b.id;
    const drop = keep === a.id ? b.id : a.id;
    expect(merged.id).toBe(keep);
    expect(await one('SELECT id FROM whatsapp_chats WHERE id = $1', [drop])).toBeNull();
    expect(await wa.resolveChatId(org, phone)).toBe(keep);
    expect(await wa.resolveChatId(org, lid)).toBe(keep);
  });
});

describe('whatsapp — mergeChats direto', () => {
  it('move mensagens/agendamentos e funde metadados', async () => {
    const a = await wa.upsertChat(org, '5511100000008@s.whatsapp.net', { nome: 'Primária' });
    const b = await wa.upsertChat(org, '5511100000009@s.whatsapp.net', { nome: 'Outra' });
    await wa.insertMessage(org, b.id, { fromMe: false, corpo: 'msg da outra' });
    await query('INSERT INTO whatsapp_schedules (org_id, chat_id, remote_jid, corpo, agendado_para) VALUES ($1,$2,$3,$4, now())',
      [org, b.id, '5511100000009@s.whatsapp.net', 'agendada']);
    const merged = await wa.mergeChats(org, Number(a.id), Number(b.id));
    expect(merged.id).toBe(a.id);
    const msgs = await query('SELECT id FROM whatsapp_messages WHERE chat_id = $1 AND org_id = $2', [a.id, org]);
    expect(msgs.length).toBe(1);
    const sch = await query('SELECT id FROM whatsapp_schedules WHERE chat_id = $1 AND org_id = $2', [a.id, org]);
    expect(sch.length).toBe(1);
    expect(await one('SELECT id FROM whatsapp_chats WHERE id = $1', [b.id])).toBeNull();
  });

  it('conversa inválida faz rollback e lança', async () => {
    const a = await wa.upsertChat(org, '5511100000010@s.whatsapp.net');
    await expect(wa.mergeChats(org, Number(a.id), 999999999)).rejects.toThrow('conversa inválida');
    // primária intacta após rollback
    expect(await one('SELECT id FROM whatsapp_chats WHERE id = $1', [a.id])).not.toBeNull();
  });
});

describe('whatsapp — insertMessage dedup', () => {
  it('dedup por evolution_id; sem id insere sempre', async () => {
    const c = await wa.upsertChat(org, '5511100000011@s.whatsapp.net');
    const m1 = await wa.insertMessage(org, c.id, { evolutionId: 'EVO1', fromMe: false, corpo: 'a' });
    expect(m1).not.toBeNull();
    const dup = await wa.insertMessage(org, c.id, { evolutionId: 'EVO1', fromMe: false, corpo: 'a' });
    expect(dup).toBeNull();
    const semId = await wa.insertMessage(org, c.id, { fromMe: true, corpo: 'otimista' });
    expect(semId).not.toBeNull();
  });
});

describe('whatsapp — foto/nome/delete/sync', () => {
  it('updateFoto por jid e por id, updateNome', async () => {
    const c = await wa.upsertChat(org, '5511100000012@s.whatsapp.net');
    await wa.updateFoto(org, '5511100000012@s.whatsapp.net', 'http://foto');
    await wa.updateFotoById(org, c.id, 'http://foto2');
    await wa.updateNome(org, c.id, 'Novo Nome');
    const r = await one<{ foto_url: string; nome: string }>('SELECT foto_url, nome FROM whatsapp_chats WHERE id = $1', [c.id]);
    expect(r).toMatchObject({ foto_url: 'http://foto2', nome: 'Novo Nome' });
  });

  it('deleteChat true/false', async () => {
    const c = await wa.upsertChat(org, '5511100000013@s.whatsapp.net');
    expect(await wa.deleteChat(org, Number(c.id))).toBe(true);
    expect(await wa.deleteChat(org, Number(c.id))).toBe(false);
  });

  it('syncGroupNames corrige só grupos existentes com subject', async () => {
    const g = await wa.upsertChat(org, '55110group@g.us');
    fetchAllGroups.mockResolvedValueOnce([
      { id: '55110group@g.us', subject: 'Grupo Bom', pictureUrl: 'http://g' }, // atualiza
      { id: 'naoehgrupo', subject: 'ignorar' },                                // não @g.us
      { id: '55110group@g.us', subject: null },                                // sem subject
      { id: 'inexistente@g.us', subject: 'Sem conversa' },                     // não existe no espelho
    ]);
    const n = await wa.syncGroupNames(org);
    expect(n).toBe(1);
    const r = await one<{ nome: string }>('SELECT nome FROM whatsapp_chats WHERE id = $1', [g.id]);
    expect(r!.nome).toBe('Grupo Bom');
  });
});
