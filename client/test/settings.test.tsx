// Configurações: navegação entre seções e editores de lista (cenários/funil).
// O perfil-alvo foi removido; a tela abre nas Empresas representadas.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Settings } from '../src/pages/Settings.tsx';
import { api } from '../src/lib/api.ts';
import { useAuth, type User } from '../src/lib/auth.tsx';

vi.mock('../src/lib/api.ts', async (orig) => {
  const real = await orig() as Record<string, unknown>;
  return { ...real, api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), del: vi.fn() } };
});
vi.mock('../src/lib/auth.tsx', () => {
  const useAuth = vi.fn();
  return { useAuth, useOptionalUser: () => useAuth().user ?? null };
});
const m = vi.mocked(api);
const useAuthMock = vi.mocked(useAuth);

const admin: User = { id: 1, email: 'a@b.c', role: 'admin', org_id: 1, org_nome: 'Org' };

beforeEach(() => {
  vi.mocked(m.get).mockReset();
  vi.mocked(m.post).mockReset();
  vi.mocked(m.del).mockReset();
  useAuthMock.mockReturnValue({
    user: admin, loading: false, login: vi.fn(), register: vi.fn(), refresh: vi.fn(), logout: vi.fn(),
    can: () => true,
  });
  m.get.mockImplementation(async (p: string) => {
    if (p === '/api/stages') return { stages: [{ id: 1, nome: 'Prospecção', ordem: 1 }] };
    if (p === '/api/represented') return { empresas: [] };
    if (p === '/api/contacts') return { contacts: [] };
    if (p === '/api/scenarios') return { items: [{ id: 7, nome: 'Compra do concorrente' }] };
    if (p === '/api/actions') return { items: [] };
    return {};
  });
});

describe('Settings', () => {
  it('abre nas empresas representadas e navega entre as seções', async () => {
    render(<Settings />);
    expect(await screen.findByText('Nenhuma empresa cadastrada')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /Cenários/ }));
    expect(await screen.findByDisplayValue('Compra do concorrente')).toBeInTheDocument(); // item é um input editável

    await userEvent.click(screen.getByRole('button', { name: /Funil/ }));
    expect(await screen.findByDisplayValue('Prospecção')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /Contatos/ }));
    expect(await screen.findByText('Nenhum contato')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /Empresas representadas/ }));
    expect(await screen.findByText('Nenhuma empresa cadastrada')).toBeInTheDocument();
  });

  it('cenários: adiciona e remove item', async () => {
    m.post.mockResolvedValueOnce({ item: { id: 8, nome: 'Novo cenário X' } });
    m.del.mockResolvedValueOnce({ deleted: true });
    render(<Settings />);
    await userEvent.click(screen.getByRole('button', { name: /Cenários/ }));
    await screen.findByDisplayValue('Compra do concorrente');

    const input = screen.getByPlaceholderText(/Novo cenário/);
    await userEvent.type(input, 'Novo cenário X');
    // o form da lista envia no submit
    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(m.post).toHaveBeenCalledWith('/api/scenarios', { nome: 'Novo cenário X' }));
  });
});
