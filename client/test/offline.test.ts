// Fila offline (Fase 5.4): enfileira check-in/relatório quando sem rede e
// reenvia ao reconectar. fake-indexeddb fornece o IndexedDB no jsdom.
import 'fake-indexeddb/auto';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { api, ApiError } from '../src/lib/api.ts';
import { enqueue, queued, postField, flushQueue, onQueueChange, initOfflineSync } from '../src/lib/offline.ts';

vi.mock('../src/lib/api.ts', async (orig) => {
  const real = await orig() as Record<string, unknown>;
  return { ...real, api: { ...(real.api as object), post: vi.fn() } };
});
const post = vi.mocked(api.post);

const setOnline = (v: boolean): void => {
  Object.defineProperty(navigator, 'onLine', { value: v, configurable: true });
};

// Apaga o banco entre testes — o módulo fecha as conexões ao fim de cada tx,
// então o delete não fica bloqueado. Recriar do zero cobre o onupgradeneeded.
const wipeDb = (): Promise<void> => new Promise((res) => {
  const r = indexedDB.deleteDatabase('rs_offline');
  r.onsuccess = r.onerror = r.onblocked = (): void => res();
});

beforeEach(async () => {
  post.mockReset();
  setOnline(true);
  await wipeDb();
});
afterEach(() => setOnline(true));

describe('postField', () => {
  it('online + sucesso -> não enfileira', async () => {
    post.mockResolvedValue({});
    const r = await postField('/api/activities/1/checkin', { lat: 1, lon: 2 }, 'Check-in');
    expect(r.queued).toBe(false);
    expect(post).toHaveBeenCalledOnce();
    expect(await queued()).toHaveLength(0);
  });

  it('offline -> enfileira sem chamar a API', async () => {
    setOnline(false);
    const r = await postField('/api/activities/1/report', { resultado: 'x' }, 'Relatório');
    expect(r.queued).toBe(true);
    expect(post).not.toHaveBeenCalled();
    const q = await queued();
    expect(q).toHaveLength(1);
    expect(q[0]!.path).toBe('/api/activities/1/report');
  });

  it('online + erro de rede -> enfileira', async () => {
    post.mockRejectedValue(new TypeError('Failed to fetch'));
    const r = await postField('/api/activities/2/checkin', { lat: 0, lon: 0 }, 'Check-in 2');
    expect(r.queued).toBe(true);
    expect(await queued()).toHaveLength(1);
  });

  it('online + erro de negócio (ApiError) -> propaga, não enfileira', async () => {
    post.mockRejectedValue(new ApiError(400, 'ruim'));
    await expect(postField('/api/activities/3/report', { resultado: 'x' }, 'R')).rejects.toThrow('ruim');
    expect(await queued()).toHaveLength(0);
  });
});

describe('flushQueue', () => {
  it('reenvia em ordem e esvazia a fila', async () => {
    setOnline(false);
    await postField('/a', { n: 1 }, 'A');
    await postField('/b', { n: 2 }, 'B');
    expect(await queued()).toHaveLength(2);

    setOnline(true);
    post.mockResolvedValue({});
    await flushQueue();
    expect(post).toHaveBeenCalledTimes(2);
    expect(await queued()).toHaveLength(0);
  });

  it('erro de negócio (4xx) descarta o item', async () => {
    setOnline(false);
    await postField('/a', { n: 1 }, 'A');
    setOnline(true);
    post.mockRejectedValue(new ApiError(422, 'invalido'));
    await flushQueue();
    expect(await queued()).toHaveLength(0); // descartado
  });

  it('erro de rede interrompe o flush e mantém a fila', async () => {
    setOnline(false);
    await postField('/a', { n: 1 }, 'A');
    await postField('/b', { n: 2 }, 'B');
    setOnline(true);
    post.mockRejectedValue(new TypeError('offline de novo'));
    await flushQueue();
    expect(await queued()).toHaveLength(2); // nada removido
  });
});

describe('listeners e init', () => {
  it('onQueueChange dispara no enqueue e o unsubscribe para', async () => {
    let hits = 0;
    const off = onQueueChange(() => { hits += 1; });
    await enqueue({ path: '/x', body: {}, label: 'X', createdAt: 1 });
    expect(hits).toBe(1);
    off();
    await enqueue({ path: '/y', body: {}, label: 'Y', createdAt: 2 });
    expect(hits).toBe(1); // não mudou após unsubscribe
  });

  it('initOfflineSync registra listener de online e faz flush se já online', async () => {
    setOnline(false);
    await postField('/a', { n: 1 }, 'A');
    setOnline(true);
    post.mockResolvedValue({});
    const add = vi.spyOn(window, 'addEventListener');
    initOfflineSync();
    expect(add).toHaveBeenCalledWith('online', expect.any(Function));
    // flush inicial (online) esvazia a fila
    await vi.waitFor(async () => expect(await queued()).toHaveLength(0));

    // dispara o evento 'online' -> novo flush sem erro
    await postField('/b', { n: 2 }, 'B');  // online -> some direto
    window.dispatchEvent(new Event('online'));
    add.mockRestore();
  });

  it('queued() devolve [] quando o IndexedDB falha', async () => {
    const open = vi.spyOn(indexedDB, 'open').mockImplementation(() => { throw new Error('sem idb'); });
    expect(await queued()).toEqual([]);
    open.mockRestore();
  });
});
