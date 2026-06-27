import type { FastifyInstance } from 'fastify';
import { query } from '../db.ts';
import { requireAuth } from '../auth.ts';

// Notificações in-app (Fase 6.2). Materializadas no fetch — sem websocket. O GET
// recalcula os avisos do usuário logado a partir do estado atual, faz upsert na
// tabela (preservando `lida`) e poda os que já não se aplicam. A `chave`
// determinística (tipo:entidade) garante idempotência e estado de leitura estável.
//
// Pessoal por usuário: cada um vê os avisos dos próprios registros
// (owner_user_id = userId), independente do papel.

interface Alert { tipo: string; chave: string; titulo: string; payload: Record<string, unknown> }

async function computeAlerts(orgId: number, userId: number): Promise<Alert[]> {
  const alerts: Alert[] = [];

  // 1) Contas a vencer em ≤ 1 dia (D-1) ainda pendentes.
  const venc = await query<{ id: string; descricao: string; valor: string; vencimento: string; kind: string }>(
    `SELECT id, descricao, valor, vencimento::text AS vencimento, kind::text AS kind
     FROM finance_entries
     WHERE org_id = $1 AND owner_user_id = $2 AND status = 'pendente'
       AND vencimento >= current_date AND vencimento <= current_date + 1`,
    [orgId, userId],
  );
  for (const v of venc) {
    const verbo = v.kind === 'receber' ? 'a receber' : 'a pagar';
    alerts.push({
      tipo: 'vencimento', chave: `vencimento:${v.id}`,
      titulo: `Conta ${verbo} vence ${v.vencimento}: ${v.descricao}`,
      payload: { finance_id: Number(v.id), valor: Number(v.valor), vencimento: v.vencimento },
    });
  }

  // 2) Compromissos começando na próxima hora.
  const ag = await query<{ id: string; titulo: string; start_at: string; company_id: string | null }>(
    `SELECT id, titulo, start_at::text AS start_at, company_id
     FROM activities
     WHERE org_id = $1 AND owner_user_id = $2 AND status = 'pendente'
       AND start_at >= now() AND start_at <= now() + interval '1 hour'`,
    [orgId, userId],
  );
  for (const a of ag) {
    alerts.push({
      tipo: 'agenda', chave: `agenda:${a.id}`,
      titulo: `Compromisso em breve: ${a.titulo}`,
      payload: { activity_id: Number(a.id), start_at: a.start_at, company_id: a.company_id ? Number(a.company_id) : null },
    });
  }

  // 3) Comissões divergentes (recebido ≠ previsto).
  const com = await query<{ id: string; valor_previsto: string; valor_recebido: string | null; competencia: string }>(
    `SELECT id, valor_previsto, valor_recebido, competencia::text AS competencia
     FROM commission_entries
     WHERE org_id = $1 AND user_id = $2 AND status = 'divergente'`,
    [orgId, userId],
  );
  for (const c of com) {
    alerts.push({
      tipo: 'comissao', chave: `comissao:${c.id}`,
      titulo: `Comissão divergente (${c.competencia}): previsto ${Number(c.valor_previsto)}, recebido ${Number(c.valor_recebido ?? 0)}`,
      payload: { commission_id: Number(c.id), competencia: c.competencia },
    });
  }

  // 4) Negócios parados no mesmo stage há 30+ dias (limite p/ não inundar).
  const par = await query<{ id: string; razao_social: string; dias: number }>(
    `SELECT r.id, c.razao_social, (current_date - r.stage_changed_at::date)::int AS dias
     FROM company_relationships r
     JOIN companies c ON c.id = r.company_id
     WHERE r.org_id = $1 AND r.owner_user_id = $2 AND r.status = 'prospect'
       AND r.stage_changed_at < now() - interval '30 days'
     ORDER BY dias DESC LIMIT 20`,
    [orgId, userId],
  );
  for (const p of par) {
    alerts.push({
      tipo: 'parado', chave: `parado:${p.id}`,
      titulo: `Negócio parado há ${p.dias} dias: ${p.razao_social}`,
      payload: { relationship_id: Number(p.id), dias: p.dias },
    });
  }

  return alerts;
}

export function notificationRoutes(app: FastifyInstance): void {
  app.get('/api/notifications', { preHandler: requireAuth }, async (req) => {
    const orgId = req.auth!.orgId;
    const userId = req.auth!.userId;
    const alerts = await computeAlerts(orgId, userId);

    // upsert preservando `lida`; poda avisos que já não se aplicam.
    for (const a of alerts) {
      await query(
        `INSERT INTO notifications (org_id, user_id, tipo, chave, titulo, payload)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (user_id, chave)
           DO UPDATE SET titulo = EXCLUDED.titulo, payload = EXCLUDED.payload, tipo = EXCLUDED.tipo`,
        [orgId, userId, a.tipo, a.chave, a.titulo, JSON.stringify(a.payload)],
      );
    }
    await query(
      'DELETE FROM notifications WHERE user_id = $1 AND chave <> ALL($2::text[])',
      [userId, alerts.map((a) => a.chave)],
    );

    const items = await query(
      `SELECT id, tipo, chave, titulo, payload, lida, created_at
       FROM notifications WHERE user_id = $1
       ORDER BY lida, created_at DESC`,
      [userId],
    );
    const nao_lidas = items.filter((n) => (n as { lida: boolean }).lida === false).length;
    return { notifications: items, nao_lidas };
  });

  app.patch('/api/notifications/:id/read', {
    preHandler: requireAuth,
    schema: { params: { type: 'object', required: ['id'], properties: { id: { type: 'integer' } } } },
  }, async (req, reply) => {
    const userId = req.auth!.userId;
    const { id } = req.params as { id: number };
    const rows = await query(
      'UPDATE notifications SET lida = true WHERE id = $1 AND user_id = $2 RETURNING id', [id, userId],
    );
    if (rows.length === 0) return reply.code(404).send({ error: 'não encontrado' });
    return { ok: true };
  });

  app.post('/api/notifications/read-all', { preHandler: requireAuth }, async (req) => {
    const userId = req.auth!.userId;
    await query('UPDATE notifications SET lida = true WHERE user_id = $1 AND lida = false', [userId]);
    return { ok: true };
  });
}
