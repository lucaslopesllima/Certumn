import { test, expect, ApiClient, db } from '../../fixtures/index.ts';

test.describe('pedidos — transições de status', () => {
  test('rascunho → enviado → faturado é permitido (UI + gera comissão)', async ({ page, request, loginAs }) => {
    const session = await loginAs('pedidos-transicao-ok');
    const api = new ApiClient(request, session);
    const company = await db.seedCompany({ uf: 'SP' });
    const represented = await api.createRepresented('Representada Transicao E2E');
    const order = await api.createOrder({ company_id: company.id, represented_id: represented.id, status: 'rascunho' });

    await page.goto('/pedidos');
    await page.waitForLoadState('networkidle');
    // <tr> não precisa da 2ª volta do rowFor (has-action): o nº do pedido é
    // estável através das transições, ao contrário do rótulo do botão (que muda
    // Enviar → Faturar após o clique — usar isso como filtro quebraria a 2ª ação).
    const row = page.locator('tr').filter({ hasText: `#${order.numero}` });
    await row.getByRole('button', { name: 'Enviar' }).click();
    await expect(row.getByText('Enviado')).toBeVisible();

    await row.getByRole('button', { name: 'Faturar' }).click();
    const nfInput = page.getByPlaceholder('Número da NF');
    await nfInput.fill('NF-E2E-001');
    await nfInput.locator('xpath=ancestor::form').getByRole('button', { name: 'Faturar' }).click();
    await expect(row.getByText('Faturado')).toBeVisible();
  });

  test('transição via API pulando etapa é bloqueada (409)', async ({ request, loginAs, page }) => {
    const session = await loginAs('pedidos-transicao-invalida');
    void page;
    const api = new ApiClient(request, session);
    const company = await db.seedCompany({ uf: 'SP' });
    const represented = await api.createRepresented('Representada Invalida E2E');
    const order = await api.createOrder({ company_id: company.id, represented_id: represented.id, status: 'rascunho' });

    const res = await request.post(`/api/orders/${order.id}/transition`, {
      headers: { authorization: `Bearer ${session.token}` },
      data: { status: 'entregue' },
    });
    expect(res.status()).toBe(409);
  });

  test('pedido faturado gera lançamento de comissão', async ({ request, loginAs, page }) => {
    const session = await loginAs('pedidos-gera-comissao');
    void page;
    const api = new ApiClient(request, session);
    const company = await db.seedCompany({ uf: 'SP' });
    const represented = await api.createRepresented('Representada Comissao E2E');
    await api.createCommissionRule({ represented_id: represented.id, percent: 10, vigencia_inicio: '2020-01-01' });
    const order = await api.createOrder({ company_id: company.id, represented_id: represented.id, status: 'rascunho' });
    await api.transitionOrder(order.id, 'enviado');
    await api.transitionOrder(order.id, 'faturado', 'NF-E2E-002');

    const commissions = await api.get<{ entries: { order_id: number }[] }>(`/api/commissions?order_id=${order.id}`);
    expect(commissions.entries.length).toBeGreaterThanOrEqual(1);
  });
});
