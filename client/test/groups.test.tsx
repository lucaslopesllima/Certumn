// Grupos de permissão (RBAC): lista, editor com módulos/checkboxes, CRUD.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Groups } from '../src/pages/Groups.tsx';
import { api, ApiError } from '../src/lib/api.ts';

vi.mock('../src/lib/api.ts', async (orig) => {
  const real = await orig() as Record<string, unknown>;
  return { ...real, api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), del: vi.fn() } };
});
vi.mock('../src/lib/toast.tsx', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock('../src/lib/confirm.ts', () => ({ confirmDialog: vi.fn() }));
import { toast } from '../src/lib/toast.tsx';
import { confirmDialog } from '../src/lib/confirm.ts';

const m = vi.mocked(api);
const toastMock = vi.mocked(toast);
const confirmMock = vi.mocked(confirmDialog);

const CATALOG = [
  { code: 'users.create', label: 'Criar usuário', module: 'Equipe' },
  { code: 'users.update', label: 'Editar usuário', module: 'Equipe' },
  { code: 'relationships.create', label: 'Criar cliente', module: 'Clientes' },
];
const GROUPS = [
  { id: 1, nome: 'Administradores', is_admin: true, permissions: [], created_at: '', user_count: 3 },
  { id: 2, nome: 'Vendas', is_admin: false, permissions: ['users.create'], created_at: '', user_count: 2 },
];

function mockGet(over?: { groups?: unknown; catalog?: unknown }): void {
  m.get.mockImplementation(async (p: string) => {
    if (p === '/api/groups') { if (over?.groups instanceof Error) throw over.groups; return over?.groups ?? { groups: GROUPS }; }
    if (p === '/api/permissions/catalog') return over?.catalog ?? { permissions: CATALOG };
    return {};
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
  mockGet();
});

describe('Groups', () => {
  it('lista grupos com badges de acesso total e contagem de permissões', async () => {
    render(<Groups />);
    expect(await screen.findByText('Administradores')).toBeInTheDocument();
    expect(screen.getByText('Acesso total')).toBeInTheDocument();
    expect(screen.getByText('1 permissões')).toBeInTheDocument();
    expect(screen.getByText('3 usuário(s)')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Ver/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Editar/ })).toBeInTheDocument();
  });

  it('estado vazio quando não há grupos', async () => {
    mockGet({ groups: { groups: [] } });
    render(<Groups />);
    expect(await screen.findByText('Nenhum grupo')).toBeInTheDocument();
  });

  it('erro ao carregar mostra mensagem (ApiError)', async () => {
    mockGet({ groups: new ApiError(500, 'falhou grupos') });
    render(<Groups />);
    expect(await screen.findByText('falhou grupos')).toBeInTheDocument();
  });

  it('erro genérico ao carregar usa fallback', async () => {
    mockGet({ groups: new Error('boom') });
    render(<Groups />);
    expect(await screen.findByText('Erro ao carregar grupos')).toBeInTheDocument();
  });

  it('editar grupo: alterna permissões e módulo, salva com PATCH', async () => {
    m.patch.mockResolvedValueOnce({});
    render(<Groups />);
    await screen.findByText('Vendas');
    await userEvent.click(screen.getByRole('button', { name: /Editar/ }));
    // nome preenchido
    expect(screen.getByDisplayValue('Vendas')).toBeInTheDocument();
    // toggle de um checkbox individual (marca users.update)
    await userEvent.click(screen.getByLabelText('Editar usuário'));
    // marca tudo do módulo Clientes
    const marcarTudo = screen.getAllByRole('button', { name: /Marcar tudo/ });
    await userEvent.click(marcarTudo[marcarTudo.length - 1]!);
    await userEvent.click(screen.getByRole('button', { name: 'Salvar' }));
    expect(m.patch).toHaveBeenCalledWith('/api/groups/2', expect.objectContaining({ nome: 'Vendas' }));
    const body = m.patch.mock.calls[0]![1] as { permissions: string[] };
    expect(body.permissions).toEqual(expect.arrayContaining(['users.create', 'users.update', 'relationships.create']));
    expect(toastMock.success).toHaveBeenCalledWith('Grupo atualizado.');
  });

  it('desmarcar tudo de um módulo já marcado', async () => {
    render(<Groups />);
    await screen.findByText('Vendas');
    await userEvent.click(screen.getByRole('button', { name: /Editar/ }));
    // Equipe tem users.create marcado, users.update não → "Marcar tudo".
    // clica marcar tudo do módulo Equipe → agora tudo marcado → vira "Desmarcar tudo"
    const equipeBtn = () => screen.getAllByRole('button', { name: /marcar tudo/i })[0]!;
    await userEvent.click(equipeBtn());
    expect(screen.getByRole('button', { name: 'Desmarcar tudo' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Desmarcar tudo' }));
    expect(screen.getAllByRole('button', { name: 'Marcar tudo' }).length).toBeGreaterThan(0);
  });

  it('novo grupo: nome vazio bloqueia; depois cria com POST', async () => {
    m.post.mockResolvedValueOnce({});
    render(<Groups />);
    await screen.findByText('Vendas');
    await userEvent.click(screen.getByRole('button', { name: /Novo grupo/ }));
    // salvar sem nome → erro inline
    await userEvent.click(screen.getByRole('button', { name: 'Salvar' }));
    expect(await screen.findByText('Informe o nome do grupo.')).toBeInTheDocument();
    expect(m.post).not.toHaveBeenCalled();
    // digita nome e marca uma permissão (Criar cliente = relationships.create)
    await userEvent.type(screen.getByRole('textbox'), 'Suporte');
    await userEvent.click(screen.getByLabelText('Criar cliente'));
    await userEvent.click(screen.getByRole('button', { name: 'Salvar' }));
    expect(m.post).toHaveBeenCalledWith('/api/groups', { nome: 'Suporte', permissions: ['relationships.create'] });
    expect(toastMock.success).toHaveBeenCalledWith('Grupo criado.');
  });

  it('erro ao salvar dispara toast e mostra mensagem', async () => {
    m.patch.mockRejectedValueOnce(new ApiError(400, 'nome em uso'));
    render(<Groups />);
    await screen.findByText('Vendas');
    await userEvent.click(screen.getByRole('button', { name: /Editar/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Salvar' }));
    expect(await screen.findByText('nome em uso')).toBeInTheDocument();
    expect(toastMock.error).toHaveBeenCalledWith('nome em uso');
  });

  it('excluir grupo: confirma e DELETE; cancelar e erro', async () => {
    // cancelado
    confirmMock.mockResolvedValueOnce(false);
    render(<Groups />);
    await screen.findByText('Vendas');
    await userEvent.click(screen.getByRole('button', { name: /Editar/ }));
    await userEvent.click(screen.getByRole('button', { name: /Excluir grupo/ }));
    expect(m.del).not.toHaveBeenCalled();

    // sucesso
    confirmMock.mockResolvedValueOnce(true);
    m.del.mockResolvedValueOnce({});
    await userEvent.click(screen.getByRole('button', { name: /Excluir grupo/ }));
    await waitFor(() => expect(m.del).toHaveBeenCalledWith('/api/groups/2'));
    expect(toastMock.success).toHaveBeenCalledWith('Grupo excluído.');
  });

  it('erro ao excluir grupo dispara toast', async () => {
    confirmMock.mockResolvedValue(true);
    m.del.mockRejectedValueOnce(new ApiError(400, 'grupo em uso'));
    render(<Groups />);
    await screen.findByText('Vendas');
    await userEvent.click(screen.getByRole('button', { name: /Editar/ }));
    await userEvent.click(screen.getByRole('button', { name: /Excluir grupo/ }));
    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith('grupo em uso'));
  });

  it('grupo admin abre somente-leitura (Ver) e fecha pelo Fechar', async () => {
    render(<Groups />);
    await screen.findByText('Administradores');
    await userEvent.click(screen.getByRole('button', { name: /Ver/ }));
    expect(screen.getByText('Grupo Administrador')).toBeInTheDocument();
    expect(screen.getByText(/acesso total e não é editável/)).toBeInTheDocument();
    expect(screen.getByText(/Todas as permissões do sistema/)).toBeInTheDocument();
    // sem botão Salvar nem Excluir no modo leitura
    expect(screen.queryByRole('button', { name: 'Salvar' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Excluir grupo/ })).not.toBeInTheDocument();
    // "Fechar" existe como X (aria-label) e como botão do rodapé — clica o do rodapé
    await userEvent.click(screen.getAllByRole('button', { name: 'Fechar' }).at(-1)!);
    expect(screen.queryByText('Grupo Administrador')).not.toBeInTheDocument();
  });

  it('fecha o editor pelo X e pelo overlay', async () => {
    render(<Groups />);
    await screen.findByText('Vendas');
    // fecha pelo X (primeiro botão "Fechar" — o do cabeçalho)
    await userEvent.click(screen.getByRole('button', { name: /Editar/ }));
    await userEvent.click(screen.getAllByRole('button', { name: 'Fechar' })[0]!);
    expect(screen.queryByDisplayValue('Vendas')).not.toBeInTheDocument();
    // reabre e fecha pelo overlay
    await userEvent.click(screen.getByRole('button', { name: /Editar/ }));
    const overlay = document.querySelector('.fixed.inset-0') as HTMLElement;
    await userEvent.click(overlay);
    expect(screen.queryByDisplayValue('Vendas')).not.toBeInTheDocument();
  });
});
