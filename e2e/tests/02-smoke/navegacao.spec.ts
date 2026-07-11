// Visita as 21 rotas da app com uma conta escritório admin (acesso total via
// bypass de admin) e garante que cada uma renderiza sem erro de console nem
// resposta 5xx — não afirma nada sobre o conteúdo específico de cada tela
// (isso é coberto pelos specs de cada módulo).
import { test as base, expect } from '@playwright/test';
import { registerOrg, setSession, type Session } from '../../fixtures/auth.ts';

const ROUTES = [
  '/', '/prospeccao', '/funil', '/clientes', '/carteiras', '/pedidos', '/whatsapp',
  '/email', '/agenda', '/transportadoras', '/rotas', '/catalogo', '/comissoes',
  '/financeiro', '/relatorios', '/equipe', '/grupos', '/config', '/conta', '/trocar-senha',
];

const test = base.extend<Record<string, never>, { adminSession: Session }>({
  adminSession: [async ({ browser }, use) => {
    const ctx = await browser.newContext();
    const session = await registerOrg(ctx.request, 'smoke-nav', { tipoConta: 'escritorio' });
    await ctx.close();
    await use(session);
  }, { scope: 'worker' }],
});

for (const route of ROUTES) {
  test(`renderiza ${route} sem erro`, async ({ page, adminSession }) => {
    const errors: string[] = [];
    const bad5xx: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });
    page.on('response', (res) => { if (res.status() >= 500) bad5xx.push(`${res.status()} ${res.url()}`); });

    await setSession(page, adminSession);
    await page.goto(route);
    await expect(page).toHaveURL(route);
    await page.waitForLoadState('networkidle');

    expect(bad5xx, `respostas 5xx em ${route}`).toEqual([]);
    expect(errors, `erros de console em ${route}`).toEqual([]);
  });
}

test('rota inexistente redireciona pro dashboard', async ({ page, adminSession }) => {
  await setSession(page, adminSession);
  await page.goto('/essa-rota-nao-existe');
  await expect(page).toHaveURL('/');
});
