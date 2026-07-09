// Transportadoras: carga, criação, edição, toggle otimista e desativar com confirm.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Carriers } from '../src/pages/Carriers.tsx';
import { api } from '../src/lib/api.ts';
import { useAuth, type User } from '../src/lib/auth.tsx';
import { confirmDialog } from '../src/lib/confirm.ts';
vi.mock('../src/lib/confirm.ts', () => ({ confirmDialog: vi.fn() }));

vi.mock('../src/lib/api.ts', async (orig) => {
  const real = await orig() as Record<string, unknown>;
  return { ...real, api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), del: vi.fn() } };
});
vi.mock('../src/lib/auth.tsx', () => {
  const useAuth = vi.fn();
  return { useAuth, useOptionalUser: () => useAuth().user ?? null };
});
const m = vi.mocked(api);
const useAuthMock = vi.mocked(useAuth);

const admin: User = { id: 1, email: 'a@b.c', role: 'admin', org_id: 1, org_nome: 'Org' };

const CARRIER = {
  id: 4, nome: 'Transp X', cnpj: '11222333000144', telefone: '11 99999-0000',
  email: null, contato: 'Maria', observacoes: null, ativo: true,
};

beforeEach(() => {
  vi.mocked(m.get).mockReset();
  vi.mocked(m.post).mockReset();
  vi.mocked(m.patch).mockReset();
  vi.mocked(m.del).mockReset();
  vi.mocked(confirmDialog).mockResolvedValue(true);
  vi.stubGlobal('alert', vi.fn());
  useAuthMock.mockReturnValue({
    user: admin, loading: false, login: vi.fn(), register: vi.fn(), refresh: vi.fn(), logout: vi.fn(),
    can: () => true,
  });
  m.get.mockResolvedValue({ carriers: [CARRIER] });
});

describe('Carriers', () => {
  it('carrega e lista com cnpj e contato', async () => {
    render(<Carriers />);
    expect(await screen.findByText('Transp X')).toBeInTheDocument();
    expect(screen.getByText('11222333000144')).toBeInTheDocument();
    expect(screen.getByText(/Maria · 11 99999-0000/)).toBeInTheDocument();
  });

  it('cria transportadora nova', async () => {
    m.post.mockResolvedValueOnce({ carrier: { ...CARRIER, id: 5, nome: 'Entrega Já' } });
    render(<Carriers />);
    await screen.findByText('Transp X');

    await userEvent.click(screen.getByRole('button', { name: /Nova transportadora/ }));
    await userEvent.type(screen.getByPlaceholderText('Nome da transportadora *'), 'Entrega Já');
    await userEvent.type(screen.getByPlaceholderText('Pessoa de contato'), 'Zé');
    await userEvent.click(screen.getByRole('button', { name: 'Salvar' }));

    expect(await screen.findByText('Entrega Já')).toBeInTheDocument();
    expect(m.post).toHaveBeenCalledWith('/api/carriers', expect.objectContaining({ nome: 'Entrega Já', contato: 'Zé' }));
  });

  it('edita pelo formulário inline', async () => {
    m.patch.mockResolvedValueOnce({ carrier: { ...CARRIER, nome: 'Transp Y' } });
    render(<Carriers />);
    await screen.findByText('Transp X');

    await userEvent.click(screen.getByLabelText('Editar transportadora'));
    const nome = screen.getByPlaceholderText('Nome da transportadora *');
    await userEvent.clear(nome);
    await userEvent.type(nome, 'Transp Y');
    await userEvent.click(screen.getByRole('button', { name: 'Salvar' }));

    expect(await screen.findByText('Transp Y')).toBeInTheDocument();
    expect(m.patch).toHaveBeenCalledWith('/api/carriers/4', expect.objectContaining({ nome: 'Transp Y' }));
  });

  it('toggle de ativo reverte quando o PATCH falha', async () => {
    m.patch.mockRejectedValueOnce(new Error('offline'));
    render(<Carriers />);
    await screen.findByText('Transp X');

    await userEvent.click(screen.getByTitle('Desativar'));
    expect(m.patch).toHaveBeenCalledWith('/api/carriers/4', { ativo: false }); // tentou
    await waitFor(() => expect(screen.getByTitle('Desativar')).toBeInTheDocument()); // rollback
    expect(screen.queryByText('inativa')).not.toBeInTheDocument();
  });

  it('desativar: confirm cancelado não chama API; sucesso marca inativa (linha fica)', async () => {
    vi.mocked(confirmDialog).mockResolvedValue(false);
    render(<Carriers />);
    await screen.findByText('Transp X');
    await userEvent.click(screen.getByLabelText('Excluir transportadora'));
    expect(m.del).not.toHaveBeenCalled();

    vi.mocked(confirmDialog).mockResolvedValue(true);
    m.del.mockResolvedValueOnce({ deleted: true });
    await userEvent.click(screen.getByLabelText('Excluir transportadora'));
    await waitFor(() => expect(m.del).toHaveBeenCalledWith('/api/carriers/4'));
    expect(screen.getByText('Transp X')).toBeInTheDocument(); // soft delete: linha continua
    expect(screen.getByText('inativa')).toBeInTheDocument();
  });
});
