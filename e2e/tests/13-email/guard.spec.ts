import { test } from '../../fixtures/index.ts';
import { loginWithoutPermission, registerOrg } from '../../fixtures/auth.ts';
import { expectMenuItemHidden, expectRouteBlocked } from '../../helpers/guard.ts';

test('usuário sem email_schedules.list não vê /email e é redirecionado', async ({ page, request }) => {
  const admin = await registerOrg(request, 'guard-email-admin', { tipoConta: 'escritorio' });
  await loginWithoutPermission(page, request, admin, 'email_schedules.list');
  await page.goto('/');
  await expectMenuItemHidden(page, 'E-mail');
  await expectRouteBlocked(page, '/email');
});
