import { test } from '../../fixtures/index.ts';
import { loginWithoutPermission, registerOrg } from '../../fixtures/auth.ts';
import { expectMenuItemHidden, expectRouteBlocked } from '../../helpers/guard.ts';

test('usuário sem routes.list não vê /rotas e é redirecionado', async ({ page, request }) => {
  const admin = await registerOrg(request, 'guard-rotas-admin', { tipoConta: 'escritorio' });
  await loginWithoutPermission(page, request, admin, 'routes.list');
  await page.goto('/');
  await expectMenuItemHidden(page, 'Rotas');
  await expectRouteBlocked(page, '/rotas');
});
