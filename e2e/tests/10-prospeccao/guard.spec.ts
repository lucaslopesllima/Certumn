import { test } from '../../fixtures/index.ts';
import { loginWithoutPermission, registerOrg } from '../../fixtures/auth.ts';
import { expectMenuItemHidden, expectRouteBlocked } from '../../helpers/guard.ts';

test('usuário sem prospeccao.view não vê /prospeccao e é redirecionado', async ({ page, request }) => {
  const admin = await registerOrg(request, 'guard-prospeccao-admin', { tipoConta: 'escritorio' });
  await loginWithoutPermission(page, request, admin, 'prospeccao.view');
  await page.goto('/');
  await expectMenuItemHidden(page, 'Buscar Empresas');
  await expectRouteBlocked(page, '/prospeccao');
});
