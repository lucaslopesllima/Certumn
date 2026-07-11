import { test } from '../../fixtures/index.ts';
import { loginWithoutPermission, registerOrg } from '../../fixtures/auth.ts';
import { expectMenuItemHidden, expectRouteBlocked } from '../../helpers/guard.ts';

test('usuário sem commissions.list não vê /comissoes e é redirecionado', async ({ page, request }) => {
  const admin = await registerOrg(request, 'guard-comissoes-admin', { tipoConta: 'escritorio' });
  await loginWithoutPermission(page, request, admin, 'commissions.list');
  await page.goto('/');
  await expectMenuItemHidden(page, 'Comissões');
  await expectRouteBlocked(page, '/comissoes');
});
