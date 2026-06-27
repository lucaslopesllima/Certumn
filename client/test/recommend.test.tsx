// Prospecção (lista): estado vazio sem filtro, busca com debounce, paginação,
// adicionar ao funil, erro de perfil. Leaflet mockado (jsdom não renderiza mapa).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { Recommend } from '../src/pages/Recommend.tsx';
import { api, ApiError } from '../src/lib/api.ts';

vi.mock('react-leaflet', () => ({
  MapContainer: ({ children }: { children?: React.ReactNode }) => <div data-testid="map">{children}</div>,
  TileLayer: () => null, CircleMarker: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  Popup: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  Polyline: () => null, Tooltip: ({ children }: { children?: React.ReactNode }) => <span>{children}</span>,
  useMap: () => ({ fitBounds: vi.fn(), setView: vi.fn(), getZoom: () => 11 }),
  useMapEvents: () => null,
}));
vi.mock('../src/lib/api.ts', async (orig) => {
  const real = await orig() as Record<string, unknown>;
  return { ...real, api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), del: vi.fn() } };
});
const m = vi.mocked(api);

const rec = (over: Record<string, unknown>): Record<string, unknown> => ({
  id: '1', cnpj: '11222333000144', razao_social: 'Alvo Comercio LTDA', nome_fantasia: 'Loja Alvo',
  cnae_principal: 4781400, municipio_id: 100, uf: 'SP', porte: 'pequeno', capital_social: '100000',
  lat: -23.5, lon: -46.6, score: 0.82,
  reason: {
    cnae_match: 'classe', cnae_principal: 4781400, distancia_km: 4.2, porte: 'pequeno',
    capital_social: '100000', componentes: { cnae: 0.5, proximidade: 0.22, porte: 0.1 },
  }, ...over,
});

const mount = (): ReturnType<typeof render> =>
  render(<MemoryRouter><Recommend /></MemoryRouter>);

beforeEach(() => {
  vi.mocked(m.get).mockReset();
  vi.mocked(m.post).mockReset();
  m.get.mockImplementation(async (p: string) => {
    if (p.startsWith('/api/recommend')) return { results: [rec({})], page: { count: 1 } };
    if (p === '/api/profile') return { profile: { cnaes_alvo: [], territorio_municipios: [], origem_lat: null, origem_lon: null } };
    return {};
  });
});

describe('Recommend', () => {
  it('sem filtro: tela vazia, sem consultar a base', async () => {
    mount();
    expect(await screen.findByText('Selecione um filtro')).toBeInTheDocument();
    expect(m.get.mock.calls.some((c) => String(c[0]).startsWith('/api/recommend'))).toBe(false);
  });

  it('filtro salvo dispara a busca (debounce) e lista resultados com score', async () => {
    localStorage.setItem('companyFilter:prospeccao',
      JSON.stringify({ fq: 'alvo', fCnae: '', fUf: '', fPorte: '', usarAlvo: false }));
    mount();
    expect(await screen.findByText('Loja Alvo', undefined, { timeout: 2000 })).toBeInTheDocument();
    expect(screen.getAllByText('82').length).toBeGreaterThan(0); // score no card e no KPI
    const url = m.get.mock.calls.map((c) => String(c[0])).find((u) => u.startsWith('/api/recommend'))!;
    expect(url).toContain('q=alvo');
  });

  it('adicionar ao funil marca o card como adicionado', async () => {
    localStorage.setItem('companyFilter:prospeccao',
      JSON.stringify({ fq: 'alvo', fCnae: '', fUf: '', fPorte: '', usarAlvo: false }));
    m.post.mockResolvedValueOnce({ relationship: { id: 1 } });
    mount();
    await screen.findByText('Loja Alvo', undefined, { timeout: 2000 });
    await userEvent.click(screen.getByRole('button', { name: /Adicionar ao funil/ }));
    expect(m.post).toHaveBeenCalledWith('/api/relationships', { company_id: 1 });
    expect(await screen.findByText('Adicionado ao funil')).toBeInTheDocument();
  });

  it('erro de perfil (400) mostra card com link para configurar', async () => {
    localStorage.setItem('companyFilter:prospeccao',
      JSON.stringify({ fq: 'alvo', fCnae: '', fUf: '', fPorte: '', usarAlvo: false }));
    m.get.mockImplementation(async (p: string) => {
      if (p.startsWith('/api/recommend')) throw new ApiError(400, 'perfil-alvo não configurado');
      if (p === '/api/profile') return { profile: null };
      return {};
    });
    mount();
    expect(await screen.findByText('perfil-alvo não configurado', undefined, { timeout: 2000 })).toBeInTheDocument();
    expect(screen.getByText(/Configurar perfil-alvo/)).toBeInTheDocument();
  });

  it('"Carregar mais" pagina com offset', async () => {
    localStorage.setItem('companyFilter:prospeccao',
      JSON.stringify({ fq: 'alvo', fCnae: '', fUf: '', fPorte: '', usarAlvo: false }));
    // primeira página cheia (20) habilita o botão
    m.get.mockImplementation(async (p: string) => {
      if (p.startsWith('/api/recommend')) {
        return { results: Array.from({ length: 20 }, (_, i) => rec({ id: String(i + 1), razao_social: `Empresa ${i + 1}`, nome_fantasia: `Empresa ${i + 1}` })), page: { count: 20 } };
      }
      if (p === '/api/profile') return { profile: null };
      return {};
    });
    mount();
    await screen.findByText('Empresa 1', undefined, { timeout: 2000 });
    await userEvent.click(screen.getByRole('button', { name: 'Carregar mais' }));
    await waitFor(() => {
      const urls = m.get.mock.calls.map((c) => String(c[0])).filter((u) => u.startsWith('/api/recommend'));
      expect(urls.some((u) => u.includes('offset=20'))).toBe(true);
    });
  });
});
