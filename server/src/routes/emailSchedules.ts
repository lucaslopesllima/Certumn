import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import type { FastifyInstance } from 'fastify';
import { one, query, withClient } from '../db.ts';
import { requireAuth, requirePermission } from '../auth.ts';
import { scopeOwner, canWriteOwned } from '../scope.ts';
import { audit, pick } from '../audit.ts';
import { addInterval } from '../email.ts';

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
         e.agendado_para, e.recorrencia, e.serie_id, e.status, e.enviado_em, e.erro, e.owner_user_id,
         e.created_at, e.updated_at,
         COALESCE(c.nome_fantasia, c.razao_social) AS empresa
    FROM email_schedules e
    LEFT JOIN companies c ON c.id = e.company_id`;

// 'nenhuma'/vazio vira null no banco; demais valores válidos passam.
const normRec = (v: unknown): string | null =>
  typeof v === 'string' && v !== 'nenhuma' && (RECORRENCIA as readonly string[]).includes(v) ? v : null;

const fullSched = (id: number, orgId: number): Promise<Record<string, unknown> | null> =>
  one(`${SCHED_SELECT} WHERE e.id = $1 AND e.org_id = $2`, [id, orgId]);

const EMAIL_TITULO = (dest: string, assunto: string): string =>
  `E-mail p/ ${dest}: ${assunto.length > 60 ? `${assunto.slice(0, 60)}…` : assunto}`;

// Cadência inferida pelo intervalo entre duas ocorrências (as linhas
// materializadas guardam recorrencia=null). E-mail não tem 'anual'.
function inferRecEmail(d0: Date, d1: Date): string | null {
  const dias = Math.round((d1.getTime() - d0.getTime()) / 86_400_000);
  if (dias <= 1) return 'diaria';
  if (dias <= 10) return 'semanal';
  return 'mensal';
}

interface EmailSeriesOpts {
  orgId: number; templateId: number | null; companyId: number | null; remetente: string;
  destinatario: string; assunto: string; corpo: string; agendadoPara: string;
  recorrencia: string | null; quantidade?: number; ownerUserId: number; serieId?: string | null;
}

// Materializa a série de e-mail num client de transação já aberto. quantidade > 1
// cria N compromissos + N agendamentos com datas espaçadas pela recorrência,
// compartilhando serie_id; cada linha fica sem recorrência (série finita, o
// processador não gera a próxima). Devolve o id da 1ª linha.
async function insertEmailSeries(c: PoolClient, o: EmailSeriesOpts): Promise<number> {
  const rec = o.recorrencia;
  const n = rec ? Math.max(1, Math.min(60, Math.trunc(o.quantidade ?? 1))) : 1;
  const rowRec = n > 1 ? null : rec;
  const serieId = n > 1 ? (o.serieId ?? randomUUID()) : (o.serieId ?? null);
  const titulo = EMAIL_TITULO(o.destinatario, o.assunto);
  let first = 0;
  let quando: string | null = o.agendadoPara;
  for (let i = 0; i < n && quando; i++) {
    const act = (await c.query(
      `INSERT INTO activities (org_id, tipo, titulo, start_at, owner_user_id, company_id, status)
       VALUES ($1, 'email', $2, $3, $4, $5, 'pendente') RETURNING id`,
      [o.orgId, titulo, quando, o.ownerUserId, o.companyId],
    )).rows[0] as { id: number };
    const s = (await c.query(
      `INSERT INTO email_schedules
         (org_id, template_id, company_id, remetente, destinatario, assunto, corpo, agendado_para, recorrencia, owner_user_id, activity_id, serie_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING id`,
      [o.orgId, o.templateId, o.companyId, o.remetente, o.destinatario, o.assunto, o.corpo, quando, rowRec, o.ownerUserId, act.id, serieId],
    )).rows[0] as { id: number };
    if (i === 0) first = s.id;
    if (rec) quando = addInterval(quando, rec);
  }
  return first;
}

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
          quantidade: { type: 'integer', minimum: 1, maximum: 60 },
        },
      },
    },
  }, async (req, reply) => {
    const orgId = req.auth!.orgId;
    const b = req.body as {
      template_id?: number | null; company_id?: number | null; remetente?: string | null;
      destinatario: string; assunto: string; corpo: string; agendado_para: string; recorrencia?: string | null; quantidade?: number;
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
    // Espelha na Agenda: compromisso 'email' + agendamento. Recorrência com
    // quantidade > 1 materializa a série inteira (N linhas + N compromissos,
    // mesmo serie_id), tudo numa transação só.
    const dest = b.destinatario.trim();
    const firstId = await withClient(async (c) => {
      await c.query('BEGIN');
      try {
        const fid = await insertEmailSeries(c, {
          orgId, templateId: b.template_id ?? null, companyId: b.company_id ?? null, remetente,
          destinatario: dest, assunto: b.assunto, corpo: b.corpo, agendadoPara: b.agendado_para,
          recorrencia: normRec(b.recorrencia), quantidade: b.quantidade, ownerUserId: req.auth!.userId,
        });
        await c.query('COMMIT');
        return fid;
      } catch (e) { await c.query('ROLLBACK'); throw e; }
    });
    await audit(req, 'email_schedule', firstId, 'create',
      { company_id: b.company_id ?? null, agendado_para: b.agendado_para });
    return reply.code(201).send({ schedule: await fullSched(firstId, orgId) });
  });

  app.patch('/api/email-schedules/:id', {
    preHandler: [requireAuth, requirePermission('email_schedules.update')],
    schema: {
      params: { type: 'object', required: ['id'], properties: { id: { type: 'integer' } } },
      body: {
        type: 'object',
        properties: {
          scope: { type: 'string', enum: ['one', 'serie'] },
          remetente: { type: 'string', pattern: EMAIL_OR_EMPTY_PATTERN },
          destinatario: { type: 'string', pattern: EMAIL_PATTERN },
          assunto: { type: 'string', minLength: 1 },
          corpo: { type: 'string', minLength: 1 },
          agendado_para: { type: 'string', minLength: 1 },
          recorrencia: { type: ['string', 'null'], enum: [...RECORRENCIA, null] },
          quantidade: { type: 'integer', minimum: 2, maximum: 60 },
          status: { type: 'string', enum: ['pendente', 'cancelado'] },
        },
      },
    },
  }, async (req, reply) => {
    const orgId = req.auth!.orgId;
    const { id } = req.params as { id: number };
    const b = req.body as Record<string, unknown>;
    const current = await one<{
      owner_user_id: string | null; status: string; activity_id: string | null; serie_id: string | null;
      template_id: string | null; company_id: string | null; remetente: string | null;
      destinatario: string; assunto: string; corpo: string; agendado_para: string;
    }>(
      `SELECT owner_user_id, status, activity_id, serie_id, template_id, company_id, remetente,
              destinatario, assunto, corpo, agendado_para
         FROM email_schedules WHERE id = $1 AND org_id = $2`, [id, orgId],
    );
    if (!current) return reply.code(404).send({ error: 'não encontrado' });
    if (!canWriteOwned(req, current.owner_user_id === null ? null : Number(current.owner_user_id), { nullWritable: true })) {
      return reply.code(403).send({ error: 'agendamento de outro vendedor' });
    }
    // e-mail já processado não volta a ser editável (enviado/erro).
    if (current.status !== 'pendente' && current.status !== 'cancelado') {
      return reply.code(409).send({ error: 'agendamento já processado' });
    }
    const scope = b.scope === 'serie' && current.serie_id != null ? 'serie' : 'one';

    // Regenera a série quando muda a quantidade, ou quando já é série e muda a
    // frequência: apaga as ocorrências pendentes-alvo + compromissos e recria N a
    // partir da base. Cancelar tem prioridade (não regenera). Frequência isolada
    // num agendamento avulso continua sendo só atualização de campo (compat).
    const cancelling = b.status === 'cancelado';
    const regen = !cancelling && ('quantidade' in b
      || (current.serie_id != null && typeof b.recorrencia === 'string' && normRec(b.recorrencia) != null));
    if (regen) {
      const alvos = scope === 'serie'
        ? await query<{ id: string; activity_id: string | null; agendado_para: string }>(
          `SELECT id, activity_id, agendado_para FROM email_schedules
            WHERE org_id = $1 AND serie_id = $2 AND status = 'pendente' ORDER BY agendado_para`, [orgId, current.serie_id])
        : [{ id: String(id), activity_id: current.activity_id, agendado_para: current.agendado_para }];
      const base = 'agendado_para' in b ? new Date(String(b.agendado_para)) : new Date(alvos[0]!.agendado_para);
      if (Number.isNaN(base.getTime())) return reply.code(400).send({ error: 'data inválida' });
      const rec = typeof b.recorrencia === 'string' ? normRec(b.recorrencia)
        : alvos.length >= 2 ? inferRecEmail(new Date(alvos[0]!.agendado_para), new Date(alvos[1]!.agendado_para)) : null;
      if (!rec) return reply.code(400).send({ error: 'informe a frequência (recorrencia) para regenerar' });
      const qtd = 'quantidade' in b ? Number(b.quantidade) : Math.max(2, alvos.length);
      const firstId = await withClient(async (c) => {
        await c.query('BEGIN');
        try {
          const actIds = alvos.map((a) => a.activity_id).filter((x): x is string => x != null);
          await c.query('DELETE FROM email_schedules WHERE org_id = $1 AND id = ANY($2::bigint[])', [orgId, alvos.map((a) => a.id)]);
          if (actIds.length) await c.query('DELETE FROM activities WHERE org_id = $1 AND id = ANY($2::bigint[])', [orgId, actIds]);
          const fid = await insertEmailSeries(c, {
            orgId, templateId: current.template_id == null ? null : Number(current.template_id),
            companyId: current.company_id == null ? null : Number(current.company_id),
            remetente: 'remetente' in b ? String(b.remetente).trim() : (current.remetente ?? ''),
            destinatario: 'destinatario' in b ? String(b.destinatario).trim() : current.destinatario,
            assunto: 'assunto' in b ? String(b.assunto) : current.assunto,
            corpo: 'corpo' in b ? String(b.corpo) : current.corpo,
            agendadoPara: base.toISOString(), recorrencia: rec, quantidade: qtd,
            ownerUserId: Number(current.owner_user_id), serieId: current.serie_id ?? undefined,
          });
          await c.query('COMMIT');
          return fid;
        } catch (e) { await c.query('ROLLBACK'); throw e; }
      });
      await audit(req, 'email_schedule', firstId, 'update', b);
      return { schedule: await fullSched(firstId, orgId) };
    }

    // Alvos da edição simples: série pendente ou só esta ocorrência.
    const alvos = scope === 'serie'
      ? await query<{ id: string; activity_id: string | null }>(
        `SELECT id, activity_id FROM email_schedules WHERE org_id = $1 AND serie_id = $2 AND status = 'pendente'`, [orgId, current.serie_id])
      : [{ id: String(id), activity_id: current.activity_id }];

    const sets: string[] = [];
    const vals: unknown[] = [];
    // agendado_para só numa ocorrência (cada uma tem a sua data).
    const camposConteudo = ['remetente', 'destinatario', 'assunto', 'corpo'] as const;
    for (const k of camposConteudo) {
      if (k in b) { vals.push(k === 'remetente' || k === 'destinatario' ? String(b[k]).trim() : b[k]); sets.push(`${k} = $${vals.length}`); }
    }
    if ('agendado_para' in b && scope === 'one') { vals.push(b.agendado_para); sets.push(`agendado_para = $${vals.length}`); }
    if ('recorrencia' in b) { vals.push(normRec(b.recorrencia)); sets.push(`recorrencia = $${vals.length}`); }
    if ('status' in b) { vals.push(b.status); sets.push(`status = $${vals.length}::email_schedule_status`); }
    if (sets.length === 0) return reply.code(400).send({ error: 'nada para atualizar' });

    await withClient(async (c) => {
      await c.query('BEGIN');
      try {
        for (const a of alvos) {
          const p = [...vals, a.id, orgId];
          await c.query(`UPDATE email_schedules SET ${sets.join(', ')}, updated_at = now()
                          WHERE id = $${p.length - 1} AND org_id = $${p.length}`, p);
          // Sincroniza o compromisso espelho: cancelar remove; senão atualiza título/data.
          if (a.activity_id != null) {
            if (b.status === 'cancelado') {
              await c.query('DELETE FROM activities WHERE id = $1 AND org_id = $2', [a.activity_id, orgId]);
            } else {
              const s = (await c.query(
                'SELECT destinatario, assunto, agendado_para FROM email_schedules WHERE id = $1 AND org_id = $2', [a.id, orgId]
              )).rows[0] as { destinatario: string; assunto: string; agendado_para: string } | undefined;
              if (s) {
                await c.query('UPDATE activities SET titulo = $1, start_at = $2 WHERE id = $3 AND org_id = $4',
                  [EMAIL_TITULO(s.destinatario, s.assunto), s.agendado_para, a.activity_id, orgId]);
              }
            }
          }
        }
        await c.query('COMMIT');
      } catch (e) { await c.query('ROLLBACK'); throw e; }
    });
    await audit(req, 'email_schedule', id, 'update', b);
    return { schedule: await fullSched(id, orgId) };
  });

  app.delete('/api/email-schedules/:id', {
    preHandler: [requireAuth, requirePermission('email_schedules.delete')],
    schema: {
      params: { type: 'object', required: ['id'], properties: { id: { type: 'integer' } } },
      querystring: { type: 'object', properties: { scope: { type: 'string', enum: ['one', 'serie'] } } },
    },
  }, async (req, reply) => {
    const orgId = req.auth!.orgId;
    const { id } = req.params as { id: number };
    const scope = (req.query as { scope?: string }).scope ?? 'one';
    const current = await one<{ owner_user_id: string | null; activity_id: string | null; serie_id: string | null }>(
      'SELECT owner_user_id, activity_id, serie_id FROM email_schedules WHERE id = $1 AND org_id = $2', [id, orgId],
    );
    if (!current) return reply.code(404).send({ error: 'não encontrado' });
    if (!canWriteOwned(req, current.owner_user_id === null ? null : Number(current.owner_user_id), { nullWritable: true })) {
      return reply.code(403).send({ error: 'agendamento de outro vendedor' });
    }
    // scope='serie' remove a série inteira (todas as ocorrências, não só as pendentes).
    const serieMode = scope === 'serie' && current.serie_id != null;
    const alvos = serieMode
      ? await query<{ id: string; activity_id: string | null }>(
        'SELECT id, activity_id FROM email_schedules WHERE org_id = $1 AND serie_id = $2', [orgId, current.serie_id])
      : [{ id: String(id), activity_id: current.activity_id }];
    const actIds = alvos.map((a) => a.activity_id).filter((x): x is string => x != null);
    await query('DELETE FROM email_schedules WHERE org_id = $1 AND id = ANY($2::bigint[])', [orgId, alvos.map((a) => a.id)]);
    if (actIds.length) await query('DELETE FROM activities WHERE org_id = $1 AND id = ANY($2::bigint[])', [orgId, actIds]);
    await audit(req, 'email_schedule', id, 'delete');
    return { deleted: true };
  });
}
