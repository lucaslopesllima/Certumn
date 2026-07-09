// Prospecção (lista): tela vazia sem território, busca por território com debounce,
// paginação, adicionar ao funil, erro genérico. Leaflet mockado (jsdom não renderiza mapa).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { Recommend } from '../src/pages/Recommend.tsx';
import { api, ApiError } from '../src/lib/api.ts';
import { useAuth, type User } from '../src/lib/auth.tsx';

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
vi.mock('../src/lib/auth.tsx', () => {
  const useAuth = vi.fn();
  return { useAuth, useOptionalUser: () => useAuth().user ?? null };
});
const m = vi.mocked(api);
const useAuthMock = vi.mocked(useAuth);

const admin: User = { id: 1, email: 'a@b.c', role: 'admin', org_id: 1, org_nome: 'Org' };

const rec = (over: Record<string, unknown>): Record<string, unknown> => ({
  id: '1', cnpj: '11222333000144', razao_social: 'Alvo Comercio LTDA', nome_fantasia: 'Loja Alvo',
  cnae_principal: 4781400, municipio_id: 100, uf: 'SP', porte: 'pequeno', capital_social: '100000',
  lat: -23.5, lon: -46.6, score: 0.82,
  reason: {
    cnae_match: 'classe', cnae_principal: 4781400, distancia_km: 4.2, porte: 'pequeno',
    capital_social: '100000', componentes: { cnae: 0.5, proximidade: 0.22, porte: 0.1 },
  }, ...over,
});

// A busca só dispara com território definido (município selecionado).
const comTerritorio = (): void =>
  localStorage.setItem('companyFilter:reco', JSON.stringify({
    munis: [{ id: 100, nome: 'São Paulo', uf: 'SP', regiao: 'Sudeste' }],
    raio: '', pesos: { cnae: 0.5, proximidade: 0.3, porte: 0.2 },
  }));

const mount = (): ReturnType<typeof render> =>
  render(<MemoryRouter><Recommend /></MemoryRouter>);

beforeEach(() => {
  localStorage.clear();
  vi.mocked(m.get).mockReset();
  vi.mocked(m.post).mockReset();
  useAuthMock.mockReturnValue({
    user: admin, loading: false, login: vi.fn(), register: vi.fn(), refresh: vi.fn(), logout: vi.fn(),
    can: () => true,
  });
  m.get.mockImplementation(async (p: string) => {
    if (p.startsWith('/api/recommend')) return { results: [rec({})], page: { count: 1 } };
    if (p === '/api/municipios/ufs') return { ufs: [] };
    return {};
  });
});

describe('Recommend', () => {
  it('sem território: tela vazia, sem consultar a base', async () => {
    mount();
    expect(await screen.findByText('Defina o território')).toBeInTheDocument();
    expect(m.get.mock.calls.some((c) => String(c[0]).startsWith('/api/recommend'))).toBe(false);
  });

  it('com território dispara a busca (debounce) e lista resultados com score', async () => {
    comTerritorio();
    mount();
    expect(await screen.findByText('Loja Alvo', undefined, { timeout: 2000 })).toBeInTheDocument();
    expect(screen.getAllByText('82').length).toBeGreaterThan(0); // score no card e no KPI
    const url = m.get.mock.calls.map((c) => String(c[0])).find((u) => u.startsWith('/api/recommend'))!;
    expect(url).toContain('munis=100');
  });

  it('adicionar ao funil marca o card como adicionado', async () => {
    comTerritorio();
    m.post.mockResolvedValueOnce({ relationship: { id: 1 } });
    mount();
    await screen.findByText('Loja Alvo', undefined, { timeout: 2000 });
    await userEvent.click(screen.getByRole('button', { name: /Adicionar ao funil/ }));
    expect(m.post).toHaveBeenCalledWith('/api/relationships', { company_id: 1 });
    expect(await screen.findByText('Adicionado ao funil')).toBeInTheDocument();
  });

  it('erro da busca (400) mostra card com ação de ajustar filtros', async () => {
    comTerritorio();
    m.get.mockImplementation(async (p: string) => {
      if (p.startsWith('/api/recommend')) throw new ApiError(400, 'parâmetros inválidos');
      if (p === '/api/municipios/ufs') return { ufs: [] };
      return {};
    });
    mount();
    expect(await screen.findByText('parâmetros inválidos', undefined, { timeout: 2000 })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Ajustar filtros/ })).toBeInTheDocument();
  });

  it('"Carregar mais" pagina com offset', async () => {
    comTerritorio();
    // primeira página cheia (20) habilita o botão; cada página traz ids distintos
    m.get.mockImplementation(async (p: string) => {
      if (p.startsWith('/api/recommend')) {
        const off = Number(new URLSearchParams(p.split('?')[1]).get('offset') ?? '0');
        return { results: Array.from({ length: 20 }, (_, i) => { const n = off + i + 1; return rec({ id: String(n), razao_social: `Empresa ${n}`, nome_fantasia: `Empresa ${n}` }); }), page: { count: 20 } };
      }
      if (p === '/api/municipios/ufs') return { ufs: [] };
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
