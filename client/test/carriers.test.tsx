// Transportadoras: carga, criação, edição, toggle otimista e desativar com confirm.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Carriers } from '../src/pages/Carriers.tsx';
import { api } from '../src/lib/api.ts';
import { useAuth, type User } from '../src/lib/auth.tsx';
import { confirmDialog } from '../src/lib/confirm.ts';
vi.mock('../src/lib/confirm.ts', () => ({ confirmDialog: vi.fn() }));
// CompanySearch (busca RFB) stubada — expõe um botão que dispara onPick.
vi.mock('../src/lib/companySearch.tsx', () => ({
  CompanySearch: ({ onPick }: { onPick: (c: Record<string, unknown>) => void }) => (
    <button type="button" onClick={() => onPick({
      cnpj: '99888777000166', razao_social: 'RFB LTDA', nome_fantasia: 'RFB',
      telefone1: '1140000000', telefone2: null, email: 'rfb@x.com',
    })}>pick-company</button>
  ),
}));

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

  it('empty state quando não há transportadoras', async () => {
    m.get.mockResolvedValue({ carriers: [] });
    render(<Carriers />);
    expect(await screen.findByText('Nenhuma transportadora')).toBeInTheDocument();
  });

  it('cancelar fecha o formulário (novo e edição)', async () => {
    render(<Carriers />);
    await screen.findByText('Transp X');
    await userEvent.click(screen.getByRole('button', { name: /Nova transportadora/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(screen.queryByPlaceholderText('Nome da transportadora *')).not.toBeInTheDocument();
    await userEvent.click(screen.getByLabelText('Editar transportadora'));
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(screen.queryByPlaceholderText('Nome da transportadora *')).not.toBeInTheDocument();
  });

  it('autopreenche da base RFB, aplica máscaras e bloqueia e-mail inválido', async () => {
    render(<Carriers />);
    await screen.findByText('Transp X');
    await userEvent.click(screen.getByRole('button', { name: /Nova transportadora/ }));
    await userEvent.click(screen.getByRole('button', { name: 'pick-company' }));
    expect(screen.getByDisplayValue('RFB')).toBeInTheDocument();

    await userEvent.clear(screen.getByPlaceholderText('CNPJ'));
    await userEvent.type(screen.getByPlaceholderText('CNPJ'), '11222333000144');
    await userEvent.type(screen.getByPlaceholderText('Telefone'), '11999990000');

    // 'a@b' passa na validação HTML5 (permite submit) mas falha no regex do app
    const email = screen.getByPlaceholderText('E-mail');
    await userEvent.clear(email);
    await userEvent.type(email, 'a@b');
    await userEvent.click(screen.getByRole('button', { name: 'Salvar' }));
    expect(m.post).not.toHaveBeenCalled();
  });

  it('remove: falha do DELETE reverte', async () => {
    m.del.mockRejectedValueOnce(new Error('offline'));
    render(<Carriers />);
    await screen.findByText('Transp X');
    await userEvent.click(screen.getByLabelText('Excluir transportadora'));
    await waitFor(() => expect(m.del).toHaveBeenCalledWith('/api/carriers/4'));
    await waitFor(() => expect(screen.queryByText('inativa')).not.toBeInTheDocument());
  });
});
