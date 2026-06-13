import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { Suspense, lazy, useEffect, useState, type ReactNode } from 'react';
import { useAuth } from './lib/auth.tsx';
import { Icon, type IconName } from './lib/icons.tsx';
import { cn } from './lib/ui.tsx';

// Code splitting por rota: Leaflet e as páginas pesadas ficam fora do bundle
// inicial — quem abre o Login não baixa o mapa.
const Login = lazy(() => import('./pages/Login.tsx').then((m) => ({ default: m.Login })));
const Dashboard = lazy(() => import('./pages/Dashboard.tsx').then((m) => ({ default: m.Dashboard })));
const Recommend = lazy(() => import('./pages/Recommend.tsx').then((m) => ({ default: m.Recommend })));
const Reports = lazy(() => import('./pages/Reports.tsx').then((m) => ({ default: m.Reports })));
const Kanban = lazy(() => import('./pages/Kanban.tsx').then((m) => ({ default: m.Kanban })));
const Catalog = lazy(() => import('./pages/Catalog.tsx').then((m) => ({ default: m.Catalog })));
const Agenda = lazy(() => import('./pages/Agenda.tsx').then((m) => ({ default: m.Agenda })));
const Settings = lazy(() => import('./pages/Settings.tsx').then((m) => ({ default: m.Settings })));
const Account = lazy(() => import('./pages/Account.tsx').then((m) => ({ default: m.Account })));
const Finance = lazy(() => import('./pages/Finance.tsx').then((m) => ({ default: m.Finance })));
const RoutePlanner = lazy(() => import('./pages/Routes.tsx').then((m) => ({ default: m.RoutePlanner })));
const Team = lazy(() => import('./pages/Team.tsx').then((m) => ({ default: m.Team })));
const Orders = lazy(() => import('./pages/Orders.tsx').then((m) => ({ default: m.Orders })));
const Carriers = lazy(() => import('./pages/Carriers.tsx').then((m) => ({ default: m.Carriers })));
const Commissions = lazy(() => import('./pages/Commissions.tsx').then((m) => ({ default: m.Commissions })));
const ChangePassword = lazy(() => import('./pages/ChangePassword.tsx').then((m) => ({ default: m.ChangePassword })));

function FullScreenSpinner(): React.JSX.Element {
  return (
    <div className="grid h-dvh place-items-center bg-ink-50 text-ink-400">
      <span className="h-6 w-6 animate-spin rounded-full border-2 border-ink-200 border-t-brand-500" />
    </div>
  );
}

function RequireAuth({ children }: { children: ReactNode }): React.JSX.Element {
  const { user, loading } = useAuth();
  const loc = useLocation();
  if (loading) return <FullScreenSpinner />;
  if (!user) return <Navigate to="/login" replace />;
  // senha provisória bloqueia tudo até a troca
  if (user.must_change_password && loc.pathname !== '/trocar-senha') {
    return <Navigate to="/trocar-senha" replace />;
  }
  return <>{children}</>;
}

function RequireAdmin({ children }: { children: ReactNode }): React.JSX.Element {
  const { user } = useAuth();
  if (user?.role !== 'admin') return <Navigate to="/" replace />;
  return <>{children}</>;
}

const NAV: { to: string; label: string; icon: IconName; admin?: boolean }[] = [
  { to: '/', label: 'Dashboard', icon: 'gauge' },
  { to: '/prospeccao', label: 'Prospecção', icon: 'target' },
  { to: '/funil', label: 'Funil', icon: 'columns' },
  { to: '/pedidos', label: 'Pedidos', icon: 'list' },
  { to: '/comissoes', label: 'Comissões', icon: 'percent' },
  { to: '/relatorios', label: 'Relatórios', icon: 'barChart' },
  { to: '/transportadoras', label: 'Transportadoras', icon: 'car' },
  { to: '/rotas', label: 'Rotas', icon: 'route' },
  { to: '/catalogo', label: 'Catálogo', icon: 'box' },
  { to: '/agenda', label: 'Agenda', icon: 'calendar' },
  { to: '/financeiro', label: 'Financeiro', icon: 'wallet' },
  { to: '/equipe', label: 'Equipe', icon: 'users', admin: true },
  { to: '/config', label: 'Config', icon: 'settings' },
];

