import { test, expect, ApiClient } from '../../fixtures/index.ts';

test.describe('sino de notificações', () => {
  test('sem pendências mostra "Nada por aqui." e sem badge', async ({ page, loginAs }) => {
    await loginAs('notif-vazio');
    await page.goto('/');
    await page.getByRole('button', { name: 'Notificações' }).click();
    await expect(page.getByText('Nada por aqui.')).toBeVisible();
  });

  test('lançamento a vencer em 1 dia gera notificação "vencimento"', async ({ page, request, loginAs }) => {
    const session = await loginAs('notif-vencimento');
    const api = new ApiClient(request, session);
    const amanha = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    await api.createFinanceEntry({ kind: 'receber', descricao: 'Fatura E2E', valor: 500, vencimento: amanha });

    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.getByRole('button', { name: 'Notificações' }).click();
    await expect(page.getByText(/Conta a receber vence/)).toBeVisible();
  });

  test('"Marcar todas" zera o contador de não lidas', async ({ page, request, loginAs }) => {
    const session = await loginAs('notif-marcar-todas');
    const api = new ApiClient(request, session);
    const amanha = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    await api.createFinanceEntry({ kind: 'pagar', descricao: 'Boleto E2E', valor: 300, vencimento: amanha });

    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.getByRole('button', { name: 'Notificações' }).click();
    await page.getByRole('button', { name: 'Marcar todas' }).click();
    await expect(page.getByRole('button', { name: 'Marcar todas' })).toHaveCount(0);
  });
});
