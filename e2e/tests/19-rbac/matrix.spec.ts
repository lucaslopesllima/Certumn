// Matriz RBAC: para cada permission code abaixo, um usuário SEM essa permissão
// (grupo custom = catálogo inteiro menos esse code) deve ter (a) o item de menu
// correspondente ausente, (b) navegação direta pela URL redirecionada pra "/",
// e (c) a chamada de API equivalente respondendo 403. Codes e rotas espelham
// client/src/App.tsx (NAV_GROUPS) e server/src/permissions.ts.
import { test as base, expect } from '@playwright/test';
import { registerOrg, loginWithoutPermission, type Session } from '../../fixtures/auth.ts';

interface Case { code: string; route: string; label: string; apiPath?: string }

const MATRIX: Case[] = [
  { code: 'prospeccao.view', route: '/prospeccao', label: 'Buscar Empresas', apiPath: '/api/recommend' },
  { code: 'relationships.list', route: '/clientes', label: 'Clientes', apiPath: '/api/relationships' },
  { code: 'orders.list', route: '/pedidos', label: 'Pedidos', apiPath: '/api/orders' },
  { code: 'whatsapp.view', route: '/whatsapp', label: 'WhatsApp', apiPath: '/api/whatsapp/connection' },
  { code: 'commissions.list', route: '/comissoes', label: 'Comissões', apiPath: '/api/commissions' },
  { code: 'reports.sales', route: '/relatorios', label: 'Relatórios', apiPath: '/api/reports/sales' },
  { code: 'carriers.list', route: '/transportadoras', label: 'Transportadoras', apiPath: '/api/carriers' },
  { code: 'routes.list', route: '/rotas', label: 'Rotas', apiPath: '/api/routes' },
  { code: 'catalog.list', route: '/catalogo', label: 'Catálogo', apiPath: '/api/catalog' },
  { code: 'activities.list', route: '/agenda', label: 'Agenda', apiPath: '/api/activities' },
  { code: 'email_schedules.list', route: '/email', label: 'E-mail', apiPath: '/api/email-schedules' },
  { code: 'finance.list', route: '/financeiro', label: 'Financeiro', apiPath: '/api/finance' },
  { code: 'users.list', route: '/equipe', label: 'Equipe', apiPath: '/api/users' },
  { code: 'groups.list', route: '/grupos', label: 'Grupos', apiPath: '/api/groups' },
  { code: 'carteiras.view', route: '/carteiras', label: 'Carteiras' },
];

const test = base.extend<Record<string, never>, { admin: Session }>({
  admin: [async ({ browser }, use) => {
    const ctx = await browser.newContext();
    const s = await registerOrg(ctx.request, 'rbac-matrix-admin', { tipoConta: 'escritorio' });
    await ctx.close();
    await use(s);
  }, { scope: 'worker' }],
});

for (const c of MATRIX) {
  test(`sem ${c.code}: menu oculto, rota redireciona, API 403`, async ({ page, request, admin }) => {
    const session = await loginWithoutPermission(page, request, admin, c.code);

    await page.goto('/');
    await expect(page.getByRole('link', { name: c.label, exact: true })).toHaveCount(0);

    await page.goto(c.route);
    await expect(page).toHaveURL('/');

    if (c.apiPath) {
      const res = await request.get(c.apiPath, { headers: { authorization: `Bearer ${session.token}` } });
      expect(res.status()).toBe(403);
    }
  });
}
