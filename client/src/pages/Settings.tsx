import { useEffect, useState } from 'react';
import { api } from '../lib/api.ts';
import type { Brand, CompanyHit, Contact, NamedItem, RepresentedCompany, Stage, TaxDefaults } from '../lib/types.ts';
import { Badge, Btn, Card, EmptyState, PageHeader, Spinner, cn } from '../lib/ui.tsx';
import { Icon, type IconName } from '../lib/icons.tsx';
import { useOptionalUser } from '../lib/auth.tsx';
import { CompanySearch } from '../lib/companySearch.tsx';
import { ProfileForm } from './Profile.tsx';
import { toast } from '../lib/toast.tsx';
import { dec, maskCNPJ, maskPct, maskPhone } from '../lib/format.ts';

type Section = 'perfil' | 'empresas' | 'funil' | 'contatos' | 'cenarios' | 'acoes' | 'aliquotas' | 'alertas' | 'smtp';
const SECTIONS: { key: Section; label: string; icon: IconName; desc: string; admin?: boolean }[] = [
  { key: 'perfil', label: 'Perfil-alvo', icon: 'compass', desc: 'Quem o motor deve priorizar' },
  { key: 'empresas', label: 'Empresas representadas', icon: 'building', desc: 'Representadas e suas marcas' },
  { key: 'contatos', label: 'Contatos', icon: 'users', desc: 'Pessoas para vincular na prospecção' },
  { key: 'cenarios', label: 'Cenários', icon: 'list', desc: 'Opções de "cenário atual"' },
  { key: 'acoes', label: 'Ações próximo nível', icon: 'target', desc: 'Opções de ação para avançar' },
  { key: 'funil', label: 'Funil', icon: 'columns', desc: 'Fases do seu pipeline de vendas' },
  { key: 'aliquotas', label: 'Alíquotas', icon: 'percent', desc: 'Impostos default dos pedidos', admin: true },
  { key: 'alertas', label: 'Alertas', icon: 'bell', desc: 'Inatividade no dashboard', admin: true },
  { key: 'smtp', label: 'E-mail (SMTP)', icon: 'mail', desc: 'Servidor de envio dos e-mails agendados', admin: true },
];
const inputCls = 'w-full rounded-xl border border-ink-200 bg-white px-3 py-2.5 text-sm text-ink-800 outline-none transition focus:border-brand-400 focus:ring-2 focus:ring-brand-200';

export function Settings(): React.JSX.Element {
  const user = useOptionalUser();
  const sections = SECTIONS.filter((s) => !s.admin || user?.role === 'admin');
  const [section, setSection] = useState<Section>('perfil');
  return (
    <div className="space-y-4 p-4 sm:p-6">
      <PageHeader title="Configurações" subtitle="Ajuste como o Prospecta funciona para a sua operação." />
      <div className="flex flex-col gap-4 sm:flex-row">
        {/* sub-nav */}
        <nav className="flex gap-2 overflow-x-auto sm:w-56 sm:flex-col sm:gap-1 sm:overflow-x-visible">
          {sections.map((s) => {
            const on = section === s.key;
            return (
              <button key={s.key} onClick={() => setSection(s.key)}
                className={cn('flex items-center gap-3 whitespace-nowrap sm:whitespace-normal rounded-xl px-3 py-2.5 text-left transition-colors',
                  on ? 'bg-brand-600 text-white shadow-sm shadow-brand-600/20' : 'bg-white text-ink-600 shadow-card hover:bg-ink-50')}>
                <Icon name={s.icon} size={18} className={cn('shrink-0', on ? 'text-white' : 'text-ink-400')} />
                <span className="min-w-0 text-sm font-semibold">
                  {s.label}
                  <span className={cn('hidden text-xs font-normal sm:block', on ? 'text-brand-100' : 'text-ink-400')}>{s.desc}</span>
                </span>
              </button>
            );
          })}
        </nav>
        <div className="min-w-0 flex-1">
          {section === 'perfil' && <ProfileForm />}
          {section === 'empresas' && <RepresentadasEditor inputCls={inputCls} />}
          {section === 'contatos' && <ContatosEditor inputCls={inputCls} />}
          {section === 'cenarios' && (
            <NamedListEditor inputCls={inputCls} path="scenarios" titulo="Cenários" icon="list"
              desc='Opções do dropdown "Cenário atual" na prospecção.' placeholder="Novo cenário (ex.: Já compra do concorrente)" />
          )}
          {section === 'acoes' && (
            <NamedListEditor inputCls={inputCls} path="actions" titulo="Ações para próximo nível" icon="target"
              desc='Opções do dropdown "Ação para próximo nível" na prospecção.' placeholder="Nova ação (ex.: Enviar proposta)" />
          )}
          {section === 'funil' && <FunilEditor inputCls={inputCls} />}
          {section === 'aliquotas' && <AliquotasEditor inputCls={inputCls} />}
          {section === 'alertas' && <AlertasEditor inputCls={inputCls} />}
          {section === 'smtp' && <SmtpEditor inputCls={inputCls} />}
        </div>
      </div>
    </div>
  );
}

