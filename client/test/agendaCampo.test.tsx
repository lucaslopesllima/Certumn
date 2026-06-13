// Fase 5 em campo: botão de visita (check-in + relatório) e "Gerar rota do dia".
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Agenda } from '../src/pages/Agenda.tsx';
import { api } from '../src/lib/api.ts';
import { postField } from '../src/lib/offline.ts';

vi.mock('../src/lib/api.ts', async (orig) => {
  const real = await orig() as Record<string, unknown>;
  return { ...real, api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), del: vi.fn() } };
});
vi.mock('../src/lib/offline.ts', () => ({ postField: vi.fn() }));

const m = vi.mocked(api);
const pf = vi.mocked(postField);

const dia = (d: number, h: number): string => {
  const x = new Date(); x.setDate(d); x.setHours(h, 0, 0, 0);
  return x.toISOString();
};
const act = (over: Record<string, unknown>): Record<string, unknown> => ({
  id: 1, tipo: 'visita', titulo: 'Visita Alfa', start_at: dia(15, 9), end_at: null,
  owner_user_id: 1, company_id: 10, status: 'pendente', razao_social: 'Alfa LTDA',
  checkin_at: null, relatorio: null, ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  m.get.mockImplementation(async (p: string) =>
    p === '/api/activities'
      ? { activities: [
          act({ id: 1, titulo: 'Visita Alfa', company_id: 10, razao_social: 'Alfa LTDA' }),
          act({ id: 2, titulo: 'Visita Beta', company_id: 20, razao_social: 'Beta SA', start_at: dia(15, 14) }),
        ] }
      : { cards: [] });
});

describe('Agenda — visita em campo', () => {
  it('abre o modal de visita, registra check-in (geo) e envia relatório', async () => {
    // geolocalização mockada
    const getCurrentPosition = vi.fn((ok: PositionCallback) =>
      ok({ coords: { latitude: -23.5, longitude: -46.6 } } as GeolocationPosition));
    Object.defineProperty(navigator, 'geolocation', { value: { getCurrentPosition }, configurable: true });
    pf.mockResolvedValue({ queued: false });

    render(<Agenda />);
    await screen.findByText('2 atividade(s) pendente(s)');
    await userEvent.click(screen.getByRole('button', { name: /Lista/ }));
    // abre o modal de visita pela linha da lista
    await userEvent.click((await screen.findAllByRole('button', { name: 'Registrar visita' }))[0]!);
    expect(await screen.findByText('Salvar visita')).toBeInTheDocument();

    // check-in
    await userEvent.click(screen.getByRole('button', { name: /Check-in/ }));
    await waitFor(() => expect(pf).toHaveBeenCalledWith('/api/activities/1/checkin', { lat: -23.5, lon: -46.6 }, expect.any(String)));

    // relatório
    await userEvent.click(screen.getByRole('button', { name: 'Salvar visita' }));
    await waitFor(() => expect(pf).toHaveBeenCalledWith('/api/activities/1/report',
      expect.objectContaining({ resultado: expect.any(String) }), expect.any(String)));
  });

  it('check-in sem geolocalização mostra aviso', async () => {
    Object.defineProperty(navigator, 'geolocation', { value: undefined, configurable: true });
    render(<Agenda />);
    await userEvent.click(screen.getByRole('button', { name: 'Lista' }));
    await userEvent.click((await screen.findAllByRole('button', { name: 'Registrar visita' }))[0]!);
    await userEvent.click(await screen.findByRole('button', { name: /Check-in/ }));
    expect(await screen.findByText(/Geolocalização indisponível/)).toBeInTheDocument();
    expect(pf).not.toHaveBeenCalled();
  });

  it('check-in com permissão negada mostra aviso', async () => {
    const getCurrentPosition = vi.fn((_ok: PositionCallback, err?: PositionErrorCallback) =>
      err?.({} as GeolocationPositionError));
    Object.defineProperty(navigator, 'geolocation', { value: { getCurrentPosition }, configurable: true });
    render(<Agenda />);
    await userEvent.click(screen.getByRole('button', { name: /Lista/ }));
    await userEvent.click((await screen.findAllByRole('button', { name: 'Registrar visita' }))[0]!);
    await userEvent.click(await screen.findByRole('button', { name: /Check-in/ }));
    expect(await screen.findByText(/Não foi possível obter a localização/)).toBeInTheDocument();
  });

  it('"Gerar rota do dia" otimiza e salva', async () => {
    vi.stubGlobal('alert', vi.fn());
    m.post.mockImplementation(async (p: string) =>
      p === '/api/routes/optimize'
        ? { origem: { lat: -23.5, lon: -46.6 }, stops: [{ company_id: 10, seq: 0, lat: -23.5, lon: -46.6, leg_dist_km: 1, leg_dur_min: 2 }],
            dist_km: 10, dur_min: 20, preco_litro: null, litros: null, custo_total: null, geometry: { coordinates: [] }, skipped: [] }
        : { route: { id: 99 } });

    render(<Agenda />);
    // abre o dia 15 (2 visitas com empresa) no grid do mês
    await userEvent.click((await screen.findAllByText('15'))[0]!);
    await userEvent.click(await screen.findByRole('button', { name: /Gerar rota do dia/ }));
    await waitFor(() => expect(m.post).toHaveBeenCalledWith('/api/routes/optimize', { company_ids: [10, 20] }));
    await waitFor(() => expect(m.post).toHaveBeenCalledWith('/api/routes', expect.objectContaining({ nome: expect.stringMatching(/^Rota /) })));
  });
});
