import type { FastifyInstance } from 'fastify';
import { one, query, withClient } from '../db.ts';
import { requireAuth, requirePermission } from '../auth.ts';
import { scopeOwner, canWriteOwned } from '../scope.ts';
import { audit, pick } from '../audit.ts';

// Agendamento de envio de e-mail (scaffold). Duas entidades:
//  - email_templates: modelos reutilizáveis da org (todos leem; dono/admin edita).
//  - email_schedules: e-mails agendados, escopo por dono (rep vê os próprios).
// O envio é stub (server/src/email.ts); aqui é só CRUD + validação.

const TPL_COLS = 'id, nome, assunto, corpo, owner_user_id, created_at, updated_at';
const SCHED_STATUS = ['pendente', 'enviado', 'cancelado', 'erro'] as const;
const RECORRENCIA = ['nenhuma', 'diaria', 'semanal', 'mensal'] as const;
// Valida formato de e-mail e barra CR/LF (header injection) — `pattern` é
// sempre aplicado pelo ajv, ao contrário de `format:'email'` que exige plugin.
const EMAIL_PATTERN = '^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$';
// remetente pode vir vazio (cai no e-mail do usuário logado) ou um e-mail válido.
const EMAIL_OR_EMPTY_PATTERN = '^([^@\\s]+@[^@\\s]+\\.[^@\\s]+)?$';

const SCHED_SELECT = `
  SELECT e.id, e.template_id, e.company_id, e.remetente, e.destinatario, e.assunto, e.corpo,
         e.agendado_para, e.recorrencia, e.status, e.enviado_em, e.erro, e.owner_user_id,
         e.created_at, e.updated_at,
         COALESCE(c.nome_fantasia, c.razao_social) AS empresa
    FROM email_schedules e
    LEFT JOIN companies c ON c.id = e.company_id`;

// 'nenhuma'/vazio vira null no banco; demais valores válidos passam.
const normRec = (v: unknown): string | null =>
  typeof v === 'string' && v !== 'nenhuma' && (RECORRENCIA as readonly string[]).includes(v) ? v : null;

const fullSched = (id: number, orgId: number): Promise<Record<string, unknown> | null> =>
  one(`${SCHED_SELECT} WHERE e.id = $1 AND e.org_id = $2`, [id, orgId]);

