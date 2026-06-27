// Planejador de rota: seleção do funil, otimizar, salvar, rotas salvas, veículos.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RoutePlanner } from '../src/pages/Routes.tsx';
import { api, ApiError } from '../src/lib/api.ts';

vi.mock('react-leaflet', () => ({
  MapContainer: ({ children }: { children?: React.ReactNode }) => <div data-testid="map">{children}</div>,
  TileLayer: () => null, CircleMarker: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  Polyline: () => null, Tooltip: ({ children }: { children?: React.ReactNode }) => <span>{children}</span>,
  useMap: () => ({ fitBounds: vi.fn() }),
}));
vi.mock('../src/lib/api.ts', async (orig) => {
  const real = await orig() as Record<string, unknown>;
  return { ...real, api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), del: vi.fn() } };
});
const m = vi.mocked(api);

const FUNNEL = [
  { id: 1, company_id: 10, razao_social: 'Alfa LTDA', nome_fantasia: 'Alfa', uf: 'SP', lat: -23.5, lon: -46.6 },
  { id: 2, company_id: 20, razao_social: 'Beta SA', nome_fantasia: null, uf: 'SP', lat: null, lon: null },
];
const VEHICLES = [
  { id: 5, nome: 'Fiorino', placa: null, combustivel: 'flex', consumo_kml: '11', tanque_litros: null, preco_litro: '6.10', ativo: true },
];
const RESULT = {
  origem: { lat: -23.5, lon: -46.6 },
  stops: [{ company_id: 10, seq: 0, razao_social: 'Alfa LTDA', nome_fantasia: 'Alfa', uf: 'SP', cidade: 'São Paulo', lat: -23.5, lon: -46.6, leg_dist_km: 12.3, leg_dur_min: 20 }],
  dist_km: 24.6, dur_min: 41, preco_litro: 6.1, litros: 2.2, custo_total: 13.4,
  geometry: { coordinates: [[-23.5, -46.6]] }, skipped: [],
};

beforeEach(() => {
  vi.mocked(m.get).mockReset();
  vi.mocked(m.post).mockReset();
  vi.mocked(m.del).mockReset();
  m.get.mockImplementation(async (p: string) => {
    if (p.startsWith('/api/relationships')) return { relationships: FUNNEL };
    if (p === '/api/vehicles') return { vehicles: VEHICLES };
    if (p === '/api/routes') return { routes: [] };
    return {};
  });
});

describe('RoutePlanner', () => {
  it('lista empresas do funil, sinaliza quem não tem localização e busca', async () => {
    render(<RoutePlanner />);
    expect(await screen.findByText('Alfa')).toBeInTheDocument();
    expect(screen.getByText(/sem localização/)).toBeInTheDocument();

    await userEvent.type(screen.getByPlaceholderText('Buscar empresa…'), 'beta');
    expect(screen.queryByText('Alfa')).not.toBeInTheDocument();
    expect(screen.getByText('Beta SA')).toBeInTheDocument();
  });

  it('otimizar fica desabilitado sem seleção; com seleção chama a API e mostra resultado', async () => {
    m.post.mockResolvedValueOnce(RESULT);
    render(<RoutePlanner />);
    await screen.findByText('Alfa');

    const otimizar = screen.getByRole('button', { name: 'Otimizar rota' });
    expect(otimizar).toBeDisabled();

    await userEvent.click(screen.getByText('Alfa'));
    await userEvent.click(otimizar);
    expect(m.post).toHaveBeenCalledWith('/api/routes/optimize',
      { company_ids: [10], vehicle_id: null, preco_litro: null });

    expect(await screen.findByText('Sequência de visitas')).toBeInTheDocument();
    expect(screen.getByText(/24,6 km/)).toBeInTheDocument();
  });

  it('erro da API aparece (ex.: sem origem cadastrada)', async () => {
    m.post.mockRejectedValueOnce(new ApiError(400, 'Cadastre o endereço da sua conta para definir a origem da rota.'));
    render(<RoutePlanner />);
    await screen.findByText('Alfa');
    await userEvent.click(screen.getByText('Alfa'));
    await userEvent.click(screen.getByRole('button', { name: 'Otimizar rota' }));
    expect(await screen.findByText(/Cadastre o endereço/)).toBeInTheDocument();
  });

  it('salvar rota usa modal e persiste; cancelar não chama POST /api/routes', async () => {
    m.post.mockResolvedValueOnce(RESULT); // optimize
    render(<RoutePlanner />);
    await screen.findByText('Alfa');
    await userEvent.click(screen.getByText('Alfa'));
    await userEvent.click(screen.getByRole('button', { name: 'Otimizar rota' }));
    await screen.findByText('Sequência de visitas');

    // abre o modal de nome e cancela — só o optimize foi chamado
    await userEvent.click(screen.getByRole('button', { name: 'Salvar rota' }));
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(m.post).toHaveBeenCalledTimes(1);

    // reabre, troca o nome e confirma
    m.post.mockResolvedValueOnce({ route: { id: 9 } });
    await userEvent.click(screen.getByRole('button', { name: 'Salvar rota' }));
    const nomeInput = screen.getByLabelText('Nome da rota');
    await userEvent.clear(nomeInput);
    await userEvent.type(nomeInput, 'Rota Zona Sul');
    await userEvent.click(screen.getByRole('button', { name: 'Salvar' })); // submit do modal
    await waitFor(() => expect(m.post).toHaveBeenCalledTimes(2));
    expect(m.post).toHaveBeenLastCalledWith('/api/routes', expect.objectContaining({
      nome: 'Rota Zona Sul', stops: [expect.objectContaining({ company_id: 10, seq: 0 })],
    }));
  });

  it('rotas salvas listam e excluem com confirm', async () => {
    m.get.mockImplementation(async (p: string) => {
      if (p.startsWith('/api/relationships')) return { relationships: FUNNEL };
      if (p === '/api/vehicles') return { vehicles: VEHICLES };
      if (p === '/api/routes') return { routes: [{ id: 9, nome: 'Rota Salva', vehicle_id: null, veiculo: null, dist_km: '24.6', dur_min: '41', litros: null, custo_total: null, created_at: '', paradas: '1' }] };
      return {};
    });
    m.del.mockResolvedValueOnce({});
    vi.stubGlobal('confirm', vi.fn(() => true));
    render(<RoutePlanner />);
    expect(await screen.findByText('Rota Salva')).toBeInTheDocument();
    await userEvent.click(screen.getByLabelText('Excluir'));
    expect(m.del).toHaveBeenCalledWith('/api/routes/9');
  });

  it('aba Veículos lista veículo ativo', async () => {
    render(<RoutePlanner />);
    await screen.findByText('Alfa');
    await userEvent.click(screen.getByRole('button', { name: 'Veículos' }));
    expect(await screen.findByText(/Fiorino/)).toBeInTheDocument();
  });
});

