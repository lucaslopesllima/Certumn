import { useEffect, useState } from 'react';
import { api } from './api.ts';
import { useOptionalUser } from './auth.tsx';
import type { OrgUser } from './types.ts';

// Lista de vendedores da org (Fase 3) — só admin tem acesso a /api/users.
// Para rep retorna lista vazia: os componentes de filtro por vendedor só
// aparecem para admin (a API já restringe a visão do rep à própria carteira).
export function useSellers(): OrgUser[] {
  const user = useOptionalUser();
  const [users, setUsers] = useState<OrgUser[]>([]);
  useEffect(() => {
    if (user?.role !== 'admin') { setUsers([]); return; }
    void api.get<{ users: OrgUser[] }>('/api/users')
      .then((r) => setUsers(r.users.filter((u) => u.ativo)))
      .catch(() => undefined);
  }, [user?.role]);
  return users;
}

export const sellerLabel = (u: OrgUser): string => u.nome ?? u.email;

// Dropdown "Todos os vendedores / <vendedor>" — só renderiza para admin com
// equipe (>1 usuário). value 'todos' = sem filtro.
export function SellerFilter({ value, onChange, sellers }: {
  value: 'todos' | number;
  onChange: (v: 'todos' | number) => void;
  sellers: OrgUser[];
}): React.JSX.Element | null {
  const user = useOptionalUser();
  if (user?.role !== 'admin' || sellers.length <= 1) return null;
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value === 'todos' ? 'todos' : Number(e.target.value))}
      aria-label="Filtrar por vendedor"
      className="rounded-lg border border-ink-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-ink-600 outline-none focus:border-brand-400"
    >
      <option value="todos">Todos os vendedores</option>
      {sellers.map((u) => <option key={u.id} value={u.id}>{sellerLabel(u)}</option>)}
    </select>
  );
}
