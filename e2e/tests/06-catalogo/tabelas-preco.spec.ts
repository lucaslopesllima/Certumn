import { test, expect, ApiClient } from '../../fixtures/index.ts';

test.describe('catálogo — tabelas de preço', () => {
  test('criar tabela de preço e associar preços a produtos', async ({ page, request, loginAs }) => {
    const session = await loginAs('tabelas-preco-criar');
    const api = new ApiClient(request, session);
    const represented = await api.createRepresented('Representada Tabela E2E');
    const item = await api.createCatalogItem({ nome: 'Produto Tabela E2E', preco: 100 });

    const hoje = new Date().toISOString().slice(0, 10);
    await api.createPriceTable({
      represented_id: represented.id, nome: 'Tabela E2E', vigencia_inicio: hoje,
      items: [{ catalog_item_id: item.id, preco: 89.9 }],
    });

    await page.goto('/catalogo');
    await page.getByRole('button', { name: 'Tabelas de preço' }).click();
    await expect(page.getByText('Tabela E2E', { exact: true })).toBeVisible();
  });

  test('tabela de preço vigente aparece no pedido ao escolher a representada', async ({ page, request, loginAs }) => {
    const session = await loginAs('tabelas-preco-pedido');
    const api = new ApiClient(request, session);
    const represented = await api.createRepresented('Representada Vigente E2E');
    const item = await api.createCatalogItem({ nome: 'Produto Vigente E2E', preco: 100 });
    const hoje = new Date().toISOString().slice(0, 10);
    await api.createPriceTable({
      represented_id: represented.id, nome: 'Tabela Vigente E2E', vigencia_inicio: hoje,
      items: [{ catalog_item_id: item.id, preco: 77.7 }],
    });

    await page.goto('/pedidos');
    await page.getByRole('button', { name: 'Novo pedido' }).click();
    await page.getByLabel('Representada *').selectOption({ label: 'Representada Vigente E2E' });
    await expect(page.getByText('Tabela de preço vigente:')).toBeVisible();
    await expect(page.getByText('Tabela Vigente E2E')).toBeVisible();
  });
});
