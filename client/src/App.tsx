import { NavLink, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { Suspense, lazy, useEffect, useState, type ReactNode } from 'react';
import { useAuth } from './lib/auth.tsx';
import { api } from './lib/api.ts';
import type { Notification } from './lib/types.ts';
import { Icon, type IconName } from './lib/icons.tsx';
import { SafeButton, cn } from './lib/ui.tsx';
import { ThemeToggle } from './lib/theme.tsx';
import { onQueueChange, queued } from './lib/offline.ts';

// Code splitting por rota: Leaflet e as páginas pesadas ficam fora do bundle
// inicial — quem abre o Login não baixa o mapa.
const Login = lazy(() => import('./pages/Login.tsx').then((m) => ({ default: m.Login })));
const Dashboard = lazy(() => import('./pages/Dashboard.tsx').then((m) => ({ default: m.Dashboard })));
const Recommend = lazy(() => import('./pages/Recommend.tsx').then((m) => ({ default: m.Recommend })));
const Reports = lazy(() => import('./pages/Reports.tsx').then((m) => ({ default: m.Reports })));
const Kanban = lazy(() => import('./pages/Kanban.tsx').then((m) => ({ default: m.Kanban })));
const Clientes = lazy(() => import('./pages/Clientes.tsx').then((m) => ({ default: m.Clientes })));
const Carteiras = lazy(() => import('./pages/Carteiras.tsx').then((m) => ({ default: m.Carteiras })));
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
const EmailAgendado = lazy(() => import('./pages/EmailAgendado.tsx').then((m) => ({ default: m.EmailAgendado })));
const WhatsApp = lazy(() => import('./pages/WhatsApp.tsx').then((m) => ({ default: m.WhatsApp })));
const Groups = lazy(() => import('./pages/Groups.tsx').then((m) => ({ default: m.Groups })));

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

// Bloqueia a rota quando o grupo não tem a permissão (admin faz bypass via can).
function RequirePermission({ code, children }: { code: string; children: ReactNode }): React.JSX.Element {
  const { can } = useAuth();
  if (!can(code)) return <Navigate to="/" replace />;
  return <>{children}</>;
}

// Bloqueia rotas de equipe (Equipe/Grupos/Carteiras) em conta individual.
function RequireOffice({ children }: { children: ReactNode }): React.JSX.Element {
  const { isOffice } = useAuth();
  if (!isOffice) return <Navigate to="/" replace />;
  return <>{children}</>;
}

type NavItem = { to: string; label: string; icon: IconName; requires?: string; officeOnly?: boolean };
type NavGroup = { label?: string; items: NavItem[] };

// Menu agrupado por intenção (chunking): reduz carga cognitiva e aproxima
// itens do mesmo fluxo de trabalho. Dashboard fica solto no topo; config no fim.
const NAV_GROUPS: NavGroup[] = [
  { items: [{ to: '/', label: 'Dashboard', icon: 'gauge' }] },
  { label: 'Vendas', items: [
    { to: '/prospeccao', label: 'Buscar Empresas', icon: 'target', requires: 'prospeccao.view' },
    { to: '/funil', label: 'Funil', icon: 'columns', requires: 'relationships.list' },
    { to: '/clientes', label: 'Clientes', icon: 'users', requires: 'relationships.list' },
    { to: '/carteiras', label: 'Carteiras', icon: 'layers', requires: 'carteiras.view', officeOnly: true },
    { to: '/pedidos', label: 'Pedidos', icon: 'list', requires: 'orders.list' },
    { to: '/whatsapp', label: 'WhatsApp', icon: 'phone', requires: 'whatsapp.view' },
    { to: '/email', label: 'E-mail', icon: 'mail', requires: 'email_schedules.list' },
    { to: '/agenda', label: 'Agenda', icon: 'calendar', requires: 'activities.list' },
  ] },
  { label: 'Logística', items: [
    { to: '/transportadoras', label: 'Transportadoras', icon: 'car', requires: 'carriers.list' },
    { to: '/rotas', label: 'Rotas', icon: 'route', requires: 'routes.list' },
    { to: '/catalogo', label: 'Catálogo', icon: 'box', requires: 'catalog.list' },
  ] },
  { label: 'Financeiro', items: [
    { to: '/comissoes', label: 'Comissões', icon: 'percent', requires: 'commissions.list' },
    { to: '/financeiro', label: 'Financeiro', icon: 'wallet', requires: 'finance.list' },
    { to: '/relatorios', label: 'Relatórios', icon: 'barChart', requires: 'reports.sales' },
  ] },
  { label: 'Sistema', items: [
    { to: '/equipe', label: 'Equipe', icon: 'users', requires: 'users.list', officeOnly: true },
    { to: '/grupos', label: 'Grupos', icon: 'layers', requires: 'groups.list', officeOnly: true },
    { to: '/config', label: 'Config', icon: 'settings' },
  ] },
];

// Lista achatada — mobile (barra + folha "Mais") e título da página usam ordem linear.
const NAV: NavItem[] = NAV_GROUPS.flatMap((g) => g.items);

// Itens visíveis: permissão do grupo (sem `requires` = livre) e, para itens de
// equipe (officeOnly), só em conta escritório.
function useNav(): NavItem[] {
  const { can, isOffice } = useAuth();
  return NAV.filter((n) => (!n.officeOnly || isOffice) && (!n.requires || can(n.requires)));
}

// Grupos visíveis: filtra itens por permissão/tipo de conta e descarta grupos vazios.
function useNavGroups(): NavGroup[] {
  const { can, isOffice } = useAuth();
  return NAV_GROUPS
    .map((g) => ({ ...g, items: g.items.filter((n) => (!n.officeOnly || isOffice) && (!n.requires || can(n.requires))) }))
    .filter((g) => g.items.length > 0);
}

// No mobile a barra inferior cabe ~4 alvos com toque confortável (≥44px). Os
// itens mais usados ficam fixos; o resto vai pra uma folha "Mais".
const MOBILE_PRIMARY = ['/', '/funil', '/pedidos', '/agenda'];

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
const SIDEBAR_GROUPS_KEY = 'rs_sidebar_groups_closed';

// Sidebar recolhível: alterna entre largura cheia (ícone + rótulo) e modo
// compacto só com ícones. O estado persiste em localStorage entre sessões.
function Sidebar(): React.JSX.Element {
  const { user, logout } = useAuth();
  const groups = useNavGroups();
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try { return localStorage.getItem(SIDEBAR_KEY) === '1'; } catch { return false; }
  });
  // Acordeon: guarda só os grupos FECHADOS (default = todos abertos).
  const [closed, setClosed] = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem(SIDEBAR_GROUPS_KEY) ?? '[]')); } catch { return new Set(); }
  });
  useEffect(() => {
    try { localStorage.setItem(SIDEBAR_KEY, collapsed ? '1' : '0'); } catch { /* storage indisponível */ }
  }, [collapsed]);
  useEffect(() => {
    try { localStorage.setItem(SIDEBAR_GROUPS_KEY, JSON.stringify([...closed])); } catch { /* storage indisponível */ }
  }, [closed]);

  const toggleGroup = (label: string): void => setClosed((prev) => {
    const next = new Set(prev);
    next.has(label) ? next.delete(label) : next.add(label);
    return next;
  });

  const inicial = (user?.org_nome ?? user?.email ?? '?').charAt(0).toUpperCase();

  return (
    <aside data-chrome className={cn('hidden shrink-0 flex-col bg-ink-900 py-4 transition-[width,padding] duration-300 ease-in-out sm:flex',
      collapsed ? 'w-16 px-2' : 'w-60 px-3')}>
      <div className={cn('flex items-center pb-5', collapsed ? 'justify-center' : 'justify-between px-2')}>
        {!collapsed && <Brand />}
        <button onClick={() => setCollapsed((v) => !v)} aria-label={collapsed ? 'Expandir menu' : 'Recolher menu'}
          className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-ink-400 hover:bg-white/10 hover:text-white">
          {/* seta acompanha o menu: aponta p/ dentro (recolher) aberto, p/ fora (expandir) fechado */}
          <Icon name="chevronRight" size={18} className={cn('transition-transform duration-300 ease-in-out', !collapsed && 'rotate-180')} />
        </button>
      </div>
      {/* nav rola na vertical quando os grupos passam da altura da tela */}
      <nav className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto overflow-x-hidden">
        {groups.map((g, gi) => {
          // acordeon só no modo expandido; recolhido sempre mostra os itens
          const isClosed = !collapsed && g.label != null && closed.has(g.label);
          return (
          <div key={g.label ?? 'top'} className={cn('flex flex-col gap-1', gi > 0 && 'mt-2')}>
            {g.label && (collapsed
              // recolhido: cabeçalho some, separador fino marca a fronteira do grupo
              ? <div className="mx-2 mb-1 border-t border-white/10" />
              : <button onClick={() => toggleGroup(g.label!)} aria-expanded={!isClosed}
                  className="flex w-full items-center justify-between rounded-lg px-3 py-1 text-xs font-semibold uppercase tracking-wider text-ink-500 transition-colors hover:text-ink-300">
                  {g.label}
                  <Icon name="chevronRight" size={14} className={cn('text-white transition-transform duration-200', !isClosed && 'rotate-90')} />
                </button>
            )}
            {!isClosed && g.items.map((n) => (
              <NavLink key={n.to} to={n.to} end={n.to === '/'} title={collapsed ? n.label : undefined}
                className={({ isActive }) => cn(
                  'group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-base font-medium transition-colors',
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
          </div>
          );
        })}
      </nav>

      <div className="mt-auto shrink-0 border-t border-white/10 pt-3">
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

// Destino de cada tipo de notificação ao clicar.
const NOTIF_DEST: Record<Notification['tipo'], string> = {
  vencimento: '/financeiro', agenda: '/agenda', comissao: '/comissoes', parado: '/funil',
};

// Sino de notificações (Fase 6.2). Materializadas no fetch pelo servidor; aqui
// só exibe, conta as não lidas e marca como lido. Repesca a cada 60s.
export function NotificationBell({ variant }: { variant: 'light' | 'dark' }): React.JSX.Element {
  const [items, setItems] = useState<Notification[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();

  const load = (): void => {
    void api.get<{ notifications: Notification[]; nao_lidas: number }>('/api/notifications')
      .then((r) => { setItems(r.notifications); setUnread(r.nao_lidas); }).catch(() => undefined);
  };
  useEffect(() => { load(); const t = setInterval(load, 60_000); return () => clearInterval(t); }, []);

  const onClick = async (n: Notification): Promise<void> => {
    if (!n.lida) await api.patch(`/api/notifications/${n.id}/read`).catch(() => undefined);
    setOpen(false);
    load();
    navigate(NOTIF_DEST[n.tipo] ?? '/');
  };
  const markAll = async (): Promise<void> => {
    await api.post('/api/notifications/read-all').catch(() => undefined);
    load();
  };

  return (
    <div className="relative">
      <button onClick={() => setOpen((o) => !o)} aria-label="Notificações"
        className={cn('relative grid h-8 w-8 place-items-center rounded-lg transition',
          variant === 'dark' ? 'text-ink-300 hover:bg-white/10 hover:text-white' : 'text-ink-400 hover:bg-ink-100 hover:text-ink-700')}>
        <Icon name="bell" size={18} />
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-[1500]" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-10 z-[1600] w-80 max-w-[calc(100vw-2rem)] overflow-hidden rounded-2xl border border-ink-200 bg-surface shadow-pop">
            <div className="flex items-center justify-between border-b border-ink-100 px-3 py-2">
              <span className="text-sm font-bold text-ink-800">Notificações</span>
              {unread > 0 && (
                <SafeButton onClick={() => markAll()} className="text-xs font-semibold text-brand-600 hover:underline">
                  Marcar todas
                </SafeButton>
              )}
            </div>
            <div className="max-h-96 overflow-auto">
              {items.length === 0 ? (
                <p className="px-3 py-6 text-center text-sm text-ink-400">Nada por aqui.</p>
              ) : items.map((n) => (
                <SafeButton key={n.id} onClick={() => onClick(n)}
                  className={cn('flex w-full items-start gap-2.5 border-b border-ink-50 px-3 py-2.5 text-left transition hover:bg-ink-50',
                    !n.lida && 'bg-brand-50/40')}>
                  <span className={cn('mt-1.5 h-2 w-2 shrink-0 rounded-full', n.lida ? 'bg-ink-200' : 'bg-brand-500')} />
                  <span className="min-w-0 flex-1 text-xs text-ink-700">{n.titulo}</span>
                </SafeButton>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// Folha "Mais" no mobile: itens secundários da navegação que não cabem na barra
// inferior. Abre de baixo, fecha ao tocar fora ou escolher destino.
function MobileMoreSheet({ items, open, onClose }: { items: typeof NAV; open: boolean; onClose: () => void }): React.JSX.Element | null {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[1100] sm:hidden" role="dialog" aria-modal="true" aria-label="Mais opções">
      <div className="absolute inset-0 bg-black/45" onClick={onClose} />
      <div className="absolute inset-x-0 bottom-0 rounded-t-2xl border-t border-ink-200 bg-surface pb-[max(env(safe-area-inset-bottom),0.5rem)] pt-2 shadow-pop animate-[toastIn_.18s_ease-out]">
        <div className="mx-auto mb-1 h-1 w-10 rounded-full bg-ink-200" />
        <p className="px-4 py-2 text-[11px] font-semibold uppercase tracking-wider text-ink-400">Mais</p>
        <div className="grid grid-cols-3 gap-1 px-3 pb-3">
          {items.map((n) => (
            <NavLink key={n.to} to={n.to} onClick={onClose}
              className={({ isActive }) => cn(
                'flex flex-col items-center gap-1 rounded-xl py-3 text-xs font-medium transition-colors',
                isActive ? 'bg-brand-50 text-brand-700' : 'text-ink-600 hover:bg-ink-50')}>
              <Icon name={n.icon} size={22} />{n.label}
            </NavLink>
          ))}
        </div>
      </div>
    </div>
  );
}

// Banner de status offline: consome a fila de ações de campo (offline.ts) e
// avisa o vendedor que há check-ins/relatórios aguardando sincronização.
function OfflineBanner(): React.JSX.Element | null {
  const [pendentes, setPendentes] = useState(0);
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine);
  useEffect(() => {
    const refresh = (): void => { void queued().then((q) => setPendentes(q.length)); };
    refresh();
    const off = onQueueChange(refresh);
    const on = (): void => setOnline(true);
    const down = (): void => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', down);
    return () => { off(); window.removeEventListener('online', on); window.removeEventListener('offline', down); };
  }, []);

  if (online && pendentes === 0) return null;
  return (
    <div className={cn('flex items-center gap-2 px-4 py-1.5 text-xs font-medium',
      online ? 'bg-amber-50 text-amber-700' : 'bg-rose-50 text-rose-700')}>
      <Icon name={online ? 'bell' : 'wifiOff'} size={14} />
      {online
        ? `Sincronizando ${pendentes} ação(ões) de campo…`
        : pendentes > 0
          ? `Offline — ${pendentes} ação(ões) aguardando. Enviadas quando a conexão voltar.`
          : 'Você está offline. Check-ins serão sincronizados ao reconectar.'}
    </div>
  );
}

function Shell({ children }: { children: ReactNode }): React.JSX.Element {
  const loc = useLocation();
  const nav = useNav();
  const [moreOpen, setMoreOpen] = useState(false);
  const title = nav.find((n) => n.to === loc.pathname)?.label ?? 'Prospecta';
  const primary = nav.filter((n) => MOBILE_PRIMARY.includes(n.to));
  const secondary = nav.filter((n) => !MOBILE_PRIMARY.includes(n.to));
  // fecha a folha ao trocar de rota
  useEffect(() => { setMoreOpen(false); }, [loc.pathname]);
  return (
    <div className="flex h-dvh bg-ink-50">
      <Sidebar />

      <div className="flex min-w-0 flex-1 flex-col">
        {/* mobile top bar */}
        <header data-chrome className="flex items-center justify-between bg-ink-900 px-4 py-3 sm:hidden">
          <Brand />
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-ink-300">{title}</span>
            <ThemeToggle variant="dark" />
            <NotificationBell variant="dark" />
            <NavLink to="/conta" aria-label="Meu perfil"
              className="grid h-8 w-8 place-items-center rounded-lg text-ink-300 hover:bg-white/10 hover:text-white">
              <Icon name="users" size={18} />
            </NavLink>
          </div>
        </header>

        {/* desktop top bar: só o sino, alinhado à direita */}
        <header className="hidden items-center justify-end gap-1 border-b border-ink-200 bg-surface px-6 py-2 sm:flex">
          <ThemeToggle variant="light" />
          <NotificationBell variant="light" />
        </header>

        <OfflineBanner />
        <main className="min-h-0 flex-1 overflow-auto pb-20 sm:pb-0">{children}</main>
      </div>

      {/* mobile bottom nav: 4 fixos + Mais (alvos ≥44px) */}
      <nav className="fixed inset-x-0 bottom-0 z-[1000] grid grid-cols-5 border-t border-ink-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur sm:hidden">
        {primary.map((n) => (
          <NavLink key={n.to} to={n.to} end={n.to === '/'}
            className={({ isActive }) => cn(
              'flex flex-col items-center gap-0.5 py-2.5 text-[10px] font-medium transition-colors',
              isActive ? 'text-brand-600' : 'text-ink-400')}>
            <Icon name={n.icon} size={22} />{n.label}
          </NavLink>
        ))}
        <button onClick={() => setMoreOpen(true)}
          className={cn('flex flex-col items-center gap-0.5 py-2.5 text-[10px] font-medium transition-colors',
            moreOpen || secondary.some((n) => n.to === loc.pathname) ? 'text-brand-600' : 'text-ink-400')}>
          <Icon name="menu" size={22} />Mais
        </button>
      </nav>
      <MobileMoreSheet items={secondary} open={moreOpen} onClose={() => setMoreOpen(false)} />
    </div>
  );
}

export function App(): React.JSX.Element {
  return (
    <Suspense fallback={<FullScreenSpinner />}>
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/" element={<RequireAuth><Shell><Dashboard /></Shell></RequireAuth>} />
      <Route path="/prospeccao" element={<RequireAuth><RequirePermission code="prospeccao.view"><Shell><Recommend /></Shell></RequirePermission></RequireAuth>} />
      <Route path="/perfil" element={<Navigate to="/config" replace />} />
      <Route path="/funil" element={<RequireAuth><RequirePermission code="relationships.list"><Shell><Kanban /></Shell></RequirePermission></RequireAuth>} />
      <Route path="/clientes" element={<RequireAuth><RequirePermission code="relationships.list"><Shell><Clientes /></Shell></RequirePermission></RequireAuth>} />
      <Route path="/carteiras" element={<RequireAuth><RequireOffice><RequirePermission code="carteiras.view"><Shell><Carteiras /></Shell></RequirePermission></RequireOffice></RequireAuth>} />
      <Route path="/pedidos" element={<RequireAuth><RequirePermission code="orders.list"><Shell><Orders /></Shell></RequirePermission></RequireAuth>} />
      <Route path="/whatsapp" element={<RequireAuth><RequirePermission code="whatsapp.view"><Shell><WhatsApp /></Shell></RequirePermission></RequireAuth>} />
      <Route path="/comissoes" element={<RequireAuth><RequirePermission code="commissions.list"><Shell><Commissions /></Shell></RequirePermission></RequireAuth>} />
      <Route path="/relatorios" element={<RequireAuth><RequirePermission code="reports.sales"><Shell><Reports /></Shell></RequirePermission></RequireAuth>} />
      <Route path="/transportadoras" element={<RequireAuth><RequirePermission code="carriers.list"><Shell><Carriers /></Shell></RequirePermission></RequireAuth>} />
      <Route path="/rotas" element={<RequireAuth><RequirePermission code="routes.list"><Shell><RoutePlanner /></Shell></RequirePermission></RequireAuth>} />
      <Route path="/catalogo" element={<RequireAuth><RequirePermission code="catalog.list"><Shell><Catalog /></Shell></RequirePermission></RequireAuth>} />
      <Route path="/agenda" element={<RequireAuth><RequirePermission code="activities.list"><Shell><Agenda /></Shell></RequirePermission></RequireAuth>} />
      <Route path="/email" element={<RequireAuth><RequirePermission code="email_schedules.list"><Shell><EmailAgendado /></Shell></RequirePermission></RequireAuth>} />
      <Route path="/financeiro" element={<RequireAuth><RequirePermission code="finance.list"><Shell><Finance /></Shell></RequirePermission></RequireAuth>} />
      <Route path="/equipe" element={<RequireAuth><RequireOffice><RequirePermission code="users.list"><Shell><Team /></Shell></RequirePermission></RequireOffice></RequireAuth>} />
      <Route path="/grupos" element={<RequireAuth><RequireOffice><RequirePermission code="groups.list"><Shell><Groups /></Shell></RequirePermission></RequireOffice></RequireAuth>} />
      <Route path="/trocar-senha" element={<RequireAuth><ChangePassword /></RequireAuth>} />
      <Route path="/config" element={<RequireAuth><Shell><Settings /></Shell></RequireAuth>} />
      <Route path="/conta" element={<RequireAuth><Shell><Account /></Shell></RequireAuth>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
    </Suspense>
  );
}
