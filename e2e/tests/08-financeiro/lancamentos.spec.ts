import { test, expect } from '../../fixtures/index.ts';
import { rowFor } from '../../helpers/row.ts';

test.describe('financeiro — lançamentos', () => {
  test('criar lançamento de receita aparece na lista', async ({ page, loginAs }) => {
    await loginAs('financeiro-receita');
    await page.goto('/financeiro');
    await page.getByRole('button', { name: 'Lançamento', exact: true }).click();
    await page.locator('form').getByRole('button', { name: 'A receber' }).click();
    await page.getByPlaceholder('Descrição').fill('Recebimento E2E');
    await page.getByLabel('Valor (R$)').fill('1234,56');
    await page.getByLabel('Vencimento').fill(new Date().toISOString().slice(0, 10));
    await page.getByRole('button', { name: 'Salvar' }).click();
    await expect(page.getByText('Recebimento E2E')).toBeVisible();
  });

  test('criar lançamento de despesa aparece na lista', async ({ page, loginAs }) => {
    await loginAs('financeiro-despesa');
    await page.goto('/financeiro');
    await page.getByRole('button', { name: 'Lançamento', exact: true }).click();
    await page.locator('form').getByRole('button', { name: 'A pagar' }).click();
    await page.getByPlaceholder('Descrição').fill('Despesa E2E');
    await page.getByLabel('Valor (R$)').fill('500,00');
    await page.getByLabel('Vencimento').fill(new Date().toISOString().slice(0, 10));
    await page.getByRole('button', { name: 'Salvar' }).click();
    await expect(page.getByText('Despesa E2E')).toBeVisible();
  });

  test('dar baixa em lançamento muda o status para liquidado', async ({ page, loginAs }) => {
    await loginAs('financeiro-baixa');
    await page.goto('/financeiro');
    await page.getByRole('button', { name: 'Lançamento', exact: true }).click();
    await page.locator('form').getByRole('button', { name: 'A pagar' }).click();
    await page.getByPlaceholder('Descrição').fill('Boleto Baixa E2E');
    await page.getByLabel('Valor (R$)').fill('200,00');
    await page.getByLabel('Vencimento').fill(new Date().toISOString().slice(0, 10));
    await page.getByRole('button', { name: 'Salvar' }).click();
    await expect(page.getByText('Boleto Baixa E2E')).toBeVisible();

    const row = rowFor(page, 'Boleto Baixa E2E', page.getByTitle('Marcar liquidado'));
    await row.getByTitle('Marcar liquidado').click();
    // título muda pra "Reabrir" após o clique — reavaliar `row` (que filtra por
    // "tem Marcar liquidado") deixaria de casar; relocaliza pelo novo estado.
    const rowAfter = rowFor(page, 'Boleto Baixa E2E', page.getByTitle('Reabrir'));
    await expect(rowAfter.getByTitle('Reabrir')).toBeVisible();
  });
});
