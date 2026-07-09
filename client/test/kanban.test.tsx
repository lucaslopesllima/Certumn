// Funil kanban: board, colunas, KPIs, drag-drop otimista com revert.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Kanban } from '../src/pages/Kanban.tsx';
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

const STAGES = [
  { id: 10, nome: 'Prospecção', ordem: 1 },
  { id: 11, nome: 'Negociação', ordem: 2 },
];
const card = (over: Record<string, unknown>): Record<string, unknown> => ({
  id: 1, company_id: 100, stage_id: 10, status: 'prospect', valor_estimado: '5000', notas: null,
  owner_user_id: 1, represented_id: null, marca_id: null, cenario_id: null, acao_id: null,
  data_contato: null, previsao_data: null, updated_at: '',
  razao_social: 'Empresa Um LTDA', nome_fantasia: 'Loja Um', cnpj: '11222333000144',
  cnae_principal: 4781400, municipio_id: 100, uf: 'SP', cidade: 'São Paulo', porte: 'pequeno',
  // /api/kanban manda amostras_count (a lista completa é carregada no modal)
  representada: null, marca: null, cenario: null, acao: null, contatos: [], catalogo: [], amostras_count: 0, ...over,
});

beforeEach(() => {
  vi.mocked(m.get).mockReset();
  vi.mocked(m.patch).mockReset();
  useAuthMock.mockReturnValue({
    user: admin, loading: false, login: vi.fn(), register: vi.fn(), refresh: vi.fn(), logout: vi.fn(),
    can: () => true,
  });
  m.get.mockImplementation(async (p: string) => {
    if (p === '/api/kanban') {
      return { stages: STAGES, cards: [
        card({ id: 1 }),
        card({ id: 2, razao_social: 'Empresa Dois SA', nome_fantasia: null, stage_id: 11, status: 'cliente', valor_estimado: '2000',
          amostras_count: 1 }),
      ] };
    }
    if (p === '/api/profile') return { profile: null };
    if (p === '/api/represented') return { empresas: [] };
    if (p === '/api/brands') return { brands: [] };
    if (p === '/api/catalog') return { items: [] };
    if (p.startsWith('/api/contacts')) return { contacts: [] };
    if (p.startsWith('/api/sample-requests')) return { samples: [] };
    return { items: [] }; // scenarios/actions
  });
});

describe('Kanban', () => {
  it('renderiza colunas, cards e KPIs (valor total, clientes)', async () => {
    render(<Kanban />);
    expect(await screen.findByText('Loja Um')).toBeInTheDocument();
    expect(screen.getByText('Prospecção')).toBeInTheDocument();
    expect(screen.getByText('Negociação')).toBeInTheDocument();
    expect(screen.getAllByText('Empresa Dois SA').length).toBeGreaterThan(0); // título + razão social
    // valor em funil 5000+2000 sem centavos (brl0)
    expect(screen.getByText(/R\$[\s ]7\.000/)).toBeInTheDocument();
  });

  it('drag-drop move o card (PATCH stage_id) de forma otimista', async () => {
    m.patch.mockResolvedValueOnce({});
    render(<Kanban />);
    const cardEl = (await screen.findByText('Loja Um')).closest('[draggable]')!;
    const colNegociacao = screen.getByText('Negociação').closest('div')!.parentElement!;

    fireEvent.dragStart(cardEl);
    fireEvent.dragOver(colNegociacao);
    fireEvent.drop(colNegociacao);

    expect(m.patch).toHaveBeenCalledWith('/api/relationships/1', { stage_id: 11 });
  });

  it('falha no PATCH recarrega o board (revert)', async () => {
    m.patch.mockRejectedValueOnce(new Error('offline'));
    render(<Kanban />);
    const cardEl = (await screen.findByText('Loja Um')).closest('[draggable]')!;
    const colNegociacao = screen.getByText('Negociação').closest('div')!.parentElement!;

    const kanbanCalls = (): number => m.get.mock.calls.filter((c) => c[0] === '/api/kanban').length;
    const antes = kanbanCalls();
    fireEvent.dragStart(cardEl);
    fireEvent.drop(colNegociacao);
    await waitFor(() => expect(kanbanCalls()).toBe(antes + 1)); // load() de revert
  });

  it('soltar na mesma coluna não chama a API', async () => {
    render(<Kanban />);
    const cardEl = (await screen.findByText('Loja Um')).closest('[draggable]')!;
    const colProspeccao = screen.getByText('Prospecção').closest('div')!.parentElement!;
    fireEvent.dragStart(cardEl);
    fireEvent.drop(colProspeccao);
    expect(m.patch).not.toHaveBeenCalled();
  });

  it('botão +Amostra abre o modal de solicitar amostra', async () => {
    render(<Kanban />);
    await screen.findByText('Loja Um');
    await userEvent.click(screen.getAllByRole('button', { name: /\+Amostra/ })[0]!);
    expect(await screen.findByText('Solicitar amostra')).toBeInTheDocument();
  });

  it('sinal de amostra no card abre a lista de amostras', async () => {
    render(<Kanban />);
    await screen.findByText('Loja Um');
    await userEvent.click(screen.getByRole('button', { name: /1 amostra/ }));
    expect(await screen.findByRole('heading', { name: 'Amostras' })).toBeInTheDocument();
  });
});
