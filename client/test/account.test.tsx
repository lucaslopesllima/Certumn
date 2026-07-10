// Minha conta: carga, salvar dados, ViaCEP, troca de senha com rotação de token.
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Account } from '../src/pages/Account.tsx';
import { api, getToken, setToken, ApiError } from '../src/lib/api.ts';

vi.mock('../src/lib/api.ts', async (orig) => {
  const real = await orig() as Record<string, unknown>;
  return { ...real, api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), del: vi.fn() } };
});
const m = vi.mocked(api);

// Account consome useAuth (is_admin p/ o card de tipo de conta, refresh após upgrade).
vi.mock('../src/lib/auth.tsx', () => ({
  useAuth: () => ({ user: { id: 1, email: 'eu@org.com', role: 'admin', org_id: 1, is_admin: true }, refresh: vi.fn() }),
}));

const fetchMock = vi.fn(); // ViaCEP usa fetch direto, não o api.ts
vi.stubGlobal('fetch', fetchMock);
afterAll(() => vi.unstubAllGlobals());

const ORG = {
  id: 1, nome: 'Minha Rep', cnpj: null, telefone: null, cep: null,
  logradouro: null, numero: null, complemento: null, bairro: null, cidade: null, uf: null,
};
const USER = { id: 1, email: 'eu@org.com', role: 'admin' };

beforeEach(() => {
  vi.mocked(m.get).mockReset();
  vi.mocked(m.patch).mockReset();
  vi.mocked(m.post).mockReset();
  fetchMock.mockReset();
  setToken(null);
  m.get.mockResolvedValue({ org: ORG, user: USER });
});

describe('Account', () => {
  it('carrega org e e-mail; salva alterações via PATCH', async () => {
    m.patch.mockResolvedValueOnce({ org: { ...ORG, nome: 'Renomeada' }, user: USER });
    render(<Account />);
    const nome = await screen.findByDisplayValue('Minha Rep');

    await userEvent.clear(nome);
    await userEvent.type(nome, 'Renomeada');
    await userEvent.click(screen.getByRole('button', { name: /Salvar/ }));
    expect(m.patch).toHaveBeenCalledWith('/api/account',
      expect.objectContaining({ nome: 'Renomeada', email: 'eu@org.com' }));
  });

  it('erro do PATCH (e-mail duplicado) aparece na tela', async () => {
    m.patch.mockRejectedValueOnce(new ApiError(409, 'email já cadastrado'));
    render(<Account />);
    await screen.findByDisplayValue('Minha Rep');
    await userEvent.click(screen.getByRole('button', { name: /Salvar/ }));
    expect(await screen.findByText('email já cadastrado')).toBeInTheDocument();
  });

  it('CEP completo consulta ViaCEP e preenche endereço', async () => {
    fetchMock.mockResolvedValueOnce({
      json: async () => ({ logradouro: 'Av. Paulista', bairro: 'Bela Vista', localidade: 'São Paulo', uf: 'SP' }),
    });
    render(<Account />);
    await screen.findByDisplayValue('Minha Rep');

    const cep = screen.getByPlaceholderText('00000-000');
    await userEvent.type(cep, '01310100');
    await waitFor(() => expect(screen.getByDisplayValue('Av. Paulista')).toBeInTheDocument());
    expect(String(fetchMock.mock.calls[0]![0])).toContain('viacep.com.br/ws/01310100');
  });

  it('ViaCEP fora do ar falha em silêncio (usuário preenche à mão)', async () => {
    fetchMock.mockRejectedValueOnce(new Error('offline'));
    render(<Account />);
    await screen.findByDisplayValue('Minha Rep');
    await userEvent.type(screen.getByPlaceholderText('00000-000'), '01310100');
    // sem crash e sem erro exibido
    expect(screen.queryByText(/Erro/)).not.toBeInTheDocument();
  });

  it('troca de senha: valida local, rotaciona token e mostra sucesso', async () => {
    m.post.mockResolvedValueOnce({ ok: true, token: 'rotacionado' });
    render(<Account />);
    await screen.findByDisplayValue('Minha Rep');

    const pwdInputs = document.querySelectorAll('input[type="password"]');
    await userEvent.type(pwdInputs[0] as HTMLElement, 'atual123');
    await userEvent.type(pwdInputs[1] as HTMLElement, 'curta');
    await userEvent.type(pwdInputs[2] as HTMLElement, 'curta');
    await userEvent.click(screen.getByRole('button', { name: /Atualizar senha/ }));
    expect(screen.getByText(/ao menos 6 caracteres/)).toBeInTheDocument();
    expect(m.post).not.toHaveBeenCalled();

    await userEvent.type(pwdInputs[1] as HTMLElement, 'novasenha1');
    await userEvent.type(pwdInputs[2] as HTMLElement, 'novasenha1diferente');
    await userEvent.click(screen.getByRole('button', { name: /Atualizar senha/ }));
    expect(screen.getByText('A confirmação não confere.')).toBeInTheDocument();

    await userEvent.clear(pwdInputs[1] as HTMLElement);
    await userEvent.clear(pwdInputs[2] as HTMLElement);
    await userEvent.type(pwdInputs[1] as HTMLElement, 'novasenha1');
    await userEvent.type(pwdInputs[2] as HTMLElement, 'novasenha1');
    await userEvent.click(screen.getByRole('button', { name: /Atualizar senha/ }));

    await waitFor(() => expect(screen.getByText('Senha atualizada.')).toBeInTheDocument());
    expect(m.post).toHaveBeenCalledWith('/api/account/password',
      { senha_atual: 'atual123', nova_senha: 'novasenha1' });
    expect(getToken()).toBe('rotacionado');
  });
});