// Config dos alertas de inatividade do dashboard (org-scoped, admin only no backend).
function AlertasEditor({ inputCls }: { inputCls: string }): React.JSX.Element {
  const [dias, setDias] = useState<number | ''>('');
  const [loading, setLoading] = useState(true);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    void api.get<{ org: { inatividade_dias: number } }>('/api/account')
      .then((r) => setDias(r.org.inatividade_dias))
      .finally(() => setLoading(false));
  }, []);

  const save = async (): Promise<void> => {
    if (dias === '' || dias < 1) { toast.error('Informe um número de dias válido.'); return; }
    try {
      await api.patch('/api/account', { inatividade_dias: Number(dias) });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      toast.success('Alerta de inatividade salvo.');
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Não foi possível salvar.'); }
  };

  if (loading) return <Spinner />;
  return (
    <Card className="max-w-lg p-4">
      <h3 className="text-sm font-semibold text-ink-900">Alertas de inatividade</h3>
      <p className="mt-0.5 text-xs text-ink-400">
        Prospects sem contato por mais que este número de dias aparecem como alerta no dashboard.
      </p>
      <label className="mt-4 block">
        <span className="mb-1 block text-xs font-medium text-ink-500">Dias sem contato</span>
        <input type="number" min={1} max={365} value={dias}
          onChange={(e) => setDias(e.target.value === '' ? '' : Number(e.target.value))}
          className={cn(inputCls, 'w-32')} />
      </label>
      <div className="mt-4 flex items-center gap-3">
        <Btn icon="check" onClick={() => void save()}>Salvar</Btn>
        {saved && <span className="inline-flex items-center gap-1 text-sm font-semibold text-emerald-600"><Icon name="check" size={16} /> Salvo</span>}
      </div>
    </Card>
  );
}

