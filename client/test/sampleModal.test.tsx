// Amostras do funil: modal de solicitar/editar (produto, quantidade, contato
// inline, follow-up na agenda) e o modal de lista (abrir editor, excluir).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SampleRequestModal, SampleListModal } from '../src/lib/sampleModal.tsx';
import { api } from '../src/lib/api.ts';
import type { CatalogItem, SampleRequest } from '../src/lib/types.ts';

vi.mock('../src/lib/api.ts', async (orig) => {
  const real = await orig() as Record<string, unknown>;
  return { ...real, api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), del: vi.fn() } };
});
const m = vi.mocked(api);

const CARD = { id: 7, company_id: 100, label: 'Loja Um' };
const CATALOG: CatalogItem[] = [
  { id: 9, nome: 'Produto A', codigo: 'A-1', descricao: null, preco: '100', represented_id: null, ativo: true },
  { id: 10, nome: 'Produto Inativo', codigo: null, descricao: null, preco: null, represented_id: null, ativo: false },
];
const sample = (over: Partial<SampleRequest> = {}): SampleRequest => ({
  id: 1, relationship_id: 7, catalog_item_id: 9, produto_snapshot: 'Produto A',
  contact_id: null, activity_id: null, owner_user_id: 1, status: 'solicitada',
  quantidade: '2', data_solicitacao: '2026-06-01', data_prevista: null, notas: null,
  created_at: '2026-06-01T12:00:00Z', produto_codigo: 'A-1', contato: null,
  atividade_titulo: null, atividade_start: null, ...over,
});

beforeEach(() => {
  vi.mocked(m.get).mockReset();
  vi.mocked(m.post).mockReset();
  vi.mocked(m.patch).mockReset();
  vi.mocked(m.del).mockReset();
  vi.stubGlobal('confirm', vi.fn(() => true));
  m.get.mockImplementation(async (p: string) => {
    if (p.startsWith('/api/contacts')) return { contacts: [{ id: 50, nome: 'João', cargo: 'Compras', email: null, telefone: null, company_id: 100, represented_id: null }] };
    if (p.startsWith('/api/sample-requests')) return { samples: [sample()] };
    return {};
  });
});

describe('SampleRequestModal — criar', () => {
  it('só lista produtos ativos e exige escolher um produto', async () => {
    const onSaved = vi.fn();
    render(<SampleRequestModal card={CARD} catalog={CATALOG} onClose={vi.fn()} onSaved={onSaved} />);
    const sel = screen.getByRole('combobox', { name: /Produto do catálogo/ });
    expect(within(sel).queryByRole('option', { name: 'Produto Inativo' })).not.toBeInTheDocument();
    expect(within(sel).getByRole('option', { name: 'Produto A (A-1)' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Solicitar' }));
    expect(m.post).not.toHaveBeenCalled(); // sem produto não envia
  });

  it('cria amostra com produto + quantidade', async () => {
    m.post.mockResolvedValueOnce({ sample: sample({ id: 9 }) });
    const onSaved = vi.fn();
    render(<SampleRequestModal card={CARD} catalog={CATALOG} onClose={vi.fn()} onSaved={onSaved} />);

    await userEvent.selectOptions(screen.getByRole('combobox', { name: /Produto do catálogo/ }), '9');
    await userEvent.type(screen.getByRole('spinbutton', { name: 'Quantidade' }), '3');
    await userEvent.click(screen.getByRole('button', { name: 'Solicitar' }));

    await waitFor(() => expect(m.post).toHaveBeenCalledWith('/api/sample-requests', expect.objectContaining({
      relationship_id: 7, catalog_item_id: 9, quantidade: 3,
    })));
    expect(onSaved).toHaveBeenCalled();
  });

  it('gera follow-up na agenda quando marcado', async () => {
    m.post.mockResolvedValueOnce({ sample: sample({ id: 9 }) });
    render(<SampleRequestModal card={CARD} catalog={CATALOG} onClose={vi.fn()} onSaved={vi.fn()} />);

    await userEvent.selectOptions(screen.getByRole('combobox', { name: /Produto do catálogo/ }), '9');
    await userEvent.click(screen.getByRole('checkbox'));
    // título sugerido a partir do produto
    expect(screen.getByDisplayValue('Amostra: Produto A')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Solicitar' }));

    await waitFor(() => expect(m.post).toHaveBeenCalledWith('/api/sample-requests', expect.objectContaining({
      agenda: expect.objectContaining({ titulo: 'Amostra: Produto A', tipo: 'tarefa' }),
    })));
  });

  it('cria contato inline antes de vincular na amostra', async () => {
    m.post
      .mockResolvedValueOnce({ contact: { id: 77, nome: 'Maria', company_id: 100 } })
      .mockResolvedValueOnce({ sample: sample({ id: 9, contact_id: 77 }) });
    render(<SampleRequestModal card={CARD} catalog={CATALOG} onClose={vi.fn()} onSaved={vi.fn()} />);

    await userEvent.selectOptions(screen.getByRole('combobox', { name: /Produto do catálogo/ }), '9');
    await userEvent.click(screen.getByRole('button', { name: '+ Novo contato' }));
    await userEvent.type(screen.getByPlaceholderText('Nome *'), 'Maria');
    await userEvent.click(screen.getByRole('button', { name: 'Solicitar' }));

    await waitFor(() => expect(m.post).toHaveBeenNthCalledWith(1, '/api/contacts', expect.objectContaining({ nome: 'Maria', company_id: 100 })));
    expect(m.post).toHaveBeenNthCalledWith(2, '/api/sample-requests', expect.objectContaining({ contact_id: 77 }));
  });
});

describe('SampleRequestModal — editar', () => {
  it('produto read-only + status editável -> PATCH', async () => {
    m.patch.mockResolvedValueOnce({ sample: sample({ status: 'enviada' }) });
    const onSaved = vi.fn();
    render(<SampleRequestModal card={CARD} catalog={CATALOG} sample={sample()} onClose={vi.fn()} onSaved={onSaved} />);

    expect(screen.getByText('Editar amostra')).toBeInTheDocument();
    expect(screen.getByText(/Produto A · A-1/)).toBeInTheDocument(); // snapshot read-only
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Status' }), 'enviada');
    await userEvent.click(screen.getByRole('button', { name: 'Salvar' }));

    await waitFor(() => expect(m.patch).toHaveBeenCalledWith('/api/sample-requests/1', expect.objectContaining({ status: 'enviada' })));
    expect(onSaved).toHaveBeenCalled();
  });
});

describe('SampleListModal', () => {
  it('lista amostras com status e abre o editor ao clicar', async () => {
    render(<SampleListModal card={CARD} catalog={CATALOG} onClose={vi.fn()} onChanged={vi.fn()} />);
    expect(await screen.findByText('Produto A')).toBeInTheDocument();
    expect(screen.getByText('Solicitada')).toBeInTheDocument();

    await userEvent.click(screen.getByText('Produto A'));
    expect(await screen.findByText('Editar amostra')).toBeInTheDocument();
  });

  it('exclui amostra (DELETE) e recarrega', async () => {
    m.del.mockResolvedValueOnce({ deleted: true });
    const onChanged = vi.fn();
    render(<SampleListModal card={CARD} catalog={CATALOG} onClose={vi.fn()} onChanged={onChanged} />);
    await screen.findByText('Produto A');

    await userEvent.click(screen.getByRole('button', { name: 'Excluir' }));
    await waitFor(() => expect(m.del).toHaveBeenCalledWith('/api/sample-requests/1'));
    expect(onChanged).toHaveBeenCalled();
  });
});
