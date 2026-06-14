// Cobertura do domínio de e-mail/SMTP: cifra de segredos (crypto), transporte
// (smtp), varredura de agendamentos (email.processDueEmails) e as rotas de
// configuração SMTP (settings) + CRUD de templates/agendamentos (emailSchedules).
// nodemailer é mockado — nenhum e-mail real sai; controla-se sucesso/erro do envio.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { makeApp, register, bearer, mail, makeCompany, closeAll, type Session } from './helpers.ts';
import { query, one } from '../src/db.ts';

// sendMail controlável: default resolve; mockRejectedValueOnce p/ simular falha.
const { sendMail } = vi.hoisted(() => ({ sendMail: vi.fn() }));
vi.mock('nodemailer', () => ({ default: { createTransport: () => ({ sendMail }) } }));

// Import depois do mock (smtp.ts importa nodemailer).
const { processDueEmails, addInterval, nextOccurrence } = await import('../src/email.ts');
const { encryptSecret, decryptSecret } = await import('../src/crypto.ts');
const { getSmtpSettings, sendViaSmtp } = await import('../src/smtp.ts');

let app: FastifyInstance;
let a: Session;     // org com SMTP
let rep: Session;   // vendedor da org A

const inj = (s: Session, method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: unknown):
  ReturnType<FastifyInstance['inject']> =>
  app.inject({ method, url, headers: bearer(s.token), payload });

async function makeRep(admin: Session, tag: string): Promise<Session> {
  const email = mail(tag);
  expect((await inj(admin, 'POST', '/api/users', { nome: tag, email, senha: 'provisoria1' })).statusCode).toBe(201);
  const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, senha: 'provisoria1' } });
  return login.json() as Session;
}

// insere um agendamento pendente direto no banco (controle fino de org/data/recorrência).
async function insertSchedule(opts: {
  orgId: number; ownerId: number; agendado: Date; recorrencia?: string | null; remetente?: string;
}): Promise<number> {
  const r = await one<{ id: string }>(
    `INSERT INTO email_schedules
       (org_id, template_id, company_id, remetente, destinatario, assunto, corpo, agendado_para, recorrencia, owner_user_id, status)
     VALUES ($1, NULL, NULL, $2, 'dest@teste.com', 'Assunto', 'Corpo', $3, $4, $5, 'pendente')
     RETURNING id`,
    [opts.orgId, opts.remetente ?? 'rem@teste.com', opts.agendado.toISOString(), opts.recorrencia ?? null, opts.ownerId],
  );
  return Number(r!.id);
}
const statusOf = async (id: number): Promise<{ status: string; erro: string | null }> =>
  (await one<{ status: string; erro: string | null }>('SELECT status, erro FROM email_schedules WHERE id = $1', [id]))!;

beforeAll(async () => {
  app = await makeApp();
  a = await register(app, 'email.a');
  rep = await makeRep(a, 'email.rep');
  sendMail.mockResolvedValue({ messageId: 'x' });
});
afterAll(async () => { await closeAll(app); });

/* ── crypto ──────────────────────────────────────────────── */
describe('crypto: cifra de segredos', () => {
  it('roundtrip encrypt/decrypt preserva o texto', () => {
    const blob = encryptSecret('senha-super-secreta');
    expect(blob).toMatch(/^[0-9a-f]+:[0-9a-f]+:[0-9a-f]+$/);
    expect(decryptSecret(blob)).toBe('senha-super-secreta');
  });
  it('blob malformado lança', () => {
    expect(() => decryptSecret('lixo')).toThrow('blob cifrado inválido');
  });
});

/* ── smtp helpers ────────────────────────────────────────── */
describe('smtp: helpers', () => {
  it('getSmtpSettings retorna null quando a org não configurou', async () => {
    expect(await getSmtpSettings(a.user.org_id)).toBeNull();
  });
  it('sendViaSmtp monta a mensagem (sem auth/sem from_name, usa from_email)', async () => {
    sendMail.mockClear();
    await sendViaSmtp(
      { org_id: '0', host: 'h', port: 25, secure: false, username: null, password_enc: null,
        from_email: 'envelope@org.com', from_name: null, enabled: true },
      { from: '', to: 't@x.com', subject: 'Oi', body: 'Texto' },
    );
    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({
      from: 'envelope@org.com', sender: 'envelope@org.com', to: 't@x.com', subject: 'Oi', text: 'Texto',
    }));
  });
});