// Itens visíveis para o papel do usuário logado (Equipe é só de admin).
function useNav(): typeof NAV {
  const { user } = useAuth();
  return NAV.filter((n) => !n.admin || user?.role === 'admin');
}

function Brand({ compact }: { compact?: boolean }): React.JSX.Element {
  return (
    <div className="flex items-center gap-2.5">
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-brand-400 to-brand-600 text-white shadow-sm shadow-brand-600/30">
        <Icon name="target" size={18} />
      </span>
      {!compact && (
        <span className="text-[15px] font-bold tracking-tight text-white">
          Prospecta
        </span>
      )}
    </div>
  );
}

const SIDEBAR_KEY = 'rs_sidebar_collapsed';

// Sidebar recolhível: alterna entre largura cheia (ícone + rótulo) e modo
// compacto só com ícones. O estado persiste em localStorage entre sessões.
function Sidebar(): React.JSX.Element {
  const { user, logout } = useAuth();
  const nav = useNav();
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try { return localStorage.getItem(SIDEBAR_KEY) === '1'; } catch { return false; }
  });
  useEffect(() => {
    try { localStorage.setItem(SIDEBAR_KEY, collapsed ? '1' : '0'); } catch { /* storage indisponível */ }
  }, [collapsed]);

  const inicial = (user?.org_nome ?? user?.email ?? '?').charAt(0).toUpperCase();

  return (
    <aside className={cn('hidden shrink-0 flex-col bg-ink-900 py-4 transition-[width,padding] duration-300 ease-in-out sm:flex',
      collapsed ? 'w-16 px-2' : 'w-60 px-3')}>
      <div className={cn('flex items-center pb-5', collapsed ? 'justify-center' : 'justify-between px-2')}>
        {!collapsed && <Brand />}
        <button onClick={() => setCollapsed((v) => !v)} aria-label={collapsed ? 'Expandir menu' : 'Recolher menu'}
          className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-ink-400 hover:bg-white/10 hover:text-white">
          {/* seta acompanha o menu: aponta p/ dentro (recolher) aberto, p/ fora (expandir) fechado */}
          <Icon name="chevronRight" size={18} className={cn('transition-transform duration-300 ease-in-out', !collapsed && 'rotate-180')} />
        </button>
      </div>
      {!collapsed && <p className="px-3 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-ink-500">Menu</p>}
      <nav className="flex flex-col gap-1">
        {nav.map((n) => (
          <NavLink key={n.to} to={n.to} end={n.to === '/'} title={collapsed ? n.label : undefined}
            className={({ isActive }) => cn(
              'group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors',
              collapsed && 'justify-center px-0',
              isActive ? 'bg-white/10 text-white' : 'text-ink-300 hover:bg-white/5 hover:text-white')}>
            {({ isActive }) => (
              <>
                {isActive && <span className="absolute left-0 top-1/2 h-5 -translate-y-1/2 rounded-r-full bg-brand-400" style={{ width: 3 }} />}
                <Icon name={n.icon} size={19} className={isActive ? 'text-brand-300' : 'text-ink-400 group-hover:text-ink-200'} />
                {!collapsed && n.label}
              </>
            )}
          </NavLink>
        ))}
      </nav>

      <div className="mt-auto border-t border-white/10 pt-3">
        {collapsed ? (
          <div className="flex flex-col items-center gap-2">
            <NavLink to="/conta" title={user?.org_nome ?? 'Meu perfil'}
              className="grid h-9 w-9 place-items-center rounded-full bg-brand-500/20 text-sm font-bold text-brand-200 transition-colors hover:bg-brand-500/30">
              {inicial}
            </NavLink>
            <button onClick={logout} aria-label="Sair"
              className="grid h-8 w-8 place-items-center rounded-lg text-ink-400 hover:bg-white/10 hover:text-white">
              <Icon name="logout" size={17} />
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2.5 rounded-xl px-2 py-2">
            <NavLink to="/conta" title="Meu perfil" className="flex min-w-0 flex-1 items-center gap-2.5 rounded-lg p-1 transition-colors hover:bg-white/5">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-brand-500/20 text-sm font-bold text-brand-200">
                {inicial}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-semibold text-white">{user?.org_nome ?? 'Minha conta'}</p>
                <p className="truncate text-[11px] text-ink-400">{user?.email}</p>
              </div>
            </NavLink>
            <button onClick={logout} aria-label="Sair"
              className="grid h-8 w-8 place-items-center rounded-lg text-ink-400 hover:bg-white/10 hover:text-white">
              <Icon name="logout" size={17} />
            </button>
          </div>
        )}
      </div>
    </aside>
  );
}

