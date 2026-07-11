import { test, expect } from '../../fixtures/index.ts';

test.describe('transportadoras — CRUD', () => {
  test('criar transportadora aparece na lista', async ({ page, loginAs }) => {
    await loginAs('carriers-criar');
    await page.goto('/transportadoras');
    await page.getByRole('button', { name: 'Nova transportadora' }).click();
    await page.getByPlaceholder('Nome da transportadora *').fill('Transportadora E2E');
    await page.getByRole('button', { name: 'Salvar' }).click();
    await expect(page.getByText('Transportadora E2E')).toBeVisible();
  });

  test('editar transportadora persiste as alterações', async ({ page, loginAs }) => {
    await loginAs('carriers-editar');
    await page.goto('/transportadoras');
    await page.getByRole('button', { name: 'Nova transportadora' }).click();
    await page.getByPlaceholder('Nome da transportadora *').fill('Transportadora Editar E2E');
    await page.getByRole('button', { name: 'Salvar' }).click();
    await expect(page.getByText('Transportadora Editar E2E')).toBeVisible();

    await page.getByLabel('Editar transportadora').first().click();
    const nome = page.getByPlaceholder('Nome da transportadora *');
    await nome.fill('Transportadora Editada E2E');
    await page.getByRole('button', { name: 'Salvar' }).click();
    await expect(page.getByText('Transportadora Editada E2E')).toBeVisible();
  });

  test('excluir (inativar) transportadora exige confirmação', async ({ page, loginAs }) => {
    await loginAs('carriers-excluir');
    await page.goto('/transportadoras');
    await page.getByRole('button', { name: 'Nova transportadora' }).click();
    await page.getByPlaceholder('Nome da transportadora *').fill('Transportadora Excluir E2E');
    await page.getByRole('button', { name: 'Salvar' }).click();
    await expect(page.getByText('Transportadora Excluir E2E')).toBeVisible();

    await page.getByLabel('Excluir transportadora').first().click();
    await page.locator('.swal2-confirm').click();
    await page.waitForLoadState('networkidle');
  });
});
