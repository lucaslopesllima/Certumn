import { test, expect } from '@playwright/test';
import { registerOrg, uniqEmail } from '../../fixtures/auth.ts';

test.describe('login', () => {
  test('login com credenciais válidas redireciona para o dashboard', async ({ page, request }) => {
    const email = uniqEmail('login-ok');
    await request.post('/api/auth/register', { data: { org_nome: 'Org Login', email, senha: 'senha123' } });

    await page.goto('/login');
    await page.getByLabel('E-mail').fill(email);
    await page.locator('input[type="password"]').fill('senha123');
    await page.locator('form').getByRole('button', { name: 'Entrar' }).click();

    await expect(page).toHaveURL('/');
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  });

  test('login com senha incorreta mostra erro e permanece em /login', async ({ page, request }) => {
    const email = uniqEmail('login-bad-pass');
    await request.post('/api/auth/register', { data: { org_nome: 'Org Login', email, senha: 'senha123' } });

    await page.goto('/login');
    await page.getByLabel('E-mail').fill(email);
    await page.locator('input[type="password"]').fill('senhaerrada');
    await page.locator('form').getByRole('button', { name: 'Entrar' }).click();

    await expect(page.getByText('credenciais inválidas')).toBeVisible();
    await expect(page).toHaveURL('/login');
  });

  test('login com email inexistente mostra erro genérico', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('E-mail').fill(uniqEmail('nao-existe'));
    await page.locator('input[type="password"]').fill('qualquercoisa');
    await page.locator('form').getByRole('button', { name: 'Entrar' }).click();

    await expect(page.getByText('credenciais inválidas')).toBeVisible();
  });

  test('logout limpa o token e redireciona para /login', async ({ page, request }) => {
    const email = uniqEmail('logout');
    await request.post('/api/auth/register', { data: { org_nome: 'Org Logout', email, senha: 'senha123' } });
    await page.goto('/login');
    await page.getByLabel('E-mail').fill(email);
    await page.locator('input[type="password"]').fill('senha123');
    await page.locator('form').getByRole('button', { name: 'Entrar' }).click();
    await expect(page).toHaveURL('/');

    await page.getByRole('button', { name: 'Sair' }).click();
    await expect(page).toHaveURL('/login');
    expect(await page.evaluate(() => localStorage.getItem('rs_token'))).toBeNull();
  });

  test('acessar rota protegida sem token redireciona para /login', async ({ page }) => {
    await page.goto('/pedidos');
    await expect(page).toHaveURL('/login');
  });

  test('token inválido no localStorage redireciona para /login', async ({ page }) => {
    await page.addInitScript(() => { window.localStorage.setItem('rs_token', 'token-invalido-e-forjado'); });
    await page.goto('/');
    await expect(page).toHaveURL('/login');
  });

  test('usuário desativado não consegue logar', async ({ page, request }) => {
    const adminEmail = uniqEmail('desativa-admin');
    const reg = await request.post('/api/auth/register', { data: { org_nome: 'Org Desativa', email: adminEmail, senha: 'senha123', tipo_conta: 'escritorio' } });
    const { token } = (await reg.json()) as { token: string };

    const repEmail = uniqEmail('rep-desativado');
    const created = await request.post('/api/users', {
      headers: { authorization: `Bearer ${token}` },
      data: { nome: 'Rep Desativado', email: repEmail, senha: 'senha123' },
    });
    const { user } = (await created.json()) as { user: { id: number } };
    await request.patch(`/api/users/${user.id}`, { headers: { authorization: `Bearer ${token}` }, data: { ativo: false } });

    await page.goto('/login');
    await page.getByLabel('E-mail').fill(repEmail);
    await page.locator('input[type="password"]').fill('senha123');
    await page.locator('form').getByRole('button', { name: 'Entrar' }).click();
    await expect(page.getByText('usuário desativado')).toBeVisible();
  });
});