// Config SMTP da org (admin). É o servidor que dispara os e-mails agendados.
// A senha nunca volta do backend (só has_password); deixar o campo em branco
// mantém a senha atual ao salvar.
interface SmtpView {
  host: string; port: number; secure: boolean; username: string | null;
  from_email: string; from_name: string | null; enabled: boolean; has_password: boolean;
}
function SmtpEditor({ inputCls }: { inputCls: string }): React.JSX.Element {
  const [host, setHost] = useState('');
  const [port, setPort] = useState(587);
  const [secure, setSecure] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [hasPassword, setHasPassword] = useState(false);
  const [fromEmail, setFromEmail] = useState('');
  const [fromName, setFromName] = useState('');
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    void api.get<{ smtp: SmtpView | null }>('/api/settings/smtp')
      .then((r) => {
        const s = r.smtp;
        if (s) {
          setHost(s.host); setPort(s.port); setSecure(s.secure); setUsername(s.username ?? '');
          setFromEmail(s.from_email); setFromName(s.from_name ?? ''); setEnabled(s.enabled);
          setHasPassword(s.has_password);
        }
      })
      .finally(() => setLoading(false));
  }, []);

  const save = async (): Promise<void> => {
    if (!host.trim() || !fromEmail.trim()) { toast.error('Informe o host e o e-mail de origem.'); return; }
    setBusy(true);
    try {
      await api.put('/api/settings/smtp', {
        host: host.trim(), port, secure,
        username: username.trim() || null,
        // só envia password quando preenchida — branco mantém a atual.
        password: password ? password : null,
        from_email: fromEmail.trim(), from_name: fromName.trim() || null, enabled,
      });
      if (password) setHasPassword(true);
      setPassword('');
      toast.success('SMTP salvo.');
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Não foi possível salvar.'); }
    finally { setBusy(false); }
  };

  const testar = async (): Promise<void> => {
    setTesting(true);
    try {
      const r = await api.post<{ ok: boolean; to: string }>('/api/settings/smtp/test');
      toast.success(`E-mail de teste enviado para ${r.to}.`);
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Falha no teste de envio.'); }
    finally { setTesting(false); }
  };

  if (loading) return <Spinner />;
  return (
    <Card className="max-w-lg p-4">
      <h3 className="text-sm font-semibold text-ink-900">Servidor de e-mail (SMTP)</h3>
      <p className="mt-0.5 text-xs text-ink-400">
        Os e-mails agendados são disparados por este servidor. A senha é guardada cifrada e não é exibida.
      </p>

      <div className="mt-4 space-y-3">
        <div className="grid grid-cols-3 gap-3">
          <label className="col-span-2 block">
            <span className="mb-1 block text-xs font-medium text-ink-500">Host</span>
            <input value={host} onChange={(e) => setHost(e.target.value)} placeholder="smtp.seudominio.com" className={inputCls} />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-ink-500">Porta</span>
            <input type="number" min={1} max={65535} value={port} onChange={(e) => setPort(Number(e.target.value) || 587)} className={inputCls} />
          </label>
        </div>

        <label className="flex items-center gap-2">
          <input type="checkbox" checked={secure} onChange={(e) => setSecure(e.target.checked)} className="h-4 w-4 rounded border-ink-300 text-brand-600" />
          <span className="text-sm text-ink-700">Conexão segura (SSL/TLS — porta 465). Desmarcado usa STARTTLS (587).</span>
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-ink-500">Usuário</span>
            <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="login do SMTP" className={inputCls} />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-ink-500">Senha {hasPassword && <span className="text-emerald-600">(definida)</span>}</span>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
              placeholder={hasPassword ? '•••••• (manter atual)' : 'senha do SMTP'} className={inputCls} />
          </label>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-ink-500">E-mail de origem</span>
            <input type="email" value={fromEmail} onChange={(e) => setFromEmail(e.target.value)} placeholder="naoresponda@seudominio.com" className={inputCls} />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-ink-500">Nome de exibição</span>
            <input value={fromName} onChange={(e) => setFromName(e.target.value)} placeholder="Sua Empresa" className={inputCls} />
          </label>
        </div>

        <label className="flex items-center gap-2">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="h-4 w-4 rounded border-ink-300 text-brand-600" />
          <span className="text-sm text-ink-700">Disparo ativo — sem isso os agendamentos ficam com erro "SMTP não configurado".</span>
        </label>
      </div>

      <div className="mt-4 flex items-center gap-2">
        <Btn icon="check" onClick={() => void save()} disabled={busy}>{busy ? '…' : 'Salvar'}</Btn>
        <Btn variant="soft" icon="mail" onClick={() => void testar()} disabled={testing}>{testing ? 'Enviando…' : 'Enviar teste'}</Btn>
      </div>
    </Card>
  );
}

// Alíquotas default da org (org-scoped, admin only no backend). Usadas como base
// nos impostos de cada item ao criar pedido; cada pedido guarda a própria cópia.
const TAX_FIELDS: { key: keyof TaxDefaults; label: string }[] = [
  { key: 'icms_pct', label: 'ICMS' },
  { key: 'ipi_pct', label: 'IPI' },
  { key: 'st_pct', label: 'ICMS-ST' },
  { key: 'pis_pct', label: 'PIS' },
  { key: 'cofins_pct', label: 'COFINS' },
  { key: 'iss_pct', label: 'ISS' },
];

function AliquotasEditor({ inputCls }: { inputCls: string }): React.JSX.Element {
  const [tax, setTax] = useState<Record<keyof TaxDefaults, string>>();
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    void api.get<{ tax: TaxDefaults }>('/api/tax-defaults').then((r) => {
      setTax(Object.fromEntries(TAX_FIELDS.map(({ key }) => [key, r.tax[key] ? String(r.tax[key]) : ''])) as Record<keyof TaxDefaults, string>);
    });
  }, []);

  const set = (k: keyof TaxDefaults) => (e: React.ChangeEvent<HTMLInputElement>): void =>
    setTax((p) => ({ ...p!, [k]: maskPct(e.target.value) }));

  const save = async (): Promise<void> => {
    if (!tax) return;
    const body = Object.fromEntries(TAX_FIELDS.map(({ key }) => [key, dec(tax[key]) || 0]));
    try {
      const r = await api.patch<{ tax: TaxDefaults }>('/api/tax-defaults', body);
      setTax(Object.fromEntries(TAX_FIELDS.map(({ key }) => [key, r.tax[key] ? String(r.tax[key]) : ''])) as Record<keyof TaxDefaults, string>);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      toast.success('Alíquotas salvas.');
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Não foi possível salvar.'); }
  };

  if (!tax) return <Spinner />;
  return (
    <Card className="max-w-lg p-4">
      <h3 className="text-sm font-semibold text-ink-900">Alíquotas de impostos</h3>
      <p className="mt-0.5 text-xs text-ink-400">
        Percentuais default usados ao criar um pedido. Cada item do pedido recebe uma cópia editável —
        mudar aqui não altera pedidos já criados.
      </p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {TAX_FIELDS.map(({ key, label }) => (
          <label key={key} className="block">
            <span className="mb-1 block text-xs font-medium text-ink-500">{label} (%)</span>
            <input type="text" inputMode="decimal" value={tax[key]} onChange={set(key)}
              placeholder="0" className={inputCls} />
          </label>
        ))}
      </div>
      <div className="mt-4 flex items-center gap-3">
        <Btn icon="check" onClick={() => void save()}>Salvar</Btn>
        {saved && <span className="inline-flex items-center gap-1 text-sm font-semibold text-emerald-600"><Icon name="check" size={16} /> Salvo</span>}
      </div>
    </Card>
  );
}

