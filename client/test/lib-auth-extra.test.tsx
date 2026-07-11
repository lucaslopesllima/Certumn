// Fecha gaps de auth.tsx: logout (limpa caches do SW + fila offline), can(),
// isOffice e useOptionalUser fora do provider.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';

const apiMock = vi.hoisted(() => ({
  get: vi.fn(), post: vi.fn(), setToken: vi.fn(), getToken: vi.fn(),
  ApiError: class ApiError extends Error { constructor(public status: number, m: string) { super(m); } },
}));
vi.mock('../src/lib/api.ts', () => ({
  api: { get: apiMock.get, post: apiMock.post },
  setToken: apiMock.setToken, getToken: apiMock.getToken, ApiError: apiMock.ApiError,
}));
vi.mock('../src/lib/offline.ts', () => ({ clearQueue: vi.fn() }));

import { AuthProvider, useAuth, useOptionalUser } from '../src/lib/auth.tsx';

function Probe(): React.JSX.Element {
  const { user, can, isOffice, logout } = useAuth();
  return (
    <div>
      <span data-testid="u">{user?.nome ?? 'none'}</span>
      <span data-testid="can">{String(can('finance.view'))}</span>
      <span data-testid="office">{String(isOffice)}</span>
      <button onClick={logout}>sair</button>
    </div>
  );
}

beforeEach(() => {
  apiMock.get.mockReset(); apiMock.post.mockReset();
  apiMock.getToken.mockReset().mockReturnValue('tok');
  apiMock.setToken.mockReset();
  localStorage.clear();
});

describe('auth — sessão e logout', () => {
  it('admin: can=true, isOffice=true; logout limpa caches do SW', async () => {
    apiMock.get.mockResolvedValueOnce({ user: { id: 1, nome: 'Adm', is_admin: true, permissions: [], tipo_conta: 'escritorio' } });
    const cachesDelete = vi.fn(async () => true);
    vi.stubGlobal('caches', { keys: vi.fn(async () => ['rs-api-v1', 'outro-cache']), delete: cachesDelete });

    render(<AuthProvider><Probe /></AuthProvider>);
    await waitFor(() => expect(screen.getByTestId('u').textContent).toBe('Adm'));
    expect(screen.getByTestId('can').textContent).toBe('true');   // admin bypassa
    expect(screen.getByTestId('office').textContent).toBe('true');

    act(() => { fireEvent.click(screen.getByText('sair')); });
    expect(apiMock.setToken).toHaveBeenCalledWith(null);
    await waitFor(() => expect(cachesDelete).toHaveBeenCalledWith('rs-api-v1'));
    expect(cachesDelete).not.toHaveBeenCalledWith('outro-cache');
    expect(screen.getByTestId('u').textContent).toBe('none');
    vi.unstubAllGlobals();
  });

  it('não-admin: can por permissão; conta individual → isOffice=false', async () => {
    apiMock.get.mockResolvedValueOnce({ user: { id: 2, nome: 'Rep', is_admin: false, permissions: ['finance.view'], tipo_conta: 'individual' } });
    render(<AuthProvider><Probe /></AuthProvider>);
    await waitFor(() => expect(screen.getByTestId('u').textContent).toBe('Rep'));
    expect(screen.getByTestId('can').textContent).toBe('true');    // tem a permissão
    expect(screen.getByTestId('office').textContent).toBe('false'); // individual
  });

  it('logout sem Cache API disponível não quebra', async () => {
    apiMock.get.mockResolvedValueOnce({ user: { id: 3, nome: 'X', is_admin: true, permissions: [] } });
    // @ts-expect-error força ausência da Cache API
    delete globalThis.caches;
    render(<AuthProvider><Probe /></AuthProvider>);
    await waitFor(() => expect(screen.getByTestId('u').textContent).toBe('X'));
    act(() => { fireEvent.click(screen.getByText('sair')); });
    expect(screen.getByTestId('u').textContent).toBe('none');
  });
});

describe('useOptionalUser', () => {
  it('devolve null fora do AuthProvider', () => {
    function P(): React.JSX.Element { return <span data-testid="o">{String(useOptionalUser())}</span>; }
    render(<P />);
    expect(screen.getByTestId('o').textContent).toBe('null');
  });
});
