// Financeiro: KPIs derivados, filtros de lista e liquidar com rollback.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Finance } from '../src/pages/Finance.tsx';
import { api } from '../src/lib/api.ts';

vi.mock('../src/lib/api.ts', async (orig) => {
  const real = await orig() as Record<string, unknown>;
  return { ...real, api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), del: vi.fn() } };
});
const m = vi.mocked(api);

const entry = (over: Record<string, unknown>): Record<string, unknown> => ({
  id: 1, kind: 'receber', descricao: 'Comissão X', valor: '1000', vencimento: '2099-12-31',
  liquidacao_data: null, status: 'pendente', categoria: null, notas: null,
  company_id: null, represented_id: null, activity_id: null, owner_user_id: 1,
  categoria_id: null, route_id: null, recorrencia: null, recorrencia_fim: null, recorrencia_origem_id: null,
  created_at: '', company_nome: null, represented_nome: null, activity_titulo: null,
  route_nome: null, categoria_nome: null, categoria_grupo_dre: null, ...over,
});

beforeEach(() => {
  vi.mocked(m.get).mockReset();
  vi.mocked(m.patch).mockReset();
  vi.mocked(m.post).mockReset();
  vi.stubGlobal('alert', vi.fn());
  m.get.mockImplementation(async (p: string) => {
    if (p === '/api/finance') {
      return { entries: [
        entry({ id: 1, kind: 'receber', valor: '1000', status: 'pendente' }),
        entry({ id: 2, kind: 'pagar', valor: '400', status: 'pendente', descricao: 'Aluguel' }),
        entry({ id: 3, kind: 'receber', valor: '250', status: 'liquidado', descricao: 'Recebida' }),
        entry({ id: 4, kind: 'pagar', valor: '999', status: 'cancelado', descricao: 'Cancelada' }),
      ] };
    }
    if (p.startsWith('/api/finance/cashflow')) {
      return { months: 3, semanas: [
        { semana: '2099-01-05', receber: 800, pagar: 300, comissao_prevista: 50, saldo: 550 },
      ] };
    }
    if (p.startsWith('/api/finance/dre')) {
      return { ano: 2099, meses: Array.from({ length: 12 }, (_, i) => ({
        mes: i + 1, receita: i === 0 ? 1000 : 0, despesa: i === 0 ? 400 : 0,
        resultado: i === 0 ? 600 : 0, despesas_por_categoria: i === 0 ? { viagem: 400 } : {},
      })) };
    }
    if (p === '/api/finance/categories') return { categories: [] };
    if (p === '/api/kanban') return { cards: [] };
    if (p === '/api/represented') return { empresas: [] };
    return { activities: [] };
  });
});

const nbsp = (s: string): RegExp => new RegExp(s.replace(' ', '[\\s\\u00a0]'));

// A lista nasce filtrada pelo mês atual; as fixtures usam datas em 2099, então
// troca para "Todo período" antes de afirmar que os lançamentos aparecem.
const renderAll = async (): Promise<void> => {
  render(<Finance />);
  await userEvent.selectOptions(await screen.findByLabelText('Período'), 'todos');
  await screen.findByText('Comissão X');
};

describe('Finance', () => {
  it('KPIs ignoram cancelados: a receber, a pagar, saldo e realizado', async () => {
    await renderAll();
    // valores também aparecem nas linhas — KPI garante >=1; saldo (1000-400) só existe no card
    expect(screen.getAllByText(nbsp('R\\$ 1.000,00')).length).toBeGreaterThan(0); // a receber aberto
    expect(screen.getAllByText(nbsp('R\\$ 400,00')).length).toBeGreaterThan(0);   // a pagar aberto
    expect(screen.getByText(nbsp('R\\$ 600,00'))).toBeInTheDocument();            // saldo previsto
    expect(screen.getAllByText(nbsp('R\\$ 250,00')).length).toBeGreaterThan(0);   // realizado (cancelado fora)
  });

  it('filtro por tipo esconde os outros lançamentos', async () => {
    await renderAll();
    await userEvent.click(screen.getByRole('button', { name: /A pagar/ }));
    expect(screen.getByText('Aluguel')).toBeInTheDocument();
    expect(screen.queryByText('Comissão X')).not.toBeInTheDocument();
  });

  it('liquidar otimista: PATCH ok refaz a carga; falha reverte o status', async () => {
    m.patch.mockRejectedValueOnce(new Error('offline'));
    await renderAll();

    const botoes = screen.getAllByTitle('Marcar liquidado');
    await userEvent.click(botoes[0]!);
    expect(m.patch).toHaveBeenCalledWith('/api/finance/1', expect.objectContaining({ status: 'liquidado' }));
    // rollback: PATCH falhou, volta a pendente (botão de liquidar segue lá)
    await waitFor(() => expect(screen.getAllByTitle('Marcar liquidado').length).toBe(botoes.length));

    m.patch.mockResolvedValueOnce({});
    await userEvent.click(screen.getAllByTitle('Marcar liquidado')[0]!);
    expect(m.patch).toHaveBeenLastCalledWith('/api/finance/1', expect.objectContaining({ status: 'liquidado' }));
  });

  it('view Fluxo de caixa lista semanas com saldo projetado', async () => {
    await renderAll();
    await userEvent.click(screen.getByRole('button', { name: /Fluxo de caixa/ }));
    expect(await screen.findByText('Saldo projetado')).toBeInTheDocument();
    expect(screen.getByText(/Semana de/)).toBeInTheDocument();
    expect(m.get).toHaveBeenCalledWith(expect.stringContaining('/api/finance/cashflow'), expect.anything());
  });

  it('view DRE mostra receita, despesa e categoria', async () => {
    await renderAll();
    await userEvent.click(screen.getByRole('button', { name: /^DRE$/ }));
    expect(await screen.findByText('Resultado')).toBeInTheDocument();
    expect(screen.getByText(/viagem:/)).toBeInTheDocument();
  });

  it('gerencia categorias: adiciona pelo modal', async () => {
    m.post.mockResolvedValue({ category: { id: 9, nome: 'Frete', grupo_dre: 'Operacional', kind: null, ativo: true } });
    await renderAll();
    await userEvent.click(screen.getByRole('button', { name: /Categorias/ }));
    await userEvent.type(screen.getByPlaceholderText('Nome *'), 'Frete');
    await userEvent.click(screen.getByRole('button', { name: /Adicionar/ }));
    expect(m.post).toHaveBeenCalledWith('/api/finance/categories', expect.objectContaining({ nome: 'Frete' }));
  });

  it('lançamento vencido ganha badge Vencido', async () => {
    m.get.mockImplementation(async (p: string) =>
      p === '/api/finance'
        ? { entries: [entry({ vencimento: '2020-01-01' })] }
        : p === '/api/kanban' ? { cards: [] } : p === '/api/represented' ? { empresas: [] } : { activities: [] });
    render(<Finance />);
    expect(await screen.findByText('Vencido')).toBeInTheDocument();
  });
});