export function emailScheduleRoutes(app: FastifyInstance): void {
  /* ── Templates ─────────────────────────────────────────── */

  // Modelos são compartilhados na org: todos leem (planejar envio usa o catálogo
  // inteiro). owner_user_id registra o autor para o RBAC de escrita.
  app.get('/api/email-templates', { preHandler: [requireAuth, requirePermission('email_templates.list')] }, async (req) => {
    const orgId = req.auth!.orgId;
    const rows = await query(
      `SELECT ${TPL_COLS} FROM email_templates WHERE org_id = $1 ORDER BY nome`, [orgId],
    );
    return { templates: rows };
  });

  app.post('/api/email-templates', {
    preHandler: [requireAuth, requirePermission('email_templates.create')],
    schema: {
      body: {
        type: 'object',
        required: ['nome', 'assunto', 'corpo'],
        properties: {
          nome: { type: 'string', minLength: 1 },
          assunto: { type: 'string', minLength: 1 },
          corpo: { type: 'string', minLength: 1 },
        },
      },
    },
  }, async (req, reply) => {
    const orgId = req.auth!.orgId;
    const b = req.body as { nome: string; assunto: string; corpo: string };
    const row = await one<{ id: number }>(
      `INSERT INTO email_templates (org_id, nome, assunto, corpo, owner_user_id)
       VALUES ($1, $2, $3, $4, $5) RETURNING ${TPL_COLS}`,
      [orgId, b.nome, b.assunto, b.corpo, req.auth!.userId],
    );
    await audit(req, 'email_template', row!.id, 'create', pick(b, ['nome', 'assunto', 'corpo']));
    return reply.code(201).send({ template: row });
  });

  app.patch('/api/email-templates/:id', {
    preHandler: [requireAuth, requirePermission('email_templates.update')],
    schema: {
      params: { type: 'object', required: ['id'], properties: { id: { type: 'integer' } } },
      body: {
        type: 'object',
        properties: {
          nome: { type: 'string', minLength: 1 },
          assunto: { type: 'string', minLength: 1 },
          corpo: { type: 'string', minLength: 1 },
        },
      },
    },
  }, async (req, reply) => {
    const orgId = req.auth!.orgId;
    const { id } = req.params as { id: number };
    const b = req.body as Record<string, unknown>;
    const current = await one<{ owner_user_id: string | null }>(
      'SELECT owner_user_id FROM email_templates WHERE id = $1 AND org_id = $2', [id, orgId],
    );
    if (!current) return reply.code(404).send({ error: 'não encontrado' });
    if (!canWriteOwned(req, current.owner_user_id === null ? null : Number(current.owner_user_id), { nullWritable: true })) {
      return reply.code(403).send({ error: 'modelo de outro vendedor' });
    }
    const sets: string[] = [];
    const params: unknown[] = [];
    for (const k of ['nome', 'assunto', 'corpo'] as const) {
      if (k in b) { params.push(b[k]); sets.push(`${k} = $${params.length}`); }
    }
    if (sets.length === 0) return reply.code(400).send({ error: 'nada para atualizar' });
    params.push(id, orgId);
    const row = await one(
      `UPDATE email_templates SET ${sets.join(', ')}, updated_at = now()
        WHERE id = $${params.length - 1} AND org_id = $${params.length} RETURNING ${TPL_COLS}`,
      params,
    );
    await audit(req, 'email_template', id, 'update', b);
    return { template: row };
  });

  app.delete('/api/email-templates/:id', {
    preHandler: [requireAuth, requirePermission('email_templates.delete')],
    schema: { params: { type: 'object', required: ['id'], properties: { id: { type: 'integer' } } } },
  }, async (req, reply) => {
    const orgId = req.auth!.orgId;
    const { id } = req.params as { id: number };
    const current = await one<{ owner_user_id: string | null }>(
      'SELECT owner_user_id FROM email_templates WHERE id = $1 AND org_id = $2', [id, orgId],
    );
    if (!current) return reply.code(404).send({ error: 'não encontrado' });
    if (!canWriteOwned(req, current.owner_user_id === null ? null : Number(current.owner_user_id), { nullWritable: true })) {
      return reply.code(403).send({ error: 'modelo de outro vendedor' });
    }
    await query('DELETE FROM email_templates WHERE id = $1 AND org_id = $2', [id, orgId]);
    await audit(req, 'email_template', id, 'delete');
    return { deleted: true };
  });

  /* ── Agendamentos ──────────────────────────────────────── */

  app.get('/api/email-schedules', {
    preHandler: [requireAuth, requirePermission('email_schedules.list')],
    schema: {
      querystring: {
        type: 'object',
        properties: {
          status: { type: 'string', enum: [...SCHED_STATUS] },
          owner_user_id: { type: 'integer' },
        },
      },
    },
  }, async (req) => {
    const orgId = req.auth!.orgId;
    const q = req.query as { status?: string; owner_user_id?: number };
    const where: string[] = ['e.org_id = $1'];
    const params: unknown[] = [orgId];
    scopeOwner(req, where, params, 'e.owner_user_id', q.owner_user_id, { nullVisible: true });
    if (q.status) { params.push(q.status); where.push(`e.status = $${params.length}::email_schedule_status`); }
    const rows = await query(
      `${SCHED_SELECT} WHERE ${where.join(' AND ')} ORDER BY e.agendado_para DESC`, params,
    );
    return { schedules: rows };
  });

  app.post('/api/email-schedules', {
    preHandler: [requireAuth, requirePermission('email_schedules.create')],
    schema: {
      body: {
        type: 'object',
        required: ['destinatario', 'assunto', 'corpo', 'agendado_para'],
        properties: {
          template_id: { type: ['integer', 'null'] },
          company_id: { type: ['integer', 'null'] },
          remetente: { type: ['string', 'null'], pattern: EMAIL_OR_EMPTY_PATTERN },
          destinatario: { type: 'string', pattern: EMAIL_PATTERN },
          assunto: { type: 'string', minLength: 1 },
          corpo: { type: 'string', minLength: 1 },
          agendado_para: { type: 'string', minLength: 1 },
          recorrencia: { type: ['string', 'null'], enum: [...RECORRENCIA, null] },
        },
      },
    },
  }, async (req, reply) => {
    const orgId = req.auth!.orgId;
    const b = req.body as {
      template_id?: number | null; company_id?: number | null; remetente?: string | null;
      destinatario: string; assunto: string; corpo: string; agendado_para: string; recorrencia?: string | null;
    };
    // template é org-scoped; valida se veio. company_id aponta p/ base global
    // (sem org), então só confere existência.
    if (b.template_id != null) {
      const tpl = await one('SELECT id FROM email_templates WHERE id = $1 AND org_id = $2', [b.template_id, orgId]);
      if (!tpl) return reply.code(400).send({ error: 'template_id inválido' });
    }
    if (b.company_id != null) {
      const comp = await one('SELECT id FROM companies WHERE id = $1', [b.company_id]);
      if (!comp) return reply.code(400).send({ error: 'company_id inválido' });
    }
    // remetente: o que veio do front (editável) ou, vazio, o e-mail do usuário logado.
    let remetente = b.remetente?.trim() ?? '';
    if (!remetente) {
      const u = await one<{ email: string }>('SELECT email FROM users WHERE id = $1', [req.auth!.userId]);
      remetente = u?.email ?? '';
    }
    // Espelha na Agenda: compromisso 'email' + agendamento, numa transação só.
    const dest = b.destinatario.trim();
    const titulo = `E-mail p/ ${dest}: ${b.assunto.length > 60 ? `${b.assunto.slice(0, 60)}…` : b.assunto}`;
    const row = await withClient(async (c) => {
      await c.query('BEGIN');
      try {
        const act = (await c.query(
          `INSERT INTO activities (org_id, tipo, titulo, start_at, owner_user_id, company_id, status)
           VALUES ($1, 'email', $2, $3, $4, $5, 'pendente') RETURNING id`,
          [orgId, titulo, b.agendado_para, req.auth!.userId, b.company_id ?? null],
        )).rows[0] as { id: number };
        const s = (await c.query(
          `INSERT INTO email_schedules
             (org_id, template_id, company_id, remetente, destinatario, assunto, corpo, agendado_para, recorrencia, owner_user_id, activity_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
          [orgId, b.template_id ?? null, b.company_id ?? null, remetente, dest,
            b.assunto, b.corpo, b.agendado_para, normRec(b.recorrencia), req.auth!.userId, act.id],
        )).rows[0] as { id: number };
        await c.query('COMMIT');
        return s;
      } catch (e) { await c.query('ROLLBACK'); throw e; }
    });
    await audit(req, 'email_schedule', row.id, 'create',
      { company_id: b.company_id ?? null, agendado_para: b.agendado_para });
    return reply.code(201).send({ schedule: await fullSched(row.id, orgId) });
  });

  app.patch('/api/email-schedules/:id', {
    preHandler: [requireAuth, requirePermission('email_schedules.update')],
    schema: {
      params: { type: 'object', required: ['id'], properties: { id: { type: 'integer' } } },
      body: {
        type: 'object',
        properties: {
          remetente: { type: 'string', pattern: EMAIL_OR_EMPTY_PATTERN },
          destinatario: { type: 'string', pattern: EMAIL_PATTERN },
          assunto: { type: 'string', minLength: 1 },
          corpo: { type: 'string', minLength: 1 },
          agendado_para: { type: 'string', minLength: 1 },
          recorrencia: { type: ['string', 'null'], enum: [...RECORRENCIA, null] },
          status: { type: 'string', enum: ['pendente', 'cancelado'] },
        },
      },
    },
  }, async (req, reply) => {
    const orgId = req.auth!.orgId;
    const { id } = req.params as { id: number };
    const b = req.body as Record<string, unknown>;
    const current = await one<{ owner_user_id: string | null; status: string; activity_id: string | null }>(
      'SELECT owner_user_id, status, activity_id FROM email_schedules WHERE id = $1 AND org_id = $2', [id, orgId],
    );
    if (!current) return reply.code(404).send({ error: 'não encontrado' });
    if (!canWriteOwned(req, current.owner_user_id === null ? null : Number(current.owner_user_id), { nullWritable: true })) {
      return reply.code(403).send({ error: 'agendamento de outro vendedor' });
    }
    // e-mail já processado não volta a ser editável (enviado/erro).
    if (current.status !== 'pendente' && current.status !== 'cancelado') {
      return reply.code(409).send({ error: 'agendamento já processado' });
    }
    const sets: string[] = [];
    const params: unknown[] = [];
    for (const k of ['remetente', 'destinatario', 'assunto', 'corpo', 'agendado_para'] as const) {
      if (k in b) { params.push(k === 'remetente' || k === 'destinatario' ? String(b[k]).trim() : b[k]); sets.push(`${k} = $${params.length}`); }
    }
    if ('recorrencia' in b) { params.push(normRec(b.recorrencia)); sets.push(`recorrencia = $${params.length}`); }
    if ('status' in b) { params.push(b.status); sets.push(`status = $${params.length}::email_schedule_status`); }
    if (sets.length === 0) return reply.code(400).send({ error: 'nada para atualizar' });
    params.push(id, orgId);
    await query(
      `UPDATE email_schedules SET ${sets.join(', ')}, updated_at = now()
        WHERE id = $${params.length - 1} AND org_id = $${params.length}`,
      params,
    );
    // Mantém o compromisso espelho da Agenda em sincronia: cancelar remove-o; mudar
    // a data/assunto/destinatário atualiza o horário e o título.
    if (current.activity_id != null) {
      if (b.status === 'cancelado') {
        await query('DELETE FROM activities WHERE id = $1 AND org_id = $2', [current.activity_id, orgId]);
      } else if ('agendado_para' in b || 'assunto' in b || 'destinatario' in b) {
        const s = await one<{ destinatario: string; assunto: string; agendado_para: string }>(
          'SELECT destinatario, assunto, agendado_para FROM email_schedules WHERE id = $1 AND org_id = $2', [id, orgId]);
        if (s) {
          const titulo = `E-mail p/ ${s.destinatario}: ${s.assunto.length > 60 ? `${s.assunto.slice(0, 60)}…` : s.assunto}`;
          await query('UPDATE activities SET titulo = $1, start_at = $2 WHERE id = $3 AND org_id = $4',
            [titulo, s.agendado_para, current.activity_id, orgId]);
        }
      }
    }
    await audit(req, 'email_schedule', id, 'update', b);
    return { schedule: await fullSched(id, orgId) };
  });

  app.delete('/api/email-schedules/:id', {
    preHandler: [requireAuth, requirePermission('email_schedules.delete')],
    schema: { params: { type: 'object', required: ['id'], properties: { id: { type: 'integer' } } } },
  }, async (req, reply) => {
    const orgId = req.auth!.orgId;
    const { id } = req.params as { id: number };
    const current = await one<{ owner_user_id: string | null; activity_id: string | null }>(
      'SELECT owner_user_id, activity_id FROM email_schedules WHERE id = $1 AND org_id = $2', [id, orgId],
    );
    if (!current) return reply.code(404).send({ error: 'não encontrado' });
    if (!canWriteOwned(req, current.owner_user_id === null ? null : Number(current.owner_user_id), { nullWritable: true })) {
      return reply.code(403).send({ error: 'agendamento de outro vendedor' });
    }
    await query('DELETE FROM email_schedules WHERE id = $1 AND org_id = $2', [id, orgId]);
    // Remove o compromisso espelho da Agenda junto.
    if (current.activity_id != null) {
      await query('DELETE FROM activities WHERE id = $1 AND org_id = $2', [current.activity_id, orgId]);
    }
    await audit(req, 'email_schedule', id, 'delete');
    return { deleted: true };
  });
}
