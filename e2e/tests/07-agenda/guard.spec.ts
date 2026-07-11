import { test } from '../../fixtures/index.ts';
import { loginWithoutPermission, registerOrg } from '../../fixtures/auth.ts';
import { expectMenuItemHidden, expectRouteBlocked } from '../../helpers/guard.ts';

test('usuário sem activities.list não vê /agenda e é redirecionado', async ({ page, request }) => {
  const admin = await registerOrg(request, 'guard-agenda-admin', { tipoConta: 'escritorio' });
  await loginWithoutPermission(page, request, admin, 'activities.list');
  await page.goto('/');
  await expectMenuItemHidden(page, 'Agenda');
  await expectRouteBlocked(page, '/agenda');
});