/* ── email.ts: helpers de recorrência (guards inalcançáveis via varredura) ── */
describe('email: addInterval / nextOccurrence', () => {
  it('addInterval cobre cada intervalo e o caso sem repetição', () => {
    expect(addInterval('2026-01-01T00:00:00.000Z', 'diaria')).toBe('2026-01-02T00:00:00.000Z');
    expect(addInterval('2026-01-01T00:00:00.000Z', 'semanal')).toBe('2026-01-08T00:00:00.000Z');
    expect(addInterval('2026-01-01T00:00:00.000Z', 'mensal')).toBe('2026-02-01T00:00:00.000Z');
    expect(addInterval('2026-01-01T00:00:00.000Z', 'nenhuma')).toBeNull();
    expect(addInterval('data-invalida', 'diaria')).toBeNull(); // guard NaN
  });
  it('nextOccurrence salta para a primeira ocorrência > now; null sem recorrência', () => {
    const now = new Date('2026-06-10T00:00:00.000Z');
    const next = nextOccurrence('2026-06-01T00:00:00.000Z', 'diaria', now);
    expect(new Date(next!).getTime()).toBeGreaterThan(now.getTime());
    expect(nextOccurrence('2026-06-01T00:00:00.000Z', null, now)).toBeNull();
  });
});

/* ── settings: configuração SMTP da org ──────────────────── */
describe('rotas /api/settings/smtp', () => {
  it('GET retorna null antes de configurar; PUT salva; GET expõe has_password', async () => {
    expect((await inj(a, 'GET', '/api/settings/smtp')).json()).toEqual({ smtp: null });

    const put = await inj(a, 'PUT', '/api/settings/smtp', {
      host: 'smtp.org.com', port: 465, secure: true, username: 'user@org.com',
      password: 'segredo', from_email: 'no-reply@org.com', from_name: 'Prospecta', enabled: true,
    });
    expect(put.statusCode).toBe(200);

    const got = (await inj(a, 'GET', '/api/settings/smtp')).json() as { smtp: { has_password: boolean; enabled: boolean; from_name: string } };
    expect(got.smtp.has_password).toBe(true);
    expect(got.smtp.enabled).toBe(true);
    expect(got.smtp.from_name).toBe('Prospecta');

    // PUT sem password mantém a senha cifrada existente (COALESCE).
    expect((await inj(a, 'PUT', '/api/settings/smtp', { host: 'smtp.org.com', from_email: 'no-reply@org.com', enabled: true })).statusCode).toBe(200);
    expect((await getSmtpSettings(a.user.org_id))!.password_enc).not.toBeNull();
  });

  it('POST /test: 400 sem config, 200 com envio ok, 502 quando o envio falha', async () => {
    // org nova sem SMTP → 400 'configure'
    const fresh = await register(app, 'email.fresh');
    expect((await inj(fresh, 'POST', '/api/settings/smtp/test')).statusCode).toBe(400);

    sendMail.mockResolvedValueOnce({ messageId: 'ok' });
    const ok = await inj(a, 'POST', '/api/settings/smtp/test');
    expect(ok.statusCode).toBe(200);
    expect((ok.json() as { ok: boolean; to: string }).ok).toBe(true);

    sendMail.mockRejectedValueOnce(new Error('conn refused'));
    const fail = await inj(a, 'POST', '/api/settings/smtp/test');
    expect(fail.statusCode).toBe(502);
  });

  it('POST /test: usuário sem e-mail → 400', async () => {
    const noMail = await register(app, 'email.nomail');
    await inj(noMail, 'PUT', '/api/settings/smtp', { host: 'h', from_email: 'x@x.com', enabled: true });
    // email é unique+NOT NULL: libera qualquer '' deixado por uma rodada anterior
    // (banco de teste é persistente) antes de esvaziar o nosso.
    await query("UPDATE users SET email = 'freed_' || id WHERE email = ''");
    await query("UPDATE users SET email = '' WHERE id = $1", [noMail.user.id]);
    const r = await inj(noMail, 'POST', '/api/settings/smtp/test');
    expect(r.statusCode).toBe(400);
    expect((r.json() as { error: string }).error).toContain('e-mail');
  });
});

