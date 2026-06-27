import type { FastifyInstance } from 'fastify';
import { query } from '../db.ts';
import { requireAuth, requireAdmin } from '../auth.ts';

// Consulta da trilha de auditoria (org-scoped, admin-only, read-only). Expõe
// ações de todos os usuários da org (criação de user, troca de role, reset de
// senha, SMTP) — não é informação para um rep. A escrita acontece nos handlers
// de mutação via src/audit.ts.
export function auditRoutes(app: FastifyInstance): void {
  app.get('/api/audit', {
    preHandler: [requireAuth, requireAdmin],
    schema: {
      querystring: {
        type: 'object',
        properties: {
          entity: { type: 'string' },
          entity_id: { type: 'integer' },
          limit: { type: 'integer', minimum: 1, maximum: 200, default: 50 },
          offset: { type: 'integer', minimum: 0, default: 0 },
        },
      },
    },
  }, async (req) => {
    const orgId = req.auth!.orgId;
    const { entity, entity_id, limit = 50, offset = 0 } = req.query as {
      entity?: string; entity_id?: number; limit?: number; offset?: number;
    };
    const where: string[] = ['a.org_id = $1'];
    const params: unknown[] = [orgId];
    if (entity) { params.push(entity); where.push(`a.entity = $${params.length}`); }
    if (entity_id !== undefined) { params.push(entity_id); where.push(`a.entity_id = $${params.length}`); }
    params.push(limit); const limIdx = params.length;
    params.push(offset); const offIdx = params.length;

    const entries = await query(
      `SELECT a.id, a.entity, a.entity_id, a.action, a.diff, a.created_at,
              u.nome AS user_nome, u.email AS user_email
       FROM audit_log a
       LEFT JOIN users u ON u.id = a.user_id
       WHERE ${where.join(' AND ')}
       ORDER BY a.created_at DESC, a.id DESC
       LIMIT $${limIdx} OFFSET $${offIdx}`,
      params,
    );
    return { entries };
  });
}
