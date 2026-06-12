import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiError } from '../lib/api.ts';
import { useAuth } from '../lib/auth.tsx';
import { Btn, Card } from '../lib/ui.tsx';
import { Icon } from '../lib/icons.tsx';

const inputCls = 'mt-1 w-full rounded-xl border border-ink-200 bg-white px-3 py-2.5 text-sm text-ink-900 outline-none transition focus:border-brand-400 focus:ring-2 focus:ring-brand-200';

// Tela bloqueante do primeiro acesso: usuário criado pelo admin entra com a
// senha provisória e só segue depois de definir a senha definitiva.
export function ChangePassword(): React.JSX.Element {
  const { user, refresh, logout } = useAuth();
  const navigate = useNavigate();
  const [atual, setAtual] = useState('');
  const [nova, setNova] = useState('');
  const [conf, setConf] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setErr('');
    if (nova.length < 6) { setErr('A nova senha precisa de ao menos 6 caracteres.'); return; }
    if (nova !== conf) { setErr('A confirmação não confere.'); return; }
    setBusy(true);
    try {
      await api.post('/api/account/password', { senha_atual: atual, nova_senha: nova });
      await refresh();
      navigate('/', { replace: true });
    } catch (e2) {
      setErr(e2 instanceof ApiError ? e2.message : 'Erro ao trocar a senha');
    } finally { setBusy(false); }
  };

  return (
    <div className="grid min-h-dvh place-items-center bg-ink-50 p-4">
      <Card className="w-full max-w-sm p-6">
        <span className="grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-brand-400 to-brand-600 text-white shadow-sm shadow-brand-600/30">
          <Icon name="target" size={20} />
        </span>
        <h1 className="mt-4 text-lg font-bold tracking-tight text-ink-900">Defina sua senha</h1>
        <p className="mt-1 text-sm text-ink-500">
          Olá{user?.nome ? `, ${user.nome}` : ''}! Sua senha atual é provisória — escolha uma definitiva para continuar.
        </p>
        <form onSubmit={submit} className="mt-5 space-y-3">
          <label className="block">
            <span className="text-xs font-semibold text-ink-600">Senha provisória</span>
            <input type="password" value={atual} onChange={(e) => setAtual(e.target.value)} required className={inputCls} />
          </label>
          <label className="block">
            <span className="text-xs font-semibold text-ink-600">Nova senha</span>
            <input type="password" value={nova} onChange={(e) => setNova(e.target.value)} required minLength={6} className={inputCls} />
          </label>
          <label className="block">
            <span className="text-xs font-semibold text-ink-600">Confirmar nova senha</span>
            <input type="password" value={conf} onChange={(e) => setConf(e.target.value)} required className={inputCls} />
          </label>
          {err && <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-600">{err}</p>}
          <Btn type="submit" disabled={busy} className="w-full">{busy ? '…' : 'Salvar e continuar'}</Btn>
          <button type="button" onClick={logout} className="w-full text-center text-xs text-ink-400 hover:text-ink-600">
            Sair
          </button>
        </form>
      </Card>
    </div>
  );
}
