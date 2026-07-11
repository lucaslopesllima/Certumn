// Cobertura da rota PATCH /api/whatsapp/chats/:id/numero — confirmação do
// telefone de um contato que chegou só como LID (número oculto).
//
// Foco: a validação no WhatsApp (evolution.whatsappNumbers) é best-effort.
// - Evolution confirma (exists:true)      -> 200, grava o jid canônico.
// - Evolution nega (respondeu, sem hit)    -> 422 (número não existe).
// - Evolution instável (throw genérico)    -> 200 mesmo assim (regressão: antes 502).
// - Evolution sem resposta útil (array [])  -> 200 com o jid montado.
// - Integração desligada (EvolutionDisabled)-> 503.
// evolution.ts é mockado: nenhuma chamada real sai.
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { makeApp, register, bearer, uniq, closeAll, type Session } from './helpers.ts';
import { query, one } from '../src/db.ts';

// whatsappNumbers controlável por teste; EvolutionDisabledError precisa ser a
// MESMA classe que a rota compara com `instanceof` — por isso vem do mock.
const { whatsappNumbers, EvolutionDisabledError } = vi.hoisted(() => {
  class EvolutionDisabledError extends Error {
    constructor() { super('integração WhatsApp não configurada'); }
  }
  return { whatsappNumbers: vi.fn(), EvolutionDisabledError };
});
vi.mock('../src/evolution.ts', () => ({ whatsappNumbers, EvolutionDisabledError }));

let app: FastifyInstance;
let a: Session;   // org A (admin, bypassa permissão whatsapp.link)
let b: Session;   // org B (isolamento)

const inj = (s: Session, method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: unknown):
  ReturnType<FastifyInstance['inject']> =>
  app.inject({ method, url, headers: bearer(s.token), payload });

// Cria uma conversa que chegou só como @lid (sem numero), no org dado.
async function makeLidChat(orgId: number): Promise<number> {
  const jid = `${uniq('lid').replace(/\D/g, '')}@lid`;
  const r = await one<{ id: string }>(
    'INSERT INTO whatsapp_chats (org_id, remote_jid, lid) VALUES ($1, $2, $2) RETURNING id',
    [orgId, jid],
  );
  return Number(r!.id);
}

const aliasCount = async (orgId: number, jid: string): Promise<number> => {
  const r = await one<{ n: string }>(
    "SELECT count(*) n FROM whatsapp_chat_jids WHERE org_id = $1 AND jid = $2 AND tipo = 'phone'",
    [orgId, jid],
  );
  return Number(r!.n);
};

beforeAll(async () => {
  app = await makeApp();
  a = await register(app, 'wa-num-a');
  b = await register(app, 'wa-num-b');
});
afterAll(() => closeAll(app));
beforeEach(() => whatsappNumbers.mockReset());

describe('PATCH /api/whatsapp/chats/:id/numero', () => {
  it('confirma e grava o jid canônico quando a Evolution valida (exists:true)', async () => {
    const chatId = await makeLidChat(a.user.org_id);
    whatsappNumbers.mockResolvedValueOnce([
      { exists: true, jid: '5547992297790@s.whatsapp.net', number: '5547992297790' },
    ]);
    const r = await inj(a, 'PATCH', `/api/whatsapp/chats/${chatId}/numero`, { numero: '47992297790' });
    expect(r.statusCode).toBe(200);
    expect(r.json().chat.numero).toBe('5547992297790');
    const c = await one<{ numero: string }>('SELECT numero FROM whatsapp_chats WHERE id = $1', [chatId]);
    expect(c!.numero).toBe('5547992297790');
    expect(await aliasCount(a.user.org_id, '5547992297790@s.whatsapp.net')).toBe(1);
    expect(whatsappNumbers).toHaveBeenCalledWith('org_' + a.user.org_id, ['5547992297790']);
  });

  it('grava mesmo quando a Evolution está instável (throw) — não devolve 502', async () => {
    const chatId = await makeLidChat(a.user.org_id);
    // Reproduz o erro real de produção: socket sem onWhatsApp -> Evolution 400.
    whatsappNumbers.mockRejectedValueOnce(new Error("Cannot read properties of undefined (reading 'onWhatsApp')"));
    const r = await inj(a, 'PATCH', `/api/whatsapp/chats/${chatId}/numero`, { numero: '47992297790' });
    expect(r.statusCode).toBe(200);
    expect(r.json().chat.numero).toBe('5547992297790');
    expect(await aliasCount(a.user.org_id, '5547992297790@s.whatsapp.net')).toBe(1);
  });

  it('grava com o jid montado quando a Evolution devolve resposta vazia', async () => {
    const chatId = await makeLidChat(a.user.org_id);
    whatsappNumbers.mockResolvedValueOnce([]);
    const r = await inj(a, 'PATCH', `/api/whatsapp/chats/${chatId}/numero`, { numero: '47992297790' });
    expect(r.statusCode).toBe(200);
    expect(r.json().chat.numero).toBe('5547992297790');
  });

  it('nega (422) quando a Evolution responde e o número não existe', async () => {
    const chatId = await makeLidChat(a.user.org_id);
    whatsappNumbers.mockResolvedValueOnce([{ exists: false, jid: '', number: '5547992297790' }]);
    const r = await inj(a, 'PATCH', `/api/whatsapp/chats/${chatId}/numero`, { numero: '47992297790' });
    expect(r.statusCode).toBe(422);
    const c = await one<{ numero: string | null }>('SELECT numero FROM whatsapp_chats WHERE id = $1', [chatId]);
    expect(c!.numero).toBeNull();
  });

  it('devolve 503 quando a integração WhatsApp está desligada', async () => {
    const chatId = await makeLidChat(a.user.org_id);
    whatsappNumbers.mockRejectedValueOnce(new EvolutionDisabledError());
    const r = await inj(a, 'PATCH', `/api/whatsapp/chats/${chatId}/numero`, { numero: '47992297790' });
    expect(r.statusCode).toBe(503);
  });

  it('rejeita número curto (sem DDD) com 400', async () => {
    const chatId = await makeLidChat(a.user.org_id);
    const r = await inj(a, 'PATCH', `/api/whatsapp/chats/${chatId}/numero`, { numero: '11333344' });
    expect(r.statusCode).toBe(400);
    expect(whatsappNumbers).not.toHaveBeenCalled();
  });

  it('rejeita body sem numero (schema) com 400', async () => {
    const chatId = await makeLidChat(a.user.org_id);
    const r = await inj(a, 'PATCH', `/api/whatsapp/chats/${chatId}/numero`, {});
    expect(r.statusCode).toBe(400);
  });

  it('404 quando a conversa não existe', async () => {
    const r = await inj(a, 'PATCH', '/api/whatsapp/chats/999999999/numero', { numero: '47992297790' });
    expect(r.statusCode).toBe(404);
  });

  it('404 quando a conversa é de outro org (isolamento)', async () => {
    const chatId = await makeLidChat(b.user.org_id);
    const r = await inj(a, 'PATCH', `/api/whatsapp/chats/${chatId}/numero`, { numero: '47992297790' });
    expect(r.statusCode).toBe(404);
    expect(whatsappNumbers).not.toHaveBeenCalled();
  });

  it('exige autenticação', async () => {
    const chatId = await makeLidChat(a.user.org_id);
    const r = await app.inject({ method: 'PATCH', url: `/api/whatsapp/chats/${chatId}/numero`, payload: { numero: '47992297790' } });
    expect(r.statusCode).toBe(401);
  });
});
