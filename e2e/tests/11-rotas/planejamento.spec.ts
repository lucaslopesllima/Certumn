import { test, expect, ApiClient, db } from '../../fixtures/index.ts';

test.describe('rotas — planejamento', () => {
  test('montar rota com paradas, otimizar e salvar', async ({ page, request, loginAs }) => {
    const session = await loginAs('rotas-planejar');
    const api = new ApiClient(request, session);
    const companies = await db.seedCompanies({}, 3);
    for (const c of companies) await api.createRelationship(c.id);
    // computeRoute() exige origem cadastrada — seta direto no banco, sem passar
    // pelo geocode real (que é o stub/Nominatim, testado à parte em outros specs).
    await db.pool.query('UPDATE organizations SET origem_lat = $1, origem_lon = $2 WHERE id = $3',
      [-23.5505, -46.6333, session.user.org_id]);

    await page.goto('/rotas');
    await page.waitForLoadState('networkidle');
    await page.getByPlaceholder('Buscar empresa…').fill('E2E');
    const buttons = page.locator('button', { hasText: 'E2E' });
    const count = Math.min(await buttons.count(), 3);
    for (let i = 0; i < count; i++) await buttons.nth(i).click();

    await page.getByRole('button', { name: 'Otimizar rota' }).click();
    await expect(page.getByText('Distância', { exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('Custo estimado')).toBeVisible();

    await page.getByRole('button', { name: 'Salvar rota' }).click();
    const nomeInput = page.locator('form input, div input').last();
    await nomeInput.fill('Rota E2E Teste');
    await page.getByRole('button', { name: 'Salvar', exact: true }).last().click();
  });
});
