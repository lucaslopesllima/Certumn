import { test } from '../../fixtures/index.ts';
import { loginWithoutPermission, registerOrg } from '../../fixtures/auth.ts';
import { expectMenuItemHidden, expectRouteBlocked } from '../../helpers/guard.ts';

test('usuário sem relationships.list não vê /funil e é redirecionado', async ({ page, request }) => {
  const admin = await registerOrg(request, 'guard-funil-admin', { tipoConta: 'escritorio' });
  await loginWithoutPermission(page, request, admin, 'relationships.list');
  await page.goto('/');
  await expectMenuItemHidden(page, 'Funil');
  await expectRouteBlocked(page, '/funil');
});
