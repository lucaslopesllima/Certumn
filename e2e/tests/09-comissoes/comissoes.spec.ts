import { test, expect, ApiClient, db } from '../../fixtures/index.ts';
import { commissionsReconcileCsv } from '../../helpers/upload.ts';
import { rowFor } from '../../helpers/row.ts';

test.describe('comissões', () => {
  test('criar regra de comissão pela aba Regras', async ({ page, request, loginAs }) => {
    const session = await loginAs('comissoes-regra');
    const api = new ApiClient(request, session);
    const represented = await api.createRepresented('Representada Regra E2E');

    await page.goto('/comissoes');
    await page.getByRole('button', { name: 'Regras' }).click();
    await page.getByRole('button', { name: 'Nova regra' }).click();
    await page.getByLabel('Representada *').selectOption({ label: 'Representada Regra E2E' });
    await page.getByLabel('Comissão % *').fill('12');
    await page.getByLabel('Vigência início *').fill('2020-01-01');
    await page.getByRole('button', { name: 'Salvar regra' }).click();
    await page.waitForLoadState('networkidle');
    void represented;
  });

  test('dar baixa em comissão prevista', async ({ page, request, loginAs }) => {
    const session = await loginAs('comissoes-baixa');
    const api = new ApiClient(request, session);
    const company = await db.seedCompany({ uf: 'SP' });
    const represented = await api.createRepresented('Representada Baixa E2E');
    await api.createCommissionRule({ represented_id: represented.id, percent: 10, vigencia_inicio: '2020-01-01' });
    const order = await api.createOrder({ company_id: company.id, represented_id: represented.id, status: 'rascunho' });
    await api.transitionOrder(order.id, 'enviado');
    await api.transitionOrder(order.id, 'faturado', 'NF-COM-1');

    await page.goto('/comissoes');
    await page.waitForLoadState('networkidle');
    const row = rowFor(page, `#${order.numero}`, page.getByRole('button', { name: 'Dar baixa' }));
    await row.getByRole('button', { name: 'Dar baixa' }).click();
    await page.getByLabel('Valor recebido *').fill('10');
    await page.getByLabel('Recebida em *').fill(new Date().toISOString().slice(0, 10));
    await page.getByRole('button', { name: 'Confirmar baixa' }).click();
    await page.waitForLoadState('networkidle');
  });

  test('conciliar comissões via CSV', async ({ page, request, loginAs }) => {
    const session = await loginAs('comissoes-conciliar');
    const api = new ApiClient(request, session);
    const company = await db.seedCompany({ uf: 'SP' });
    const represented = await api.createRepresented('Representada Conciliar E2E');
    await api.createCommissionRule({ represented_id: represented.id, percent: 10, vigencia_inicio: '2020-01-01' });
    const order = await api.createOrder({ company_id: company.id, represented_id: represented.id, status: 'rascunho' });
    await api.transitionOrder(order.id, 'enviado');
    await api.transitionOrder(order.id, 'faturado', 'NF-COM-2');

    await page.goto('/comissoes');
    await page.getByRole('button', { name: 'Conciliar CSV' }).click();
    const csv = commissionsReconcileCsv([{ pedido: String(order.numero), valor: '10,00', data: new Date().toLocaleDateString('pt-BR') }]);
    await page.locator('textarea').fill(csv.toString('utf8'));
    await page.getByRole('button', { name: 'Conciliar', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Concluir' })).toBeVisible();
  });
});
