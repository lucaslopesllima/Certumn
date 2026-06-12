import { useEffect, useState } from 'react';
import { api, ApiError } from '../lib/api.ts';
import { useAuth } from '../lib/auth.tsx';
import { Badge, Btn, Card, EmptyState, PageHeader, Spinner, cn } from '../lib/ui.tsx';

interface OrgUser {
  id: number;
  nome: string | null;
  email: string;
  role: 'admin' | 'rep';
  ativo: boolean;
  must_change_password: boolean;
}

const inputCls = 'w-full rounded-xl border border-ink-200 bg-white px-3 py-2.5 text-sm text-ink-800 outline-none transition focus:border-brand-400 focus:ring-2 focus:ring-brand-200';

function Field({ label, children }: { label: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-ink-500">{label}</span>
      {children}
    </label>
  );
}

export function Team(): React.JSX.Element {
  const { user: me } = useAuth();
  const [users, setUsers] = useState<OrgUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  // form de criação
  const [showForm, setShowForm] = useState(false);
  const [nome, setNome] = useState('');
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [role, setRole] = useState<'rep' | 'admin'>('rep');
  const [busy, setBusy] = useState(false);

  const load = async (): Promise<void> => {
    try {
      const r = await api.get<{ users: OrgUser[] }>('/api/users');
      setUsers(r.users);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Erro ao carregar equipe');
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { void load(); }, []);

  const create = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setBusy(true); setErr('');
    try {
      await api.post('/api/users', { nome: nome.trim(), email: email.trim(), senha, role });
      setNome(''); setEmail(''); setSenha(''); setRole('rep'); setShowForm(false);
      await load();
    } catch (e2) {
      setErr(e2 instanceof ApiError ? e2.message : 'Erro ao criar usuário');
    } finally { setBusy(false); }
  };

  const patch = async (id: number, body: Partial<Pick<OrgUser, 'role' | 'ativo'>>): Promise<void> => {
    setErr('');
    try {
      await api.patch(`/api/users/${id}`, body);
      await load();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Erro ao atualizar usuário');
    }
  };

  const resetPwd = async (u: OrgUser): Promise<void> => {
    const senha2 = window.prompt(`Nova senha provisória para ${u.nome ?? u.email} (mín. 6 caracteres):`);
    if (!senha2) return;
    setErr('');
    try {
      await api.post(`/api/users/${u.id}/password`, { senha: senha2 });
      await load();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Erro ao redefinir senha');
    }
  };

  if (loading) return <div className="p-6"><Spinner /></div>;

  return (
    <div className="space-y-5 p-4 sm:p-6">
      <PageHeader
        title="Equipe"
        subtitle="Vendedores e administradores da sua organização."
        actions={<Btn icon="plus" onClick={() => setShowForm((v) => !v)}>Novo usuário</Btn>}
      />

      {err && <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-600">{err}</p>}

      {showForm && (
        <Card className="max-w-2xl p-4">
          <h3 className="text-sm font-semibold text-ink-900">Novo usuário</h3>
          <p className="mt-0.5 text-xs text-ink-400">
            Informe uma senha provisória — o usuário será obrigado a trocá-la no primeiro acesso.
          </p>
          <form onSubmit={create} className="mt-4 grid gap-3 sm:grid-cols-2">
            <Field label="Nome"><input value={nome} onChange={(e) => setNome(e.target.value)} required className={inputCls} /></Field>
            <Field label="E-mail"><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required className={inputCls} /></Field>
            <Field label="Senha provisória"><input type="text" value={senha} onChange={(e) => setSenha(e.target.value)} required minLength={6} className={inputCls} /></Field>
            <Field label="Papel">
              <select value={role} onChange={(e) => setRole(e.target.value as 'rep' | 'admin')} className={inputCls}>
                <option value="rep">Vendedor</option>
                <option value="admin">Administrador</option>
              </select>
            </Field>
            <div className="flex gap-2 sm:col-span-2">
              <Btn type="submit" disabled={busy}>{busy ? '…' : 'Criar usuário'}</Btn>
              <Btn type="button" variant="ghost" onClick={() => setShowForm(false)}>Cancelar</Btn>
            </div>
          </form>
        </Card>
      )}

      <Card className="overflow-x-auto">
        {users.length === 0 ? (
          <EmptyState icon="users" title="Nenhum usuário" hint="Crie o primeiro vendedor da sua equipe." />
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-ink-100 text-left text-xs font-semibold uppercase tracking-wide text-ink-400">
                <th className="px-4 py-3">Nome</th>
                <th className="px-4 py-3">E-mail</th>
                <th className="px-4 py-3">Papel</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Ações</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => {
                const self = u.id === Number(me?.id);
                return (
                  <tr key={u.id} className={cn('border-b border-ink-50 last:border-0', !u.ativo && 'opacity-60')}>
                    <td className="px-4 py-3 font-medium text-ink-900">
                      {u.nome ?? '—'}{self && <span className="ml-1.5 text-xs font-normal text-ink-400">(você)</span>}
                    </td>
                    <td className="px-4 py-3 text-ink-600">{u.email}</td>
                    <td className="px-4 py-3">
                      <select
                        value={u.role}
                        disabled={self}
                        onChange={(e) => void patch(u.id, { role: e.target.value as 'admin' | 'rep' })}
                        className="rounded-lg border border-ink-200 bg-white px-2 py-1 text-xs disabled:cursor-not-allowed disabled:bg-ink-50"
                      >
                        <option value="rep">Vendedor</option>
                        <option value="admin">Administrador</option>
                      </select>
                    </td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center gap-1.5">
                        <Badge tone={u.ativo ? 'success' : 'neutral'}>{u.ativo ? 'Ativo' : 'Desativado'}</Badge>
                        {u.must_change_password && <Badge tone="warn">Senha provisória</Badge>}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className="inline-flex gap-1.5">
                        {!self && (
                          <Btn size="sm" variant="ghost" onClick={() => void resetPwd(u)}>Redefinir senha</Btn>
                        )}
                        {!self && (
                          <Btn size="sm" variant={u.ativo ? 'danger' : 'soft'}
                            onClick={() => void patch(u.id, { ativo: !u.ativo })}>
                            {u.ativo ? 'Desativar' : 'Reativar'}
                          </Btn>
                        )}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
