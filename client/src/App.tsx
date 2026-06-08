import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './lib/auth.tsx';
import { Login } from './pages/Login.tsx';
import { Recommend } from './pages/Recommend.tsx';
import { Kanban } from './pages/Kanban.tsx';
import { Catalog } from './pages/Catalog.tsx';
import { Agenda } from './pages/Agenda.tsx';
import { Settings } from './pages/Settings.tsx';
import { Account } from './pages/Account.tsx';
import { Finance } from './pages/Finance.tsx';
import { RoutePlanner } from './pages/Routes.tsx';
import { Icon, type IconName } from './lib/icons.tsx';
import { cn } from './lib/ui.tsx';
import type { ReactNode } from 'react';

function RequireAuth({ children }: { children: ReactNode }): React.JSX.Element {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div className="grid h-dvh place-items-center bg-ink-50 text-ink-400">
        <span className="h-6 w-6 animate-spin rounded-full border-2 border-ink-200 border-t-brand-500" />
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

const NAV: { to: string; label: string; icon: IconName }[] = [
  { to: '/', label: 'Prospecção', icon: 'target' },
  { to: '/funil', label: 'Funil', icon: 'columns' },
  { to: '/rotas', label: 'Rotas', icon: 'route' },
  { to: '/catalogo', label: 'Catálogo', icon: 'box' },
  { to: '/agenda', label: 'Agenda', icon: 'calendar' },
  { to: '/financeiro', label: 'Financeiro', icon: 'wallet' },
  { to: '/config', label: 'Config', icon: 'settings' },
];

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

function Sidebar(): React.JSX.Element {
  const { user, logout } = useAuth();
  return (
    <aside className="hidden w-60 shrink-0 flex-col bg-ink-900 px-3 py-4 sm:flex">
      <div className="px-2 pb-5">
        <Brand />
      </div>
      <p className="px-3 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-ink-500">Menu</p>
      <nav className="flex flex-col gap-1">
        {NAV.map((n) => (
          <NavLink key={n.to} to={n.to} end={n.to === '/'}
            className={({ isActive }) => cn(
              'group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors',
              isActive ? 'bg-white/10 text-white' : 'text-ink-300 hover:bg-white/5 hover:text-white')}>
            {({ isActive }) => (
              <>
                {isActive && <span className="absolute left-0 top-1/2 h-5 -translate-y-1/2 rounded-r-full bg-brand-400" style={{ width: 3 }} />}
                <Icon name={n.icon} size={19} className={isActive ? 'text-brand-300' : 'text-ink-400 group-hover:text-ink-200'} />
                {n.label}
              </>
            )}
          </NavLink>
        ))}
      </nav>

      <div className="mt-auto border-t border-white/10 pt-3">
        <div className="flex items-center gap-2.5 rounded-xl px-2 py-2">
          <NavLink to="/conta" title="Meu perfil" className="flex min-w-0 flex-1 items-center gap-2.5 rounded-lg p-1 transition-colors hover:bg-white/5">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-brand-500/20 text-sm font-bold text-brand-200">
              {(user?.org_nome ?? user?.email ?? '?').charAt(0).toUpperCase()}
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
      </div>
    </aside>
  );
}

function Shell({ children }: { children: ReactNode }): React.JSX.Element {
  const loc = useLocation();
  const title = NAV.find((n) => n.to === loc.pathname)?.label ?? 'Prospecta';
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
      <nav className="fixed inset-x-0 bottom-0 z-[1000] grid grid-cols-7 border-t border-ink-200 bg-white/95 backdrop-blur sm:hidden">
        {NAV.map((n) => (
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
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/" element={<RequireAuth><Shell><Recommend /></Shell></RequireAuth>} />
      <Route path="/perfil" element={<Navigate to="/config" replace />} />
      <Route path="/funil" element={<RequireAuth><Shell><Kanban /></Shell></RequireAuth>} />
      <Route path="/rotas" element={<RequireAuth><Shell><RoutePlanner /></Shell></RequireAuth>} />
      <Route path="/catalogo" element={<RequireAuth><Shell><Catalog /></Shell></RequireAuth>} />
      <Route path="/agenda" element={<RequireAuth><Shell><Agenda /></Shell></RequireAuth>} />
      <Route path="/financeiro" element={<RequireAuth><Shell><Finance /></Shell></RequireAuth>} />
      <Route path="/config" element={<RequireAuth><Shell><Settings /></Shell></RequireAuth>} />
      <Route path="/conta" element={<RequireAuth><Shell><Account /></Shell></RequireAuth>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
