// Troca de senha provisória: validação local, token rotacionado salvo, refresh.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { ChangePassword } from '../src/pages/ChangePassword.tsx';
import { useAuth } from '../src/lib/auth.tsx';
import { api, getToken, setToken, ApiError } from '../src/lib/api.ts';

vi.mock('../src/lib/auth.tsx', () => ({ useAuth: vi.fn() }));
vi.mock('../src/lib/api.ts', async (orig) => {
  const real = await orig() as Record<string, unknown>;
  return { ...real, api: { ...(real.api as object), post: vi.fn() } };
});

const useAuthMock = vi.mocked(useAuth);
const postMock = vi.mocked(api.post);
const refresh = vi.fn().mockResolvedValue(undefined);

const mount = (): ReturnType<typeof render> => render(
  <MemoryRouter initialEntries={['/trocar-senha']}>
    <Routes>
      <Route path="/trocar-senha" element={<ChangePassword />} />
      <Route path="/" element={<div>HOME</div>} />
    </Routes>
  </MemoryRouter>,
);

async function fill(atual: string, nova: string, conf: string): Promise<void> {
  const inputs = screen.getAllByDisplayValue('');
  await userEvent.type(inputs[0]!, atual);
  await userEvent.type(inputs[1]!, nova);
  await userEvent.type(inputs[2]!, conf);
  await userEvent.click(screen.getByRole('button', { name: 'Salvar e continuar' }));
}

beforeEach(() => {
  postMock.mockReset();
  refresh.mockClear();
  setToken(null);
  useAuthMock.mockReturnValue({
    user: { id: 1, email: 'a@b.c', role: 'rep', org_id: 1, nome: 'Vendedor', must_change_password: true },
    loading: false, login: vi.fn(), register: vi.fn(), refresh, logout: vi.fn(),
  });
});

describe('ChangePassword', () => {
  it('valida tamanho mínimo antes de chamar a API', async () => {
    mount();
    await fill('prov1x', 'curta', 'curta');
    expect(screen.getByText(/ao menos 6 caracteres/)).toBeInTheDocument();
    expect(postMock).not.toHaveBeenCalled();
  });

  it('confirmação divergente bloqueia o envio', async () => {
    mount();
    await fill('prov1x', 'senhanova1', 'senhanova2');
    expect(screen.getByText('A confirmação não confere.')).toBeInTheDocument();
    expect(postMock).not.toHaveBeenCalled();
  });

  it('sucesso: guarda o token novo, faz refresh e navega para /', async () => {
    postMock.mockResolvedValueOnce({ ok: true, token: 'token-novo' });
    mount();
    await fill('prov1x', 'senhanova1', 'senhanova1');
    expect(postMock).toHaveBeenCalledWith('/api/account/password',
      { senha_atual: 'prov1x', nova_senha: 'senhanova1' });
    expect(getToken()).toBe('token-novo');
    expect(refresh).toHaveBeenCalled();
    expect(await screen.findByText('HOME')).toBeInTheDocument();
  });

  it('erro da API aparece na tela', async () => {
    postMock.mockRejectedValueOnce(new ApiError(400, 'senha atual incorreta'));
    mount();
    await fill('errada', 'senhanova1', 'senhanova1');
    expect(await screen.findByText('senha atual incorreta')).toBeInTheDocument();
  });
});
