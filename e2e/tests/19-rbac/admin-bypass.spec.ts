import { test, expect } from '@playwright/test';
import { registerOrg, setSession } from '../../fixtures/auth.ts';

const PROTECTED_ROUTES = [
  '/prospeccao', '/funil', '/clientes', '/carteiras', '/pedidos', '/whatsapp', '/comissoes',
  '/relatorios', '/transportadoras', '/rotas', '/catalogo', '/agenda', '/email', '/financeiro',
  '/equipe', '/grupos',
];

test('admin (is_admin) acessa todas as rotas protegidas independente de grupo', async ({ page, request }) => {
  const admin = await registerOrg(request, 'rbac-admin-bypass', { tipoConta: 'escritorio' });
  await setSession(page, admin);
  for (const route of PROTECTED_ROUTES) {
    await page.goto(route);
    await expect(page).toHaveURL(route);
  }
});

test('admin acessa a API mesmo com permissions=[] no payload do token (bypass server-side)', async ({ request }) => {
  const admin = await registerOrg(request, 'rbac-admin-api', { tipoConta: 'escritorio' });
  expect(admin.user.permissions).toEqual([]);
  const res = await request.get('/api/users', { headers: { authorization: `Bearer ${admin.token}` } });
  expect(res.status()).toBe(200);
});
