// Cobertura do cliente da Evolution API (src/evolution.ts). global.fetch é
// mockado — nenhuma rede real. Cobre o wrapper call() (sucesso, timeout/abort,
// erros com message string/array/objeto/status) e cada função exportada.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { config } from '../src/config.ts';
import * as evo from '../src/evolution.ts';

// Response-like mínimo do que evolution.call() consome (ok, status, text()).
function res(status: number, body: unknown): Response {
  const text = body === undefined ? '' : typeof body === 'string' ? body : JSON.stringify(body);
  return { ok: status >= 200 && status < 300, status, text: async () => text } as unknown as Response;
}
const fetchMock = vi.fn<(...a: unknown[]) => Promise<Response>>();

let url0 = config.evolutionApiUrl;
let key0 = config.evolutionApiKey;
let hook0 = config.whatsappWebhookUrl;

beforeEach(() => {
  url0 = config.evolutionApiUrl; key0 = config.evolutionApiKey; hook0 = config.whatsappWebhookUrl;
  config.evolutionApiUrl = 'http://evo.test'; config.evolutionApiKey = 'k';
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  config.evolutionApiUrl = url0; config.evolutionApiKey = key0; config.whatsappWebhookUrl = hook0;
  vi.unstubAllGlobals();
});

describe('evolution — configuração', () => {
  it('evolutionEnabled reflete url+key', () => {
    expect(evo.evolutionEnabled()).toBe(true);
    config.evolutionApiUrl = '';
    expect(evo.evolutionEnabled()).toBe(false);
  });

  it('EvolutionDisabledError quando url/key vazios', async () => {
    config.evolutionApiUrl = '';
    await expect(evo.connectionState('org_1')).rejects.toBeInstanceOf(evo.EvolutionDisabledError);
  });

  it('remove barra final da base ao montar a URL', async () => {
    config.evolutionApiUrl = 'http://evo.test/';
    fetchMock.mockResolvedValueOnce(res(200, { instance: { state: 'open' } }));
    await evo.connectionState('org_1');
    expect(fetchMock.mock.calls[0]![0]).toBe('http://evo.test/instance/connectionState/org_1');
  });
});

describe('evolution — call() tratamento de erro', () => {
  it('timeout vira mensagem amigável', async () => {
    fetchMock.mockRejectedValueOnce(Object.assign(new Error('x'), { name: 'TimeoutError' }));
    await expect(evo.logout('org_1')).rejects.toThrow('tempo de resposta esgotado');
  });
  it('abort vira mensagem amigável', async () => {
    fetchMock.mockRejectedValueOnce(Object.assign(new Error('x'), { name: 'AbortError' }));
    await expect(evo.logout('org_1')).rejects.toThrow('tempo de resposta esgotado');
  });
  it('outro erro de rede propaga cru', async () => {
    fetchMock.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    await expect(evo.logout('org_1')).rejects.toThrow('ECONNREFUSED');
  });
  it('erro com response.message', async () => {
    fetchMock.mockResolvedValueOnce(res(400, { response: { message: 'msg aninhada' } }));
    await expect(evo.logout('org_1')).rejects.toThrow('msg aninhada');
  });
  it('erro com message no topo', async () => {
    fetchMock.mockResolvedValueOnce(res(400, { message: 'msg topo' }));
    await expect(evo.logout('org_1')).rejects.toThrow('msg topo');
  });
  it('erro sem message cai em Evolution <status>', async () => {
    fetchMock.mockResolvedValueOnce(res(418, {}));
    await expect(evo.logout('org_1')).rejects.toThrow('Evolution 418');
  });
  it('erro com array serializa string/exists:false/objeto', async () => {
    fetchMock.mockResolvedValueOnce(res(400, { message: ['texto', { exists: false, number: '5511' }, { foo: 1 }] }));
    await expect(evo.logout('org_1')).rejects.toThrow('texto; número não está no WhatsApp: 5511; {"foo":1}');
  });
  it('exists:false sem number cai no jid', async () => {
    fetchMock.mockResolvedValueOnce(res(400, { message: [{ exists: false, jid: '5511@s.whatsapp.net' }] }));
    await expect(evo.logout('org_1')).rejects.toThrow('número não está no WhatsApp: 5511@s.whatsapp.net');
  });
  it('corpo vazio vira data null (sem throw quando ok)', async () => {
    fetchMock.mockResolvedValueOnce(res(200, undefined));
    await expect(evo.logout('org_1')).resolves.toBeUndefined();
  });
});

