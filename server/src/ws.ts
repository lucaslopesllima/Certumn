// Registro de conexões WebSocket por org + broadcast. O webhook do WhatsApp e o
// envio pela UI empurram eventos para todas as abas abertas daquela org (espelho
// ao vivo). Sem estado em DB — conexões vivem só na memória do processo.
import type { WebSocket } from 'ws';

const byOrg = new Map<number, Set<WebSocket>>();

export function addConn(orgId: number, socket: WebSocket): void {
  let set = byOrg.get(orgId);
  if (!set) { set = new Set(); byOrg.set(orgId, set); }
  set.add(socket);
}

export function removeConn(orgId: number, socket: WebSocket): void {
  const set = byOrg.get(orgId);
  if (!set) return;
  set.delete(socket);
  if (set.size === 0) byOrg.delete(orgId);
}

// Empurra um evento JSON {event, data} para as conexões da org. Socket morto é
// ignorado (será removido no 'close'). Nunca lança — broadcast é best-effort.
export function broadcast(orgId: number, event: string, data: unknown): void {
  const set = byOrg.get(orgId);
  if (!set || set.size === 0) return;
  const msg = JSON.stringify({ event, data });
  for (const sock of set) {
    try { if (sock.readyState === 1) sock.send(msg); } catch { /* ignora socket quebrado */ }
  }
}
