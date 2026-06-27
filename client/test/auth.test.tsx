// AuthProvider: hidratação via /api/auth/me, login/register/refresh/logout.
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import { AuthProvider, useAuth } from '../src/lib/auth.tsx';
import { setToken, getToken } from '../src/lib/api.ts';

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);
afterAll(() => vi.unstubAllGlobals());

const resp = (status: number, body: unknown): Response => ({
  ok: status < 300, status, text: async () => JSON.stringify(body),
} as unknown as Response);

const USER = { id: 1, email: 'a@b.c', role: 'admin', org_id: 1 };

let ctx: ReturnType<typeof useAuth>;
function Probe(): React.JSX.Element {
  ctx = useAuth();
  return <div>{ctx.loading ? 'loading' : ctx.user ? `user:${ctx.user.email}` : 'anon'}</div>;
}

const mount = (): ReturnType<typeof render> =>
  render(<AuthProvider><Probe /></AuthProvider>);

beforeEach(() => {
  fetchMock.mockReset();
  setToken(null);
});

describe('AuthProvider', () => {
  it('sem token: não chama /me e termina anônimo', async () => {
    mount();
    await waitFor(() => expect(screen.getByText('anon')).toBeInTheDocument());
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('com token válido: hidrata o usuário', async () => {
    setToken('tok');
    fetchMock.mockResolvedValueOnce(resp(200, { user: USER }));
    mount();
    await waitFor(() => expect(screen.getByText('user:a@b.c')).toBeInTheDocument());
  });

  it('com token inválido: limpa o token e fica anônimo', async () => {
    setToken('podre');
    fetchMock.mockResolvedValueOnce(resp(401, { error: 'x' }));
    mount();
    await waitFor(() => expect(screen.getByText('anon')).toBeInTheDocument());
    expect(getToken()).toBeNull();
  });

  it('login e register guardam token e usuário; refresh atualiza', async () => {
    mount();
    await waitFor(() => expect(screen.getByText('anon')).toBeInTheDocument());

    fetchMock.mockResolvedValueOnce(resp(200, { token: 't1', user: USER }));
    await act(() => ctx.login('a@b.c', 'senha123'));
    expect(getToken()).toBe('t1');
    expect(screen.getByText('user:a@b.c')).toBeInTheDocument();

    fetchMock.mockResolvedValueOnce(resp(200, { user: { ...USER, email: 'novo@b.c' } }));
    await act(() => ctx.refresh());
    expect(screen.getByText('user:novo@b.c')).toBeInTheDocument();

    setToken(null);
    fetchMock.mockResolvedValueOnce(resp(201, { token: 't2', user: USER }));
    await act(() => ctx.register('Org', 'a@b.c', 'senha123'));
    expect(getToken()).toBe('t2');
  });

  it('logout limpa token e usuário', async () => {
    setToken('tok');
    fetchMock.mockResolvedValueOnce(resp(200, { user: USER }));
    mount();
    await waitFor(() => expect(screen.getByText('user:a@b.c')).toBeInTheDocument());
    act(() => ctx.logout()); // jsdom não navega (location.href), mas o estado limpa
    expect(getToken()).toBeNull();
  });
});
