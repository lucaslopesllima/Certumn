// Comissões: extrato mensal agrupado por representada (KPIs, divergência),
// baixa individual, conciliação CSV (admin) e aba de regras com precedência.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Commissions } from '../src/pages/Commissions.tsx';
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
const vendedor: User = { ...admin, id: 2, role: 'rep' };

const entry = (over: Record<string, unknown>): Record<string, unknown> => ({
  id: 1, order_id: 10, user_id: 2, represented_id: 5, competencia: '2026-06-01',
  valor_previsto: '100', valor_recebido: null, percent_aplicado: '5', vendedor_split_pct: '40',
  status: 'prevista', recebida_em: null, observacao: null, finance_entry_id: null,
  created_at: '2026-06-10T12:00:00Z', order_numero: 12, nf_numero: null, order_total: '2000',
  company_nome: 'Cliente Um LTDA', represented_nome: 'Indústria X',
  vendedor_nome: 'Vend', vendedor_email: 'v@b.c', valor_vendedor: '40', ...over,
});

const RULE = {
  id: 3, represented_id: 5, catalog_item_id: 9, company_id: null, user_id: null,
  percent: '8', vendedor_split_pct: '100', vigencia_inicio: '2026-01-01', vigencia_fim: null,
  ativo: true, created_at: '', represented_nome: 'Indústria X', catalog_nome: 'Produto A',
  company_nome: null, user_nome: null, user_email: null,
};

// admin faz bypass do RBAC; vendedor (sem grupo) não tem settle/reconcile
const setRole = (u: User): void => {
  useAuthMock.mockReturnValue({
    user: u, loading: false, login: vi.fn(), register: vi.fn(), refresh: vi.fn(), logout: vi.fn(),
    can: () => u.role === 'admin',
  });
};

beforeEach(() => {
  vi.mocked(m.get).mockReset();
  vi.mocked(m.post).mockReset();
  vi.mocked(m.patch).mockReset();
  vi.mocked(m.del).mockReset();
  vi.stubGlobal('alert', vi.fn());
  vi.stubGlobal('confirm', vi.fn(() => true));
  setRole(admin);
  m.get.mockImplementation(async (p: string) => {
    if (p === '/api/represented') return { empresas: [{ id: 5, nome: 'Indústria X', ativo: true }] };
    if (p.startsWith('/api/commissions?')) {
      return { entries: [
        entry({ id: 1, order_numero: 12 }),
        entry({ id: 2, order_numero: 13, status: 'divergente', valor_recebido: '80', represented_nome: 'Indústria Y' }),
      ] };
    }
    if (p === '/api/commission-rules') return { rules: [RULE] };
    if (p === '/api/catalog') return { items: [{ id: 9, nome: 'Produto A', codigo: null, descricao: null, preco: '100', represented_id: 5, ativo: true }] };
    if (p === '/api/kanban') return { cards: [{ id: 7, company_id: 100, nome_fantasia: 'Cliente Um', razao_social: 'Cliente Um LTDA' }] };
    if (p === '/api/users') return { users: [{ id: 2, nome: 'Vend', email: 'v@b.c', role: 'rep', ativo: true }] };
    return {};
  });
});

