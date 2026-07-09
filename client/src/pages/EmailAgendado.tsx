import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api.ts';
import type { CompanyHit, EmailSchedule, EmailScheduleStatus, EmailTemplate } from '../lib/types.ts';
import { Badge, Btn, Card, EmptyState, PageHeader, Segmented, Spinner, StatCard, cn, type Tone } from '../lib/ui.tsx';
import { Icon } from '../lib/icons.tsx';
import { CompanySearch } from '../lib/companySearch.tsx';
import { useAuth } from '../lib/auth.tsx';
import { toast } from '../lib/toast.tsx';
import { confirmDialog } from '../lib/confirm.ts';

const inputCls = 'w-full rounded-xl border border-ink-200 bg-surface px-3 py-2.5 text-sm text-ink-800 outline-none transition focus:border-brand-400 focus:ring-2 focus:ring-brand-200';

// Status do envio → rótulo/cor do badge.
const STATUS_META: Record<EmailScheduleStatus, { label: string; tone: Tone }> = {
  pendente: { label: 'Pendente', tone: 'info' },
  enviado: { label: 'Enviado', tone: 'success' },
  cancelado: { label: 'Cancelado', tone: 'neutral' },
  erro: { label: 'Erro', tone: 'danger' },
};

// Rótulo curto da recorrência (null/'nenhuma' = sem badge).
const REC_LABEL: Record<string, string> = { diaria: 'Diária', semanal: 'Semanal', mensal: 'Mensal' };

// timestamptz → "DD/MM/AAAA HH:MM" no fuso local.
const fmtDateTime = (iso: string): string => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
};

// ISO/timestamptz → valor de <input type="datetime-local"> ("AAAA-MM-DDTHH:MM" local).
const toLocalInput = (iso: string): string => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

// Quebra uma string de e-mails (vírgula/;/espaço/linha) em tokens não vazios.
const splitEmails = (s: string): string[] => s.split(/[,;\s]+/).map((x) => x.trim()).filter(Boolean);

// Valida formato de e-mail (não só presença de "@").
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

type Tab = 'agendados' | 'templates';

// Menu de agendamento de envio de e-mail. Aba "Agendados" lista/cria envios
// (destinatário puxado de uma empresa da base ou digitado manual); aba "Modelos"
// gere templates reutilizáveis. Envio em si é stub no backend (scaffold).
export function EmailAgendado(): React.JSX.Element {
  const [tab, setTab] = useState<Tab>('agendados');

  return (
    <div className="space-y-4 p-4 sm:p-6">
      <PageHeader title="Agendamento de e-mail"
        subtitle="Agende envios para empresas da base ou destinatários manuais e mantenha modelos reutilizáveis."
        actions={(
          <Segmented<Tab> value={tab} onChange={setTab} options={[
            { value: 'agendados', label: 'Agendados', icon: 'clock' },
            { value: 'templates', label: 'Modelos', icon: 'mail' },
          ]} />
        )} />
      {tab === 'agendados' ? <SchedulesTab /> : <TemplatesTab />}
    </div>
  );
}

/* ── Aba Agendados ──────────────────────────────────────── */

const STATUS_FILTERS: { value: EmailScheduleStatus | 'todos'; label: string }[] = [
  { value: 'todos', label: 'Todos' },
  { value: 'pendente', label: 'Pendentes' },
  { value: 'enviado', label: 'Enviados' },
  { value: 'cancelado', label: 'Cancelados' },
  { value: 'erro', label: 'Erro' },
];

