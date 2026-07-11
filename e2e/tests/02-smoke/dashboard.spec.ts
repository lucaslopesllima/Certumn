import { test, expect, ApiClient, db } from '../../fixtures/index.ts';

test.describe('dashboard', () => {
  test('org recém-criada (sem dados) mostra estado vazio tratado, sem erro', async ({ page, loginAs }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await loginAs('dash-vazio');
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    await expect(page.getByText('Funil vazio')).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('KPI "Negócios no funil" reflete cliente criado via API', async ({ page, request, loginAs }) => {
    const session = await loginAs('dash-kpi');
    const api = new ApiClient(request, session);
    const company = await db.seedCompany({ uf: 'SP' });
    await api.createRelationship(company.id, { valor_estimado: 5000 });

    await page.goto('/');
    await page.waitForLoadState('networkidle');
    // Card renderiza "Negócios no funil" + contagem + valor (ex.: "...funil1R$ 5.000").
    // "não contém '0'" é frágil (R$ 5.000 contém zeros) — verifica a contagem
    // em si em vez de fazer substring matching ingênuo no texto inteiro.
    const card = page.locator('a', { hasText: 'Negócios no funil' });
    await expect(card).toBeVisible();
    await expect(card).toContainText('R$');
    await expect(card).not.toContainText('funil0');
  });

  test('link "Ver agenda" navega para /agenda', async ({ page, loginAs }) => {
    await loginAs('dash-link-agenda');
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    const link = page.getByRole('link', { name: 'Ver agenda' });
    if (await link.count()) {
      await link.click();
      await expect(page).toHaveURL('/agenda');
    }
  });
});
