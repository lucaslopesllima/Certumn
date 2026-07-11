import { test, expect } from '../../fixtures/index.ts';
import { uniqEmail, login } from '../../fixtures/auth.ts';

// Team.tsx usa Field (span+input, sem htmlFor) — escopado ao <form> do card
// "Novo usuário" pra não colidir com "E-mail"/"Nome" da tabela de usuários.
async function fillNewUserForm(page: import('@playwright/test').Page, nome: string, email: string, senha: string) {
  await page.getByRole('button', { name: 'Novo usuário' }).click();
  const form = page.locator('form');
  await form.locator('label', { hasText: 'Nome' }).locator('input').fill(nome);
  await form.locator('label', { hasText: 'E-mail' }).locator('input').fill(email);
  await form.locator('label', { hasText: 'Senha provisória' }).locator('input').fill(senha);
  await form.getByRole('button', { name: 'Criar usuário' }).click();
}

test.describe('equipe', () => {
  test('criar usuário novo e ele consegue logar', async ({ page, request, loginAs }) => {
    await loginAs('equipe-criar', { tipoConta: 'escritorio' });
    const email = uniqEmail('equipe-novo-membro');
    await page.goto('/equipe');
    await fillNewUserForm(page, 'Membro Equipe E2E', email, 'provisoria123');
    await expect(page.getByText('Membro Equipe E2E')).toBeVisible();

    const session = await login(request, email, 'provisoria123');
    expect(session.token).toBeTruthy();
  });

  test('desativar usuário bloqueia login subsequente', async ({ page, request, loginAs }) => {
    await loginAs('equipe-desativar', { tipoConta: 'escritorio' });
    const email = uniqEmail('equipe-desativado');
    await page.goto('/equipe');
    await fillNewUserForm(page, 'Membro Desativar E2E', email, 'provisoria123');
    await expect(page.getByText('Membro Desativar E2E')).toBeVisible();

    const row = page.locator('tr').filter({ hasText: 'Membro Desativar E2E' });
    // exact:true: o nome do usuário de teste contém a palavra "Desativar",
    // colidindo por substring com o próprio botão de ação.
    await row.getByRole('button', { name: 'Desativar', exact: true }).click();
    await expect(row.getByRole('button', { name: 'Reativar' })).toBeVisible();

    const loginRes = await request.post('/api/auth/login', { data: { email, senha: 'provisoria123' } });
    expect(loginRes.status()).toBe(403);
  });

  test('resetar senha de usuário gera senha provisória', async ({ page, request, loginAs }) => {
    await loginAs('equipe-resetar', { tipoConta: 'escritorio' });
    const email = uniqEmail('equipe-resetar-senha');
    await page.goto('/equipe');
    await fillNewUserForm(page, 'Membro Resetar E2E', email, 'senhaantiga123');
    await expect(page.getByText('Membro Resetar E2E')).toBeVisible();

    const row = page.locator('tr').filter({ hasText: 'Membro Resetar E2E' });
    await row.getByRole('button', { name: 'Redefinir senha' }).click();
    await page.getByPlaceholder('Nova senha provisória').fill('novaprovisoria123');
    const resetResponse = page.waitForResponse((r) => /\/api\/users\/\d+\/password$/.test(r.url()) && r.request().method() === 'POST');
    await page.getByRole('button', { name: 'Redefinir', exact: true }).click();
    await resetResponse; // sem isso o login abaixo pode correr antes do PATCH commitar

    const loginRes = await request.post('/api/auth/login', { data: { email, senha: 'novaprovisoria123' } });
    expect(loginRes.status()).toBe(200);
  });
});