function FunilEditor({ inputCls }: { inputCls: string }): React.JSX.Element {
  const [stages, setStages] = useState<Stage[]>([]);
  const [loading, setLoading] = useState(true);
  const [novo, setNovo] = useState('');
  const [saved, setSaved] = useState(false);

  const flash = (): void => { setSaved(true); setTimeout(() => setSaved(false), 1500); };

  const load = async (): Promise<void> => {
    const r = await api.get<{ stages: Stage[] }>('/api/stages');
    setStages(r.stages);
    setLoading(false);
  };
  useEffect(() => { void load(); }, []);

  const add = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    const nome = novo.trim();
    if (!nome) return;
    try {
      const r = await api.post<{ stage: Stage }>('/api/stages', { nome });
      setStages((s) => [...s, r.stage]);
      setNovo('');
      flash(); toast.success(`Fase "${nome}" adicionada.`);
    } catch (e2) { toast.error(e2 instanceof Error ? e2.message : 'Não foi possível adicionar a fase.'); }
  };

  const rename = async (id: number, nome: string): Promise<void> => {
    const trimmed = nome.trim();
    if (!trimmed) return;
    try { await api.patch(`/api/stages/${id}`, { nome: trimmed }); setStages((s) => s.map((x) => (x.id === id ? { ...x, nome: trimmed } : x))); flash(); }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Não foi possível renomear.'); }
  };

  const remove = async (id: number): Promise<void> => {
    if (!confirm('Excluir esta fase? Os cards nela ficam sem etapa.')) return;
    try {
      await api.del(`/api/stages/${id}`);
      setStages((s) => s.filter((x) => x.id !== id));
      flash(); toast.success('Fase excluída.');
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Não foi possível excluir a fase.'); }
  };

  // Reorder by swapping with neighbor, then persist new ordem for the affected stages.
  const move = async (idx: number, dir: -1 | 1): Promise<void> => {
    const j = idx + dir;
    if (j < 0 || j >= stages.length) return;
    const next = [...stages];
    [next[idx], next[j]] = [next[j]!, next[idx]!];
    const renumbered = next.map((st, i) => ({ ...st, ordem: i + 1 }));
    setStages(renumbered);
    await Promise.all(
      renumbered
        .filter((st, i) => stages[i]?.id !== st.id || stages[i]?.ordem !== st.ordem)
        .map((st) => api.patch(`/api/stages/${st.id}`, { ordem: st.ordem })),
    );
    flash();
  };

  if (loading) return <Spinner />;

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-ink-900">Fases do funil</h3>
        {saved && <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-600"><Icon name="check" size={14} /> Salvo</span>}
      </div>
      <p className="mt-0.5 text-xs text-ink-400">Renomeie (Enter ou clique fora para salvar), reordene e exclua. Reflete direto na tela de Funil.</p>

      <ul className="mt-4 space-y-2">
        {stages.map((st, i) => (
          <li key={st.id} className="flex items-center gap-2 rounded-xl border border-ink-200/70 bg-ink-50 p-2">
            <span className="tabnums grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-white text-xs font-bold text-ink-400 shadow-card">
              {i + 1}
            </span>
            <input defaultValue={st.nome}
              onBlur={(e) => { if (e.target.value.trim() !== st.nome) void rename(st.id, e.target.value); }}
              onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
              className="min-w-0 flex-1 rounded-lg border border-transparent bg-white px-2 py-1.5 text-sm outline-none transition focus:border-brand-400 focus:ring-2 focus:ring-brand-200" />
            <div className="flex shrink-0 items-center gap-1">
              <button onClick={() => move(i, -1)} disabled={i === 0}
                className="grid h-7 w-7 place-items-center rounded-lg text-ink-500 hover:bg-white disabled:opacity-30" aria-label="Subir">
                <Icon name="arrowUp" size={15} />
              </button>
              <button onClick={() => move(i, 1)} disabled={i === stages.length - 1}
                className="grid h-7 w-7 place-items-center rounded-lg text-ink-500 hover:bg-white disabled:opacity-30" aria-label="Descer">
                <Icon name="arrowDown" size={15} />
              </button>
              <button onClick={() => remove(st.id)}
                className="grid h-7 w-7 place-items-center rounded-lg text-ink-300 hover:bg-rose-50 hover:text-rose-500" aria-label="Excluir">
                <Icon name="x" size={15} />
              </button>
            </div>
          </li>
        ))}
        {stages.length === 0 && <li className="py-4 text-center text-sm text-ink-400">Nenhuma fase. Adicione abaixo.</li>}
      </ul>

      <form onSubmit={add} className="mt-3 flex gap-2">
        <input value={novo} onChange={(e) => setNovo(e.target.value)} placeholder="Nova fase (ex.: Pós-venda)" className={cn(inputCls, 'flex-1')} />
        <Btn icon="plus" type="submit">Adicionar</Btn>
      </form>
    </Card>
  );
}

