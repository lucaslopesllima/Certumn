import { test, expect, ApiClient } from '../../fixtures/index.ts';

test.describe('financeiro — fluxo de caixa e DRE', () => {
  test('fluxo de caixa soma receitas e despesas semeadas por período', async ({ page, request, loginAs }) => {
    const session = await loginAs('financeiro-fluxo');
    const api = new ApiClient(request, session);
    const hoje = new Date().toISOString().slice(0, 10);
    await api.createFinanceEntry({ kind: 'receber', descricao: 'Receita Fluxo E2E', valor: 1000, vencimento: hoje });
    await api.createFinanceEntry({ kind: 'pagar', descricao: 'Despesa Fluxo E2E', valor: 400, vencimento: hoje });

    await page.goto('/financeiro');
    await page.getByRole('button', { name: 'Fluxo de caixa' }).click();
    await page.waitForLoadState('networkidle');
    await expect(page.locator('body')).toBeVisible();

    const cashflow = await api.get<{ semanas: { receber: number; pagar: number }[] }>('/api/finance/cashflow');
    const totalReceber = cashflow.semanas.reduce((s, w) => s + w.receber, 0);
    const totalPagar = cashflow.semanas.reduce((s, w) => s + w.pagar, 0);
    expect(totalReceber).toBeGreaterThanOrEqual(1000);
    expect(totalPagar).toBeGreaterThanOrEqual(400);
  });

  test('DRE calcula receita/despesa/resultado do ano corrente', async ({ page, request, loginAs }) => {
    const session = await loginAs('financeiro-dre');
    const api = new ApiClient(request, session);
    const hoje = new Date().toISOString().slice(0, 10);
    const entry = await api.createFinanceEntry({ kind: 'pagar', descricao: 'Despesa DRE E2E', valor: 300, vencimento: hoje });
    await api.patch(`/api/finance/${entry.id}`, { status: 'liquidado', liquidacao_data: hoje });

    await page.goto('/financeiro');
    await page.getByRole('button', { name: 'DRE' }).click();
    // Âncora determinística no conteúdo do DRE. `networkidle` é flaky: o app faz
    // polling (notificações) e sob carga nunca fica ocioso → estourava o timeout.
    await expect(page.getByText('Resultado por mês')).toBeVisible({ timeout: 20_000 });

    const ano = new Date().getFullYear();
    const dre = await api.get<{ meses: { mes: number; despesa: number }[] }>(`/api/finance/dre?ano=${ano}`);
    const mesAtual = dre.meses[new Date().getMonth()]!;
    expect(mesAtual.despesa).toBeGreaterThanOrEqual(300);
  });
});
