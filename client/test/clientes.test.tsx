// Clientes: lista, adicionar (busca/CSV), editar, ativar/remover, ver empresa.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Clientes } from '../src/pages/Clientes.tsx';
import { api } from '../src/lib/api.ts';
import { useAuth } from '../src/lib/auth.tsx';
import type { Cliente } from '../src/lib/types.ts';

vi.mock('../src/lib/auth.tsx', () => ({ useAuth: vi.fn() }));
vi.mock('../src/lib/api.ts', async (orig) => {
  const real = await orig() as Record<string, unknown>;
  return { ...real, api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), del: vi.fn() } };
});
vi.mock('../src/lib/toast.tsx', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock('../src/lib/confirm.ts', () => ({ confirmDialog: vi.fn() }));
vi.mock('../src/lib/companySearch.tsx', () => ({
  CompanySearch: ({ onPick }: { onPick: (c: unknown) => void }) => (
    <button onClick={() => onPick({ id: 99, razao_social: 'Nova RS', nome_fantasia: 'Nova NF', cnpj: '11222333000199', uf: 'MG' })}>
      pick-company
    </button>
  ),
}));
vi.mock('../src/lib/companyModal.tsx', () => ({
  CompanyModal: ({ companyId, onClose }: { companyId: number; onClose: () => void }) => (
    <div data-testid="company-modal">modal {companyId}<button onClick={onClose}>close-modal</button></div>
  ),
}));
import { toast } from '../src/lib/toast.tsx';
import { confirmDialog } from '../src/lib/confirm.ts';

const m = vi.mocked(api);
const useAuthMock = vi.mocked(useAuth);
const toastMock = vi.mocked(toast);
const confirmMock = vi.mocked(confirmDialog);

const cli = (over: Partial<Cliente> & { id: number; company_id: number }): Cliente => ({
  status: 'cliente', ativo: true, valor_estimado: null, notas: null,
  owner_user_id: null, represented_id: null, representada: null, updated_at: '',
  contatos: [], razao_social: 'RS', nome_fantasia: null, cnpj: '11222333000181',
  cnae_principal: 0, municipio_id: null, uf: 'SP', ...over,
});

const LIST = [
  cli({ id: 20, company_id: 200, ativo: true, valor_estimado: '1500', notas: 'nota', representada: 'Rep X', razao_social: 'Cli RS1', nome_fantasia: 'Cli NF1', cnpj: '11222333000181', uf: 'SP', contatos: [{ id: 1, nome: 'C', cargo: null }] }),
  cli({ id: 21, company_id: 201, ativo: false, razao_social: 'Cli RS2', nome_fantasia: null, cnpj: '99888777000166', uf: '' }),
];

function mockData(list: unknown = { relationships: LIST }): void {
  m.get.mockImplementation(async (p: string) => {
    if (p.startsWith('/api/relationships')) return list;
    return {};
  });
}
function setCan(can: (c: string) => boolean): void {
  useAuthMock.mockReturnValue({
    user: { id: 1, email: 'a@x', role: 'admin', org_id: 1 },
    loading: false, login: vi.fn(), register: vi.fn(), refresh: vi.fn(), logout: vi.fn(),
    can, isOffice: true,
  });
}

beforeEach(() => {
  vi.mocked(m.get).mockReset();
  vi.mocked(m.post).mockReset();
  vi.mocked(m.patch).mockReset();
  vi.mocked(m.del).mockReset();
  toastMock.success.mockReset();
  toastMock.error.mockReset();
  confirmMock.mockReset();
  setCan(() => true);
  mockData();
});

describe('Clientes', () => {
  it('lista clientes com badges e KPIs', async () => {
    render(<Clientes />);
    expect(await screen.findByText('Cli NF1')).toBeInTheDocument();
    expect(screen.getByText('Cli RS2')).toBeInTheDocument(); // sem fantasia → razão
    expect(screen.getByText('Rep X')).toBeInTheDocument();
    expect(screen.getByText('inativo')).toBeInTheDocument();
    expect(screen.getByText('Clientes ativos')).toBeInTheDocument();
    expect(screen.getByText('sem detalhes do relacionamento')).toBeInTheDocument();
  });

  it('estado vazio quando não há clientes', async () => {
    mockData({ relationships: [] });
    render(<Clientes />);
    expect(await screen.findByText('Nenhum cliente ainda')).toBeInTheDocument();
  });

  it('filtra por nome e por CNPJ; mostra "nenhum corresponde"', async () => {
    render(<Clientes />);
    await screen.findByText('Cli NF1');
    const filtro = screen.getByPlaceholderText(/Filtrar por nome/);
    await userEvent.type(filtro, 'NF'); // sem dígito → só casa por nome
    expect(screen.queryByText('Cli RS2')).not.toBeInTheDocument();
    await userEvent.clear(filtro);
    await userEvent.type(filtro, 'zzzznaoexiste');
    expect(await screen.findByText('Nenhum cliente corresponde ao filtro.')).toBeInTheDocument();
    await userEvent.clear(filtro);
    await userEvent.type(filtro, '11222');
    expect(screen.getByText('Cli NF1')).toBeInTheDocument();
    expect(screen.queryByText('Cli RS2')).not.toBeInTheDocument();
  });

  it('adiciona cliente pela busca da base (sucesso)', async () => {
    m.post.mockResolvedValueOnce({ relationship: cli({ id: 99, company_id: 99, razao_social: 'Nova RS', nome_fantasia: 'Nova NF', cnpj: '11222333000199' }) });
    render(<Clientes />);
    await screen.findByText('Cli NF1');
    await userEvent.click(screen.getByRole('button', { name: /Novo cliente/ }));
    await userEvent.click(screen.getByRole('button', { name: 'pick-company' }));
    await waitFor(() => expect(m.post).toHaveBeenCalledWith('/api/relationships', { company_id: 99, status: 'cliente' }));
    expect(toastMock.success).toHaveBeenCalledWith('Cliente adicionado.');
    // fecha o painel de adicionar
    await userEvent.click(screen.getByRole('button', { name: /Novo cliente/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Fechar' }));
  });

  it('adicionar cliente com erro de funil e erro genérico', async () => {
    m.post.mockRejectedValueOnce(new Error('empresa já no funil'));
    render(<Clientes />);
    await screen.findByText('Cli NF1');
    await userEvent.click(screen.getByRole('button', { name: /Novo cliente/ }));
    await userEvent.click(screen.getByRole('button', { name: 'pick-company' }));
    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith('Empresa já está no funil — converta para cliente no Funil.'));

    m.post.mockRejectedValueOnce(new Error('erro qualquer'));
    await userEvent.click(screen.getByRole('button', { name: 'pick-company' }));
    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith('erro qualquer'));
  });

  it('importa CSV (sucesso com resumo completo)', async () => {
    m.post.mockResolvedValueOnce({ created: 2, alreadyExists: ['a'], notFound: ['b'], invalid: ['c'] });
    render(<Clientes />);
    await screen.findByText('Cli NF1');
    // o botão dispara o input escondido (fileRef.click)
    await userEvent.click(screen.getByRole('button', { name: /Importar CSV/ }));
    const file = new File(['11222333000181\n99888777000166'], 'clientes.csv', { type: 'text/csv' });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await userEvent.upload(input, file);
    await waitFor(() => expect(m.post).toHaveBeenCalledWith('/api/relationships/import', { cnpjs: ['11222333000181', '99888777000166'] }));
    expect(toastMock.success).toHaveBeenCalledWith('2 adicionado(s) · 1 já era(m) cliente · 1 fora da base · 1 inválido(s)');
  });

  it('importa CSV sem nenhum criado usa toast de erro', async () => {
    m.post.mockResolvedValueOnce({ created: 0, alreadyExists: [], notFound: [], invalid: [] });
    render(<Clientes />);
    await screen.findByText('Cli NF1');
    const file = new File(['11222333000181'], 'c.csv', { type: 'text/csv' });
    await userEvent.upload(document.querySelector('input[type="file"]') as HTMLInputElement, file);
    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith('0 adicionado(s)'));
  });

  it('importa CSV sem CNPJs válidos e sem arquivo', async () => {
    render(<Clientes />);
    await screen.findByText('Cli NF1');
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    // arquivo sem dígitos
    await userEvent.upload(input, new File(['nome,cidade'], 'x.csv', { type: 'text/csv' }));
    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith('Nenhum CNPJ encontrado no arquivo.'));
    // sem arquivo (change vazio) → não faz nada
    toastMock.error.mockClear();
    fireEvent.change(input, { target: { files: [] } });
    expect(toastMock.error).not.toHaveBeenCalled();
  });

  it('erro ao importar CSV dispara toast', async () => {
    m.post.mockRejectedValueOnce(new Error('falha import'));
    render(<Clientes />);
    await screen.findByText('Cli NF1');
    await userEvent.upload(document.querySelector('input[type="file"]') as HTMLInputElement, new File(['11222333000181'], 'c.csv'));
    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith('falha import'));
  });

  it('edita relacionamento e salva (e trata valor vazio)', async () => {
    m.patch.mockResolvedValueOnce({ relationship: { notas: 'nova nota', valor_estimado: '200' } });
    render(<Clientes />);
    await screen.findByText('Cli NF1');
    await userEvent.click(screen.getAllByRole('button', { name: 'Editar relacionamento' })[0]!);
    const valor = screen.getByPlaceholderText(/Valor estimado/);
    await userEvent.clear(valor); // deixa vazio → valor_estimado null
    const notas = screen.getByPlaceholderText(/Notas do relacionamento/);
    await userEvent.clear(notas);
    await userEvent.type(notas, 'nova nota');
    await userEvent.click(screen.getByRole('button', { name: 'Salvar' }));
    await waitFor(() => expect(m.patch).toHaveBeenCalledWith('/api/relationships/20', { notas: 'nova nota', valor_estimado: null }));
    expect(toastMock.success).toHaveBeenCalledWith('Cliente salvo.');
  });

  it('cancelar edição fecha o form; erro ao salvar dispara toast', async () => {
    render(<Clientes />);
    await screen.findByText('Cli NF1');
    await userEvent.click(screen.getAllByRole('button', { name: 'Editar relacionamento' })[0]!);
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(screen.queryByPlaceholderText(/Notas do relacionamento/)).not.toBeInTheDocument();

    m.patch.mockRejectedValueOnce(new Error('nao salvou'));
    await userEvent.click(screen.getAllByRole('button', { name: 'Editar relacionamento' })[0]!);
    await userEvent.click(screen.getByRole('button', { name: 'Salvar' }));
    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith('nao salvou'));
  });

  it('ativa/inativa cliente (sucesso e erro com rollback)', async () => {
    m.patch.mockResolvedValueOnce({});
    render(<Clientes />);
    await screen.findByText('Cli NF1');
    await userEvent.click(screen.getByRole('button', { name: 'Inativar cliente' }));
    await waitFor(() => expect(m.patch).toHaveBeenCalledWith('/api/relationships/20', { ativo: false }));

    // após inativar K1, há dois botões "Reativar cliente" — clica um; patch falha → rollback
    m.patch.mockRejectedValueOnce(new Error('x'));
    await userEvent.click(screen.getAllByRole('button', { name: 'Reativar cliente' })[0]!);
    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith('Não foi possível atualizar.'));
  });

  it('remove cliente: confirma e DELETE; cancelar e erro', async () => {
    confirmMock.mockResolvedValueOnce(false);
    render(<Clientes />);
    await screen.findByText('Cli NF1');
    await userEvent.click(screen.getAllByRole('button', { name: 'Remover cliente' })[0]!);
    expect(m.del).not.toHaveBeenCalled();

    confirmMock.mockResolvedValueOnce(true);
    m.del.mockResolvedValueOnce({});
    await userEvent.click(screen.getAllByRole('button', { name: 'Remover cliente' })[0]!);
    await waitFor(() => expect(m.del).toHaveBeenCalledWith('/api/relationships/20'));
    expect(toastMock.success).toHaveBeenCalledWith('Vínculo removido.');
  });

  it('erro ao remover reverte e dispara toast', async () => {
    confirmMock.mockResolvedValue(true);
    m.del.mockRejectedValueOnce(new Error('x'));
    render(<Clientes />);
    await screen.findByText('Cli NF1');
    await userEvent.click(screen.getAllByRole('button', { name: 'Remover cliente' })[0]!);
    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith('Não foi possível remover.'));
    // permanece na lista após rollback
    expect(screen.getByText('Cli NF1')).toBeInTheDocument();
  });

  it('abre e fecha o modal de dados da empresa', async () => {
    render(<Clientes />);
    await screen.findByText('Cli NF1');
    await userEvent.click(screen.getAllByRole('button', { name: 'Ver dados da empresa' })[0]!);
    expect(await screen.findByTestId('company-modal')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'close-modal' }));
    expect(screen.queryByTestId('company-modal')).not.toBeInTheDocument();
  });

  it('sem permissões esconde importar/novo/editar/remover mas mantém "ver empresa"', async () => {
    setCan(() => false);
    render(<Clientes />);
    await screen.findByText('Cli NF1');
    expect(screen.queryByRole('button', { name: /Importar CSV/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Novo cliente/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Editar relacionamento' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remover cliente' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Inativar cliente' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Ver dados da empresa' }).length).toBe(2);
  });
});