/* ── Empresas representadas (marcas/fornecedores do rep) ──── */
type EmpForm = { nome: string; cnpj: string; segmento: string; site: string; contato: string; notas: string };
const EMPTY: EmpForm = { nome: '', cnpj: '', segmento: '', site: '', contato: '', notas: '' };
const toForm = (e: RepresentedCompany): EmpForm => ({
  nome: e.nome, cnpj: e.cnpj ?? '', segmento: e.segmento ?? '', site: e.site ?? '', contato: e.contato ?? '', notas: e.notas ?? '',
});

function RepresentadasEditor({ inputCls }: { inputCls: string }): React.JSX.Element {
  const [list, setList] = useState<RepresentedCompany[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<number | 'new' | null>(null);

  const load = async (): Promise<void> => {
    const r = await api.get<{ empresas: RepresentedCompany[] }>('/api/represented');
    setList(r.empresas);
    setLoading(false);
  };
  useEffect(() => { void load(); }, []);

  const create = async (f: EmpForm): Promise<void> => {
    try {
      const r = await api.post<{ empresa: RepresentedCompany }>('/api/represented', normalize(f));
      setList((xs) => [...xs, r.empresa]);
      setEditing(null);
      toast.success('Representada criada.');
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Não foi possível criar.'); }
  };
  const update = async (id: number, f: EmpForm): Promise<void> => {
    try {
      const r = await api.patch<{ empresa: RepresentedCompany }>(`/api/represented/${id}`, normalize(f));
      setList((xs) => xs.map((x) => (x.id === id ? r.empresa : x)));
      setEditing(null);
      toast.success('Representada salva.');
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Não foi possível salvar.'); }
  };
  const toggleAtivo = async (e: RepresentedCompany): Promise<void> => {
    setList((xs) => xs.map((x) => (x.id === e.id ? { ...x, ativo: !x.ativo } : x)));
    try { await api.patch(`/api/represented/${e.id}`, { ativo: !e.ativo }); }
    catch { setList((xs) => xs.map((x) => (x.id === e.id ? { ...x, ativo: e.ativo } : x))); toast.error('Não foi possível atualizar.'); }
  };
  const remove = async (id: number): Promise<void> => {
    if (!confirm('Excluir esta empresa representada?')) return;
    const before = list;
    setList((xs) => xs.filter((x) => x.id !== id));
    try { await api.del(`/api/represented/${id}`); toast.success('Representada excluída.'); }
    catch { setList(before); toast.error('Não foi possível excluir.'); }
  };

  if (loading) return <Spinner />;

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-ink-900">Empresas representadas</h3>
          <p className="mt-0.5 text-xs text-ink-400">Marcas/fornecedores que você representa. Pode cadastrar várias.</p>
        </div>
        {editing !== 'new' && <Btn size="sm" icon="plus" onClick={() => setEditing('new')}>Nova</Btn>}
      </div>

      {editing === 'new' && (
        <div className="mt-4">
          <EmpresaForm inputCls={inputCls} initial={EMPTY} onSave={create} onCancel={() => setEditing(null)} />
        </div>
      )}

      <div className="mt-4 space-y-2">
        {list.length === 0 && editing !== 'new' && (
          <EmptyState icon="building" title="Nenhuma empresa cadastrada" hint="Adicione as marcas/fornecedores que você representa." />
        )}
        {list.map((e) => editing === e.id ? (
          <Card key={e.id} className="border-brand-200 bg-brand-50/40 p-3">
            <EmpresaForm inputCls={inputCls} initial={toForm(e)} onSave={(f) => update(e.id, f)} onCancel={() => setEditing(null)} />
            <div className="mt-3 border-t border-brand-200/60 pt-3">
              <BrandsEditor representedId={e.id} inputCls={inputCls} />
            </div>
          </Card>
        ) : (
          <div key={e.id} className={cn('flex items-start gap-3 rounded-xl border border-ink-200/70 bg-white p-3', !e.ativo && 'opacity-60')}>
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-ink-100 text-ink-500"><Icon name="building" size={18} /></span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <p className="truncate text-sm font-semibold text-ink-800">{e.nome}</p>
                {e.ativo ? <Badge tone="success">ativa</Badge> : <Badge tone="neutral">inativa</Badge>}
                {e.segmento && <Badge tone="brand">{e.segmento}</Badge>}
              </div>
              <p className="mt-0.5 truncate text-xs text-ink-400">
                {[e.cnpj, e.contato, e.site].filter(Boolean).join(' · ') || 'sem detalhes'}
              </p>
              {e.notas && <p className="mt-1 line-clamp-2 text-xs text-ink-500">{e.notas}</p>}
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <button onClick={() => void toggleAtivo(e)} title={e.ativo ? 'Desativar' : 'Ativar'}
                className="grid h-8 w-8 place-items-center rounded-lg text-ink-400 hover:bg-ink-100">
                <Icon name={e.ativo ? 'check' : 'x'} size={16} />
              </button>
              <button onClick={() => setEditing(e.id)} aria-label="Editar"
                className="grid h-8 w-8 place-items-center rounded-lg text-ink-400 hover:bg-ink-100"><Icon name="pencil" size={16} /></button>
              <button onClick={() => void remove(e.id)} aria-label="Excluir"
                className="grid h-8 w-8 place-items-center rounded-lg text-ink-300 hover:bg-rose-50 hover:text-rose-500"><Icon name="trash" size={16} /></button>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

function normalize(f: EmpForm): Record<string, string | null> {
  const t = (s: string): string | null => (s.trim() === '' ? null : s.trim());
  return { nome: f.nome.trim(), cnpj: t(f.cnpj), segmento: t(f.segmento), site: t(f.site), contato: t(f.contato), notas: t(f.notas) };
}

function EmpresaForm({ inputCls, initial, onSave, onCancel }: {
  inputCls: string; initial: EmpForm; onSave: (f: EmpForm) => void | Promise<void>; onCancel: () => void;
}): React.JSX.Element {
  const [f, setF] = useState<EmpForm>(initial);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof EmpForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF((p) => ({ ...p, [k]: e.target.value }));

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (!f.nome.trim()) return;
    setBusy(true);
    try { await onSave(f); } finally { setBusy(false); }
  };

  // Autopreenche a partir da base de empresas (RFB).
  const fillFrom = (c: CompanyHit): void => setF((p) => ({
    ...p,
    nome: c.nome_fantasia || c.razao_social,
    cnpj: c.cnpj ?? p.cnpj,
    contato: p.contato || c.telefone1 || c.email || '',
  }));

  return (
    <form onSubmit={submit} className="space-y-2.5">
      <CompanySearch onPick={fillFrom} placeholder="Buscar na base de empresas (CNPJ ou nome)…" />
      <input autoFocus value={f.nome} onChange={set('nome')} placeholder="Nome da empresa / marca *" className={inputCls} />
      <div className="grid gap-2.5 sm:grid-cols-2">
        <input value={f.segmento} onChange={set('segmento')} placeholder="Segmento (ex.: Calçados)" className={inputCls} />
        <input value={f.cnpj} inputMode="numeric" onChange={(e) => setF((p) => ({ ...p, cnpj: maskCNPJ(e.target.value) }))} placeholder="CNPJ" className={inputCls} />
        <input value={f.contato} onChange={set('contato')} placeholder="Contato (telefone/e-mail)" className={inputCls} />
        <input value={f.site} onChange={set('site')} placeholder="Site" className={inputCls} />
      </div>
      <textarea value={f.notas} onChange={set('notas')} placeholder="Notas (linha de produtos, comissão, etc.)" rows={2} className={cn(inputCls, 'resize-y')} />
      <div className="flex justify-end gap-2">
        <Btn variant="ghost" type="button" onClick={onCancel}>Cancelar</Btn>
        <Btn icon="check" type="submit" disabled={busy}>{busy ? '…' : 'Salvar'}</Btn>
      </div>
    </form>
  );
}

/* ── Marcas de uma empresa representada ────────────────────── */
function BrandsEditor({ representedId, inputCls }: { representedId: number; inputCls: string }): React.JSX.Element {
  const [brands, setBrands] = useState<Brand[]>([]);
  const [novo, setNovo] = useState('');

  useEffect(() => {
    void api.get<{ brands: Brand[] }>(`/api/brands?represented_id=${representedId}`)
      .then((r) => setBrands(r.brands)).catch(() => undefined);
  }, [representedId]);

  const add = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    const nome = novo.trim();
    if (!nome) return;
    const r = await api.post<{ brand: Brand }>('/api/brands', { represented_id: representedId, nome });
    setBrands((xs) => [...xs, r.brand]);
    setNovo('');
  };
  const remove = async (id: number): Promise<void> => {
    setBrands((xs) => xs.filter((x) => x.id !== id));
    await api.del(`/api/brands/${id}`);
  };

  return (
    <div>
      <p className="text-xs font-semibold text-ink-600">Marcas que esta empresa trabalha</p>
      <p className="mt-0.5 text-xs text-ink-400">Aparecem no dropdown "Marca" da prospecção.</p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {brands.map((b) => (
          <span key={b.id} className="inline-flex items-center gap-1 rounded-full bg-white px-2.5 py-1 text-xs font-medium text-ink-700 shadow-card">
            {b.nome}
            <button type="button" onClick={() => void remove(b.id)} className="text-ink-300 hover:text-rose-500" aria-label="Remover">
              <Icon name="x" size={13} />
            </button>
          </span>
        ))}
        {brands.length === 0 && <span className="text-xs text-ink-300">Nenhuma marca ainda.</span>}
      </div>
      <form onSubmit={add} className="mt-2 flex gap-2">
        <input value={novo} onChange={(e) => setNovo(e.target.value)} placeholder="Nova marca" className={cn(inputCls, 'flex-1')} />
        <Btn size="sm" icon="plus" type="submit">Add</Btn>
      </form>
    </div>
  );
}

/* ── Lista nome-só (cenários, ações) ──────────────────────── */
function NamedListEditor({ inputCls, path, titulo, desc, icon, placeholder }: {
  inputCls: string; path: 'scenarios' | 'actions'; titulo: string; desc: string; icon: IconName; placeholder: string;
}): React.JSX.Element {
  const [items, setItems] = useState<NamedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [novo, setNovo] = useState('');

  const load = async (): Promise<void> => {
    const r = await api.get<{ items: NamedItem[] }>(`/api/${path}`);
    setItems(r.items);
    setLoading(false);
  };
  useEffect(() => { void load(); }, []);

  const add = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    const nome = novo.trim();
    if (!nome) return;
    try {
      const r = await api.post<{ item: NamedItem }>(`/api/${path}`, { nome });
      setItems((xs) => [...xs, r.item]);
      setNovo('');
      toast.success('Item adicionado.');
    } catch (e2) { toast.error(e2 instanceof Error ? e2.message : 'Não foi possível adicionar.'); }
  };
  const rename = async (id: number, nome: string): Promise<void> => {
    const t = nome.trim();
    if (!t) return;
    try { await api.patch(`/api/${path}/${id}`, { nome: t }); setItems((xs) => xs.map((x) => (x.id === id ? { ...x, nome: t } : x))); }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Não foi possível renomear.'); }
  };
  const remove = async (id: number): Promise<void> => {
    if (!confirm('Excluir este item? Prospecções que o usavam ficam sem valor.')) return;
    const before = items;
    setItems((xs) => xs.filter((x) => x.id !== id));
    try { await api.del(`/api/${path}/${id}`); toast.success('Item excluído.'); }
    catch { setItems(before); toast.error('Não foi possível excluir.'); }
  };

  if (loading) return <Spinner />;

  return (
    <Card className="p-4">
      <h3 className="text-sm font-semibold text-ink-900">{titulo}</h3>
      <p className="mt-0.5 text-xs text-ink-400">{desc}</p>

      <ul className="mt-4 space-y-2">
        {items.map((it) => (
          <li key={it.id} className="flex items-center gap-2 rounded-xl border border-ink-200/70 bg-ink-50 p-2">
            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-white text-ink-400 shadow-card"><Icon name={icon} size={15} /></span>
            <input defaultValue={it.nome}
              onBlur={(e) => { if (e.target.value.trim() !== it.nome) void rename(it.id, e.target.value); }}
              onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
              className="min-w-0 flex-1 rounded-lg border border-transparent bg-white px-2 py-1.5 text-sm outline-none transition focus:border-brand-400 focus:ring-2 focus:ring-brand-200" />
            <button onClick={() => void remove(it.id)}
              className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-ink-300 hover:bg-rose-50 hover:text-rose-500" aria-label="Excluir">
              <Icon name="x" size={15} />
            </button>
          </li>
        ))}
        {items.length === 0 && <li className="py-4 text-center text-sm text-ink-400">Nada cadastrado. Adicione abaixo.</li>}
      </ul>

      <form onSubmit={add} className="mt-3 flex gap-2">
        <input value={novo} onChange={(e) => setNovo(e.target.value)} placeholder={placeholder} className={cn(inputCls, 'flex-1')} />
        <Btn icon="plus" type="submit">Adicionar</Btn>
      </form>
    </Card>
  );
}

/* ── Contatos ──────────────────────────────────────────────── */
type ContactForm = { nome: string; cargo: string; email: string; telefone: string; represented_id: string };
const EMPTY_CONTACT: ContactForm = { nome: '', cargo: '', email: '', telefone: '', represented_id: '' };
const toContactForm = (c: Contact): ContactForm => ({
  nome: c.nome, cargo: c.cargo ?? '', email: c.email ?? '', telefone: c.telefone ?? '',
  represented_id: c.represented_id != null ? String(c.represented_id) : '',
});
function contactBody(f: ContactForm): Record<string, unknown> {
  const t = (s: string): string | null => (s.trim() === '' ? null : s.trim());
  return {
    nome: f.nome.trim(), cargo: t(f.cargo), email: t(f.email), telefone: t(f.telefone),
    represented_id: f.represented_id === '' ? null : Number(f.represented_id),
  };
}

function ContatosEditor({ inputCls }: { inputCls: string }): React.JSX.Element {
  const [list, setList] = useState<Contact[]>([]);
  const [reps, setReps] = useState<RepresentedCompany[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<number | 'new' | null>(null);

  const load = async (): Promise<void> => {
    const [c, r] = await Promise.all([
      api.get<{ contacts: Contact[] }>('/api/contacts'),
      api.get<{ empresas: RepresentedCompany[] }>('/api/represented'),
    ]);
    setList(c.contacts);
    setReps(r.empresas);
    setLoading(false);
  };
  useEffect(() => { void load(); }, []);

  const repName = (id: number | null): string | null => reps.find((r) => r.id === id)?.nome ?? null;

  const create = async (f: ContactForm): Promise<void> => {
    try {
      const r = await api.post<{ contact: Contact }>('/api/contacts', contactBody(f));
      setList((xs) => [...xs, r.contact]);
      setEditing(null);
      toast.success('Contato criado.');
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Não foi possível criar o contato.'); }
  };
  const update = async (id: number, f: ContactForm): Promise<void> => {
    try {
      const r = await api.patch<{ contact: Contact }>(`/api/contacts/${id}`, contactBody(f));
      setList((xs) => xs.map((x) => (x.id === id ? r.contact : x)));
      setEditing(null);
      toast.success('Contato salvo.');
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Não foi possível salvar o contato.'); }
  };
  const remove = async (id: number): Promise<void> => {
    if (!confirm('Excluir este contato?')) return;
    const before = list;
    setList((xs) => xs.filter((x) => x.id !== id));
    try { await api.del(`/api/contacts/${id}`); toast.success('Contato excluído.'); }
    catch { setList(before); toast.error('Não foi possível excluir o contato.'); }
  };

  if (loading) return <Spinner />;

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-ink-900">Contatos</h3>
          <p className="mt-0.5 text-xs text-ink-400">Pessoas que você pode vincular na prospecção. Contatos de uma empresa-cliente também podem ser criados direto no funil.</p>
        </div>
        {editing !== 'new' && <Btn size="sm" icon="plus" onClick={() => setEditing('new')}>Novo</Btn>}
      </div>

      {editing === 'new' && (
        <div className="mt-4"><ContatoForm inputCls={inputCls} reps={reps} initial={EMPTY_CONTACT} onSave={create} onCancel={() => setEditing(null)} /></div>
      )}

      <div className="mt-4 space-y-2">
        {list.length === 0 && editing !== 'new' && (
          <EmptyState icon="users" title="Nenhum contato" hint="Cadastre pessoas para selecionar na prospecção." />
        )}
        {list.map((c) => editing === c.id ? (
          <Card key={c.id} className="border-brand-200 bg-brand-50/40 p-3">
            <ContatoForm inputCls={inputCls} reps={reps} initial={toContactForm(c)} onSave={(f) => update(c.id, f)} onCancel={() => setEditing(null)} />
          </Card>
        ) : (
          <div key={c.id} className="flex items-start gap-3 rounded-xl border border-ink-200/70 bg-white p-3">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-ink-100 text-ink-500"><Icon name="users" size={18} /></span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <p className="truncate text-sm font-semibold text-ink-800">{c.nome}</p>
                {c.cargo && <Badge tone="neutral">{c.cargo}</Badge>}
                {repName(c.represented_id) && <Badge tone="brand">{repName(c.represented_id)}</Badge>}
              </div>
              <p className="mt-0.5 truncate text-xs text-ink-400">{[c.email, c.telefone].filter(Boolean).join(' · ') || 'sem contato'}</p>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <button onClick={() => setEditing(c.id)} aria-label="Editar"
                className="grid h-8 w-8 place-items-center rounded-lg text-ink-400 hover:bg-ink-100"><Icon name="pencil" size={16} /></button>
              <button onClick={() => void remove(c.id)} aria-label="Excluir"
                className="grid h-8 w-8 place-items-center rounded-lg text-ink-300 hover:bg-rose-50 hover:text-rose-500"><Icon name="trash" size={16} /></button>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

function ContatoForm({ inputCls, reps, initial, onSave, onCancel }: {
  inputCls: string; reps: RepresentedCompany[]; initial: ContactForm;
  onSave: (f: ContactForm) => void | Promise<void>; onCancel: () => void;
}): React.JSX.Element {
  const [f, setF] = useState<ContactForm>(initial);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof ContactForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF((p) => ({ ...p, [k]: e.target.value }));

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (!f.nome.trim()) return;
    setBusy(true);
    try { await onSave(f); } finally { setBusy(false); }
  };

  return (
    <form onSubmit={submit} className="space-y-2.5">
      <input autoFocus value={f.nome} onChange={set('nome')} placeholder="Nome *" className={inputCls} />
      <div className="grid gap-2.5 sm:grid-cols-2">
        <input value={f.cargo} onChange={set('cargo')} placeholder="Cargo (ex.: Comprador)" className={inputCls} />
        <select value={f.represented_id} onChange={set('represented_id')} className={inputCls}>
          <option value="">Representada (opcional)</option>
          {reps.map((r) => <option key={r.id} value={r.id}>{r.nome}</option>)}
        </select>
        <input value={f.email} onChange={set('email')} placeholder="E-mail" className={inputCls} />
        <input value={f.telefone} inputMode="tel" onChange={(e) => setF((p) => ({ ...p, telefone: maskPhone(e.target.value) }))} placeholder="Telefone" className={inputCls} />
      </div>
      <div className="flex justify-end gap-2">
        <Btn variant="ghost" type="button" onClick={onCancel}>Cancelar</Btn>
        <Btn icon="check" type="submit" disabled={busy}>{busy ? '…' : 'Salvar'}</Btn>
      </div>
    </form>
  );
}
