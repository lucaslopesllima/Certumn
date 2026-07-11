import { test } from '../../fixtures/index.ts';
import { loginWithoutPermission, registerOrg } from '../../fixtures/auth.ts';
import { expectMenuItemHidden, expectRouteBlocked } from '../../helpers/guard.ts';

test('usuário sem relationships.list não vê /clientes e é redirecionado', async ({ page, request }) => {
  const admin = await registerOrg(request, 'guard-clientes-admin', { tipoConta: 'escritorio' });
  await loginWithoutPermission(page, request, admin, 'relationships.list');
  await page.goto('/');
  await expectMenuItemHidden(page, 'Clientes');
  await expectRouteBlocked(page, '/clientes');
});
