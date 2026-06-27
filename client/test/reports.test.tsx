// Fase 4: Relatórios (vendas, ABC, cobertura, descartes) + export CSV.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Reports } from '../src/pages/Reports.tsx';
import { useAuth, type User } from '../src/lib/auth.tsx';
import { api } from '../src/lib/api.ts';

vi.mock('../src/lib/auth.tsx', () => {
  const useAuth = vi.fn();
  return { useAuth, useOptionalUser: () => useAuth().user ?? null };
});
vi.mock('../src/lib/api.ts', () => ({ api: { get: vi.fn() }, ApiError: class extends Error {} }));
// Leaflet não roda em jsdom — neutraliza o mapa da aba Cobertura.
vi.mock('react-leaflet', () => ({
  MapContainer: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  TileLayer: () => null, CircleMarker: () => null, Tooltip: () => null,
}));

const useAuthMock = vi.mocked(useAuth);
const m = vi.mocked(api);
const rep: User = { id: 2, email: 'r@b.c', role: 'rep', org_id: 1, nome: 'Vendedor' };

beforeEach(() => {
  useAuthMock.mockReturnValue({ user: rep, loading: false, login: vi.fn(), register: vi.fn(), refresh: vi.fn(), logout: vi.fn() });
  m.get.mockReset();
  m.get.mockImplementation(async (p: string) => {
    if (p.startsWith('/api/reports/sales')) return { rows: [{ chave: '2026-06', label: '2026-06', total: '1200', qtd: 3 }] };
    if (p.startsWith('/api/reports/abc')) return { clientes: [] };
    if (p.startsWith('/api/reports/coverage')) return { municipios: [] };
    if (p.startsWith('/api/reports/descartes')) return { motivos: [] };
    if (p === '/api/users') return { users: [] };
    return {};
  });
});

const mount = (): ReturnType<typeof render> => render(<MemoryRouter><Reports /></MemoryRouter>);

describe('Reports', () => {
  it('abre na aba de vendas e lista a linha agregada', async () => {
    mount();
    expect(await screen.findByText('2026-06')).toBeInTheDocument();
    await waitFor(() => expect(m.get.mock.calls.some(([p]) => String(p).startsWith('/api/reports/sales'))).toBe(true));
  });
});
