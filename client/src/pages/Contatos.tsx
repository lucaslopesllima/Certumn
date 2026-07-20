import { useEffect, useState } from 'react';
import { api } from '../lib/api.ts';
import type { CompanyHit, Contact, RepresentedCompany } from '../lib/types.ts';
import { Badge, Btn, Card, EmptyState, PageHeader, SafeButton, Spinner } from '../lib/ui.tsx';
import { Icon } from '../lib/icons.tsx';
import { useAuth } from '../lib/auth.tsx';
import { CompanySearch } from '../lib/companySearch.tsx';
import { toast } from '../lib/toast.tsx';
import { isEmail, maskPhone } from '../lib/format.ts';
import { confirmDialog } from '../lib/confirm.ts';

const inputCls = 'w-full rounded-xl border border-ink-200 bg-surface px-3 py-2.5 text-sm text-ink-800 outline-none transition focus:border-brand-400 focus:ring-2 focus:ring-brand-200';

type ContactForm = {
  nome: string; cargo: string; email: string; telefone: string; represented_id: string;
  company_id: number | null; company_name: string | null;
};
const EMPTY_CONTACT: ContactForm = { nome: '', cargo: '', email: '', telefone: '', represented_id: '', company_id: null, company_name: null };
const toContactForm = (c: Contact): ContactForm => ({
  nome: c.nome, cargo: c.cargo ?? '', email: c.email ?? '', telefone: c.telefone ?? '',
  represented_id: c.represented_id != null ? String(c.represented_id) : '',
  company_id: c.company_id ?? null, company_name: c.company_name ?? null,
});
function contactBody(f: ContactForm): Record<string, unknown> {
  const t = (s: string): string | null => (s.trim() === '' ? null : s.trim());
  return {
    nome: f.nome.trim(), cargo: t(f.cargo), email: t(f.email), telefone: t(f.telefone),
    represented_id: f.represented_id === '' ? null : Number(f.represented_id),
    company_id: f.company_id,
  };
}

export function Contatos(): React.JSX.Element {
  const { can } = useAuth();
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
    if (!(await confirmDialog('Excluir este contato?'))) return;
    const before = list;
    setList((xs) => xs.filter((x) => x.id !== id));
    try { await api.del(`/api/contacts/${id}`); toast.success('Contato excluído.'); }
    catch { setList(before); toast.error('Não foi possível excluir o contato.'); }
  };

  return (
    <div className="space-y-4 p-4 sm:p-6">
      <PageHeader title="Contatos" subtitle="Pessoas que você pode vincular na prospecção. Contatos de uma empresa-cliente também podem ser criados direto no funil."
        actions={can('contacts.create') && editing !== 'new' ? <Btn size="sm" icon="plus" onClick={() => setEditing('new')}>Novo</Btn> : undefined} />

      {loading ? <Spinner /> : (
        <Card className="p-4">
          {editing === 'new' && (
            <ContatoForm inputCls={inputCls} reps={reps} initial={EMPTY_CONTACT} onSave={create} onCancel={() => setEditing(null)} />
          )}

          <div className={editing === 'new' ? 'mt-4 space-y-2' : 'space-y-2'}>
            {list.length === 0 && editing !== 'new' && (
              <EmptyState icon="users" title="Nenhum contato" hint="Cadastre pessoas para selecionar na prospecção." />
            )}
            {list.map((c) => editing === c.id ? (
              <Card key={c.id} className="border-brand-200 bg-brand-50/40 p-3">
                <ContatoForm inputCls={inputCls} reps={reps} initial={toContactForm(c)} onSave={(f) => update(c.id, f)} onCancel={() => setEditing(null)} />
              </Card>
            ) : (
              <div key={c.id} className="flex items-start gap-3 rounded-xl border border-ink-200/70 bg-surface p-3">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-ink-100 text-ink-500"><Icon name="users" size={18} /></span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <p className="truncate text-sm font-semibold text-ink-800">{c.nome}</p>
                    {c.cargo && <Badge tone="neutral">{c.cargo}</Badge>}
                    {c.company_name && <Badge tone="neutral"><Icon name="building" size={12} />{c.company_name}</Badge>}
                    {repName(c.represented_id) && <Badge tone="brand">{repName(c.represented_id)}</Badge>}
                  </div>
                  <p className="mt-0.5 truncate text-xs text-ink-400">{[c.email, c.telefone].filter(Boolean).join(' · ') || 'sem contato'}</p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {can('contacts.update') && (
                    <button onClick={() => setEditing(c.id)} aria-label="Editar"
                      className="grid h-8 w-8 place-items-center rounded-lg text-ink-400 hover:bg-ink-100"><Icon name="pencil" size={16} /></button>
                  )}
                  {can('contacts.delete') && (
                    <SafeButton onClick={() => remove(c.id)} aria-label="Excluir"
                      className="grid h-8 w-8 place-items-center rounded-lg text-ink-300 hover:bg-rose-50 hover:text-rose-500"><Icon name="trash" size={16} /></SafeButton>
                  )}
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
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
    if (f.email.trim() && !isEmail(f.email)) { toast.error('E-mail inválido.'); return; }
    setBusy(true);
    try { await onSave(f); } finally { setBusy(false); }
  };

  const pickCompany = (c: CompanyHit): void =>
    setF((p) => ({ ...p, company_id: c.id, company_name: c.nome_fantasia || c.razao_social }));
  const clearCompany = (): void => setF((p) => ({ ...p, company_id: null, company_name: null }));

  return (
    <form onSubmit={submit} className="space-y-2.5">
      <input autoFocus value={f.nome} onChange={set('nome')} maxLength={120} placeholder="Nome *" className={inputCls} />
      <div className="grid gap-2.5 sm:grid-cols-2">
        <input value={f.cargo} onChange={set('cargo')} maxLength={120} placeholder="Cargo (ex.: Comprador)" className={inputCls} />
        <select value={f.represented_id} onChange={set('represented_id')} className={inputCls}>
          <option value="">Representada (opcional)</option>
          {reps.map((r) => <option key={r.id} value={r.id}>{r.nome}</option>)}
        </select>
        <input type="email" value={f.email} onChange={set('email')} maxLength={160} placeholder="E-mail" className={inputCls} />
        <input value={f.telefone} inputMode="tel" onChange={(e) => setF((p) => ({ ...p, telefone: maskPhone(e.target.value) }))} placeholder="Telefone" className={inputCls} />
      </div>
      <div>
        {f.company_id != null ? (
          <div className="flex items-center gap-2 rounded-xl border border-ink-200 bg-ink-50/50 px-3 py-2">
            <Icon name="building" size={16} className="shrink-0 text-ink-400" />
            <span className="min-w-0 flex-1 truncate text-sm text-ink-800">{f.company_name ?? `Empresa #${f.company_id}`}</span>
            <button type="button" onClick={clearCompany} aria-label="Remover empresa"
              className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-ink-400 hover:bg-ink-100"><Icon name="x" size={15} /></button>
          </div>
        ) : (
          <CompanySearch onPick={pickCompany} placeholder="Empresa-prospect (opcional) — buscar por CNPJ ou nome…" />
        )}
      </div>
      <div className="flex justify-end gap-2">
        <Btn variant="ghost" type="button" onClick={onCancel}>Cancelar</Btn>
        <Btn icon="check" type="submit" disabled={busy}>{busy ? '…' : 'Salvar'}</Btn>
      </div>
    </form>
  );
}
