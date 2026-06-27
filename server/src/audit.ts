import type { FastifyRequest } from 'fastify';
import { query } from './db.ts';

// Trilha de auditoria: uma linha por mutação de entidade de negócio.
// Aguardada nos handlers (insert barato), mas falha de auditoria nunca
// derruba a requisição — loga e segue. diff jamais deve conter senhas.
export async function audit(
  req: FastifyRequest,
  entity: string,
  entityId: number | string,
  action: 'create' | 'update' | 'delete' | string,
  diff?: unknown,
): Promise<void> {
  const a = req.auth;
  if (!a) return;
  try {
    await query(
      'INSERT INTO audit_log (org_id, user_id, entity, entity_id, action, diff) VALUES ($1,$2,$3,$4,$5,$6)',
      [a.orgId, a.userId, entity, entityId, action, diff === undefined ? null : JSON.stringify(diff)],
    );
  } catch (e) {
    req.log.error({ err: e, entity, entityId, action }, 'audit insert failed');
  }
}

// Recorta do body apenas as chaves de uma allow-list (o que os handlers já
// usam para montar o UPDATE) — evita vazar campo inesperado para o log.
export function pick(body: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of keys) if (k in body) out[k] = body[k];
  return out;
}
