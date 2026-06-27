// Guards de rota do App: anônimo -> /login, senha provisória -> /trocar-senha,
// não-admin fora de /equipe. Páginas pesadas mockadas (Leaflet não roda em jsdom).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { App } from '../src/App.tsx';
import { useAuth, type User } from '../src/lib/auth.tsx';

vi.mock('../src/lib/auth.tsx', () => {
  const useAuth = vi.fn();
  return { useAuth, useOptionalUser: () => useAuth().user ?? null };
});
// páginas lazy substituídas por marcadores — o alvo aqui é o roteamento
vi.mock('../src/pages/Dashboard.tsx', () => ({ Dashboard: () => <div>PAGE-DASHBOARD</div> }));
vi.mock('../src/pages/Reports.tsx', () => ({ Reports: () => <div>PAGE-RELATORIOS</div> }));
vi.mock('../src/pages/Recommend.tsx', () => ({ Recommend: () => <div>PAGE-RECOMMEND</div> }));
vi.mock('../src/pages/Kanban.tsx', () => ({ Kanban: () => <div>PAGE-KANBAN</div> }));
vi.mock('../src/pages/Routes.tsx', () => ({ RoutePlanner: () => <div>PAGE-ROTAS</div> }));
vi.mock('../src/pages/Catalog.tsx', () => ({ Catalog: () => <div>PAGE-CATALOGO</div> }));
vi.mock('../src/pages/Agenda.tsx', () => ({ Agenda: () => <div>PAGE-AGENDA</div> }));
vi.mock('../src/pages/Settings.tsx', () => ({ Settings: () => <div>PAGE-CONFIG</div> }));
vi.mock('../src/pages/Account.tsx', () => ({ Account: () => <div>PAGE-CONTA</div> }));
vi.mock('../src/pages/Finance.tsx', () => ({ Finance: () => <div>PAGE-FIN</div> }));
vi.mock('../src/pages/Team.tsx', () => ({ Team: () => <div>PAGE-EQUIPE</div> }));
vi.mock('../src/pages/Login.tsx', () => ({ Login: () => <div>PAGE-LOGIN</div> }));
vi.mock('../src/pages/ChangePassword.tsx', () => ({ ChangePassword: () => <div>PAGE-TROCAR-SENHA</div> }));
// theme usa window.matchMedia (ausente no jsdom); o alvo aqui é roteamento.
vi.mock('../src/lib/theme.tsx', () => ({
  ThemeProvider: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  ThemeToggle: () => null,
  useTheme: () => ({ theme: 'light', setTheme: vi.fn(), toggle: vi.fn() }),
}));

const useAuthMock = vi.mocked(useAuth);

const auth = (user: User | null, loading = false): ReturnType<typeof useAuth> => ({
  user, loading, login: vi.fn(), register: vi.fn(), refresh: vi.fn(), logout: vi.fn(),
});

const admin: User = { id: 1, email: 'a@b.c', role: 'admin', org_id: 1, org_nome: 'Org' };
const rep: User = { ...admin, role: 'rep' };

const mount = (path: string): ReturnType<typeof render> => render(
  <MemoryRouter initialEntries={[path]}><App /></MemoryRouter>,
);

beforeEach(() => useAuthMock.mockReturnValue(auth(admin)));

describe('App routing', () => {
  it('anônimo em rota protegida cai no login', async () => {
    useAuthMock.mockReturnValue(auth(null));
    mount('/funil');
    expect(await screen.findByText('PAGE-LOGIN')).toBeInTheDocument();
  });

  it('loading mostra spinner, não redireciona', () => {
    useAuthMock.mockReturnValue(auth(null, true));
    const { container } = mount('/funil');
    expect(container.querySelector('.animate-spin')).toBeInTheDocument();
    expect(screen.queryByText('PAGE-LOGIN')).not.toBeInTheDocument();
  });

  it('senha provisória força /trocar-senha em qualquer rota', async () => {
    useAuthMock.mockReturnValue(auth({ ...rep, must_change_password: true }));
    mount('/agenda');
    expect(await screen.findByText('PAGE-TROCAR-SENHA')).toBeInTheDocument();
  });

  it('admin abre o dashboard na home e a prospecção em /prospeccao', async () => {
    mount('/');
    expect(await screen.findByText('PAGE-DASHBOARD')).toBeInTheDocument();
  });

  it('rota /prospeccao renderiza a recomendação', async () => {
    mount('/prospeccao');
    expect(await screen.findByText('PAGE-RECOMMEND')).toBeInTheDocument();
  });

  it('rep não acessa /equipe (volta para a home)', async () => {
    useAuthMock.mockReturnValue(auth(rep));
    mount('/equipe');
    expect(await screen.findByText('PAGE-DASHBOARD')).toBeInTheDocument();
    expect(screen.queryByText('PAGE-EQUIPE')).not.toBeInTheDocument();
  });

  it('admin acessa /equipe e o menu mostra Equipe', async () => {
    mount('/equipe');
    expect(await screen.findByText('PAGE-EQUIPE')).toBeInTheDocument();
    expect(screen.getAllByText('Equipe').length).toBeGreaterThan(0);
  });

  it('menu de rep não tem Equipe; rota desconhecida cai na home', async () => {
    useAuthMock.mockReturnValue(auth(rep));
    mount('/nao-existe');
    expect(await screen.findByText('PAGE-DASHBOARD')).toBeInTheDocument();
    expect(screen.queryByText('Equipe')).not.toBeInTheDocument();
  });

  it('/perfil redireciona para /config', async () => {
    mount('/perfil');
    expect(await screen.findByText('PAGE-CONFIG')).toBeInTheDocument();
  });
});
