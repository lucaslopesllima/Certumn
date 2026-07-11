import { test, expect } from '@playwright/test';
import { registerOrg, setSession } from '../../fixtures/auth.ts';

test.describe('conta individual — rotas office-only bloqueadas', () => {
  for (const route of ['/equipe', '/grupos', '/carteiras']) {
    test(`conta individual acessando ${route} via URL é redirecionada`, async ({ page, request }) => {
      const session = await registerOrg(request, 'rbac-individual', { tipoConta: 'individual' });
      await setSession(page, session);
      await page.goto(route);
      await expect(page).toHaveURL('/');
    });
  }
});
