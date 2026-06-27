// Wrapper de fetch: token, JSON, ApiError, 401 -> limpa token, AbortSignal.
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import { api, ApiError, getToken, setToken } from '../src/lib/api.ts';

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);
afterAll(() => vi.unstubAllGlobals());

const resp = (status: number, body: unknown = null): Response => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => (body === null ? '' : JSON.stringify(body)),
} as unknown as Response);

beforeEach(() => {
  fetchMock.mockReset();
  setToken(null);
});

describe('token storage', () => {
  it('set/get/clear no localStorage', () => {
    expect(getToken()).toBeNull();
    setToken('abc');
    expect(getToken()).toBe('abc');
    expect(localStorage.getItem('rs_token')).toBe('abc');
    setToken(null);
    expect(getToken()).toBeNull();
  });
});

describe('request', () => {
  it('GET parseia JSON e não manda content-type sem body', async () => {
    fetchMock.mockResolvedValueOnce(resp(200, { ok: 1 }));
    const r = await api.get<{ ok: number }>('/api/x');
    expect(r.ok).toBe(1);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe('GET');
    expect((init.headers as Record<string, string>)['content-type']).toBeUndefined();
    expect((init.headers as Record<string, string>).authorization).toBeUndefined();
  });

  it('anexa Bearer quando há token e serializa body', async () => {
    setToken('tok123');
    fetchMock.mockResolvedValueOnce(resp(200, {}));
    await api.post('/api/x', { a: 1 });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer tok123');
    expect((init.headers as Record<string, string>)['content-type']).toBe('application/json');
    expect(init.body).toBe('{"a":1}');
  });

  it('erro vira ApiError com mensagem do servidor', async () => {
    fetchMock.mockResolvedValueOnce(resp(400, { error: 'inválido' }));
    await expect(api.post('/api/x', {})).rejects.toMatchObject({ status: 400, message: 'inválido' });
    fetchMock.mockResolvedValueOnce(resp(500, { message: 'pane' }));
    await expect(api.get('/api/x')).rejects.toThrow('pane');
    fetchMock.mockResolvedValueOnce(resp(502, {}));
    await expect(api.get('/api/x')).rejects.toThrow('Erro 502');
  });

  it('401 limpa o token', async () => {
    setToken('morto');
    fetchMock.mockResolvedValueOnce(resp(401, { error: 'invalid token' }));
    await expect(api.get('/api/x')).rejects.toBeInstanceOf(ApiError);
    expect(getToken()).toBeNull();
  });

  it('corpo vazio resolve null; PUT/PATCH/DELETE funcionam', async () => {
    fetchMock.mockResolvedValue(resp(200));
    expect(await api.put('/api/x', { a: 1 })).toBeNull();
    expect(await api.patch('/api/x', { a: 1 })).toBeNull();
    expect(await api.del('/api/x')).toBeNull();
    expect(fetchMock.mock.calls.map((c) => (c[1] as RequestInit).method)).toEqual(['PUT', 'PATCH', 'DELETE']);
  });

  it('repassa o AbortSignal ao fetch', async () => {
    const ac = new AbortController();
    fetchMock.mockResolvedValueOnce(resp(200, {}));
    await api.get('/api/x', { signal: ac.signal });
    expect((fetchMock.mock.calls[0]![1] as RequestInit).signal).toBe(ac.signal);
  });
});
