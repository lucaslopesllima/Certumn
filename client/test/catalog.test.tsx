// Catálogo: carga, criação, toggle otimista com rollback e exclusão com confirm.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Catalog } from '../src/pages/Catalog.tsx';
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

const ITEM = { id: 1, nome: 'Furadeira', codigo: 'F-01', descricao: null, preco: '199.9', represented_id: null, ativo: true };

beforeEach(() => {
  vi.mocked(m.get).mockReset();
  vi.mocked(m.patch).mockReset();
  vi.mocked(m.del).mockReset();
  vi.stubGlobal('confirm', vi.fn(() => true));
  vi.stubGlobal('alert', vi.fn());
  useAuthMock.mockReturnValue({
    user: admin, loading: false, login: vi.fn(), register: vi.fn(), refresh: vi.fn(), logout: vi.fn(),
    can: () => true,
  });
  m.get.mockImplementation(async (p: string) =>
    p === '/api/catalog' ? { items: [ITEM] } : { empresas: [] });
});

describe('Catalog', () => {
  it('carrega e lista os itens', async () => {
    render(<Catalog />);
    expect(await screen.findByText('Furadeira')).toBeInTheDocument();
    expect(screen.getByText('F-01')).toBeInTheDocument();
  });

  it('toggle de ativo: otimista, e reverte quando o PATCH falha', async () => {
    m.patch.mockRejectedValueOnce(new Error('offline'));
    render(<Catalog />);
    await screen.findByText('Furadeira');

    await userEvent.click(screen.getByTitle('Desativar'));
    expect(m.patch).toHaveBeenCalledWith('/api/catalog/1', { ativo: false }); // tentou
    // rollback: item volta a ativo (botão de desativar reaparece)
    await waitFor(() => expect(screen.getByTitle('Desativar')).toBeInTheDocument());
    expect(screen.queryByText('inativo')).not.toBeInTheDocument();
  });

  it('exclusão: confirm cancelado não chama API; falha de DELETE reverte', async () => {
    vi.stubGlobal('confirm', vi.fn(() => false));
    render(<Catalog />);
    await screen.findByText('Furadeira');
    await userEvent.click(screen.getByLabelText('Excluir'));
    expect(m.del).not.toHaveBeenCalled();

    vi.stubGlobal('confirm', vi.fn(() => true));
    m.del.mockRejectedValueOnce(new Error('offline'));
    await userEvent.click(screen.getByLabelText('Excluir'));
    // sumiu otimista, voltou no rollback
    await waitFor(() => expect(screen.getByText('Furadeira')).toBeInTheDocument());
  });

  it('cria item novo via formulário', async () => {
    m.post.mockResolvedValueOnce({ item: { ...ITEM, id: 2, nome: 'Parafusadeira' } });
    render(<Catalog />);
    await screen.findByText('Furadeira');

    await userEvent.click(screen.getByRole('button', { name: /Novo item/ }));
    await userEvent.type(screen.getByPlaceholderText('Nome do produto / serviço *'), 'Parafusadeira');
    await userEvent.click(screen.getByRole('button', { name: 'Salvar' }));
    expect(await screen.findByText('Parafusadeira')).toBeInTheDocument();
    expect(m.post).toHaveBeenCalledWith('/api/catalog', expect.objectContaining({ nome: 'Parafusadeira' }));
  });
});