// Fase 5: ações nas rotas salvas (reusar, criar compromissos, template).
const SAVED = [{
  id: 7, nome: 'Rota seg', vehicle_id: null, veiculo: null,
  dist_km: '24.6', dur_min: '41', litros: '2', custo_total: '13.4',
  template: false, recorrencia: null, created_at: '2026-06-01', paradas: '2',
}];

describe('RoutePlanner: rotas salvas (Fase 5)', () => {
  beforeEach(() => {
    m.get.mockImplementation(async (p: string) => {
      if (p.startsWith('/api/relationships')) return { relationships: FUNNEL };
      if (p === '/api/vehicles') return { vehicles: VEHICLES };
      if (p === '/api/routes') return { routes: SAVED };
      return {};
    });
    vi.mocked(m.patch).mockReset();
    vi.stubGlobal('alert', vi.fn());
  });

  it('reusar: pede nome em modal e chama /reuse', async () => {
    m.post.mockResolvedValueOnce({ skipped: [] });
    render(<RoutePlanner />);
    await screen.findByText('Rota seg');
    await userEvent.click(screen.getByRole('button', { name: 'Reusar rota' }));
    const nomeInput = screen.getByLabelText('Nome da nova rota');
    await userEvent.clear(nomeInput);
    await userEvent.type(nomeInput, 'Rota nova');
    await userEvent.click(screen.getByRole('button', { name: 'Reusar' })); // submit do modal
    await waitFor(() => expect(m.post).toHaveBeenCalledWith('/api/routes/7/reuse', { nome: 'Rota nova' }));
  });

  it('criar compromissos: pede data em modal e chama /agenda', async () => {
    m.post.mockResolvedValueOnce({ created: 2 });
    render(<RoutePlanner />);
    await screen.findByText('Rota seg');
    await userEvent.click(screen.getByRole('button', { name: 'Criar compromissos' }));
    // input de data do modal (type=date) — define via change
    fireEvent.change(screen.getByLabelText('Data da rota'), { target: { value: '2026-07-01' } });
    // segundo "Criar compromissos" = submit do modal
    await userEvent.click(screen.getAllByRole('button', { name: 'Criar compromissos' }).at(-1)!);
    await waitFor(() => expect(m.post).toHaveBeenCalledWith('/api/routes/7/agenda', { start_at: '2026-07-01T08:00:00' }));
  });

  it('marcar template: faz PATCH e atualiza o estado local (sem refetch da lista)', async () => {
    m.patch.mockResolvedValueOnce({ route: { template: true } });
    render(<RoutePlanner />);
    await screen.findByText('Rota seg');
    await userEvent.click(screen.getByRole('button', { name: 'Marcar como template' }));
    await waitFor(() => expect(m.patch).toHaveBeenCalledWith('/api/routes/7', { template: true }));
    // o badge "Template" aparece a partir do retorno do PATCH, sem refetch:
    // GET /api/routes só foi chamado no mount (1x), não após o toggle.
    expect(await screen.findByText('Template')).toBeInTheDocument();
    expect(m.get.mock.calls.filter((c: unknown[]) => c[0] === '/api/routes')).toHaveLength(1);
  });

  it('reusar cancelado (prompt vazio) não chama API', async () => {
    vi.stubGlobal('prompt', vi.fn(() => null));
    render(<RoutePlanner />);
    await screen.findByText('Rota seg');
    await userEvent.click(screen.getByRole('button', { name: 'Reusar rota' }));
    expect(m.post).not.toHaveBeenCalledWith(expect.stringContaining('/reuse'), expect.anything());
  });
});
