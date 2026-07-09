import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, setToken, getToken } from './api.ts';
import { clearQueue } from './offline.ts';

export interface User {
  id: number | string;
  email: string;
  nome?: string | null;
  role: string;
  org_id: number | string;
  org_nome?: string;
  must_change_password?: boolean;
  // RBAC fino: grupo do usuário. is_admin = bypass total; permissions = códigos
  // do catálogo concedidos pelo grupo.
  group_id?: number | string | null;
  group_nome?: string | null;
  is_admin?: boolean;
  permissions?: string[];
}

interface AuthState {
  user: User | null;
  loading: boolean;
  login: (email: string, senha: string) => Promise<void>;
  register: (org_nome: string, email: string, senha: string) => Promise<void>;
  refresh: () => Promise<void>;
  logout: () => void;
  // true se o usuário pode executar a ação (admin faz bypass).
  can: (code: string) => boolean;
}

const AuthCtx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!getToken()) { setLoading(false); return; }
    const ac = new AbortController();
    api.get<{ user: User }>('/api/auth/me', { signal: ac.signal })
      .then((r) => setUser(r.user))
      .catch((e) => { if (!ac.signal.aborted) setToken(null); void e; })
      .finally(() => { if (!ac.signal.aborted) setLoading(false); });
    return () => ac.abort();
  }, []);

  const login = useCallback(async (email: string, senha: string): Promise<void> => {
    const r = await api.post<{ token: string; user: User }>('/api/auth/login', { email, senha });
    setToken(r.token);
    setUser(r.user);
  }, []);

  const register = useCallback(async (org_nome: string, email: string, senha: string): Promise<void> => {
    const r = await api.post<{ token: string; user: User }>('/api/auth/register', { org_nome, email, senha });
    setToken(r.token);
    setUser(r.user);
  }, []);

  // Recarrega o usuário do servidor (ex.: após trocar a senha provisória).
  const refresh = useCallback(async (): Promise<void> => {
    const r = await api.get<{ user: User }>('/api/auth/me');
    setUser(r.user);
  }, []);

  const logout = useCallback((): void => {
    setToken(null);
    setUser(null);
    // Limpa a fila offline antes de sair: em dispositivo compartilhado a próxima
    // conta não pode reenviar ações de campo enfileiradas por este usuário.
    void clearQueue();
    // Limpa também os caches de resposta da API do service worker (agenda/rotas):
    // sem isso, em dispositivo compartilhado o próximo usuário leria dados do
    // anterior via cache offline. Best-effort — não bloqueia o logout.
    if (typeof caches !== 'undefined') {
      void caches.keys().then((keys) => Promise.all(
        keys.filter((k) => k.startsWith('rs-api')).map((k) => caches.delete(k)),
      )).catch(() => undefined);
    }
    location.href = '/login';
  }, []);

  const can = useCallback((code: string): boolean =>
    !!user && (user.is_admin === true || (user.permissions?.includes(code) ?? false)), [user]);

  // Valor memoizado: sem isso todo render do provider re-renderiza a árvore
  // inteira de consumidores do contexto.
  const value = useMemo<AuthState>(
    () => ({ user, loading, login, register, refresh, logout, can }),
    [user, loading, login, register, refresh, logout, can],
  );

  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthCtx);
  if (!ctx) throw new Error('useAuth fora do AuthProvider');
  return ctx;
}

// Variante que não lança quando renderizado fora do AuthProvider (ex.: páginas
// montadas isoladas em testes). Devolve só o usuário, ou null.
export function useOptionalUser(): User | null {
  return useContext(AuthCtx)?.user ?? null;
}
