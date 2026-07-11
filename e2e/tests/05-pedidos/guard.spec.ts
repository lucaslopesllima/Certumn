import { test } from '../../fixtures/index.ts';
import { loginWithoutPermission, registerOrg } from '../../fixtures/auth.ts';
import { expectMenuItemHidden, expectRouteBlocked } from '../../helpers/guard.ts';

test('usuário sem orders.list não vê /pedidos e é redirecionado', async ({ page, request }) => {
  const admin = await registerOrg(request, 'guard-pedidos-admin', { tipoConta: 'escritorio' });
  await loginWithoutPermission(page, request, admin, 'orders.list');
  await page.goto('/');
  await expectMenuItemHidden(page, 'Pedidos');
  await expectRouteBlocked(page, '/pedidos');
});
