// Página de Representadas (Cadastros): CRUD, autopreencher pela base RFB,
// toggle ativo, marcas (BrandsEditor) e gating por permissão.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Representadas } from '../src/pages/Representadas.tsx';
import { api } from '../src/lib/api.ts';
import { useAuth, type User } from '../src/lib/auth.tsx';
import { toast } from '../src/lib/toast.tsx';
import { confirmDialog } from '../src/lib/confirm.ts';

// Empresa devolvida pelo CompanySearch (controlável por teste).
const hoisted = vi.hoisted(() => ({
  companyHit: {
    id: 99, cnpj: '12345678000195', razao_social: 'Fornecedor RS',
    nome_fantasia: 'RS Marca', telefone1: '4830001111', email: 'contato@rs.com',
  } as Record<string, unknown>,
}));

vi.mock('../src/lib/api.ts', async (orig) => {
  const real = await orig() as Record<string, unknown>;
  return { ...real, api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), del: vi.fn(), invalidate: vi.fn() } };
});
vi.mock('../src/lib/auth.tsx', () => {
  const useAuth = vi.fn();
  return { useAuth, useOptionalUser: () => useAuth().user ?? null };
});
vi.mock('../src/lib/toast.tsx', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock('../src/lib/confirm.ts', () => ({ confirmDialog: vi.fn() }));
vi.mock('../src/lib/companySearch.tsx', () => ({
  CompanySearch: ({ onPick }: { onPick: (c: unknown) => void }) => (
    <button type="button" onClick={() => onPick(hoisted.companyHit)}>mock-pick</button>
  ),
}));

const m = vi.mocked(api);
const useAuthMock = vi.mocked(useAuth);
const toastMock = vi.mocked(toast);
const confirmMock = vi.mocked(confirmDialog);

const admin: User = { id: 1, email: 'a@b.c', role: 'admin', org_id: 1, org_nome: 'Org' };

// Fixtures reatribuíveis por teste antes do render.
let reps: Record<string, unknown>[];
let brands: Record<string, unknown>[];

function setAuth(over: { user?: Partial<User>; can?: (c: string) => boolean } = {}): void {
  useAuthMock.mockReturnValue({
    user: { ...admin, ...(over.user ?? {}) }, loading: false,
    login: vi.fn(), register: vi.fn(), refresh: vi.fn(), logout: vi.fn(),
    can: over.can ?? (() => true), isOffice: true,
  });
}

beforeEach(() => {
  m.get.mockReset(); m.post.mockReset(); m.put.mockReset(); m.patch.mockReset(); m.del.mockReset();
  toastMock.success.mockReset(); toastMock.error.mockReset();
  confirmMock.mockReset(); confirmMock.mockResolvedValue(true);
  reps = []; brands = [];
  setAuth();
  m.get.mockImplementation(async (p: string) => {
    if (p === '/api/represented') return { empresas: reps };
    if (p.startsWith('/api/brands')) return { brands };
    return {};
  });
});

describe('Representadas', () => {
  const rep = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
    id: 5, nome: 'ACME', cnpj: '123', segmento: 'Calçados', site: 'x.com',
    contato: 'joao', notas: 'nota importante', ativo: true, ...over,
  });

  it('cria uma representada puxando dados da base', async () => {
    m.post.mockResolvedValueOnce({ empresa: rep({ id: 6, nome: 'RS Marca' }) });
    render(<Representadas />);
    await screen.findByText('Nenhuma empresa cadastrada');
    await userEvent.click(screen.getByRole('button', { name: 'Nova' }));

    // preenche via CompanySearch
    await userEvent.click(screen.getByText('mock-pick'));
    const nome = await screen.findByDisplayValue('RS Marca');
    expect(nome).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Salvar' }));
    await waitFor(() => expect(m.post).toHaveBeenCalledWith('/api/represented', expect.objectContaining({ nome: 'RS Marca' })));
    expect(toastMock.success).toHaveBeenCalledWith('Representada criada.');
  });

  it('form não envia sem nome e cria com erro', async () => {
    m.post.mockRejectedValueOnce(new Error('rep-fail'));
    render(<Representadas />);
    await screen.findByText('Nenhuma empresa cadastrada');
    await userEvent.click(screen.getByRole('button', { name: 'Nova' }));

    // submit sem nome: nada
    await userEvent.click(screen.getByRole('button', { name: 'Salvar' }));
    expect(m.post).not.toHaveBeenCalled();

    await userEvent.type(screen.getByPlaceholderText(/Nome da empresa/), 'Teste');
    // mexe no CNPJ (máscara) e nas notas
    await userEvent.type(screen.getByPlaceholderText('CNPJ'), '11222333000181');
    await userEvent.type(screen.getByPlaceholderText(/Notas/), 'obs');
    await userEvent.click(screen.getByRole('button', { name: 'Salvar' }));
    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith('rep-fail'));

    // cancela o formulário novo (onCancel)
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(screen.queryByPlaceholderText(/Nome da empresa/)).not.toBeInTheDocument();
  });

  it('lista, edita, alterna ativo e exclui', async () => {
    reps = [rep(), rep({ id: 8, nome: 'Sem detalhes', cnpj: null, contato: null, site: null, notas: null, segmento: null, ativo: false })];
    m.patch.mockResolvedValue({ empresa: rep({ nome: 'ACME editado' }) });
    m.del.mockResolvedValueOnce({});
    render(<Representadas />);
    expect(await screen.findByText('ACME')).toBeInTheDocument();
    expect(screen.getByText('ativa')).toBeInTheDocument();
    expect(screen.getByText('inativa')).toBeInTheDocument();
    expect(screen.getByText('sem detalhes')).toBeInTheDocument();
    expect(screen.getByText('Calçados')).toBeInTheDocument();

    // editar -> salva update (patch)
    await userEvent.click(screen.getAllByLabelText('Editar')[0]!);
    await userEvent.click(screen.getByRole('button', { name: 'Salvar' }));
    await waitFor(() => expect(m.patch).toHaveBeenCalledWith('/api/represented/5', expect.objectContaining({ nome: 'ACME' })));
    expect(toastMock.success).toHaveBeenCalledWith('Representada salva.');

    // alternar ativo (sucesso)
    await userEvent.click(screen.getByTitle('Desativar'));
    await waitFor(() => expect(m.patch).toHaveBeenCalledWith('/api/represented/5', { ativo: false }));

    // excluir (confirm true)
    await userEvent.click(screen.getAllByLabelText('Excluir')[0]!);
    await waitFor(() => expect(m.del).toHaveBeenCalledWith('/api/represented/5'));
    expect(toastMock.success).toHaveBeenCalledWith('Representada excluída.');
  });

  it('reverte quando toggle/exclusão/edição falham', async () => {
    reps = [rep()];
    render(<Representadas />);
    await screen.findByText('ACME');

    // toggle falha -> reverte + toast
    m.patch.mockRejectedValueOnce(new Error('x'));
    await userEvent.click(screen.getByTitle('Desativar'));
    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith('Não foi possível atualizar.'));

    // update falha
    m.patch.mockRejectedValueOnce(new Error('upd-fail'));
    await userEvent.click(screen.getAllByLabelText('Editar')[0]!);
    await userEvent.click(screen.getByRole('button', { name: 'Salvar' }));
    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith('upd-fail'));
    // cancelar o form de edição
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }));

    // delete cancelado
    confirmMock.mockResolvedValueOnce(false);
    await userEvent.click(screen.getAllByLabelText('Excluir')[0]!);
    expect(m.del).not.toHaveBeenCalled();

    // delete falha -> reverte
    m.del.mockRejectedValueOnce(new Error('d'));
    await userEvent.click(screen.getAllByLabelText('Excluir')[0]!);
    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith('Não foi possível excluir.'));
  });

  it('BrandsEditor: lista, adiciona e remove marcas', async () => {
    reps = [rep()];
    brands = [{ id: 1, represented_id: 5, nome: 'Marca A' }];
    m.post.mockResolvedValueOnce({ brand: { id: 2, represented_id: 5, nome: 'Marca B' } });
    m.del.mockResolvedValueOnce({});
    render(<Representadas />);
    await screen.findByText('ACME');
    await userEvent.click(screen.getAllByLabelText('Editar')[0]!);
    expect(await screen.findByText('Marca A')).toBeInTheDocument();

    // adicionar vazio: nada
    await userEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(m.post).not.toHaveBeenCalled();

    await userEvent.type(screen.getByPlaceholderText('Nova marca'), 'Marca B');
    await userEvent.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(m.post).toHaveBeenCalledWith('/api/brands', { represented_id: 5, nome: 'Marca B' }));
    expect(await screen.findByText('Marca B')).toBeInTheDocument();

    // remover marca (a primeira, Marca A)
    await userEvent.click(screen.getAllByLabelText('Remover')[0]!);
    await waitFor(() => expect(m.del).toHaveBeenCalledWith('/api/brands/1'));
  });

  it('BrandsEditor vazio e gating de permissões', async () => {
    reps = [rep()];
    brands = [];
    setAuth({ can: () => false });
    render(<Representadas />);
    await screen.findByText('ACME');
    // sem represented.update não há botão Editar → não abre BrandsEditor; valida gating no topo
    expect(screen.queryByRole('button', { name: 'Nova' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Editar')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Excluir')).not.toBeInTheDocument();
  });
});
