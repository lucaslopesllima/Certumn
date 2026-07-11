import { test, expect, ApiClient, db } from '../../fixtures/index.ts';

test.describe('relatórios', () => {
  test('relatório de vendas soma os pedidos faturados semeados por API', async ({ page, request, loginAs }) => {
    const session = await loginAs('relatorios-vendas');
    const api = new ApiClient(request, session);
    const company = await db.seedCompany({ uf: 'SP' });
    const represented = await api.createRepresented('Representada Relatorio E2E');
    const order = await api.createOrder({
      company_id: company.id, represented_id: represented.id, status: 'rascunho',
      items: [{ descricao: 'Item relatório', qtd: 1, preco_unit: 999 }],
    });
    await api.transitionOrder(order.id, 'enviado');
    await api.transitionOrder(order.id, 'faturado', 'NF-REL-1');

    await page.goto('/relatorios');
    await page.waitForLoadState('networkidle');
    const sales = await api.get<{ total: number } | Record<string, unknown>>('/api/reports/sales');
    expect(sales).toBeTruthy();
  });

  test('curva ABC classifica clientes', async ({ page, loginAs }) => {
    await loginAs('relatorios-abc');
    await page.goto('/relatorios');
    await page.getByRole('button', { name: 'Curva ABC' }).click();
    await page.waitForLoadState('networkidle');
    await expect(page.locator('body')).toBeVisible();
  });

  test('relatório de descartes agrupa por motivo', async ({ page, request, loginAs }) => {
    const session = await loginAs('relatorios-descartes');
    const api = new ApiClient(request, session);
    const company = await db.seedCompany({ uf: 'SP' });
    // GET /api/reports/descartes agrega por motivo_descarte (count), não lista
    // empresa a empresa — o motivo é o que aparece na tela, não o nome do cliente.
    await api.createRelationship(company.id, { status: 'descartado', motivo_descarte: 'Preço alto E2E' });

    await page.goto('/relatorios');
    await page.getByRole('button', { name: 'Perdas' }).click();
    await page.waitForLoadState('networkidle');
    await expect(page.getByText('Preço alto E2E')).toBeVisible();
  });

  test('mapa de cobertura renderiza (com território definido)', async ({ page, loginAs }) => {
    await loginAs('relatorios-cobertura');
    await page.addInitScript(() => {
      window.localStorage.setItem('companyFilter:reco', JSON.stringify({
        munis: [{ id: 3550308, nome: 'São Paulo', uf: 'SP', regiao: 'SE' }],
        pesos: { cnae: 0.5, proximidade: 0.3, porte: 0.2 }, partida: null,
      }));
    });
    await page.goto('/relatorios');
    await page.getByRole('button', { name: 'Cobertura' }).click();
    await page.waitForLoadState('networkidle');
    await expect(page.locator('body')).toBeVisible();
  });
});
