import { useEffect, useState } from 'react';
import { api } from './api.ts';
import { postField } from './offline.ts';
import { Btn, Card, cn } from './ui.tsx';
import { Icon, type IconName } from './icons.tsx';
import { toast } from './toast.tsx';
import type { Activity } from './types.ts';

// Modal de criação de atividade/compromisso. Reutilizado na Agenda e no Funil.
const inputCls = 'w-full rounded-xl border border-ink-200 bg-white px-3 py-2.5 text-sm text-ink-800 outline-none transition focus:border-brand-400 focus:ring-2 focus:ring-brand-200';

const TIPOS: { v: string; label: string; icon: IconName; chip: string }[] = [
  { v: 'tarefa', label: 'Tarefa', icon: 'check', chip: 'bg-brand-50 text-brand-700' },
  { v: 'ligacao', label: 'Ligação', icon: 'phone', chip: 'bg-sky-50 text-sky-700' },
  { v: 'visita', label: 'Visita', icon: 'mapPin', chip: 'bg-amber-50 text-amber-700' },
  { v: 'reuniao', label: 'Reunião', icon: 'users', chip: 'bg-violet-50 text-violet-700' },
];

export type FunnelCompany = { company_id: number; label: string };
export type RepresentedOption = { id: number; nome: string };
type ContactOption = { id: number; nome: string };