describe('evolution — funções', () => {
  it('createInstance com webhook configurado', async () => {
    config.whatsappWebhookUrl = 'http://app/webhook';
    fetchMock.mockResolvedValueOnce(res(200, {}));
    await evo.createInstance('org_1');
    const body = JSON.parse(fetchMock.mock.calls[0]![1]!.body as string);
    expect(body.instanceName).toBe('org_1');
    expect(body.webhook.url).toBe('http://app/webhook');
  });
  it('createInstance sem webhook', async () => {
    config.whatsappWebhookUrl = '';
    fetchMock.mockResolvedValueOnce(res(200, {}));
    await evo.createInstance('org_1');
    const body = JSON.parse(fetchMock.mock.calls[0]![1]!.body as string);
    expect(body.webhook).toBeUndefined();
  });
  it('connect com qrcode aninhado', async () => {
    fetchMock.mockResolvedValueOnce(res(200, { qrcode: { code: 'c', base64: 'b' }, instance: { state: 'connecting' } }));
    expect(await evo.connect('org_1')).toEqual({ code: 'c', base64: 'b', state: 'connecting' });
  });
  it('connect com campos planos', async () => {
    fetchMock.mockResolvedValueOnce(res(200, { code: 'c2', base64: 'b2' }));
    expect(await evo.connect('org_1')).toEqual({ code: 'c2', base64: 'b2', state: null });
  });
  it('connectionState default close', async () => {
    fetchMock.mockResolvedValueOnce(res(200, {}));
    expect(await evo.connectionState('org_1')).toBe('close');
  });
  it('sendText monta number+text', async () => {
    fetchMock.mockResolvedValueOnce(res(200, { key: { id: 'm1' } }));
    expect(await evo.sendText('org_1', '5511', 'oi')).toEqual({ key: { id: 'm1' } });
    expect(JSON.parse(fetchMock.mock.calls[0]![1]!.body as string)).toEqual({ number: '5511', text: 'oi' });
  });
  it('whatsappNumbers mapeia array', async () => {
    fetchMock.mockResolvedValueOnce(res(200, [{ exists: true, jid: 'j', number: '5511' }, {}]));
    expect(await evo.whatsappNumbers('org_1', ['5511'])).toEqual([
      { exists: true, jid: 'j', number: '5511' }, { exists: false, jid: '', number: '' },
    ]);
  });
  it('whatsappNumbers com resposta não-array vira []', async () => {
    fetchMock.mockResolvedValueOnce(res(200, { erro: true }));
    expect(await evo.whatsappNumbers('org_1', ['5511'])).toEqual([]);
  });
  it('sendMedia e sendAudio', async () => {
    fetchMock.mockResolvedValueOnce(res(200, { key: { id: 'md' } }));
    expect(await evo.sendMedia('org_1', '5511', { mediatype: 'image', media: 'b64' })).toEqual({ key: { id: 'md' } });
    fetchMock.mockResolvedValueOnce(res(200, { key: { id: 'au' } }));
    expect(await evo.sendAudio('org_1', '5511', 'b64')).toEqual({ key: { id: 'au' } });
  });
  it('getMediaBase64', async () => {
    fetchMock.mockResolvedValueOnce(res(200, { base64: 'AA', mimetype: 'image/png' }));
    expect(await evo.getMediaBase64('org_1', { id: 'm', remoteJid: 'j', fromMe: false })).toMatchObject({ base64: 'AA' });
  });
  it('markRead sem mensagens não chama fetch', async () => {
    await evo.markRead('org_1', []);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('markRead com mensagens chama fetch', async () => {
    fetchMock.mockResolvedValueOnce(res(200, {}));
    await evo.markRead('org_1', [{ id: 'm', remoteJid: 'j', fromMe: false }]);
    expect(fetchMock).toHaveBeenCalledOnce();
  });
  it('sendPresence', async () => {
    fetchMock.mockResolvedValueOnce(res(200, {}));
    await evo.sendPresence('org_1', '5511', 'composing');
    expect(fetchMock).toHaveBeenCalledOnce();
  });
  it('profilePicture url e null', async () => {
    fetchMock.mockResolvedValueOnce(res(200, { profilePictureUrl: 'http://p' }));
    expect(await evo.profilePicture('org_1', '5511')).toBe('http://p');
    fetchMock.mockResolvedValueOnce(res(200, {}));
    expect(await evo.profilePicture('org_1', '5511')).toBeNull();
  });
  it('groupInfo subject/foto', async () => {
    fetchMock.mockResolvedValueOnce(res(200, { subject: 'G', pictureUrl: 'http://g' }));
    expect(await evo.groupInfo('org_1', 'g@g.us')).toEqual({ subject: 'G', pictureUrl: 'http://g' });
    fetchMock.mockResolvedValueOnce(res(200, {}));
    expect(await evo.groupInfo('org_1', 'g@g.us')).toEqual({ subject: null, pictureUrl: null });
  });
  it('groupDetails com e sem participantes', async () => {
    fetchMock.mockResolvedValueOnce(res(200, { subject: 'G', desc: 'd', size: 2, participants: [{ id: 'p1', admin: 'admin' }] }));
    expect(await evo.groupDetails('org_1', 'g@g.us')).toEqual({
      subject: 'G', desc: 'd', size: 2, participants: [{ id: 'p1', admin: 'admin' }],
    });
    fetchMock.mockResolvedValueOnce(res(200, {}));
    expect(await evo.groupDetails('org_1', 'g@g.us')).toEqual({ subject: null, desc: null, size: null, participants: [] });
  });
  it('fetchAllGroups array e não-array', async () => {
    fetchMock.mockResolvedValueOnce(res(200, [{ id: 'g@g.us', subject: 'G' }]));
    expect(await evo.fetchAllGroups('org_1')).toHaveLength(1);
    fetchMock.mockResolvedValueOnce(res(200, { x: 1 }));
    expect(await evo.fetchAllGroups('org_1')).toEqual([]);
  });
});