/* ── email.processDueEmails: varredura ───────────────────── */
describe('email: processDueEmails', () => {
  it('envia agendamento vencido, marca enviado e agenda a próxima ocorrência (diária)', async () => {
    const now = new Date();
    const past = new Date(now.getTime() - 5 * 86_400_000);
    const id = await insertSchedule({ orgId: a.user.org_id, ownerId: Number(a.user.id), agendado: past, recorrencia: 'diaria' });

    sendMail.mockResolvedValue({ messageId: 'sent' });
    const sent = await processDueEmails(now);
    expect(sent).toBeGreaterThanOrEqual(1);
    expect((await statusOf(id)).status).toBe('enviado');

    // recorrência: nova linha pendente com data futura.
    const children = await query<{ agendado_para: string }>(
      "SELECT agendado_para FROM email_schedules WHERE org_id = $1 AND status = 'pendente' AND recorrencia = 'diaria'",
      [a.user.org_id],
    );
    expect(children.some((c) => new Date(c.agendado_para).getTime() > now.getTime())).toBe(true);
  });

  it('org sem SMTP ativo: agendamento fica pendente (travado, não vira erro)', async () => {
    const noSmtp = await register(app, 'email.nosmtp');
    const id = await insertSchedule({ orgId: noSmtp.user.org_id, ownerId: Number(noSmtp.user.id), agendado: new Date(Date.now() - 1000) });
    await processDueEmails(new Date());
    expect((await statusOf(id)).status).toBe('pendente');
  });

  it('falha de envio marca o agendamento como erro com a mensagem', async () => {
    const id = await insertSchedule({ orgId: a.user.org_id, ownerId: Number(a.user.id), agendado: new Date(Date.now() - 1000), recorrencia: null });
    sendMail.mockRejectedValueOnce(new Error('host fora'));
    await processDueEmails(new Date());
    const s = await statusOf(id);
    expect(s.status).toBe('erro');
    expect(s.erro).toContain('host fora');
  });

  it('idempotência: linha já processada por outra varredura é pulada', async () => {
    const id = await insertSchedule({ orgId: a.user.org_id, ownerId: Number(a.user.id), agendado: new Date(Date.now() - 1000), recorrencia: null });
    // o "envio" marca a linha como enviada ANTES do UPDATE condicional → RETURNING vazio → continue.
    sendMail.mockImplementationOnce(async () => {
      await query("UPDATE email_schedules SET status = 'enviado', enviado_em = now() WHERE id = $1", [id]);
      return { messageId: 'race' };
    });
    await processDueEmails(new Date());
    expect((await statusOf(id)).status).toBe('enviado');
    // não gerou recorrência (a linha condicional não casou).
    const dup = await query("SELECT id FROM email_schedules WHERE id <> $1 AND owner_user_id = $2 AND status = 'pendente' AND recorrencia IS NULL", [id, a.user.id]);
    expect(dup.length).toBe(0);
  });
});

/* ── emailSchedules: templates + agendamentos (CRUD + RBAC) ── */
describe('rotas /api/email-templates', () => {
  let tplId: number;
  it('CRUD do template + escopo de escrita por dono', async () => {
    const created = await inj(a, 'POST', '/api/email-templates', { nome: 'Boas-vindas', assunto: 'Olá', corpo: 'Bem-vindo' });
    expect(created.statusCode).toBe(201);
    tplId = Number((created.json() as { template: { id: number } }).template.id);

    expect((await inj(a, 'GET', '/api/email-templates')).statusCode).toBe(200);

    const up = await inj(a, 'PATCH', `/api/email-templates/${tplId}`, { nome: 'Boas-vindas v2' });
    expect((up.json() as { template: { nome: string } }).template.nome).toBe('Boas-vindas v2');

    expect((await inj(a, 'PATCH', `/api/email-templates/${tplId}`, {})).statusCode).toBe(400);          // nada p/ atualizar
    expect((await inj(a, 'PATCH', '/api/email-templates/999999', { nome: 'x' })).statusCode).toBe(404);  // inexistente
    expect((await inj(rep, 'PATCH', `/api/email-templates/${tplId}`, { nome: 'x' })).statusCode).toBe(403); // de outro vendedor

    expect((await inj(rep, 'DELETE', `/api/email-templates/${tplId}`)).statusCode).toBe(403);
    expect((await inj(a, 'DELETE', '/api/email-templates/999999')).statusCode).toBe(404);
    expect((await inj(a, 'DELETE', `/api/email-templates/${tplId}`)).statusCode).toBe(200);
  });
});

