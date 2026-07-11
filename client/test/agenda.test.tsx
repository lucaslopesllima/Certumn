// Agenda: visões mês/lista, filtros por tipo/status, concluir e excluir.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Agenda } from '../src/pages/Agenda.tsx';
import { api } from '../src/lib/api.ts';
import { useAuth, type User } from '../src/lib/auth.tsx';

vi.mock('../src/lib/api.ts', async (orig) => {
  const real = await orig() as Record<string, unknown>;
  return { ...real, api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), del: vi.fn() } };
});
vi.mock('../src/lib/auth.tsx', () => {
  const useAuth = vi.fn();
  return { useAuth, useOptionalUser: () => useAuth().user ?? null };
});
// modais de atividade (criar/editar/visita) substituídos por stubs com onClose/onSaved.
vi.mock('../src/lib/activityModal.tsx', () => ({
  ActivityCreateModal: ({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) => (
    <div>
      <span>MODAL-CREATE</span>
      <button onClick={onClose}>create-close</button>
      <button onClick={onSaved}>create-saved</button>
    </div>
  ),
  VisitModal: ({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) => (
    <div>
      <span>MODAL-VISIT</span>
      <button onClick={onClose}>visit-close</button>
      <button onClick={onSaved}>visit-saved</button>
    </div>
  ),
}));
const m = vi.mocked(api);
const useAuthMock = vi.mocked(useAuth);

const admin: User = { id: 1, email: 'a@b.c', role: 'admin', org_id: 1, org_nome: 'Org' };

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
  useAuthMock.mockReturnValue({
    user: admin, loading: false, login: vi.fn(), register: vi.fn(), refresh: vi.fn(), logout: vi.fn(),
    can: () => true,
  });
  // a página busca a janela visível: /api/activities?from=…&to=…&limit=500
  // (as fixtures caem no mês corrente, dentro da janela pedida)
  m.get.mockImplementation(async (p: string) =>
    p.startsWith('/api/activities?')
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

  it('navega no mês, volta pra hoje e "Adicionar" abre/fecha o modal de criar', async () => {
    render(<Agenda />);
    await screen.findByText('Ligar p/ cliente');
    await userEvent.click(screen.getByLabelText('Anterior'));
    await userEvent.click(screen.getByLabelText('Próximo'));
    await userEvent.click(screen.getByRole('button', { name: 'Hoje' }));

    await userEvent.click(screen.getByRole('button', { name: /Adicionar/ }));
    expect(await screen.findByText('MODAL-CREATE')).toBeInTheDocument();
    await userEvent.click(screen.getByText('create-saved'));
    await waitFor(() => expect(screen.queryByText('MODAL-CREATE')).not.toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: /Adicionar/ }));
    await userEvent.click(screen.getByText('create-close'));
    await waitFor(() => expect(screen.queryByText('MODAL-CREATE')).not.toBeInTheDocument());
  });

  it('visão semana: navega, renderiza evento com fim, clica no slot e no dia', async () => {
    const at = (h: number): string => { const d = new Date(); d.setHours(h, 0, 0, 0); return d.toISOString(); };
    m.get.mockImplementation(async (p: string) =>
      p.startsWith('/api/activities?')
        ? { activities: [act({ id: 1, titulo: 'Reunião hoje', tipo: 'reuniao', start_at: at(10), end_at: at(12) })] }
        : { cards: [] });
    render(<Agenda />);
    await userEvent.click(await screen.findByRole('button', { name: 'Semana' }));
    await userEvent.click(screen.getByLabelText('Anterior'));
    await userEvent.click(screen.getByLabelText('Próximo'));

    // clica numa coluna vazia -> abre criar (onSlot)
    const cols = document.querySelectorAll('div.relative.border-l.border-ink-100');
    fireEvent.click(cols[0]!);
    expect(await screen.findByText('MODAL-CREATE')).toBeInTheDocument();
    await userEvent.click(screen.getByText('create-close'));

    // cabeçalho de um dia (onDay via header) abre e fecha o modal do dia
    const headers = document.querySelectorAll('button.border-l.border-ink-100');
    await userEvent.click(headers[0]!);
    await userEvent.click(await screen.findByLabelText('Fechar'));

    // clica no evento -> abre o modal do dia
    await userEvent.click(screen.getByText('Reunião hoje'));
    await waitFor(() => expect(screen.getAllByText('Reunião hoje').length).toBeGreaterThan(1));
  });

  it('gera a rota do dia pelo modal (sucesso com skipped e depois falha)', async () => {
    m.post.mockReset();
    const d = (day: number, h: number): string => { const x = new Date(); x.setDate(day); x.setHours(h, 0, 0, 0); return x.toISOString(); };
    m.get.mockImplementation(async (p: string) =>
      p.startsWith('/api/activities?')
        ? { activities: [
            act({ id: 1, titulo: 'Visita A', company_id: 10, start_at: d(15, 9) }),
            act({ id: 2, titulo: 'Visita B', company_id: 20, start_at: d(15, 11) }),
          ] }
        : { cards: [] });
    m.post
      .mockResolvedValueOnce({ origem: { lat: 1, lon: 2 }, dist_km: 1, dur_min: 1, preco_litro: null, litros: null, custo_total: null, geometry: {}, stops: [{ company_id: 10, seq: 0, lat: 1, lon: 2, leg_dist_km: 1, leg_dur_min: 2 }], skipped: [99] })
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(new Error('boom'));
    render(<Agenda />);
    await screen.findByText('Visita A');
    await userEvent.click(screen.getByText('Visita A'));
    const gerar = await screen.findByRole('button', { name: /Gerar rota do dia/ });
    await userEvent.click(gerar);
    await waitFor(() => expect(m.post).toHaveBeenCalledWith('/api/routes/optimize', { company_ids: [10, 20] }));
    await waitFor(() => expect(m.post).toHaveBeenCalledWith('/api/routes', expect.anything()));
    await userEvent.click(gerar);
    await waitFor(() => expect(m.post).toHaveBeenCalledTimes(3));
  });

  it('lista: concluir/excluir com erro revertem; editar e visitar abrem modais; adicionar', async () => {
    m.get.mockImplementation(async (p: string) =>
      p.startsWith('/api/activities?')
        ? { activities: [act({ id: 1, titulo: 'Ligar', tipo: 'ligacao', company_id: 10 })] }
        : { cards: [] });
    m.patch.mockRejectedValueOnce(new Error('x'));
    m.del.mockRejectedValueOnce(new Error('x'));
    render(<Agenda />);
    await screen.findByText('Ligar');
    await userEvent.click(screen.getByRole('button', { name: 'Lista' }));

    await userEvent.click(screen.getAllByLabelText('Concluir')[0]!); // patch falha -> reverte

    await userEvent.click(screen.getByLabelText('Editar'));
    expect(await screen.findByText('MODAL-CREATE')).toBeInTheDocument();
    await userEvent.click(screen.getByText('create-saved'));

    await userEvent.click(await screen.findByLabelText('Registrar visita'));
    expect(await screen.findByText('MODAL-VISIT')).toBeInTheDocument();
    await userEvent.click(screen.getByText('visit-saved'));
    await userEvent.click(await screen.findByLabelText('Registrar visita'));
    await userEvent.click(screen.getByText('visit-close'));

    // abre edição pelo título da linha (onEdit) e fecha o modal (onClose da edição)
    await userEvent.click(screen.getByText('Ligar'));
    expect(await screen.findByText('MODAL-CREATE')).toBeInTheDocument();
    await userEvent.click(screen.getByText('create-close'));

    await userEvent.click(screen.getByRole('button', { name: 'Adicionar atividade' }));
    await userEvent.click(await screen.findByText('create-close'));

    await userEvent.click(screen.getByLabelText('Excluir'));
    await waitFor(() => expect(screen.getByText('Ligar')).toBeInTheDocument());
  });

  it('modal do dia: adicionar neste dia, visitar e editar', async () => {
    m.get.mockImplementation(async (p: string) =>
      p.startsWith('/api/activities?')
        ? { activities: [act({ id: 1, titulo: 'Ligar', tipo: 'ligacao', company_id: 10 })] }
        : { cards: [] });
    render(<Agenda />);
    await screen.findByText('Ligar');

    await userEvent.click(screen.getByText('Ligar'));
    await userEvent.click(await screen.findByRole('button', { name: 'Adicionar neste dia' }));
    expect(await screen.findByText('MODAL-CREATE')).toBeInTheDocument();
    await userEvent.click(screen.getByText('create-close'));

    await userEvent.click(screen.getByText('Ligar'));
    await userEvent.click(await screen.findByLabelText('Registrar visita'));
    expect(await screen.findByText('MODAL-VISIT')).toBeInTheDocument();
    await userEvent.click(screen.getByText('visit-close'));

    await userEvent.click(screen.getByText('Ligar'));
    await userEvent.click(await screen.findByLabelText('Editar'));
    expect(await screen.findByText('MODAL-CREATE')).toBeInTheDocument();
  });

  it('carrega empresas do funil deduplicando por company_id', async () => {
    m.get.mockImplementation(async (p: string) => {
      if (p.startsWith('/api/activities?')) return { activities: [] };
      if (p === '/api/kanban') return { cards: [
        { id: 1, company_id: 5, nome_fantasia: 'B', razao_social: 'B SA' },
        { id: 2, company_id: 5, nome_fantasia: 'B2', razao_social: 'B SA' },
        { id: 3, company_id: 6, nome_fantasia: null, razao_social: 'A SA' },
      ] };
      return {};
    });
    render(<Agenda />);
    expect(await screen.findByText('0 atividade(s) pendente(s)')).toBeInTheDocument();
  });

  it('lista vazia e dia sem eventos mostram estados vazios', async () => {
    m.get.mockImplementation(async (p: string) => p.startsWith('/api/activities?') ? { activities: [] } : { cards: [] });
    render(<Agenda />);
    await screen.findByText('0 atividade(s) pendente(s)');
    await userEvent.click(screen.getByRole('button', { name: 'Lista' }));
    expect(screen.getByText('Nenhuma atividade')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Mês' }));
    const cells = document.querySelectorAll('.grid-rows-6 > button');
    await userEvent.click(cells[0]!);
    expect(await screen.findByText('Nenhuma atividade neste dia.')).toBeInTheDocument();
  });
});