function Shell({ children }: { children: ReactNode }): React.JSX.Element {
  const loc = useLocation();
  const nav = useNav();
  const title = nav.find((n) => n.to === loc.pathname)?.label ?? 'Prospecta';
  return (
    <div className="flex h-dvh bg-ink-50">
      <Sidebar />

      <div className="flex min-w-0 flex-1 flex-col">
        {/* mobile top bar */}
        <header className="flex items-center justify-between bg-ink-900 px-4 py-3 sm:hidden">
          <Brand />
          <div className="flex items-center gap-3">
            <span className="text-sm font-medium text-ink-300">{title}</span>
            <NavLink to="/conta" aria-label="Meu perfil"
              className="grid h-8 w-8 place-items-center rounded-lg text-ink-300 hover:bg-white/10 hover:text-white">
              <Icon name="users" size={18} />
            </NavLink>
          </div>
        </header>

        <main className="min-h-0 flex-1 overflow-auto pb-20 sm:pb-0">{children}</main>
      </div>

      {/* mobile bottom nav */}
      <nav className="fixed inset-x-0 bottom-0 z-[1000] grid border-t border-ink-200 bg-white/95 backdrop-blur sm:hidden"
        style={{ gridTemplateColumns: `repeat(${nav.length}, minmax(0, 1fr))` }}>
        {nav.map((n) => (
          <NavLink key={n.to} to={n.to} end={n.to === '/'}
            className={({ isActive }) => cn(
              'flex flex-col items-center gap-0.5 py-2 text-[10px] font-medium transition-colors',
              isActive ? 'text-brand-600' : 'text-ink-400')}>
            <Icon name={n.icon} size={20} />{n.label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}

export function App(): React.JSX.Element {
  return (
    <Suspense fallback={<FullScreenSpinner />}>
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/" element={<RequireAuth><Shell><Dashboard /></Shell></RequireAuth>} />
      <Route path="/prospeccao" element={<RequireAuth><Shell><Recommend /></Shell></RequireAuth>} />
      <Route path="/perfil" element={<Navigate to="/config" replace />} />
      <Route path="/funil" element={<RequireAuth><Shell><Kanban /></Shell></RequireAuth>} />
      <Route path="/pedidos" element={<RequireAuth><Shell><Orders /></Shell></RequireAuth>} />
      <Route path="/comissoes" element={<RequireAuth><Shell><Commissions /></Shell></RequireAuth>} />
      <Route path="/relatorios" element={<RequireAuth><Shell><Reports /></Shell></RequireAuth>} />
      <Route path="/transportadoras" element={<RequireAuth><Shell><Carriers /></Shell></RequireAuth>} />
      <Route path="/rotas" element={<RequireAuth><Shell><RoutePlanner /></Shell></RequireAuth>} />
      <Route path="/catalogo" element={<RequireAuth><Shell><Catalog /></Shell></RequireAuth>} />
      <Route path="/agenda" element={<RequireAuth><Shell><Agenda /></Shell></RequireAuth>} />
      <Route path="/financeiro" element={<RequireAuth><Shell><Finance /></Shell></RequireAuth>} />
      <Route path="/equipe" element={<RequireAuth><RequireAdmin><Shell><Team /></Shell></RequireAdmin></RequireAuth>} />
      <Route path="/trocar-senha" element={<RequireAuth><ChangePassword /></RequireAuth>} />
      <Route path="/config" element={<RequireAuth><Shell><Settings /></Shell></RequireAuth>} />
      <Route path="/conta" element={<RequireAuth><Shell><Account /></Shell></RequireAuth>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
    </Suspense>
  );
}
