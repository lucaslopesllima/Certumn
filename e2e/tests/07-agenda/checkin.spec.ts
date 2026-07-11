import { test, expect, ApiClient, db } from '../../fixtures/index.ts';
import { rowFor } from '../../helpers/row.ts';

test.describe('agenda — check-in e relato de visita', () => {
  test.use({ geolocation: { latitude: -23.5505, longitude: -46.6333 }, permissions: ['geolocation'] });

  test('check-in com geolocalização concedida registra local e horário', async ({ page, request, loginAs, context }) => {
    const session = await loginAs('agenda-checkin');
    const api = new ApiClient(request, session);
    await context.grantPermissions(['geolocation']);
    const company = await db.seedCompany({ uf: 'SP' });
    // "Registrar visita" só aparece com company_id vinculado (podeVisitar em Agenda.tsx).
    await api.createActivity({ titulo: 'Visita E2E Verificacao', start_at: new Date().toISOString(), tipo: 'visita', company_id: company.id });

    await page.goto('/agenda');
    await page.getByRole('button', { name: 'Lista' }).click();
    await page.waitForLoadState('networkidle');
    const row = rowFor(page, 'Visita E2E Verificacao', page.getByRole('button', { name: 'Registrar visita' }));
    await row.getByRole('button', { name: 'Registrar visita' }).click();
    // exact:true: o título da atividade ("...check-in E2E") contém a palavra
    // "check-in" e colide por substring (case-insensitive) com o botão de ação.
    await page.getByRole('button', { name: 'Check-in', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Refazer' })).toBeVisible({ timeout: 15_000 });
  });

  test('relatar visita salva resultado e próximo passo', async ({ page, request, loginAs, context }) => {
    const session = await loginAs('agenda-relato');
    const api = new ApiClient(request, session);
    await context.grantPermissions(['geolocation']);
    const company = await db.seedCompany({ uf: 'SP' });
    await api.createActivity({ titulo: 'Visita E2E Relato', start_at: new Date().toISOString(), tipo: 'visita', company_id: company.id });

    await page.goto('/agenda');
    await page.getByRole('button', { name: 'Lista' }).click();
    await page.waitForLoadState('networkidle');
    const row = rowFor(page, 'Visita E2E Relato', page.getByRole('button', { name: 'Registrar visita' }));
    await row.getByRole('button', { name: 'Registrar visita' }).click();
    await page.getByLabel('Próximo passo').fill('Enviar proposta até sexta');
    await page.getByLabel('Observações').fill('Cliente demonstrou interesse.');
    await page.getByRole('button', { name: 'Salvar visita' }).click();
    await page.waitForLoadState('networkidle');
  });
});
