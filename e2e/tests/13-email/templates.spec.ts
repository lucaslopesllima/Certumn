import { test, expect } from '../../fixtures/index.ts';

test.describe('e-mail — templates', () => {
  test('criar template de e-mail', async ({ page, loginAs }) => {
    await loginAs('email-template-criar');
    await page.goto('/email');
    await page.getByRole('button', { name: 'Modelos' }).click();
    await page.getByRole('button', { name: 'Novo modelo' }).click();
    await page.getByPlaceholder('Ex.: Apresentação inicial').fill('Template E2E');
    await page.getByPlaceholder('Assunto do e-mail').fill('Assunto E2E');
    await page.getByPlaceholder('Conteúdo do e-mail').fill('Corpo do e-mail E2E');
    await page.getByRole('button', { name: 'Salvar' }).click();
    await expect(page.getByText('Template E2E')).toBeVisible();
  });

  test('editar template persiste', async ({ page, loginAs }) => {
    await loginAs('email-template-editar');
    await page.goto('/email');
    await page.getByRole('button', { name: 'Modelos' }).click();
    await page.getByRole('button', { name: 'Novo modelo' }).click();
    await page.getByPlaceholder('Ex.: Apresentação inicial').fill('Template Editar E2E');
    await page.getByPlaceholder('Assunto do e-mail').fill('Assunto Editar E2E');
    await page.getByPlaceholder('Conteúdo do e-mail').fill('Corpo Editar E2E');
    await page.getByRole('button', { name: 'Salvar' }).click();
    await expect(page.getByText('Template Editar E2E')).toBeVisible();

    await page.getByLabel('Editar modelo').first().click();
    await page.getByPlaceholder('Ex.: Apresentação inicial').fill('Template Editado E2E');
    await page.getByRole('button', { name: 'Salvar' }).click();
    await expect(page.getByText('Template Editado E2E')).toBeVisible();
  });

  test('remover template exige confirmação', async ({ page, loginAs }) => {
    await loginAs('email-template-remover');
    await page.goto('/email');
    await page.getByRole('button', { name: 'Modelos' }).click();
    await page.getByRole('button', { name: 'Novo modelo' }).click();
    await page.getByPlaceholder('Ex.: Apresentação inicial').fill('Template Remover E2E');
    await page.getByPlaceholder('Assunto do e-mail').fill('Assunto Remover E2E');
    await page.getByPlaceholder('Conteúdo do e-mail').fill('Corpo Remover E2E');
    await page.getByRole('button', { name: 'Salvar' }).click();
    await expect(page.getByText('Template Remover E2E')).toBeVisible();

    await page.getByLabel('Remover modelo').first().click();
    await page.locator('.swal2-confirm').click();
    await page.waitForLoadState('networkidle');
  });
});
