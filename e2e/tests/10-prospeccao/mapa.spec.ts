import { test, expect } from '../../fixtures/index.ts';

async function setTerritorioSaoPaulo(page: import('@playwright/test').Page): Promise<void> {
  await page.addInitScript(() => {
    window.localStorage.setItem('companyFilter:reco', JSON.stringify({
      munis: [{ id: 3550308, nome: 'São Paulo', uf: 'SP', regiao: 'SE' }],
      pesos: { cnae: 0.5, proximidade: 0.3, porte: 0.2 },
      partida: null,
    }));
  });
}

test.describe('prospecção — mapa', () => {
  test('mapa renderiza marcadores para os resultados', async ({ page, loginAs }) => {
    await loginAs('prospeccao-mapa');
    await setTerritorioSaoPaulo(page);
    await page.goto('/prospeccao');
    await page.waitForLoadState('networkidle');
    await page.getByRole('button', { name: 'Mapa', exact: true }).click();
    await expect(page.locator('.leaflet-interactive').first()).toBeVisible({ timeout: 15_000 });
  });

  test('clicar em marcador abre popup e "Adicionar ao funil" funciona', async ({ page, loginAs }) => {
    await loginAs('prospeccao-mapa-popup');
    await setTerritorioSaoPaulo(page);
    await page.goto('/prospeccao');
    await page.waitForLoadState('networkidle');
    await page.getByRole('button', { name: 'Mapa', exact: true }).click();
    const marker = page.locator('.leaflet-interactive').first();
    await expect(marker).toBeVisible({ timeout: 15_000 });
    await marker.click();
    const popup = page.locator('.leaflet-popup-content');
    await expect(popup).toBeVisible();
    const addBtn = popup.getByText('+ Adicionar ao funil');
    if (await addBtn.count()) {
      await addBtn.click();
      await expect(popup.getByText('✓ no funil')).toBeVisible();
    }
  });
});
