// Tela de login: alterna login/registro, submete, mostra erro, redireciona logado.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { Login } from '../src/pages/Login.tsx';
import { useAuth } from '../src/lib/auth.tsx';

vi.mock('../src/lib/auth.tsx', () => ({ useAuth: vi.fn() }));
const useAuthMock = vi.mocked(useAuth);

const authState = (over: Partial<ReturnType<typeof useAuth>> = {}): ReturnType<typeof useAuth> => ({
  user: null, loading: false,
  login: vi.fn(), register: vi.fn(), refresh: vi.fn(), logout: vi.fn(),
  ...over,
});

const mount = (): ReturnType<typeof render> => render(
  <MemoryRouter initialEntries={['/login']}>
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/" element={<div>HOME</div>} />
    </Routes>
  </MemoryRouter>,
);

beforeEach(() => useAuthMock.mockReturnValue(authState()));

describe('Login', () => {
  it('submete credenciais no modo login', async () => {
    const login = vi.fn().mockResolvedValue(undefined);
    useAuthMock.mockReturnValue(authState({ login }));
    mount();

    await userEvent.type(screen.getByPlaceholderText('voce@empresa.com'), 'eu@org.com');
    await userEvent.type(screen.getByPlaceholderText('mínimo 6 caracteres'), 'senha123');
    await userEvent.click(screen.getAllByRole('button', { name: 'Entrar' }).at(-1)!); // tab + submit têm o mesmo nome
    expect(login).toHaveBeenCalledWith('eu@org.com', 'senha123');
  });

  it('modo registro tem tipo de conta com Individual pré-selecionado', async () => {
    useAuthMock.mockReturnValue(authState());
    mount();
    await userEvent.click(screen.getByRole('button', { name: 'Criar conta' }));

    const individual = screen.getByRole('radio', { name: /Individual/ }) as HTMLInputElement;
    const escritorio = screen.getByRole('radio', { name: /Escritório/ }) as HTMLInputElement;
    expect(individual.checked).toBe(true);
    expect(escritorio.checked).toBe(false);
    // default individual → label/placeholder do nome
    expect(screen.getByPlaceholderText('João Silva Representações')).toBeInTheDocument();
  });

  it('registro default (individual) chama register com tipo_conta', async () => {
    const register = vi.fn().mockResolvedValue(undefined);
    useAuthMock.mockReturnValue(authState({ register }));
    mount();

    await userEvent.click(screen.getByRole('button', { name: 'Criar conta' }));
    await userEvent.type(screen.getByPlaceholderText('João Silva Representações'), 'Minha Org');
    await userEvent.type(screen.getByPlaceholderText('voce@empresa.com'), 'eu@org.com');
    await userEvent.type(screen.getByPlaceholderText('mínimo 6 caracteres'), 'senha123');
    await userEvent.click(screen.getAllByRole('button', { name: 'Criar conta' })[1]!);
    expect(register).toHaveBeenCalledWith('Minha Org', 'eu@org.com', 'senha123', 'individual');
  });

  it('escolher Escritório muda o label do nome e o tipo enviado', async () => {
    const register = vi.fn().mockResolvedValue(undefined);
    useAuthMock.mockReturnValue(authState({ register }));
    mount();

    await userEvent.click(screen.getByRole('button', { name: 'Criar conta' }));
    await userEvent.click(screen.getByRole('radio', { name: /Escritório/ }));
    await userEvent.type(screen.getByPlaceholderText('Minha Representação'), 'Meu Escritório');
    await userEvent.type(screen.getByPlaceholderText('voce@empresa.com'), 'eu@org.com');
    await userEvent.type(screen.getByPlaceholderText('mínimo 6 caracteres'), 'senha123');
    await userEvent.click(screen.getAllByRole('button', { name: 'Criar conta' })[1]!);
    expect(register).toHaveBeenCalledWith('Meu Escritório', 'eu@org.com', 'senha123', 'escritorio');
  });

  it('mostra a mensagem de erro da API', async () => {
    const login = vi.fn().mockRejectedValue(new Error('credenciais inválidas'));
    useAuthMock.mockReturnValue(authState({ login }));
    mount();

    await userEvent.type(screen.getByPlaceholderText('voce@empresa.com'), 'eu@org.com');
    await userEvent.type(screen.getByPlaceholderText('mínimo 6 caracteres'), 'senhaerrada');
    await userEvent.click(screen.getAllByRole('button', { name: 'Entrar' }).at(-1)!);
    expect(await screen.findByText('credenciais inválidas')).toBeInTheDocument();
  });

  it('usuário logado é redirecionado para /', () => {
    useAuthMock.mockReturnValue(authState({
      user: { id: 1, email: 'a@b.c', role: 'admin', org_id: 1 },
    }));
    mount();
    expect(screen.getByText('HOME')).toBeInTheDocument();
  });
});
