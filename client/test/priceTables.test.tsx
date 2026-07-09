// Aba Tabelas de preço do Catálogo: lista, criação com itens e exclusão.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Catalog } from '../src/pages/Catalog.tsx';
import { api } from '../src/lib/api.ts';
import { useAuth, type User } from '../src/lib/auth.tsx';
import { confirmDialog } from '../src/lib/confirm.ts';
vi.mock('../src/lib/confirm.ts', () => ({ confirmDialog: vi.fn() }));

vi.mock('../src/lib/api.ts', async (orig) => {
  const real = await orig() as Record<string, unknown>;
  return { ...real, api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn(), del: vi.fn() } };
});
vi.mock('../src/lib/auth.tsx', () => {
  const useAuth = vi.fn();
  return { useAuth, useOptionalUser: () => useAuth().user ?? null };
});
const m = vi.mocked(api);
const useAuthMock = vi.mocked(useAuth);

const admin: User = { id: 1, email: 'a@b.c', role: 'admin', org_id: 1, org_nome: 'Org' };

const ITEM = { id: 9, nome: 'Produto A', codigo: null, descricao: null, preco: '100', represented_id: 5, ativo: true };
const TABLE = {
  id: 3, represented_id: 5, nome: 'Tabela 2026', vigencia_inicio: '2026-01-01',
  vigencia_fim: null, ativo: true, created_at: '', represented_nome: 'Indústria X', itens: 1,
};

beforeEach(() => {
  vi.mocked(m.get).mockReset();
  vi.mocked(m.post).mockReset();
  vi.mocked(m.patch).mockReset();
  vi.mocked(m.put).mockReset();
  vi.mocked(m.del).mockReset();
  vi.mocked(confirmDialog).mockResolvedValue(true);
  vi.stubGlobal('alert', vi.fn());
  useAuthMock.mockReturnValue({
    user: admin, loading: false, login: vi.fn(), register: vi.fn(), refresh: vi.fn(), logout: vi.fn(),
    can: () => true,
  });
  m.get.mockImplementation(async (p: string) => {
    if (p === '/api/catalog') return { items: [ITEM] };
    if (p === '/api/represented') return { empresas: [{ id: 5, nome: 'Indústria X', ativo: true }] };
    if (p === '/api/price-tables') return { tables: [TABLE] };
    if (p === `/api/price-tables/${TABLE.id}`) {
      return { table: { ...TABLE, items: [{ id: 1, catalog_item_id: 9, preco: '90', desconto_max_pct: null, catalog_nome: 'Produto A', codigo: null }] } };
    }
    return {};
  });
});

const openTab = async (): Promise<void> => {
  render(<Catalog />);
  await screen.findByText('Produto A');
  await userEvent.click(screen.getByRole('button', { name: /Tabelas de preço/ }));
};

describe('Catalog · Tabelas de preço', () => {
  it('lista as tabelas com representada e vigência', async () => {
    await openTab();
    expect(await screen.findByText('Tabela 2026')).toBeInTheDocument();
    expect(screen.getByText('Indústria X')).toBeInTheDocument();
    expect(screen.getByText(/sem fim · 1 item/)).toBeInTheDocument();
  });

  it('cria tabela nova com item do catálogo (preço sugerido do item)', async () => {
    m.post.mockResolvedValueOnce({ table: { ...TABLE, id: 4 } });
    await openTab();
    await screen.findByText('Tabela 2026');

    await userEvent.click(screen.getByRole('button', { name: /Nova tabela/ }));
    await userEvent.type(screen.getByPlaceholderText('Nome da tabela *'), 'Inverno');
    await userEvent.selectOptions(screen.getByDisplayValue('Representada *'), '5');
    const inicio = document.querySelector('input[type="date"]')!;
    fireEvent.change(inicio, { target: { value: '2026-07-01' } });
    await userEvent.selectOptions(screen.getByLabelText('Adicionar produto'), '9');
    expect(screen.getByLabelText('Preço Produto A')).toHaveValue(100); // sugerido do catálogo

    await userEvent.click(screen.getByRole('button', { name: 'Salvar tabela' }));
    await waitFor(() => expect(m.post).toHaveBeenCalledWith('/api/price-tables', expect.objectContaining({
      nome: 'Inverno', represented_id: 5, vigencia_inicio: '2026-07-01',
      items: [{ catalog_item_id: 9, preco: 100, desconto_max_pct: null }],
    })));
  });

  it('edita tabela existente: PATCH + PUT dos itens', async () => {
    m.patch.mockResolvedValueOnce({ table: TABLE });
    m.put.mockResolvedValueOnce({ items: [] });
    await openTab();
    await screen.findByText('Tabela 2026');

    await userEvent.click(screen.getByLabelText('Editar tabela'));
    const nome = await screen.findByPlaceholderText('Nome da tabela *');
    expect(nome).toHaveValue('Tabela 2026');
    expect(screen.getByLabelText('Preço Produto A')).toHaveValue(90); // item carregado do GET :id

    await userEvent.click(screen.getByRole('button', { name: 'Salvar tabela' }));
    await waitFor(() => expect(m.patch).toHaveBeenCalledWith(`/api/price-tables/${TABLE.id}`, expect.objectContaining({ nome: 'Tabela 2026' })));
    expect(m.put).toHaveBeenCalledWith(`/api/price-tables/${TABLE.id}/items`, {
      items: [{ catalog_item_id: 9, preco: 90, desconto_max_pct: null }],
    });
  });

  it('exclui com confirm; falha reverte', async () => {
    m.del.mockResolvedValueOnce({ deleted: true });
    await openTab();
    await screen.findByText('Tabela 2026');
    await userEvent.click(screen.getByLabelText('Excluir tabela'));
    await waitFor(() => expect(m.del).toHaveBeenCalledWith('/api/price-tables/3'));
    expect(screen.queryByText('Tabela 2026')).not.toBeInTheDocument();
  });
});
