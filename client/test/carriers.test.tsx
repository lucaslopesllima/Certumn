// Transportadoras: carga, criação, edição, toggle otimista e desativar com confirm.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Carriers } from '../src/pages/Carriers.tsx';
import { api } from '../src/lib/api.ts';

vi.mock('../src/lib/api.ts', async (orig) => {
  const real = await orig() as Record<string, unknown>;
  return { ...real, api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), del: vi.fn() } };
});
const m = vi.mocked(api);

const CARRIER = {
  id: 4, nome: 'Transp X', cnpj: '11222333000144', telefone: '11 99999-0000',
  email: null, contato: 'Maria', observacoes: null, ativo: true,
};

beforeEach(() => {
  vi.mocked(m.get).mockReset();
  vi.mocked(m.post).mockReset();
  vi.mocked(m.patch).mockReset();
  vi.mocked(m.del).mockReset();
  vi.stubGlobal('confirm', vi.fn(() => true));
  vi.stubGlobal('alert', vi.fn());
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
    await waitFor(() => expect(screen.getByTitle('Desativar')).toBeInTheDocument()); // rollback
    expect(screen.queryByText('inativa')).not.toBeInTheDocument();
    expect(alert).toHaveBeenCalled();
  });

  it('desativar: confirm cancelado não chama API; sucesso marca inativa (linha fica)', async () => {
    vi.stubGlobal('confirm', vi.fn(() => false));
    render(<Carriers />);
    await screen.findByText('Transp X');
    await userEvent.click(screen.getByLabelText('Excluir transportadora'));
    expect(m.del).not.toHaveBeenCalled();

    vi.stubGlobal('confirm', vi.fn(() => true));
    m.del.mockResolvedValueOnce({ deleted: true });
    await userEvent.click(screen.getByLabelText('Excluir transportadora'));
    await waitFor(() => expect(m.del).toHaveBeenCalledWith('/api/carriers/4'));
    expect(screen.getByText('Transp X')).toBeInTheDocument(); // soft delete: linha continua
    expect(screen.getByText('inativa')).toBeInTheDocument();
  });
});
