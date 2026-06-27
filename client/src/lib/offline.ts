// Fila offline mínima (Fase 5.4). Check-in e relatório de visita são feitos no
// campo, muitas vezes sem sinal. Quando o POST falha por estar offline, a ação
// vai para uma fila no IndexedDB e é reenviada quando a conexão volta.
//
// Escopo deliberadamente pequeno: só ações idempotentes de visita (gravar o
// mesmo check-in/relatório duas vezes não causa dano). Funil/pedidos NÃO entram
// aqui — conflito de edição offline não compensa a complexidade.
import { api, ApiError } from './api.ts';

const DB_NAME = 'rs_offline';
const STORE = 'queue';

export interface QueuedAction {
  id?: number;
  path: string;          // ex.: /api/activities/12/checkin
  body: unknown;
  createdAt: number;
  label: string;         // descrição amigável p/ a UI ("Check-in: ACME")
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then((db) => new Promise<T>((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const r = fn(t.objectStore(STORE));
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    // fecha a conexão ao fim da transação — sem isso cada chamada vaza um
    // handle e bloqueia futuras migrações/limpezas do banco.
    t.oncomplete = () => db.close();
    t.onabort = () => db.close();
  }));
}

export async function enqueue(action: Omit<QueuedAction, 'id'>): Promise<void> {
  await tx('readwrite', (s) => s.add(action));
  notify();
}

export async function queued(): Promise<QueuedAction[]> {
  try { return await tx<QueuedAction[]>('readonly', (s) => s.getAll() as IDBRequest<QueuedAction[]>); }
  catch { return []; }
}

async function remove(id: number): Promise<void> {
  await tx('readwrite', (s) => s.delete(id));
}

// Esvazia a fila — chamado no logout para não vazar ações de campo de um
// usuário para a conta seguinte no mesmo dispositivo (campo compartilhado).
export async function clearQueue(): Promise<void> {
  try { await tx('readwrite', (s) => s.clear() as unknown as IDBRequest<undefined>); }
  catch { /* fila já inacessível: nada a limpar */ }
  notify();
}

// Erro de rede (offline/servidor inalcançável) não é ApiError — o fetch rejeita.
function isNetworkError(e: unknown): boolean {
  return !(e instanceof ApiError);
}

// POST de ação de campo com fallback offline. Se já está offline, enfileira
// direto; se o POST falha por rede, enfileira. Erros de negócio (4xx) sobem.
export async function postField(path: string, body: unknown, label: string): Promise<{ queued: boolean }> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    await enqueue({ path, body, label, createdAt: Date.now() });
    return { queued: true };
  }
  try {
    await api.post(path, body);
    return { queued: false };
  } catch (e) {
    if (isNetworkError(e)) {
      await enqueue({ path, body, label, createdAt: Date.now() });
      return { queued: true };
    }
    throw e;
  }
}

let flushing = false;
// Reenvia a fila em ordem. Ação que dá erro de negócio (4xx) é descartada
// (não adianta reenviar); erro de rede para o flush e tenta de novo depois.
export async function flushQueue(): Promise<void> {
  if (flushing) return;
  flushing = true;
  try {
    const items = (await queued()).sort((a, b) => a.createdAt - b.createdAt);
    for (const item of items) {
      try {
        await api.post(item.path, item.body);
        if (item.id != null) await remove(item.id);
      } catch (e) {
        if (isNetworkError(e)) break;          // ainda offline — para e tenta depois
        if (item.id != null) await remove(item.id); // 4xx: descarta, não reenvia
      }
    }
  } finally {
    flushing = false;
    notify();
  }
}

// Pequeno pub-sub p/ a UI mostrar o badge de pendências.
type Listener = () => void;
const listeners = new Set<Listener>();
export function onQueueChange(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function notify(): void { for (const l of listeners) l(); }

// Liga o flush automático ao voltar a conexão. Chamado uma vez no boot.
export function initOfflineSync(): void {
  if (typeof window === 'undefined') return;
  window.addEventListener('online', () => { void flushQueue(); });
  if (navigator.onLine) void flushQueue();
}
