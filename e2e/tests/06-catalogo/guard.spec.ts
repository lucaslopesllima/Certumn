import { test } from '../../fixtures/index.ts';
import { loginWithoutPermission, registerOrg } from '../../fixtures/auth.ts';
import { expectMenuItemHidden, expectRouteBlocked } from '../../helpers/guard.ts';

test('usuário sem catalog.list não vê /catalogo e é redirecionado', async ({ page, request }) => {
  const admin = await registerOrg(request, 'guard-catalogo-admin', { tipoConta: 'escritorio' });
  await loginWithoutPermission(page, request, admin, 'catalog.list');
  await page.goto('/');
  await expectMenuItemHidden(page, 'Catálogo');
  await expectRouteBlocked(page, '/catalogo');
});
