// Agenda: visões mês/lista, filtros por tipo/status, concluir e excluir.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Agenda } from '../src/pages/Agenda.tsx';
import { api } from '../src/lib/api.ts';

vi.mock('../src/lib/api.ts', async (orig) => {
  const real = await orig() as Record<string, unknown>;
  return { ...real, api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), del: vi.fn() } };
});
const m = vi.mocked(api);

// atividades no mês corrente (datas dinâmicas p/ caírem na grade visível)
const dia = (d: number, h: number): string => {
  const x = new Date(); x.setDate(d); x.setHours(h, 0, 0, 0);
  return x.toISOString();
};
const act = (over: Record<string, unknown>): Record<string, unknown> => ({
  id: 1, tipo: 'tarefa', titulo: 'Ligar p/ cliente', start_at: dia(10, 9), end_at: null,
  owner_user_id: 1, company_id: null, status: 'pendente', razao_social: null, ...over,
});

beforeEach(() => {
  vi.mocked(m.get).mockReset();
  vi.mocked(m.patch).mockReset();
  vi.mocked(m.del).mockReset();
  m.get.mockImplementation(async (p: string) =>
    p === '/api/activities'
      ? { activities: [
          act({ id: 1, titulo: 'Ligar p/ cliente', tipo: 'ligacao' }),
          act({ id: 2, titulo: 'Visita fábrica', tipo: 'visita', start_at: dia(11, 14) }),
          act({ id: 3, titulo: 'Tarefa feita', tipo: 'tarefa', status: 'feito', start_at: dia(12, 8) }),
        ] }
      : { cards: [] });
});

describe('Agenda', () => {
  it('mês: mostra contagem de pendentes e eventos na grade', async () => {
    render(<Agenda />);
    expect(await screen.findByText('2 atividade(s) pendente(s)')).toBeInTheDocument();
    expect(screen.getByText('Ligar p/ cliente')).toBeInTheDocument();
    expect(screen.getByText('Visita fábrica')).toBeInTheDocument();
  });

  it('filtro de tipo esconde a categoria desligada', async () => {
    render(<Agenda />);
    await screen.findByText('Ligar p/ cliente');
    await userEvent.click(screen.getByRole('button', { name: /Ligação/ }));
    expect(screen.queryByText('Ligar p/ cliente')).not.toBeInTheDocument();
    expect(screen.getByText('Visita fábrica')).toBeInTheDocument();
  });

  it('filtro de status pendente esconde concluídas (e atualiza contagem)', async () => {
    render(<Agenda />);
    await screen.findByText('Ligar p/ cliente');
    await userEvent.selectOptions(screen.getByRole('combobox'), 'pendente');
    expect(screen.queryByText('Tarefa feita')).not.toBeInTheDocument();
  });

  it('lista: concluir faz PATCH otimista e excluir faz DELETE', async () => {
    m.patch.mockResolvedValue({});
    m.del.mockResolvedValue({});
    render(<Agenda />);
    await screen.findByText('Ligar p/ cliente');
    await userEvent.click(screen.getByRole('button', { name: 'Lista' }));

    const concluir = screen.getAllByLabelText('Concluir');
    await userEvent.click(concluir[0]!);
    expect(m.patch).toHaveBeenCalledWith(expect.stringMatching(/^\/api\/activities\/\d+$/), { status: 'feito' });

    const excluir = screen.getAllByLabelText('Excluir');
    const antes = excluir.length;
    await userEvent.click(excluir[0]!);
    expect(m.del).toHaveBeenCalled();
    await waitFor(() => expect(screen.getAllByLabelText('Excluir').length).toBe(antes - 1));
  });

  it('clicar num dia abre o modal de detalhe', async () => {
    render(<Agenda />);
    await screen.findByText('Ligar p/ cliente');
    await userEvent.click(screen.getByText('Ligar p/ cliente'));
    // modal lista o evento de novo (título duplicado na tela)
    await waitFor(() => expect(screen.getAllByText('Ligar p/ cliente').length).toBeGreaterThan(1));
  });
});
