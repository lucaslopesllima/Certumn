// Fase 4: Relatórios (vendas, ABC, cobertura, descartes) + export CSV + filtro por vendedor.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { Reports } from '../src/pages/Reports.tsx';
import { useAuth, type User } from '../src/lib/auth.tsx';
import { api } from '../src/lib/api.ts';
import { downloadCsv } from '../src/lib/export.ts';

vi.mock('../src/lib/auth.tsx', () => {
  const useAuth = vi.fn();
  return { useAuth, useOptionalUser: () => useAuth().user ?? null };
});
vi.mock('../src/lib/api.ts', () => ({ api: { get: vi.fn(), invalidate: vi.fn() }, ApiError: class extends Error {} }));
vi.mock('../src/lib/export.ts', () => ({ downloadCsv: vi.fn() }));
// Leaflet não roda em jsdom — neutraliza o mapa da aba Cobertura.
vi.mock('react-leaflet', () => ({
  MapContainer: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  TileLayer: () => null, CircleMarker: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>, Tooltip: ({ children }: { children?: React.ReactNode }) => <span>{children}</span>,
}));

const useAuthMock = vi.mocked(useAuth);
const m = vi.mocked(api);
const csv = vi.mocked(downloadCsv);
const rep: User = { id: 2, email: 'r@b.c', role: 'rep', org_id: 1, nome: 'Vendedor' };
const admin: User = { id: 1, email: 'a@b.c', role: 'admin', org_id: 1, org_nome: 'Org', tipo_conta: 'escritorio' };

const territorio = (): void => localStorage.setItem('companyFilter:reco', JSON.stringify({
  munis: [{ id: 100, nome: 'São Paulo', uf: 'SP', regiao: 'Sudeste' }], pesos: { cnae: 0.5, proximidade: 0.3, porte: 0.2 }, partida: null,
}));

const salesRows = [
  { chave: '2026-06', label: '2026-06', total: '1200', qtd: 3 },
  { chave: '2026-05', label: '2026-05', total: '0', qtd: 0 },
];
const abcClientes = [
  { company_id: 1, razao_social: 'A LTDA', nome_fantasia: 'Fantasia A', total: 800, share: 66.7, classe: 'A' },
  { company_id: 2, razao_social: 'B LTDA', nome_fantasia: null, total: 400, share: 33.3, classe: 'C' },
];
const coverageMun = [
  { id: 1, nome: 'São Paulo', uf: 'SP', lat: -23.5, lon: -46.6, potencial: 1000, clientes: 80 }, // verde (>=5%)
  { id: 2, nome: 'Campinas', uf: 'SP', lat: -22.9, lon: -47.0, potencial: 500, clientes: 5 },     // amarelo (<5%)
  { id: 3, nome: 'Santos', uf: 'SP', lat: -23.9, lon: -46.3, potencial: 0, clientes: 0 },          // cinza (sem cliente/potencial)
];
const descarteRows = [
  { motivo: 'Sem interesse', qtd: 10 },
  { motivo: 'Preço', qtd: 0 },
];

beforeEach(() => {
  localStorage.clear();
  useAuthMock.mockReturnValue({ user: rep, loading: false, login: vi.fn(), register: vi.fn(), refresh: vi.fn(), logout: vi.fn(), can: () => true, isOffice: true });
  m.get.mockReset();
  csv.mockReset();
  m.get.mockImplementation(async (p: string) => {
    if (p.startsWith('/api/reports/sales')) return { rows: salesRows };
    if (p.startsWith('/api/reports/abc')) return { clientes: abcClientes };
    if (p.startsWith('/api/reports/coverage')) return { municipios: coverageMun };
    if (p.startsWith('/api/reports/descartes')) return { motivos: descarteRows };
    if (p === '/api/users') return { users: [{ id: 1, email: 'a@b.c', nome: 'Ana', role: 'admin', ativo: true }, { id: 2, email: 'r@b.c', nome: 'Beto', role: 'rep', ativo: true }] };
    return {};
  });
});

const mount = (): ReturnType<typeof render> => render(<MemoryRouter><Reports /></MemoryRouter>);