const toLocalInput = (d: Date): string => {
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

export type EditableActivity = {
  id: number; titulo: string; tipo: string; start_at: string;
  company_id: number | null; represented_id: number | null; contact_id: number | null;
};

export function ActivityCreateModal({ preset, funnel, represented, presetCompanyId, activity, onClose, onSaved }: {
  preset: Date; funnel: FunnelCompany[]; represented: RepresentedOption[]; presetCompanyId?: number | null;
  activity?: EditableActivity;  // se presente → modo edição (PATCH)
  onClose: () => void; onSaved: () => void;
}): React.JSX.Element {
  const editando = !!activity;
  const [titulo, setTitulo] = useState(activity?.titulo ?? '');
  const [tipo, setTipo] = useState(activity?.tipo ?? 'tarefa');
  const [start, setStart] = useState(toLocalInput(activity ? new Date(activity.start_at) : preset));
  const [companyId, setCompanyId] = useState<number | null>(activity ? activity.company_id : (presetCompanyId ?? null));
  const [representedId, setRepresentedId] = useState<number | null>(activity?.represented_id ?? null);
  const [contactId, setContactId] = useState<number | null>(activity?.contact_id ?? null);
  const [contacts, setContacts] = useState<ContactOption[]>([]);
  const [busy, setBusy] = useState(false);

  // Contatos vêm da empresa do funil (prioridade) ou da representada escolhida.
  // Empresa filtra por company_id; senão cai na representada. Troca de qualquer
  // um zera o contato se ele não pertencer mais à lista.
  useEffect(() => {
    const param = companyId != null ? `company_id=${companyId}`
      : representedId != null ? `represented_id=${representedId}` : null;
    if (param == null) { setContacts([]); return; }
    let alive = true;
    void api.get<{ contacts: ContactOption[] }>(`/api/contacts?${param}`)
      .then((r) => { if (alive) setContacts(r.contacts); })
      .catch(() => { if (alive) setContacts([]); });
    return () => { alive = false; };
  }, [companyId, representedId]);

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (!titulo.trim()) { toast.error('Informe o título da atividade.'); return; }
    if (!start) { toast.error('Informe a data e hora.'); return; }
    setBusy(true);
    try {
      const body = {
        titulo: titulo.trim(), tipo, start_at: new Date(start).toISOString(),
        company_id: companyId, represented_id: representedId, contact_id: contactId,
      };
      if (editando) await api.patch(`/api/activities/${activity!.id}`, body);
      else await api.post('/api/activities', body);
      toast.success(editando ? 'Atividade salva.' : 'Atividade criada.');
      onSaved();
    } catch (err) { toast.error(err instanceof Error ? err.message : 'Não foi possível salvar a atividade.'); }
    finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-[2000] grid place-items-center bg-ink-950/40 p-4" onClick={onClose}>
      <Card className="w-full max-w-md p-4 shadow-pop">
        <div onClick={(e) => e.stopPropagation()}>
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-bold text-ink-900">{editando ? 'Editar atividade' : 'Nova atividade'}</h3>
            <button onClick={onClose} aria-label="Fechar" className="grid h-8 w-8 place-items-center rounded-lg text-ink-400 hover:bg-ink-100">
              <Icon name="x" size={17} />
            </button>
          </div>
          <form onSubmit={submit} className="space-y-3">
            <input autoFocus value={titulo} onChange={(e) => setTitulo(e.target.value)} placeholder="Ex.: Ligar para cliente" className={inputCls} />
            <div className="grid grid-cols-4 gap-1.5">
              {TIPOS.map((t) => (
                <button key={t.v} type="button" onClick={() => setTipo(t.v)}
                  className={cn('flex flex-col items-center gap-1 rounded-xl border px-2 py-2 text-[11px] font-semibold transition',
                    tipo === t.v ? 'border-transparent ' + t.chip : 'border-ink-200 text-ink-500 hover:bg-ink-50')}>
                  <Icon name={t.icon} size={16} />{t.label}
                </button>
              ))}
            </div>
            <label className="block">
              <span className="text-xs font-semibold text-ink-600">Quando</span>
              <input type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} className={cn(inputCls, 'mt-1')} />
            </label>
            <label className="block">
              <span className="text-xs font-semibold text-ink-600">Empresa do funil</span>
              <select value={companyId ?? ''} onChange={(e) => { setCompanyId(e.target.value === '' ? null : Number(e.target.value)); setContactId(null); }} className={cn(inputCls, 'mt-1')}>
                <option value="">Sem vínculo</option>
                {funnel.map((f) => <option key={f.company_id} value={f.company_id}>{f.label}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="text-xs font-semibold text-ink-600">Representada</span>
              <select value={representedId ?? ''}
                onChange={(e) => { const v = e.target.value === '' ? null : Number(e.target.value); setRepresentedId(v); setContactId(null); }}
                className={cn(inputCls, 'mt-1')}>
                <option value="">Sem vínculo</option>
                {represented.map((r) => <option key={r.id} value={r.id}>{r.nome}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="text-xs font-semibold text-ink-600">Contato</span>
              <select value={contactId ?? ''} disabled={companyId == null && representedId == null}
                onChange={(e) => setContactId(e.target.value === '' ? null : Number(e.target.value))}
                className={cn(inputCls, 'mt-1', companyId == null && representedId == null && 'opacity-50')}>
                <option value="">{companyId == null && representedId == null ? 'Escolha empresa ou representada' : contacts.length ? 'Sem vínculo' : 'Nenhum contato'}</option>
                {contacts.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
              </select>
            </label>
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

/* ── Modal de visita em campo (Fase 5): check-in geo + relatório ─────────── */
const RESULTADOS = ['Pedido fechado', 'Em negociação', 'Retornar depois', 'Sem interesse'];

export function VisitModal({ activity, onClose, onSaved }: {
  activity: Activity; onClose: () => void; onSaved: () => void;
}): React.JSX.Element {
  const [checkedAt, setCheckedAt] = useState<string | null>(activity.checkin_at ?? null);
  const [geoBusy, setGeoBusy] = useState(false);
  const [resultado, setResultado] = useState(activity.relatorio?.resultado ?? RESULTADOS[0]!);
  const [proximo, setProximo] = useState(activity.relatorio?.proximo_passo ?? '');
  const [texto, setTexto] = useState(activity.relatorio?.texto ?? '');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  const doCheckin = (): void => {
    if (!navigator.geolocation) { setMsg('Geolocalização indisponível neste dispositivo.'); return; }
    setGeoBusy(true); setMsg('');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        void postField(`/api/activities/${activity.id}/checkin`,
          { lat: pos.coords.latitude, lon: pos.coords.longitude }, `Check-in: ${activity.titulo}`)
          .then((r) => { setCheckedAt(new Date().toISOString()); setMsg(r.queued ? 'Check-in salvo offline — sincroniza ao reconectar.' : ''); })
          .catch(() => setMsg('Falha ao registrar check-in.'))
          .finally(() => setGeoBusy(false));
      },
      () => { setMsg('Não foi possível obter a localização (permissão negada?).'); setGeoBusy(false); },
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  };

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setBusy(true); setMsg('');
    try {
      const r = await postField(`/api/activities/${activity.id}/report`,
        { resultado, proximo_passo: proximo.trim() || null, texto: texto.trim() || null },
        `Relatório: ${activity.titulo}`);
      if (r.queued) { setMsg('Relatório salvo offline — sincroniza ao reconectar.'); setBusy(false); return; }
      onSaved();
    } catch { setMsg('Falha ao salvar o relatório.'); setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-[2000] grid place-items-center bg-ink-950/40 p-4" onClick={onClose}>
      <Card className="w-full max-w-md p-4 shadow-pop">
        <div onClick={(e) => e.stopPropagation()}>
          <div className="mb-3 flex items-center justify-between">
            <div className="min-w-0">
              <h3 className="truncate text-sm font-bold text-ink-900">Visita</h3>
              {activity.razao_social && <p className="truncate text-xs text-ink-400">{activity.razao_social}</p>}
            </div>
            <button onClick={onClose} aria-label="Fechar" className="grid h-8 w-8 place-items-center rounded-lg text-ink-400 hover:bg-ink-100">
              <Icon name="x" size={17} />
            </button>
          </div>

          {/* check-in */}
          <div className="mb-3 flex items-center gap-2 rounded-xl border border-ink-200 p-2.5">
            <span className={cn('grid h-9 w-9 shrink-0 place-items-center rounded-lg',
              checkedAt ? 'bg-emerald-100 text-emerald-700' : 'bg-ink-100 text-ink-500')}>
              <Icon name="mapPin" size={18} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-ink-800">Check-in</p>
              <p className="truncate text-[11px] text-ink-400">
                {checkedAt ? `Registrado ${new Date(checkedAt).toLocaleString('pt-BR')}` : 'Marque sua chegada no cliente.'}
              </p>
            </div>
            <Btn size="sm" variant={checkedAt ? 'soft' : 'primary'} icon="mapPin" disabled={geoBusy} onClick={doCheckin}>
              {geoBusy ? '…' : checkedAt ? 'Refazer' : 'Check-in'}
            </Btn>
          </div>

          {/* relatório */}
          <form onSubmit={submit} className="space-y-3">
            <label className="block">
              <span className="text-xs font-semibold text-ink-600">Resultado</span>
              <select value={resultado} onChange={(e) => setResultado(e.target.value)} className={cn(inputCls, 'mt-1')}>
                {RESULTADOS.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="text-xs font-semibold text-ink-600">Próximo passo</span>
              <input value={proximo} onChange={(e) => setProximo(e.target.value)} placeholder="Ex.: enviar proposta até sexta" className={cn(inputCls, 'mt-1')} />
            </label>
            <label className="block">
              <span className="text-xs font-semibold text-ink-600">Observações</span>
              <textarea value={texto} onChange={(e) => setTexto(e.target.value)} rows={3} placeholder="Como foi a visita?" className={cn(inputCls, 'mt-1 resize-none')} />
            </label>
            {msg && <p className="text-xs text-amber-600">{msg}</p>}
            <div className="flex justify-end gap-2 pt-1">
              <Btn variant="ghost" type="button" onClick={onClose}>Fechar</Btn>
              <Btn icon="check" type="submit" disabled={busy}>{busy ? '…' : 'Salvar visita'}</Btn>
            </div>
          </form>
        </div>
      </Card>
    </div>
  );
}
