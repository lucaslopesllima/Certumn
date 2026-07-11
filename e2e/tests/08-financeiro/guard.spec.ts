import { test } from '../../fixtures/index.ts';
import { loginWithoutPermission, registerOrg } from '../../fixtures/auth.ts';
import { expectMenuItemHidden, expectRouteBlocked } from '../../helpers/guard.ts';

test('usuário sem finance.list não vê /financeiro e é redirecionado', async ({ page, request }) => {
  const admin = await registerOrg(request, 'guard-financeiro-admin', { tipoConta: 'escritorio' });
  await loginWithoutPermission(page, request, admin, 'finance.list');
  await page.goto('/');
  await expectMenuItemHidden(page, 'Financeiro');
  await expectRouteBlocked(page, '/financeiro');
});
