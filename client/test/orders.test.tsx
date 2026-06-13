// Pedidos: lista + KPIs, filtros, criação com tabela de preço vigente,
// transições de status (faturar pede NF), exclusão e importação CSV (admin).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { Orders } from '../src/pages/Orders.tsx';
import { api } from '../src/lib/api.ts';
import { useAuth, type User } from '../src/lib/auth.tsx';

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

const order = (over: Record<string, unknown>): Record<string, unknown> => ({
  id: 1, numero: 1, relationship_id: 7, company_id: 100, represented_id: 5,
  owner_user_id: 1, price_table_id: null, status: 'rascunho', validade: null,
  condicao_pagamento: null, transportadora: null, frete: '0', observacoes: null,
  total: '1000', nf_numero: null, emitido_em: null, faturado_em: null,
  created_at: '2026-06-01T12:00:00Z', updated_at: '2026-06-01T12:00:00Z',
  company_nome: 'Cliente Um LTDA', company_cnpj: '11222333000144',
  represented_nome: 'Indústria X', owner_email: 'a@b.c', owner_nome: null,
  items: [], ...over,
});

const CARD = {
  id: 7, company_id: 100, nome_fantasia: 'Cliente Um', razao_social: 'Cliente Um LTDA',
};
const TABLE = {
  id: 3, nome: 'Tabela 2026', represented_id: 5,
  items: [{ id: 1, catalog_item_id: 9, preco: '90', desconto_max_pct: '10', catalog_nome: 'Produto A', codigo: null }],
};

beforeEach(() => {
  vi.mocked(m.get).mockReset();
  vi.mocked(m.post).mockReset();
  vi.mocked(m.del).mockReset();
  vi.stubGlobal('alert', vi.fn());
  vi.stubGlobal('confirm', vi.fn(() => true));
  useAuthMock.mockReturnValue({
    user: admin, loading: false, login: vi.fn(), register: vi.fn(), refresh: vi.fn(), logout: vi.fn(),
  });
  m.get.mockImplementation(async (p: string) => {
    if (p === '/api/orders') {
      return { orders: [
        order({ id: 1, numero: 1, status: 'rascunho', total: '1000' }),
        order({ id: 2, numero: 2, status: 'faturado', total: '500', nf_numero: 'NF-7', company_nome: 'Cliente Dois SA' }),
      ] };
    }
    if (p.startsWith('/api/orders/')) return { order: order({ id: 1 }) };
    if (p === '/api/represented') return { empresas: [{ id: 5, nome: 'Indústria X', ativo: true }] };
    if (p === '/api/kanban') return { cards: [CARD] };
    if (p === '/api/catalog') return { items: [{ id: 9, nome: 'Produto A', codigo: null, descricao: null, preco: '100', represented_id: 5, ativo: true }] };
    if (p === '/api/carriers') return { carriers: [{ id: 4, nome: 'Transp X', cnpj: null, telefone: null, email: null, contato: null, observacoes: null, ativo: true }] };
    if (p.startsWith('/api/price-tables/active')) return { table: TABLE };
    return {};
  });
});

const mount = (path = '/pedidos'): ReturnType<typeof render> => render(
  <MemoryRouter initialEntries={[path]}><Orders /></MemoryRouter>,
);

