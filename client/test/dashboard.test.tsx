// Fase 4: Dashboard agrega KPIs, funil, agenda, alertas e ranking.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Dashboard } from '../src/pages/Dashboard.tsx';
import { useAuth, type User } from '../src/lib/auth.tsx';
import { api } from '../src/lib/api.ts';

vi.mock('../src/lib/auth.tsx', () => {
  const useAuth = vi.fn();
  return { useAuth, useOptionalUser: () => useAuth().user ?? null };
});
vi.mock('../src/lib/api.ts', () => ({ api: { get: vi.fn() }, ApiError: class extends Error {} }));

const useAuthMock = vi.mocked(useAuth);
const m = vi.mocked(api);
const admin: User = { id: 1, email: 'a@b.c', role: 'admin', org_id: 1, nome: 'Chefe' };

const DATA = {
  competencia: '2026-06', inatividade_dias: 30,
  funil: [{ id: 1, nome: 'Prospecção', ordem: 1, qtd: 3, valor: '5000' }],
  vendas: { total: 1500, qtd: 2, meta: 3000 },
  comissoes: { previsto: 150, recebido: 50, divergentes: 1 },
  agenda: [{ id: 9, tipo: 'visita', titulo: 'Visitar ACME', start_at: '2026-06-13T14:00:00Z', company_id: 7, razao_social: 'ACME LTDA' }],
  alertas: {
    sem_contato: [{ id: 2, company_id: 7, razao_social: 'ACME LTDA', nome_fantasia: 'ACME', ultimo_contato: '2020-01-01', dias: 99 }],
    parados: [],
  },
  ranking: [{ user_id: 1, nome: 'Chefe', email: 'a@b.c', total: '1500', qtd: 2 }],
};

beforeEach(() => {
  useAuthMock.mockReturnValue({ user: admin, loading: false, login: vi.fn(), register: vi.fn(), refresh: vi.fn(), logout: vi.fn(), can: () => true, isOffice: true });
  m.get.mockReset();
  m.get.mockImplementation(async (p: string) => {
    if (p.startsWith('/api/dashboard')) return DATA;
    if (p === '/api/users') return { users: [] };
    return {};
  });
});

const mount = (): ReturnType<typeof render> => render(<MemoryRouter><Dashboard /></MemoryRouter>);

describe('Dashboard', () => {
  it('mostra KPIs, funil, agenda, alerta e ranking', async () => {
    mount();
    expect(await screen.findByText('Vendas do mês')).toBeInTheDocument();
    expect(screen.getByText('Prospecção')).toBeInTheDocument();
    expect(screen.getByText('Visitar ACME')).toBeInTheDocument();
    expect(screen.getByText('99 dias')).toBeInTheDocument();
    expect(screen.getByText('Ranking de vendas do mês')).toBeInTheDocument();
  });

  it('chama o dashboard com a competência do mês', async () => {
    mount();
    await waitFor(() => expect(m.get).toHaveBeenCalled());
    expect(vi.mocked(m.get).mock.calls.some(([p]) => String(p).startsWith('/api/dashboard?competencia='))).toBe(true);
  });
});