describe('Reports', () => {
  it('aba de vendas: lista, total, barras e exporta CSV; troca de agrupador refaz busca', async () => {
    mount();
    expect(await screen.findByText('2026-06')).toBeInTheDocument();
    expect(screen.getByText('Total:')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Exportar CSV/ }));
    expect(csv).toHaveBeenCalledWith('vendas-por-mes', expect.any(Array), expect.any(Array));
    await userEvent.click(screen.getByRole('button', { name: 'Por vendedor' }));
    await waitFor(() => expect(m.get.mock.calls.some(([p]) => String(p).includes('group_by=vendedor'))).toBe(true));
  });

  it('vendas vazio mostra estado vazio', async () => {
    m.get.mockImplementation(async (p: string) => {
      if (p.startsWith('/api/reports/sales')) return { rows: [] };
      return {};
    });
    mount();
    expect(await screen.findByText('Sem vendas no período')).toBeInTheDocument();
  });

  it('aba ABC: resumo por classe, tabela e export', async () => {
    mount();
    await userEvent.click(screen.getByRole('button', { name: 'Curva ABC' }));
    expect(await screen.findByText('Fantasia A')).toBeInTheDocument();
    expect(screen.getByText('B LTDA')).toBeInTheDocument(); // nome_fantasia null → razao_social
    expect(screen.getByText(/2 cliente\(s\) — últimos 12 meses/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Exportar CSV/ }));
    expect(csv).toHaveBeenCalledWith('curva-abc', expect.any(Array), expect.any(Array));
  });

  it('aba ABC vazia', async () => {
    m.get.mockImplementation(async (p: string) => {
      if (p.startsWith('/api/reports/sales')) return { rows: salesRows };
      if (p.startsWith('/api/reports/abc')) return { clientes: [] };
      return {};
    });
    mount();
    await userEvent.click(screen.getByRole('button', { name: 'Curva ABC' }));
    expect(await screen.findByText('Sem faturamento')).toBeInTheDocument();
  });

  it('aba Cobertura sem território pede configuração', async () => {
    mount();
    await userEvent.click(screen.getByRole('button', { name: 'Cobertura' }));
    expect(await screen.findByText('Sem território')).toBeInTheDocument();
    expect(m.get.mock.calls.some(([p]) => String(p).startsWith('/api/reports/coverage'))).toBe(false);
  });

  it('aba Cobertura com território renderiza o mapa e o resumo', async () => {
    territorio();
    mount();
    await userEvent.click(screen.getByRole('button', { name: 'Cobertura' }));
    expect(await screen.findByText(/3 município\(s\)/)).toBeInTheDocument();
    expect(screen.getByText(/São Paulo\/SP/)).toBeInTheDocument();
    await waitFor(() => expect(m.get.mock.calls.some(([p]) => String(p).includes('munis=1,2,3') || String(p).startsWith('/api/reports/coverage'))).toBe(true));
  });

  it('aba Perdas: barras e total', async () => {
    mount();
    await userEvent.click(screen.getByRole('button', { name: 'Perdas' }));
    expect(await screen.findByText('Sem interesse')).toBeInTheDocument();
    expect(screen.getByText(/10 negócio\(s\) descartado\(s\)/)).toBeInTheDocument();
  });

  it('aba Perdas vazia', async () => {
    m.get.mockImplementation(async (p: string) => {
      if (p.startsWith('/api/reports/sales')) return { rows: salesRows };
      if (p.startsWith('/api/reports/descartes')) return { motivos: [] };
      return {};
    });
    mount();
    await userEvent.click(screen.getByRole('button', { name: 'Perdas' }));
    expect(await screen.findByText('Sem perdas registradas')).toBeInTheDocument();
  });

  it('admin com equipe filtra por vendedor (ownerQs com user_id)', async () => {
    useAuthMock.mockReturnValue({ user: admin, loading: false, login: vi.fn(), register: vi.fn(), refresh: vi.fn(), logout: vi.fn(), can: () => true, isOffice: true });
    mount();
    const sel = await screen.findByLabelText('Filtrar por vendedor');
    await userEvent.selectOptions(sel, '2');
    await waitFor(() => expect(m.get.mock.calls.some(([p]) => String(p).includes('user_id=2'))).toBe(true));
  });
});