function SchedulesTab(): React.JSX.Element {
  const { can } = useAuth();
  const [list, setList] = useState<EmailSchedule[]>([]);
  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<EmailScheduleStatus | 'todos'>('todos');
  const [editing, setEditing] = useState<EmailSchedule | null>(null);
  const [creating, setCreating] = useState(false);

  const load = async (): Promise<void> => {
    const [s, t] = await Promise.all([
      api.get<{ schedules: EmailSchedule[] }>('/api/email-schedules'),
      api.get<{ templates: EmailTemplate[] }>('/api/email-templates'),
    ]);
    setList(s.schedules);
    setTemplates(t.templates);
    setLoading(false);
  };
  useEffect(() => { void load(); }, []);

  const pendentes = useMemo(() => list.filter((e) => e.status === 'pendente').length, [list]);
  const enviados = useMemo(() => list.filter((e) => e.status === 'enviado').length, [list]);
  const filtered = useMemo(() => filter === 'todos' ? list : list.filter((e) => e.status === filter), [list, filter]);

  const cancelar = async (e: EmailSchedule): Promise<void> => {
    if (!(await confirmDialog(`Cancelar o envio para ${e.destinatario}?`))) return;
    try {
      const r = await api.patch<{ schedule: EmailSchedule }>(`/api/email-schedules/${e.id}`, { status: 'cancelado' });
      setList((xs) => xs.map((x) => (x.id === e.id ? r.schedule : x)));
      toast.success('Envio cancelado.');
    } catch (err) { toast.error(err instanceof Error ? err.message : 'Não foi possível cancelar.'); }
  };

  const remove = async (e: EmailSchedule): Promise<void> => {
    if (!(await confirmDialog(`Remover o agendamento para ${e.destinatario}?`))) return;
    const before = list;
    setList((xs) => xs.filter((x) => x.id !== e.id));
    try { await api.del(`/api/email-schedules/${e.id}`); toast.success('Agendamento removido.'); }
    catch { setList(before); toast.error('Não foi possível remover.'); }
  };

  if (loading) return <Spinner />;

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard label="Total agendados" value={list.length} icon="mail" />
        <StatCard label="Pendentes" value={pendentes} icon="clock" tone="info" />
        <StatCard label="Enviados" value={enviados} icon="check" tone="success" />
      </div>

      <Card className="p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap gap-1.5">
            {STATUS_FILTERS.map((f) => (
              <button key={f.value} onClick={() => setFilter(f.value)}
                className={cn('rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors',
                  filter === f.value ? 'bg-brand-100 text-brand-700' : 'bg-ink-50 text-ink-500 hover:text-ink-700')}>
                {f.label}
              </button>
            ))}
          </div>
          {can('email_schedules.create') && <Btn icon="plus" onClick={() => setCreating(true)}>Novo agendamento</Btn>}
        </div>

        <div className="space-y-2">
          {list.length === 0 && (
            <EmptyState icon="mail" title="Nenhum e-mail agendado"
              hint="Crie um agendamento puxando o e-mail de uma empresa da base ou digitando o destinatário." />
          )}
          {list.length > 0 && filtered.length === 0 && (
            <p className="py-8 text-center text-sm text-ink-400">Nenhum agendamento neste filtro.</p>
          )}
          {filtered.map((e) => {
            const meta = STATUS_META[e.status];
            return (
              <div key={e.id} className="flex items-start gap-3 rounded-xl border border-ink-200/70 bg-surface p-3">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-600"><Icon name="mail" size={18} /></span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <p className="truncate text-sm font-semibold text-ink-800">{e.assunto}</p>
                    <Badge tone={meta.tone}>{meta.label}</Badge>
                    {e.empresa && <Badge tone="brand">{e.empresa}</Badge>}
                    {e.recorrencia && REC_LABEL[e.recorrencia] && (
                      <Badge tone="info"><span className="inline-flex items-center gap-1"><Icon name="clock" size={11} />{REC_LABEL[e.recorrencia]}</span></Badge>
                    )}
                  </div>
                  <p className="mt-0.5 truncate text-xs text-ink-400">
                    {e.destinatario} · {e.status === 'enviado' && e.enviado_em
                      ? `enviado ${fmtDateTime(e.enviado_em)}`
                      : `agendado ${fmtDateTime(e.agendado_para)}`}
                    {e.status === 'erro' && e.erro ? ` · ${e.erro}` : ''}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {(e.status === 'pendente' || e.status === 'cancelado') && can('email_schedules.update') && (
                    <button onClick={() => setEditing(e)} aria-label="Editar agendamento"
                      className="grid h-8 w-8 place-items-center rounded-lg text-ink-400 hover:bg-ink-100"><Icon name="pencil" size={16} /></button>
                  )}
                  {e.status === 'pendente' && can('email_schedules.delete') && (
                    <button onClick={() => void cancelar(e)} title="Cancelar envio"
                      className="grid h-8 w-8 place-items-center rounded-lg text-ink-400 hover:bg-ink-100"><Icon name="x" size={16} /></button>
                  )}
                  {can('email_schedules.delete') && (
                    <button onClick={() => void remove(e)} aria-label="Remover agendamento"
                      className="grid h-8 w-8 place-items-center rounded-lg text-ink-300 hover:bg-rose-50 hover:text-rose-500"><Icon name="trash" size={16} /></button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      {(creating || editing) && (
        <ScheduleModal schedule={editing} templates={templates}
          onClose={() => { setCreating(false); setEditing(null); }}
          onSaved={(s) => {
            setList((xs) => editing ? xs.map((x) => (x.id === s.id ? s : x)) : [s, ...xs]);
            setCreating(false); setEditing(null);
          }} />
      )}
    </>
  );
}

// Cria/edita um agendamento. Destinatário vem de uma empresa da base (puxa o
// e-mail direto) ou é digitado manual; um modelo pode pré-preencher assunto/corpo.
function ScheduleModal({ schedule, templates, onClose, onSaved }: {
  schedule: EmailSchedule | null;
  templates: EmailTemplate[];
  onClose: () => void;
  onSaved: (s: EmailSchedule) => void;
}): React.JSX.Element {
  const { user } = useAuth();
  const [companyId, setCompanyId] = useState<number | null>(schedule?.company_id ?? null);
  const [empresa, setEmpresa] = useState<string | null>(schedule?.empresa ?? null);
  // remetente sugere o e-mail do usuário logado ao criar, mas é editável.
  const [remetente, setRemetente] = useState(schedule?.remetente ?? user?.email ?? '');
  // múltiplos destinatários como chips; empresas selecionadas puxam o e-mail.
  const [recipients, setRecipients] = useState<string[]>(schedule ? splitEmails(schedule.destinatario) : []);
  const [recipInput, setRecipInput] = useState('');
  const [templateId, setTemplateId] = useState<number | null>(schedule?.template_id ?? null);
  const [assunto, setAssunto] = useState(schedule?.assunto ?? '');
  const [corpo, setCorpo] = useState(schedule?.corpo ?? '');
  const [agendadoPara, setAgendadoPara] = useState(schedule ? toLocalInput(schedule.agendado_para) : '');
  const [recorrencia, setRecorrencia] = useState(schedule?.recorrencia ?? 'nenhuma');
  const [busy, setBusy] = useState(false);

  // Adiciona um ou mais e-mails à lista (dedup), ignorando tokens sem "@".
  const addRecipients = (raw: string): void => {
    const parts = splitEmails(raw);
    const valid = parts.filter((p) => EMAIL_RE.test(p));
    const bad = parts.filter((p) => !EMAIL_RE.test(p));
    if (bad.length) toast.error(`E-mail inválido: ${bad.join(', ')}`);
    if (valid.length) setRecipients((xs) => [...new Set([...xs, ...valid])]);
    setRecipInput('');
  };

  const pickCompany = (c: CompanyHit): void => {
    setCompanyId(c.id);
    setEmpresa(c.nome_fantasia || c.razao_social);
    if (c.email) addRecipients(c.email);
    else toast.error('Empresa sem e-mail na base — informe o destinatário manualmente.');
  };

  const applyTemplate = (id: number | null): void => {
    setTemplateId(id);
    // id de bigint vem string do pg — coage os dois lados antes de comparar.
    const t = templates.find((x) => Number(x.id) === id);
    if (t) { setAssunto(t.assunto); setCorpo(t.corpo); }
  };

  const submit = async (ev: React.FormEvent): Promise<void> => {
    ev.preventDefault();
    // inclui o que estiver digitado mas ainda não virou chip.
    const pending = splitEmails(recipInput).filter((p) => EMAIL_RE.test(p));
    const all = [...new Set([...recipients, ...pending])];
    if (!remetente.trim() || all.length === 0 || !assunto.trim() || !corpo.trim() || !agendadoPara) {
      toast.error('Preencha remetente, ao menos um destinatário, assunto, corpo e a data/hora.');
      return;
    }
    setBusy(true);
    const body = {
      company_id: companyId,
      template_id: templateId,
      remetente: remetente.trim(),
      destinatario: all.join(', '),
      assunto, corpo,
      agendado_para: new Date(agendadoPara).toISOString(),
      recorrencia,
    };
    try {
      const r = schedule
        ? await api.patch<{ schedule: EmailSchedule }>(`/api/email-schedules/${schedule.id}`,
          { remetente: body.remetente, destinatario: body.destinatario, assunto, corpo, agendado_para: body.agendado_para, recorrencia })
        : await api.post<{ schedule: EmailSchedule }>('/api/email-schedules', body);
      toast.success(schedule ? 'Agendamento salvo.' : 'E-mail agendado.');
      onSaved(r.schedule);
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Não foi possível salvar.'); }
    finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-[2000] grid place-items-center bg-black/45 p-4" onClick={onClose}>
      <Card className="w-full max-w-lg p-0" >
        <div onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center justify-between border-b border-ink-100 px-4 py-3">
            <h2 className="text-sm font-bold text-ink-800">{schedule ? 'Editar agendamento' : 'Novo agendamento'}</h2>
            <button onClick={onClose} aria-label="Fechar" className="grid h-8 w-8 place-items-center rounded-lg text-ink-400 hover:bg-ink-100"><Icon name="x" size={16} /></button>
          </div>
          <form onSubmit={submit} className="max-h-[70vh] space-y-3 overflow-auto p-4">
            {!schedule && (
              <div>
                <label className="mb-1 block text-xs font-semibold text-ink-500">Empresa <span className="font-normal text-ink-400">(opcional — carrega o e-mail)</span></label>
                <CompanySearch onPick={pickCompany} placeholder="Buscar empresa por CNPJ ou nome…" />
                {empresa && <p className="mt-1 text-xs text-ink-400">Empresa: <span className="font-medium text-ink-600">{empresa}</span></p>}
              </div>
            )}
            <div>
              <label className="mb-1 block text-xs font-semibold text-ink-500">E-mail de origem (remetente)</label>
              <input type="email" value={remetente} onChange={(e) => setRemetente(e.target.value)} maxLength={160}
                placeholder="seu@email.com" className={inputCls} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-ink-500">Destinatários</label>
              <div className="flex flex-wrap items-center gap-1.5 rounded-xl border border-ink-200 bg-surface p-2 transition focus-within:border-brand-400 focus-within:ring-2 focus-within:ring-brand-200">
                {recipients.map((r, i) => (
                  <span key={r} className="inline-flex items-center gap-1 rounded-lg bg-brand-50 px-2 py-1 text-xs font-medium text-brand-700">
                    {r}
                    <button type="button" aria-label={`Remover ${r}`} onClick={() => setRecipients((xs) => xs.filter((_, j) => j !== i))}
                      className="text-brand-400 hover:text-brand-600"><Icon name="x" size={12} /></button>
                  </span>
                ))}
                <input type="email" value={recipInput} onChange={(e) => setRecipInput(e.target.value)} maxLength={160}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addRecipients(recipInput); } }}
                  onBlur={() => { if (recipInput.trim()) addRecipients(recipInput); }}
                  placeholder={recipients.length ? 'adicionar outro…' : 'contato@empresa.com'}
                  className="min-w-[8rem] flex-1 border-0 bg-transparent p-1 text-sm text-ink-800 outline-none" />
              </div>
              <p className="mt-1 text-xs text-ink-400">Enter ou vírgula adiciona. Selecione empresas acima para puxar o e-mail.</p>
            </div>

            {templates.length > 0 && (
              <div>
                <label className="mb-1 block text-xs font-semibold text-ink-500">Modelo <span className="font-normal text-ink-400">(carrega assunto e corpo)</span></label>
                <select value={templateId ?? ''} onChange={(e) => applyTemplate(e.target.value ? Number(e.target.value) : null)} className={inputCls}>
                  <option value="">— sem modelo —</option>
                  {templates.map((t) => <option key={t.id} value={t.id}>{t.nome}</option>)}
                </select>
              </div>
            )}

            <div>
              <label className="mb-1 block text-xs font-semibold text-ink-500">Assunto</label>
              <input value={assunto} onChange={(e) => setAssunto(e.target.value)} maxLength={200} placeholder="Assunto do e-mail" className={inputCls} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-ink-500">Corpo</label>
              <textarea value={corpo} onChange={(e) => setCorpo(e.target.value)} rows={6} maxLength={20000} placeholder="Conteúdo do e-mail" className={cn(inputCls, 'resize-y')} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs font-semibold text-ink-500">Enviar em</label>
                <input type="datetime-local" value={agendadoPara} onChange={(e) => setAgendadoPara(e.target.value)} className={inputCls} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-ink-500">Repetição</label>
                <select value={recorrencia} onChange={(e) => setRecorrencia(e.target.value)} className={inputCls}>
                  <option value="nenhuma">Não repetir</option>
                  <option value="diaria">Diária</option>
                  <option value="semanal">Semanal</option>
                  <option value="mensal">Mensal</option>
                </select>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-1">
              <Btn variant="ghost" type="button" onClick={onClose}>Cancelar</Btn>
              <Btn icon="check" type="submit" disabled={busy}>{busy ? '…' : 'Salvar'}</Btn>
            </div>
          </form>
        </div>
      </Card>
    </div>
  );
}

/* ── Aba Modelos ────────────────────────────────────────── */

function TemplatesTab(): React.JSX.Element {
  const { can } = useAuth();
  const [list, setList] = useState<EmailTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<EmailTemplate | null>(null);
  const [creating, setCreating] = useState(false);

  const load = async (): Promise<void> => {
    const r = await api.get<{ templates: EmailTemplate[] }>('/api/email-templates');
    setList(r.templates);
    setLoading(false);
  };
  useEffect(() => { void load(); }, []);

  const remove = async (t: EmailTemplate): Promise<void> => {
    if (!(await confirmDialog(`Remover o modelo "${t.nome}"?`))) return;
    const before = list;
    setList((xs) => xs.filter((x) => x.id !== t.id));
    try { await api.del(`/api/email-templates/${t.id}`); toast.success('Modelo removido.'); }
    catch { setList(before); toast.error('Não foi possível remover.'); }
  };

  if (loading) return <Spinner />;

  return (
    <Card className="p-4">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-sm font-semibold text-ink-700">Modelos de e-mail</p>
        {can('email_templates.create') && <Btn icon="plus" onClick={() => setCreating(true)}>Novo modelo</Btn>}
      </div>
      <div className="space-y-2">
        {list.length === 0 && (
          <EmptyState icon="mail" title="Nenhum modelo ainda" hint="Crie modelos reutilizáveis para agilizar os agendamentos." />
        )}
        {list.map((t) => (
          <div key={t.id} className="flex items-start gap-3 rounded-xl border border-ink-200/70 bg-surface p-3">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-600"><Icon name="mail" size={18} /></span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-ink-800">{t.nome}</p>
              <p className="mt-0.5 truncate text-xs text-ink-400">{t.assunto}</p>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              {can('email_templates.update') && (
                <button onClick={() => setEditing(t)} aria-label="Editar modelo"
                  className="grid h-8 w-8 place-items-center rounded-lg text-ink-400 hover:bg-ink-100"><Icon name="pencil" size={16} /></button>
              )}
              {can('email_templates.delete') && (
                <button onClick={() => void remove(t)} aria-label="Remover modelo"
                  className="grid h-8 w-8 place-items-center rounded-lg text-ink-300 hover:bg-rose-50 hover:text-rose-500"><Icon name="trash" size={16} /></button>
              )}
            </div>
          </div>
        ))}
      </div>

      {(creating || editing) && (
        <TemplateModal template={editing}
          onClose={() => { setCreating(false); setEditing(null); }}
          onSaved={(t) => {
            setList((xs) => editing ? xs.map((x) => (x.id === t.id ? t : x)) : [t, ...xs].sort((a, b) => a.nome.localeCompare(b.nome)));
            setCreating(false); setEditing(null);
          }} />
      )}
    </Card>
  );
}

function TemplateModal({ template, onClose, onSaved }: {
  template: EmailTemplate | null;
  onClose: () => void;
  onSaved: (t: EmailTemplate) => void;
}): React.JSX.Element {
  const [nome, setNome] = useState(template?.nome ?? '');
  const [assunto, setAssunto] = useState(template?.assunto ?? '');
  const [corpo, setCorpo] = useState(template?.corpo ?? '');
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (!nome.trim() || !assunto.trim() || !corpo.trim()) { toast.error('Preencha nome, assunto e corpo.'); return; }
    setBusy(true);
    const body = { nome: nome.trim(), assunto, corpo };
    try {
      const r = template
        ? await api.patch<{ template: EmailTemplate }>(`/api/email-templates/${template.id}`, body)
        : await api.post<{ template: EmailTemplate }>('/api/email-templates', body);
      toast.success(template ? 'Modelo salvo.' : 'Modelo criado.');
      onSaved(r.template);
    } catch (err) { toast.error(err instanceof Error ? err.message : 'Não foi possível salvar.'); }
    finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-[2000] grid place-items-center bg-black/45 p-4" onClick={onClose}>
      <Card className="w-full max-w-lg p-0">
        <div onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center justify-between border-b border-ink-100 px-4 py-3">
            <h2 className="text-sm font-bold text-ink-800">{template ? 'Editar modelo' : 'Novo modelo'}</h2>
            <button onClick={onClose} aria-label="Fechar" className="grid h-8 w-8 place-items-center rounded-lg text-ink-400 hover:bg-ink-100"><Icon name="x" size={16} /></button>
          </div>
          <form onSubmit={submit} className="max-h-[70vh] space-y-3 overflow-auto p-4">
            <div>
              <label className="mb-1 block text-xs font-semibold text-ink-500">Nome do modelo</label>
              <input value={nome} onChange={(e) => setNome(e.target.value)} maxLength={120} placeholder="Ex.: Apresentação inicial" className={inputCls} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-ink-500">Assunto</label>
              <input value={assunto} onChange={(e) => setAssunto(e.target.value)} maxLength={200} placeholder="Assunto do e-mail" className={inputCls} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-ink-500">Corpo</label>
              <textarea value={corpo} onChange={(e) => setCorpo(e.target.value)} rows={8} maxLength={20000} placeholder="Conteúdo do e-mail" className={cn(inputCls, 'resize-y')} />
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <Btn variant="ghost" type="button" onClick={onClose}>Cancelar</Btn>
              <Btn icon="check" type="submit" disabled={busy}>{busy ? '…' : 'Salvar'}</Btn>
            </div>
          </form>
        </div>
      </Card>
    </div>
  );
}
