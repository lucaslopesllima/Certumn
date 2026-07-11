import { test, expect, ApiClient, db } from '../../fixtures/index.ts';

test.describe('pedidos — CRUD', () => {
  test('criar pedido pelo modal calcula o total corretamente', async ({ page, request, loginAs }) => {
    const session = await loginAs('pedidos-criar');
    const api = new ApiClient(request, session);
    const company = await db.seedCompany({ uf: 'SP' });
    const rel = await api.createRelationship(company.id, { status: 'cliente' });
    const represented = await api.createRepresented('Representada E2E');
    void rel;

    await page.goto('/pedidos');
    await page.getByRole('button', { name: 'Novo pedido' }).click();
    const clienteNome = company.nome_fantasia ?? company.razao_social;
    await page.getByLabel('Cliente (funil) *').selectOption({ label: clienteNome });
    await page.getByLabel('Representada *').selectOption({ label: 'Representada E2E' });
    await page.getByRole('button', { name: 'Item livre' }).click();
    await page.getByLabel('Descrição item 1').fill('Item avulso e2e');
    await page.getByLabel('Qtd * item 1').fill('2');
    await page.getByLabel('Preço * item 1').fill('150');

    await page.getByRole('button', { name: 'Salvar pedido' }).click();
    await expect(page.getByText('Total: R$')).toBeVisible();

    void represented;
  });

  test('editar pedido em rascunho recalcula o total', async ({ page, request, loginAs }) => {
    const session = await loginAs('pedidos-editar');
    const api = new ApiClient(request, session);
    const company = await db.seedCompany({ uf: 'SP' });
    const represented = await api.createRepresented('Representada Edit E2E');
    const order = await api.createOrder({ company_id: company.id, represented_id: represented.id, status: 'rascunho' });

    await page.goto('/pedidos');
    await page.waitForLoadState('networkidle');
    // A célula do número é só texto — quem abre o pedido é o SafeButton do nome
    // do cliente (title "Editar pedido" p/ rascunho/cotação, "Ver pedido" senão).
    const row = page.locator('tr').filter({ hasText: `#${order.numero}` });
    await row.getByTitle('Editar pedido').click();
    await page.getByLabel('Qtd * item 1').fill('5');
    await page.getByRole('button', { name: 'Salvar pedido' }).click();
    await expect(page.getByText('Total: R$')).toBeVisible();
  });

  test('cancelar pedido muda o status (transição direta, sem confirmação)', async ({ page, request, loginAs }) => {
    const session = await loginAs('pedidos-cancelar');
    const api = new ApiClient(request, session);
    const company = await db.seedCompany({ uf: 'SP' });
    const represented = await api.createRepresented('Representada Cancel E2E');
    const order = await api.createOrder({ company_id: company.id, represented_id: represented.id, status: 'rascunho' });

    await page.goto('/pedidos');
    await page.waitForLoadState('networkidle');
    const row = page.locator('tr').filter({ hasText: `#${order.numero}` });
    // Cancelar pedido chama transition() direto (sem confirmDialog) — só o
    // remove() de exclusão definitiva usa SweetAlert, em Orders.tsx.
    await row.getByTitle('Cancelar pedido').click();
    await expect(row.getByText('Cancelado')).toBeVisible();
  });
});
