import { test } from '../../fixtures/index.ts';
import { loginWithoutPermission, registerOrg } from '../../fixtures/auth.ts';
import { expectMenuItemHidden, expectRouteBlocked } from '../../helpers/guard.ts';

test('usuário sem whatsapp.view não vê /whatsapp e é redirecionado', async ({ page, request }) => {
  const admin = await registerOrg(request, 'guard-whatsapp-admin', { tipoConta: 'escritorio' });
  await loginWithoutPermission(page, request, admin, 'whatsapp.view');
  await page.goto('/');
  await expectMenuItemHidden(page, 'WhatsApp');
  await expectRouteBlocked(page, '/whatsapp');
});
