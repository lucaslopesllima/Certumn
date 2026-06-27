// Equipe (admin): lista, criação com senha provisória, papel/ativo, reset de senha.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Team } from '../src/pages/Team.tsx';
import { api, ApiError } from '../src/lib/api.ts';
import { useAuth } from '../src/lib/auth.tsx';

vi.mock('../src/lib/auth.tsx', () => ({ useAuth: vi.fn() }));
vi.mock('../src/lib/api.ts', async (orig) => {
  const real = await orig() as Record<string, unknown>;
  return { ...real, api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), del: vi.fn() } };
});
const m = vi.mocked(api);
const useAuthMock = vi.mocked(useAuth);

const ME = { id: 1, nome: 'Admin', email: 'adm@org.com', role: 'admin' as const, ativo: true, must_change_password: false };
const REP = { id: 2, nome: 'Vendedor', email: 'rep@org.com', role: 'rep' as const, ativo: true, must_change_password: true };

beforeEach(() => {
  vi.mocked(m.get).mockReset();
  vi.mocked(m.post).mockReset();
  vi.mocked(m.patch).mockReset();
  useAuthMock.mockReturnValue({
    user: { id: 1, email: ME.email, role: 'admin', org_id: 1 },
    loading: false, login: vi.fn(), register: vi.fn(), refresh: vi.fn(), logout: vi.fn(),
  });
  m.get.mockResolvedValue({ users: [ME, REP] });
});

describe('Team', () => {
  it('lista usuários, marca (você) e badge de senha provisória', async () => {
    render(<Team />);
    expect(await screen.findByText('rep@org.com')).toBeInTheDocument();
    expect(screen.getByText('(você)')).toBeInTheDocument();
    expect(screen.getByText('Senha provisória')).toBeInTheDocument();
    // ações não aparecem na própria linha
    expect(screen.getAllByRole('button', { name: 'Desativar' })).toHaveLength(1);
  });

  it('cria usuário pelo formulário e recarrega', async () => {
    m.post.mockResolvedValueOnce({ user: {} });
    render(<Team />);
    await screen.findByText('rep@org.com');

    await userEvent.click(screen.getByRole('button', { name: /Novo usuário/ }));
    const form = document.querySelector('form')!;
    const inputs = form.querySelectorAll('input');
    await userEvent.type(inputs[0]!, 'Novo Vendedor');
    await userEvent.type(inputs[1]!, 'novo@org.com');
    await userEvent.type(inputs[2]!, 'provisoria1');
    await userEvent.click(screen.getByRole('button', { name: 'Criar usuário' }));

    expect(m.post).toHaveBeenCalledWith('/api/users',
      { nome: 'Novo Vendedor', email: 'novo@org.com', senha: 'provisoria1', role: 'rep' });
    await waitFor(() => expect(m.get).toHaveBeenCalledTimes(2)); // recarregou
  });

  it('erro da API ao criar aparece na tela', async () => {
    m.post.mockRejectedValueOnce(new ApiError(409, 'email já cadastrado'));
    render(<Team />);
    await screen.findByText('rep@org.com');
    await userEvent.click(screen.getByRole('button', { name: /Novo usuário/ }));
    const inputs = document.querySelector('form')!.querySelectorAll('input');
    await userEvent.type(inputs[0]!, 'X');
    await userEvent.type(inputs[1]!, 'rep@org.com');
    await userEvent.type(inputs[2]!, 'provisoria1');
    await userEvent.click(screen.getByRole('button', { name: 'Criar usuário' }));
    expect(await screen.findByText('email já cadastrado')).toBeInTheDocument();
  });

  it('desativar chama PATCH ativo=false; troca de papel chama PATCH role', async () => {
    m.patch.mockResolvedValue({});
    render(<Team />);
    await screen.findByText('rep@org.com');

    await userEvent.click(screen.getByRole('button', { name: 'Desativar' }));
    expect(m.patch).toHaveBeenCalledWith('/api/users/2', { ativo: false });

    const selects = screen.getAllByRole('combobox');
    // primeiro select é o do admin (desabilitado), segundo é o do rep
    expect(selects[0]).toBeDisabled();
    await userEvent.selectOptions(selects[1]!, 'admin');
    expect(m.patch).toHaveBeenCalledWith('/api/users/2', { role: 'admin' });
  });

  it('redefinir senha usa modal; cancelar não chama API', async () => {
    render(<Team />);
    await screen.findByText('rep@org.com');
    // abre o modal e cancela — nenhuma chamada
    await userEvent.click(screen.getByRole('button', { name: 'Redefinir senha' }));
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(m.post).not.toHaveBeenCalled();

    // reabre, digita senha provisória válida e confirma
    await userEvent.click(screen.getByRole('button', { name: 'Redefinir senha' }));
    m.post.mockResolvedValueOnce({ ok: true });
    await userEvent.type(screen.getByPlaceholderText('Nova senha provisória'), 'novaprov1');
    await userEvent.click(screen.getByRole('button', { name: 'Redefinir' }));
    expect(m.post).toHaveBeenCalledWith('/api/users/2/password', { senha: 'novaprov1' });
  });
});
