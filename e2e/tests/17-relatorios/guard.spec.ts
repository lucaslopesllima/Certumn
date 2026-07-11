import { test } from '../../fixtures/index.ts';
import { loginWithoutPermission, registerOrg } from '../../fixtures/auth.ts';
import { expectMenuItemHidden, expectRouteBlocked } from '../../helpers/guard.ts';

test('usuário sem reports.sales não vê /relatorios e é redirecionado', async ({ page, request }) => {
  const admin = await registerOrg(request, 'guard-relatorios-admin', { tipoConta: 'escritorio' });
  await loginWithoutPermission(page, request, admin, 'reports.sales');
  await page.goto('/');
  await expectMenuItemHidden(page, 'Relatórios');
  await expectRouteBlocked(page, '/relatorios');
});
