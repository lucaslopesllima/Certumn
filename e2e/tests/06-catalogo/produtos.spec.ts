import { test, expect } from '../../fixtures/index.ts';
import { rowFor } from '../../helpers/row.ts';

test.describe('catálogo — produtos', () => {
  test('criar produto aparece na lista', async ({ page, loginAs }) => {
    await loginAs('catalogo-criar');
    await page.goto('/catalogo');
    await page.getByRole('button', { name: 'Novo item' }).click();
    await page.getByPlaceholder('Nome do produto / serviço *').fill('Produto E2E');
    await page.getByPlaceholder('Preço (R$)').fill('49.90');
    await page.getByRole('button', { name: 'Salvar' }).click();
    await expect(page.getByText('Produto E2E')).toBeVisible();
  });

  test('editar produto persiste as alterações', async ({ page, loginAs }) => {
    await loginAs('catalogo-editar');
    await page.goto('/catalogo');
    await page.getByRole('button', { name: 'Novo item' }).click();
    await page.getByPlaceholder('Nome do produto / serviço *').fill('Produto Editar E2E');
    await page.getByRole('button', { name: 'Salvar' }).click();
    await expect(page.getByText('Produto Editar E2E')).toBeVisible();

    const row = rowFor(page, 'Produto Editar E2E', page.getByLabel('Editar'));
    await row.getByLabel('Editar').click();
    const nome = page.getByPlaceholder('Nome do produto / serviço *');
    await nome.fill('Produto Editado E2E');
    await page.getByRole('button', { name: 'Salvar' }).click();
    await expect(page.getByText('Produto Editado E2E')).toBeVisible();
  });

  test('inativar produto some da lista de itens ativos', async ({ page, loginAs }) => {
    await loginAs('catalogo-inativar');
    await page.goto('/catalogo');
    await page.getByRole('button', { name: 'Novo item' }).click();
    await page.getByPlaceholder('Nome do produto / serviço *').fill('Produto Inativar E2E');
    await page.getByRole('button', { name: 'Salvar' }).click();
    await expect(page.getByText('Produto Inativar E2E')).toBeVisible();

    const row = rowFor(page, 'Produto Inativar E2E', page.getByTitle('Desativar'));
    await row.getByTitle('Desativar').click();
    // `row` foi filtrado por "tem botão Desativar" — depois do clique o botão
    // vira "Ativar" e o MESMO locator (lazy, reavaliado) deixaria de casar.
    // Re-localiza a linha pelo novo estado em vez de reusar `row`.
    const rowAfter = rowFor(page, 'Produto Inativar E2E', page.getByTitle('Ativar'));
    await expect(rowAfter.getByTitle('Ativar')).toBeVisible();
  });
});
