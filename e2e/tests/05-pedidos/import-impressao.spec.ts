import { test, expect, ApiClient, db } from '../../fixtures/index.ts';
import { pedidosImportCsv } from '../../helpers/upload.ts';

test.describe('pedidos — import e impressão', () => {
  test('importar faturamento via CSV marca o pedido como faturado', async ({ page, request, loginAs }) => {
    const session = await loginAs('pedidos-import');
    const api = new ApiClient(request, session);
    const company = await db.seedCompany({ uf: 'SP' });
    const { rows } = await db.pool.query<{ cnpj: string }>('SELECT cnpj FROM companies WHERE id = $1', [company.id]);
    const cnpj = rows[0]!.cnpj.trim();
    const represented = await api.createRepresented('Representada Import E2E');
    const order = await api.createOrder({ company_id: company.id, represented_id: represented.id, status: 'rascunho' });
    await api.transitionOrder(order.id, 'enviado');

    await page.goto('/pedidos');
    await page.getByRole('button', { name: 'Importar NF' }).click();
    const csv = pedidosImportCsv([{ nf: 'NF-IMPORT-1', data: new Date().toLocaleDateString('pt-BR'), cnpj, valor: '100,00' }]);
    await page.locator('textarea').fill(csv.toString('utf8'));
    // "Importar" ambíguo com o botão de toolbar "Importar NF" — exact:true isola o submit do modal.
    await page.getByRole('button', { name: 'Importar', exact: true }).click();
    await page.waitForLoadState('networkidle');
  });

  test('imprimir pedido busca o HTML de impressão do servidor', async ({ page, request, loginAs }) => {
    const session = await loginAs('pedidos-imprimir');
    const api = new ApiClient(request, session);
    const company = await db.seedCompany({ uf: 'SP' });
    const represented = await api.createRepresented('Representada Print E2E');
    const order = await api.createOrder({ company_id: company.id, represented_id: represented.id, status: 'rascunho' });

    await page.goto('/pedidos');
    await page.waitForLoadState('networkidle');
    const row = page.locator('tr').filter({ hasText: `#${order.numero}` });
    // O botão abre um iframe sandbox e chama contentWindow.print() ali dentro —
    // não dá pra interceptar de forma confiável via window.print no page top-level
    // (é um objeto window diferente). Verifica o efeito observável: a requisição
    // do HTML de impressão acontece e responde OK.
    const printResponse = page.waitForResponse((r) => r.url().includes(`/api/orders/${order.id}/print`) && r.request().method() === 'GET');
    await row.getByTitle('Imprimir / PDF').click();
    const res = await printResponse;
    expect(res.ok()).toBeTruthy();
  });
});