describe('Orders', () => {
  it('lista pedidos com status, NF e KPIs (aberto / faturado)', async () => {
    mount();
    expect(await screen.findByText('Cliente Um LTDA')).toBeInTheDocument();
    expect(screen.getByText('Rascunho', { selector: 'span' })).toBeInTheDocument();
    expect(screen.getByText('Faturado', { selector: 'span' })).toBeInTheDocument();
    expect(screen.getByText(/NF NF-7/)).toBeInTheDocument();
    // KPI + linha: aberto 1000, faturado 500
    expect(screen.getAllByText(/R\$\s?1\.000,00/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/R\$\s?500,00/).length).toBeGreaterThan(0);
  });

  it('filtra por status', async () => {
    mount();
    await screen.findByText('Cliente Um LTDA');
    await userEvent.selectOptions(screen.getByLabelText('Filtrar por status'), 'faturado');
    expect(screen.queryByText('Cliente Um LTDA')).not.toBeInTheDocument();
    expect(screen.getByText('Cliente Dois SA')).toBeInTheDocument();
  });

  it('cria pedido com item do catálogo usando preço da tabela vigente', async () => {
    m.post.mockResolvedValueOnce({ order: order({ id: 9 }) });
    mount();
    await screen.findByText('Cliente Um LTDA');

    await userEvent.click(screen.getByRole('button', { name: /Novo pedido/ }));
    await userEvent.selectOptions(screen.getByLabelText('Cliente (funil) *'), '100');
    await userEvent.selectOptions(screen.getByLabelText('Representada *'), '5');
    expect(await screen.findByText('Tabela 2026')).toBeInTheDocument(); // tabela vigente carregada

    await userEvent.selectOptions(screen.getByLabelText('Adicionar item do catálogo'), '9');
    // preço pré-preenchido vem da tabela (90), não do catálogo (100)
    expect(screen.getByLabelText('Preço * item 1')).toHaveValue(90);

    await userEvent.selectOptions(screen.getByLabelText('Transportadora'), '4');

    await userEvent.click(screen.getByRole('button', { name: 'Salvar pedido' }));
    await waitFor(() => expect(m.post).toHaveBeenCalledWith('/api/orders', expect.objectContaining({
      company_id: 100,
      represented_id: 5,
      relationship_id: 7,
      price_table_id: 3,
      carrier_id: 4,
      status: 'rascunho',
      items: [expect.objectContaining({ catalog_item_id: 9, qtd: 1, preco_unit: 90 })],
    })));
  });

  it('?company_id= abre o modal pré-preenchido (botão do Kanban)', async () => {
    mount('/pedidos?company_id=100&relationship_id=7&represented_id=5');
    expect(await screen.findByText('Novo pedido', { selector: 'h3' })).toBeInTheDocument();
    expect(screen.getByLabelText('Cliente (funil) *')).toHaveValue('100');
    expect(screen.getByLabelText('Representada *')).toHaveValue('5');
  });

  it('transição: enviar rascunho; faturar pede NF no prompt', async () => {
    m.post.mockResolvedValue({ order: order({ id: 1, status: 'enviado' }) });
    mount();
    await screen.findByText('Cliente Um LTDA');

    await userEvent.click(screen.getByRole('button', { name: 'Enviar' }));
    await waitFor(() => expect(m.post).toHaveBeenCalledWith('/api/orders/1/transition', { status: 'enviado', nf_numero: undefined }));

    vi.stubGlobal('prompt', vi.fn(() => 'NF-99'));
    await userEvent.click(screen.getByRole('button', { name: 'Faturar' })); // pedido 2? não: o 1 virou enviado
    await waitFor(() => expect(m.post).toHaveBeenCalledWith('/api/orders/1/transition', { status: 'faturado', nf_numero: 'NF-99' }));
  });

  it('excluir pedido em rascunho chama DELETE e some da lista', async () => {
    m.del.mockResolvedValueOnce({ deleted: true });
    mount();
    await screen.findByText('Cliente Um LTDA');
    await userEvent.click(screen.getByLabelText('Excluir pedido 1'));
    await waitFor(() => expect(m.del).toHaveBeenCalledWith('/api/orders/1'));
    expect(screen.queryByText('Cliente Um LTDA')).not.toBeInTheDocument();
  });

  it('admin importa CSV de faturamento e vê o resultado', async () => {
    m.post.mockResolvedValueOnce({ processadas: 2, faturadas: 1, results: [] });
    mount();
    await screen.findByText('Cliente Um LTDA');

    await userEvent.click(screen.getByRole('button', { name: /Importar NF/ }));
    await userEvent.type(screen.getByPlaceholderText(/nf;data;cnpj;valor/), 'nf;data;cnpj;valor\n1;2026-06-01;11222333000144;500');
    await userEvent.click(screen.getByRole('button', { name: 'Importar' }));
    expect(await screen.findByText(/1 de 2 linha/)).toBeInTheDocument();
    expect(m.post).toHaveBeenCalledWith('/api/orders/import', expect.objectContaining({ csv: expect.stringContaining('nf;data') }));
  });

  it('vendedor não vê o botão de importação', async () => {
    useAuthMock.mockReturnValue({
      user: { ...admin, role: 'rep' }, loading: false, login: vi.fn(), register: vi.fn(), refresh: vi.fn(), logout: vi.fn(),
    });
    mount();
    await screen.findByText('Cliente Um LTDA');
    expect(screen.queryByRole('button', { name: /Importar NF/ })).not.toBeInTheDocument();
  });
});
