// Financeiro: KPIs derivados, filtros de lista e liquidar com rollback.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Finance } from '../src/pages/Finance.tsx';
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
vi.mock('../src/lib/confirm.ts', () => ({ confirmDialog: vi.fn(async () => true) }));
const m = vi.mocked(api);
const useAuthMock = vi.mocked(useAuth);

// mock só de GET com os endpoints auxiliares vazios; o caller sobrescreve /api/finance*.
const finGet = (fn: (p: string) => unknown) => async (p: string): Promise<unknown> => {
  if (p.startsWith('/api/finance')) return fn(p);
  if (p === '/api/kanban') return { cards: [] };
  if (p === '/api/represented') return { empresas: [] };
  return { activities: [] };
};
const fixed = (text: string): HTMLElement => screen.getByText(text).closest('.fixed') as HTMLElement;

const admin: User = { id: 1, email: 'a@b.c', role: 'admin', org_id: 1, org_nome: 'Org' };

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
  vi.mocked(m.del).mockReset();
  m.del.mockResolvedValue({});
  vi.stubGlobal('alert', vi.fn());
  useAuthMock.mockReturnValue({
    user: admin, loading: false, login: vi.fn(), register: vi.fn(), refresh: vi.fn(), logout: vi.fn(),
    can: () => true,
  });
  m.get.mockImplementation(async (p: string) => {
    // lista paginada no servidor: /api/finance?limit=…&offset=…[&kind=…][&status=…][&totais=1]
    if (p.startsWith('/api/finance?')) {
      const qs = new URLSearchParams(p.split('?')[1]);
      return {
        entries: [
          entry({ id: 1, kind: 'receber', valor: '1000', status: 'pendente' }),
          entry({ id: 2, kind: 'pagar', valor: '400', status: 'pendente', descricao: 'Aluguel' }),
          entry({ id: 3, kind: 'receber', valor: '250', status: 'liquidado', descricao: 'Recebida' }),
          entry({ id: 4, kind: 'pagar', valor: '999', status: 'cancelado', descricao: 'Cancelada' }),
        ],
        // KPIs agregados do servidor (cancelados já ficam de fora)
        ...(qs.get('totais') === '1'
          ? { totais: { receber_aberto: 1000, pagar_aberto: 400, recebido: 250, pago: 0 } }
          : {}),
      };
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
      p.startsWith('/api/finance?')
        ? { entries: [entry({ vencimento: '2020-01-01' })] }
        : p === '/api/kanban' ? { cards: [] } : p === '/api/represented' ? { empresas: [] } : { activities: [] });
    render(<Finance />);
    expect(await screen.findByText('Vencido')).toBeInTheDocument();
  });

  it('KPIs preferem os totais agregados do servidor quando presentes', async () => {
    m.get.mockImplementation(finGet((p) =>
      p.startsWith('/api/finance?')
        ? { entries: [entry({ vencimento: '2099-12-31' })], totais: { receber_aberto: 7000, pagar_aberto: 2000, recebido: 500, pago: 100 } }
        : { categories: [] }));
    render(<Finance />);
    await userEvent.selectOptions(await screen.findByLabelText('Período'), 'todos');
    // saldo previsto = 7000 - 2000 (só existe nos KPIs do servidor)
    expect(await screen.findByText(nbsp('R\\$ 5.000,00'))).toBeInTheDocument();
  });

  it('"Carregar mais" pagina a lista quando a página vem cheia', async () => {
    const page1 = Array.from({ length: 200 }, (_, i) => entry({ id: i + 1, descricao: `L${i + 1}`, vencimento: '2099-12-31' }));
    m.get.mockImplementation(finGet((p) => {
      if (p.startsWith('/api/finance?')) {
        const offset = Number(new URLSearchParams(p.split('?')[1]).get('offset'));
        return offset === 0 ? { entries: page1 } : { entries: [entry({ id: 999, descricao: 'UltimaPagina', vencimento: '2099-12-31' })] };
      }
      return { categories: [] };
    }));
    render(<Finance />);
    await userEvent.selectOptions(await screen.findByLabelText('Período'), 'todos');
    await screen.findByText('L1');
    await userEvent.click(screen.getByRole('button', { name: /Carregar mais/ }));
    expect(await screen.findByText('UltimaPagina')).toBeInTheDocument();
  });

  it('exclui lançamento (otimista) e reverte quando o servidor recusa', async () => {
    await renderAll();
    m.del.mockRejectedValueOnce(new Error('offline'));
    await userEvent.click(screen.getAllByLabelText('Excluir')[0]!);
    // rollback: o lançamento volta
    await waitFor(() => expect(screen.getByText('Comissão X')).toBeInTheDocument());
    await userEvent.click(screen.getAllByLabelText('Excluir')[0]!);
    await waitFor(() => expect(m.del).toHaveBeenCalledWith('/api/finance/1'));
  });

  it('filtro por status recarrega a lista no servidor', async () => {
    render(<Finance />);
    const sel = await screen.findByLabelText('Filtrar por status');
    m.get.mockClear();
    await userEvent.selectOptions(sel, 'pendente');
    await waitFor(() => expect(m.get).toHaveBeenCalledWith(expect.stringContaining('status=pendente')));
  });

  it('recorte por mês usa o mês de referência selecionado', async () => {
    render(<Finance />);
    const mes = await screen.findByLabelText('Mês de referência');
    fireEvent.change(mes, { target: { value: '2099-12' } });
    expect(await screen.findByText('Comissão X')).toBeInTheDocument();
    expect(screen.getByText(/Exibindo dez\/2099/)).toBeInTheDocument();
  });

  it('cria lançamento pelo modal: valida, alterna tipo/recorrência e envia POST', async () => {
    m.get.mockImplementation(finGet((p) =>
      p.startsWith('/api/finance?') ? { entries: [] } : { categories: [] }));
    // dropdown de empresas prospect (com company_id duplicado para exercitar o dedup)
    m.get.mockImplementation(async (p: string) => {
      if (p.startsWith('/api/finance?')) return { entries: [] };
      if (p === '/api/finance/categories') return { categories: [] };
      if (p === '/api/kanban') return { cards: [
        { company_id: 5, razao_social: 'RZ Cinco', nome_fantasia: 'Fantasia Cinco' },
        { company_id: 5, razao_social: 'RZ Cinco', nome_fantasia: 'Fantasia Cinco' },
        { company_id: 6, razao_social: 'RZ Seis', nome_fantasia: null },
      ] };
      if (p === '/api/represented') return { empresas: [] };
      return { activities: [] };
    });
    render(<Finance />);
    await screen.findByText('Nenhum lançamento');

    // abre e fecha (cobre onClose do modal)
    await userEvent.click(screen.getByRole('button', { name: 'Lançamento' }));
    await screen.findByText('Novo lançamento');
    await userEvent.click(within(fixed('Novo lançamento')).getByRole('button', { name: 'Cancelar' }));
    await waitFor(() => expect(screen.queryByText('Novo lançamento')).not.toBeInTheDocument());

    await userEvent.click(screen.getByRole('button', { name: 'Lançamento' }));
    const d = (): HTMLElement => fixed('Novo lançamento');

    // validação: descrição vazia
    await userEvent.click(within(d()).getByRole('button', { name: /Salvar/ }));
    expect(m.post).not.toHaveBeenCalled();

    await userEvent.type(within(d()).getByPlaceholderText('Descrição'), 'Assinatura');
    // validação: vencimento vazio
    fireEvent.change(within(d()).getByLabelText('Vencimento'), { target: { value: '' } });
    await userEvent.click(within(d()).getByRole('button', { name: /Salvar/ }));
    expect(m.post).not.toHaveBeenCalled();
    fireEvent.change(within(d()).getByLabelText('Vencimento'), { target: { value: '2099-05-10' } });

    // validação: valor <= 0
    await userEvent.click(within(d()).getByRole('button', { name: /Salvar/ }));
    expect(m.post).not.toHaveBeenCalled();

    await userEvent.type(within(d()).getByLabelText('Valor (R$)'), '1000');
    await userEvent.click(within(d()).getByRole('button', { name: /A pagar/ }));
    await userEvent.selectOptions(within(d()).getByLabelText('Recorrência'), 'mensal');
    fireEvent.change(within(d()).getByLabelText('Repetir até (opcional)'), { target: { value: '2099-12-31' } });
    await userEvent.selectOptions(within(d()).getByLabelText('Empresa prospect'), '5');
    await userEvent.type(within(d()).getByPlaceholderText('Categoria livre (opcional)'), 'Livre');

    m.post.mockResolvedValueOnce({});
    await userEvent.click(within(d()).getByRole('button', { name: /Salvar/ }));
    await waitFor(() => expect(m.post).toHaveBeenCalledWith('/api/finance',
      expect.objectContaining({ kind: 'pagar', descricao: 'Assinatura', recorrencia: 'mensal', recorrencia_fim: '2099-12-31', company_id: 5 })));
  });

  it('edita lançamento (filho de recorrência) mantendo a categoria desativada', async () => {
    const cats = [{ id: 5, nome: 'Frete', grupo_dre: 'Operacional', kind: 'receber', ativo: true }];
    m.get.mockImplementation(finGet((p) =>
      p.startsWith('/api/finance?')
        ? { entries: [entry({ id: 1, categoria_id: 99, categoria_nome: 'Antiga', recorrencia_origem_id: 7, vencimento: '2099-12-31' })] }
        : { categories: cats }));
    render(<Finance />);
    await userEvent.selectOptions(await screen.findByLabelText('Período'), 'todos');
    await userEvent.click(await screen.findByText('Comissão X'));
    await screen.findByText('Editar lançamento');
    const d = fixed('Editar lançamento');
    // filho de recorrência não reabre a config de recorrência
    expect(within(d).queryByText('Sem recorrência')).not.toBeInTheDocument();
    // opção da categoria desativada continua disponível
    expect(within(d).getByRole('option', { name: 'Antiga' })).toBeInTheDocument();
    await userEvent.selectOptions(within(d).getByLabelText('Categoria'), '5');
    await userEvent.type(within(d).getByPlaceholderText('Notas (opcional)'), 'obs');
    m.patch.mockResolvedValueOnce({});
    await userEvent.click(within(d).getByRole('button', { name: /Salvar/ }));
    await waitFor(() => expect(m.patch).toHaveBeenCalledWith('/api/finance/1', expect.objectContaining({ descricao: 'Comissão X' })));
  });

  it('categorias: adiciona com grupo/kind, lista as existentes e remove', async () => {
    const cats = [{ id: 3, nome: 'Aluguel', grupo_dre: 'Fixo', kind: 'pagar', ativo: true }];
    m.get.mockImplementation(finGet((p) =>
      p.startsWith('/api/finance?') ? { entries: [] } : { categories: cats }));
    m.post.mockResolvedValue({ category: { id: 9, nome: 'Frete', grupo_dre: 'Operacional', kind: 'pagar', ativo: true } });
    render(<Finance />);
    await userEvent.click(await screen.findByRole('button', { name: /Categorias/ }));
    await screen.findByText('Categorias financeiras');
    const d = (): HTMLElement => fixed('Categorias financeiras');
    expect(within(d()).getByText('Aluguel')).toBeInTheDocument();
    await userEvent.type(within(d()).getByPlaceholderText('Nome *'), 'Frete');
    await userEvent.type(within(d()).getByPlaceholderText(/Grupo DRE/), 'Operacional');
    await userEvent.selectOptions(within(d()).getByRole('combobox'), 'pagar');
    await userEvent.click(within(d()).getByRole('button', { name: /Adicionar/ }));
    expect(m.post).toHaveBeenCalledWith('/api/finance/categories',
      expect.objectContaining({ nome: 'Frete', grupo_dre: 'Operacional', kind: 'pagar' }));
    await userEvent.click(within(d()).getByLabelText('Excluir Aluguel'));
    await waitFor(() => expect(m.del).toHaveBeenCalledWith('/api/finance/categories/3'));
    await userEvent.click(within(d()).getByLabelText('Fechar'));
    await waitFor(() => expect(screen.queryByText('Categorias financeiras')).not.toBeInTheDocument());
  });

  it('fluxo de caixa: troca o horizonte e mostra o vazio', async () => {
    m.get.mockImplementation(finGet((p) =>
      p.startsWith('/api/finance/cashflow') ? { semanas: [] }
        : p.startsWith('/api/finance?') ? { entries: [] } : { categories: [] }));
    render(<Finance />);
    await userEvent.click(await screen.findByRole('button', { name: /Fluxo de caixa/ }));
    expect(await screen.findByText('Sem projeção')).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByRole('combobox'), '6');
    await waitFor(() => expect(m.get).toHaveBeenCalledWith(expect.stringContaining('months=6'), expect.anything()));
  });

  it('DRE: troca o ano e mostra sem movimento', async () => {
    m.get.mockImplementation(finGet((p) =>
      p.startsWith('/api/finance/dre')
        ? { meses: Array.from({ length: 12 }, (_, i) => ({ mes: i + 1, receita: 0, despesa: 0, resultado: 0, despesas_por_categoria: {} })) }
        : p.startsWith('/api/finance?') ? { entries: [] } : { categories: [] }));
    render(<Finance />);
    await userEvent.click(await screen.findByRole('button', { name: /^DRE$/ }));
    expect(await screen.findByText('Sem movimento')).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByRole('combobox'), String(new Date().getFullYear() - 1));
    await waitFor(() => expect(m.get).toHaveBeenCalledWith(expect.stringContaining(`ano=${new Date().getFullYear() - 1}`), expect.anything()));
  });
});