describe('Commissions · extrato', () => {
  it('agrupa por representada com KPIs e destaca divergência', async () => {
    render(<Commissions />);
    expect(await screen.findByText('Indústria X', { selector: 'h3' })).toBeInTheDocument();
    expect(screen.getByText('Indústria Y', { selector: 'h3' })).toBeInTheDocument();
    expect(screen.getByText('Recebido no mês')).toBeInTheDocument();
    // previsto 200 (2×100), recebido 80
    expect(screen.getAllByText(/R\$\s?200,00/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/R\$\s?80,00/).length).toBeGreaterThan(0);
    expect(screen.getByText('Divergente', { selector: 'span' })).toBeInTheDocument();
    // detalhe da linha: split do vendedor
    expect(screen.getAllByText(/vendedor R\$\s?40,00 \(40%\)/).length).toBe(2);
  });

  it('dá baixa individual: PATCH settle com valor e data', async () => {
    m.patch.mockResolvedValueOnce({ entry: entry({ status: 'recebida', valor_recebido: '100' }) });
    render(<Commissions />);
    await screen.findByText('Indústria X', { selector: 'h3' });

    await userEvent.click(screen.getAllByRole('button', { name: 'Dar baixa' })[0]!);
    const modal = screen.getByText(/Baixa da comissão · pedido #12/).closest('form') ?? document.body;
    expect(screen.getByLabelText('Valor recebido *')).toHaveValue(100); // prefill do previsto
    await userEvent.click(within(modal as HTMLElement).getByRole('button', { name: /Confirmar baixa/ }));
    await waitFor(() => expect(m.patch).toHaveBeenCalledWith('/api/commissions/1/settle', expect.objectContaining({
      valor_recebido: 100, observacao: null,
    })));
  });

  it('concilia CSV em lote (admin) e mostra o resumo', async () => {
    m.post.mockResolvedValueOnce({ processadas: 3, baixadas: 2, divergentes: 1 });
    render(<Commissions />);
    await screen.findByText('Indústria X', { selector: 'h3' });

    await userEvent.click(screen.getByRole('button', { name: /Conciliar CSV/ }));
    await userEvent.type(screen.getByPlaceholderText(/pedido;valor;data/), 'pedido;valor{enter}12;100');
    await userEvent.click(screen.getByRole('button', { name: 'Conciliar' }));
    await waitFor(() => expect(m.post).toHaveBeenCalledWith('/api/commissions/reconcile', expect.objectContaining({ csv: expect.stringContaining('12;100') })));
    expect(await screen.findByText(/2 de 3 linha\(s\) baixada\(s\), 1 divergente\(s\)/)).toBeInTheDocument();
  });

  it('vendedor não vê baixa nem conciliação', async () => {
    setRole(vendedor);
    render(<Commissions />);
    await screen.findByText('Indústria X', { selector: 'h3' });
    expect(screen.queryByRole('button', { name: 'Dar baixa' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Conciliar CSV/ })).not.toBeInTheDocument();
  });
});

describe('Commissions · regras', () => {
  it('lista regra com alvo (precedência) e vigência', async () => {
    render(<Commissions />);
    await screen.findByText('Indústria X', { selector: 'h3' });
    await userEvent.click(screen.getByRole('button', { name: 'Regras' }));
    expect(await screen.findByText(/Produto · Produto A/)).toBeInTheDocument();
    expect(screen.getByText(/8% · vendedor 100%/)).toBeInTheDocument();
  });

  it('cria regra por vendedor: POST com user_id e percent', async () => {
    m.post.mockResolvedValueOnce({ rule: RULE });
    render(<Commissions />);
    await screen.findByText('Indústria X', { selector: 'h3' });
    await userEvent.click(screen.getByRole('button', { name: 'Regras' }));
    await userEvent.click(await screen.findByRole('button', { name: /Nova regra/ }));

    await userEvent.selectOptions(screen.getByLabelText('Representada *'), '5');
    await userEvent.selectOptions(screen.getByLabelText('Tipo de regra'), 'vendedor');
    await userEvent.selectOptions(screen.getByLabelText('Alvo da regra'), '2');
    await userEvent.type(screen.getByLabelText('Comissão % *'), '6');
    await userEvent.click(screen.getByRole('button', { name: 'Salvar regra' }));

    await waitFor(() => expect(m.post).toHaveBeenCalledWith('/api/commission-rules', expect.objectContaining({
      represented_id: 5, user_id: 2, catalog_item_id: null, company_id: null,
      percent: 6, vendedor_split_pct: 100,
    })));
  });

  it('exclui regra com confirm', async () => {
    m.del.mockResolvedValueOnce({ deleted: true });
    render(<Commissions />);
    await screen.findByText('Indústria X', { selector: 'h3' });
    await userEvent.click(screen.getByRole('button', { name: 'Regras' }));
    await userEvent.click(await screen.findByLabelText('Excluir regra'));
    await waitFor(() => expect(m.del).toHaveBeenCalledWith('/api/commission-rules/3'));
    expect(screen.queryByText(/Produto · Produto A/)).not.toBeInTheDocument();
  });
});
