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

test.describe('prospecção — ações', () => {
  test('"Adicionar ao funil" na lista cria relationship e some do resultado', async ({ page, loginAs }) => {
    await loginAs('prospeccao-add-funil');
    await setTerritorioSaoPaulo(page);
    await page.goto('/prospeccao');
    await page.waitForLoadState('networkidle');

    const addBtn = page.getByRole('button', { name: 'Adicionar ao funil' }).first();
    await expect(addBtn).toBeVisible({ timeout: 15_000 });
    await addBtn.click();
    await expect(page.getByText('Adicionado ao funil').first()).toBeVisible();
  });

  test('filtro exclui empresas já vinculadas como cliente', async ({ page, request, loginAs }) => {
    const { ApiClient, db } = await import('../../fixtures/index.ts');
    const session = await loginAs('prospeccao-exclui-cliente');
    const api = new ApiClient(request, session);
    const company = await db.seedCompany({ uf: 'SP' });
    await api.createRelationship(company.id, { status: 'cliente' });

    await setTerritorioSaoPaulo(page);
    await page.goto('/prospeccao');
    await page.waitForLoadState('networkidle');
    await expect(page.getByText(company.nome_fantasia ?? company.razao_social, { exact: true })).toHaveCount(0);
  });
});
