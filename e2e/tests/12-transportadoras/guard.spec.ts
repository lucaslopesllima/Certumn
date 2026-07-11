import { test } from '../../fixtures/index.ts';
import { loginWithoutPermission, registerOrg } from '../../fixtures/auth.ts';
import { expectMenuItemHidden, expectRouteBlocked } from '../../helpers/guard.ts';

test('usuário sem carriers.list não vê /transportadoras e é redirecionado', async ({ page, request }) => {
  const admin = await registerOrg(request, 'guard-carriers-admin', { tipoConta: 'escritorio' });
  await loginWithoutPermission(page, request, admin, 'carriers.list');
  await page.goto('/');
  await expectMenuItemHidden(page, 'Transportadoras');
  await expectRouteBlocked(page, '/transportadoras');
});
