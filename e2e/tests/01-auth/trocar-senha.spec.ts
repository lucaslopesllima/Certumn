import { test, expect } from '@playwright/test';
import { uniqEmail } from '../../fixtures/auth.ts';

// ChangePassword.tsx usa <label><span>Rótulo</span><input/></label> sem
// htmlFor/id — getByLabel não casa; localizamos pelo texto do <span> subindo
// ao ancestral <label> e pegando o input dentro dele.
function fieldByLabelText(page: import('@playwright/test').Page, label: string) {
  return page.locator('label', { has: page.getByText(label, { exact: true }) }).locator('input');
}

async function createProvisionalUser(request: import('@playwright/test').APIRequestContext) {
  const adminEmail = uniqEmail('trocar-senha-admin');
  const reg = await request.post('/api/auth/register', {
    data: { org_nome: 'Org TrocarSenha', email: adminEmail, senha: 'senha123', tipo_conta: 'escritorio' },
  });
  const { token } = (await reg.json()) as { token: string };
  const repEmail = uniqEmail('trocar-senha-rep');
  await request.post('/api/users', {
    headers: { authorization: `Bearer ${token}` },
    data: { nome: 'Rep Provisório', email: repEmail, senha: 'provisoria123' },
  });
  return repEmail;
}

test.describe('troca de senha provisória', () => {
  test('redireciona para /trocar-senha a partir de qualquer rota', async ({ page, request }) => {
    const repEmail = await createProvisionalUser(request);
    await page.goto('/login');
    await page.getByLabel('E-mail').fill(repEmail);
    await page.locator('input[type="password"]').fill('provisoria123');
    await page.locator('form').getByRole('button', { name: 'Entrar' }).click();
    await expect(page).toHaveURL('/trocar-senha');
  });

  test('navegação direta pela URL também é bloqueada', async ({ page, request }) => {
    const repEmail = await createProvisionalUser(request);
    await page.goto('/login');
    await page.getByLabel('E-mail').fill(repEmail);
    await page.locator('input[type="password"]').fill('provisoria123');
    await page.locator('form').getByRole('button', { name: 'Entrar' }).click();
    await expect(page).toHaveURL('/trocar-senha');

    await page.goto('/pedidos');
    await expect(page).toHaveURL('/trocar-senha');
  });

  test('confirmação divergente mostra erro e não avança', async ({ page, request }) => {
    const repEmail = await createProvisionalUser(request);
    await page.goto('/login');
    await page.getByLabel('E-mail').fill(repEmail);
    await page.locator('input[type="password"]').fill('provisoria123');
    await page.locator('form').getByRole('button', { name: 'Entrar' }).click();
    await expect(page).toHaveURL('/trocar-senha');

    await fieldByLabelText(page, 'Senha provisória').fill('provisoria123');
    await fieldByLabelText(page, 'Nova senha').fill('novasenha123');
    await fieldByLabelText(page, 'Confirmar nova senha').fill('outrasenha456');
    await page.getByRole('button', { name: 'Salvar e continuar' }).click();

    await expect(page.getByText('A confirmação não confere.')).toBeVisible();
    await expect(page).toHaveURL('/trocar-senha');
  });

  test('troca bem-sucedida libera a navegação normal', async ({ page, request }) => {
    const repEmail = await createProvisionalUser(request);
    await page.goto('/login');
    await page.getByLabel('E-mail').fill(repEmail);
    await page.locator('input[type="password"]').fill('provisoria123');
    await page.locator('form').getByRole('button', { name: 'Entrar' }).click();
    await expect(page).toHaveURL('/trocar-senha');

    await fieldByLabelText(page, 'Senha provisória').fill('provisoria123');
    await fieldByLabelText(page, 'Nova senha').fill('novasenha123');
    await fieldByLabelText(page, 'Confirmar nova senha').fill('novasenha123');
    await page.getByRole('button', { name: 'Salvar e continuar' }).click();

    await expect(page).not.toHaveURL('/trocar-senha');
    await page.goto('/pedidos');
    await expect(page).toHaveURL('/pedidos');
  });
});