describe('rotas /api/email-schedules', () => {
  it('cria com template/empresa válidos e remetente herdado; valida FKs', async () => {
    const tpl = (await inj(a, 'POST', '/api/email-templates', { nome: 'Tpl', assunto: 'A', corpo: 'C' })).json() as { template: { id: number } };
    const cid = await makeCompany();
    const future = new Date(Date.now() + 86_400_000).toISOString();

    // template_id e company_id inválidos → 400
    expect((await inj(a, 'POST', '/api/email-schedules', { template_id: 999999, destinatario: 'x@y.com', assunto: 'A', corpo: 'C', agendado_para: future })).statusCode).toBe(400);
    expect((await inj(a, 'POST', '/api/email-schedules', { company_id: 999999999, destinatario: 'x@y.com', assunto: 'A', corpo: 'C', agendado_para: future })).statusCode).toBe(400);

    // remetente vazio → herda o e-mail do usuário logado
    const created = await inj(a, 'POST', '/api/email-schedules', {
      template_id: tpl.template.id, company_id: cid, remetente: '',
      destinatario: 'cliente@y.com', assunto: 'Proposta', corpo: 'Segue', agendado_para: future, recorrencia: 'mensal',
    });
    expect(created.statusCode).toBe(201);
    const sched = (created.json() as { schedule: { id: number; remetente: string; recorrencia: string | null } }).schedule;
    expect(sched.remetente).toBeTruthy();
    expect(sched.recorrencia).toBe('mensal');

    // listagem com filtro de status + escopo de dono
    const list = await inj(a, 'GET', `/api/email-schedules?status=pendente&owner_user_id=${a.user.id}`);
    expect(list.statusCode).toBe(200);
    expect((list.json() as { schedules: { id: number }[] }).schedules.some((x) => Number(x.id) === Number(sched.id))).toBe(true);
  });

  it('PATCH edita campos/recorrência/status; 400 vazio; 404 inexistente; 403 de outro; 409 já processado', async () => {
    const future = new Date(Date.now() + 86_400_000).toISOString();
    const sched = (await inj(a, 'POST', '/api/email-schedules', {
      destinatario: 'a@b.com', assunto: 'X', corpo: 'Y', agendado_para: future,
    }).then((r) => r.json())) as { schedule: { id: number } };
    const id = Number(sched.schedule.id);

    const up = await inj(a, 'PATCH', `/api/email-schedules/${id}`, { assunto: 'Editado', remetente: 'novo@b.com', recorrencia: 'semanal', status: 'cancelado' });
    expect(up.statusCode).toBe(200);

    expect((await inj(a, 'PATCH', `/api/email-schedules/${id}`, {})).statusCode).toBe(400);
    expect((await inj(a, 'PATCH', '/api/email-schedules/999999', { assunto: 'z' })).statusCode).toBe(404);
    expect((await inj(rep, 'PATCH', `/api/email-schedules/${id}`, { assunto: 'z' })).statusCode).toBe(403);

    // marca como enviado direto no banco → PATCH responde 409 (já processado)
    await query("UPDATE email_schedules SET status = 'enviado' WHERE id = $1", [id]);
    expect((await inj(a, 'PATCH', `/api/email-schedules/${id}`, { assunto: 'z' })).statusCode).toBe(409);
  });

  it('DELETE remove; 404 inexistente; 403 de outro vendedor', async () => {
    const future = new Date(Date.now() + 86_400_000).toISOString();
    const sched = (await inj(a, 'POST', '/api/email-schedules', {
      destinatario: 'a@b.com', assunto: 'Del', corpo: 'Y', agendado_para: future,
    }).then((r) => r.json())) as { schedule: { id: number } };
    const id = Number(sched.schedule.id);

    expect((await inj(a, 'DELETE', '/api/email-schedules/999999')).statusCode).toBe(404);
    expect((await inj(rep, 'DELETE', `/api/email-schedules/${id}`)).statusCode).toBe(403);
    expect((await inj(a, 'DELETE', `/api/email-schedules/${id}`)).statusCode).toBe(200);
  });
});
