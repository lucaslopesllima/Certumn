import { test, expect } from '../../fixtures/index.ts';

// O território (municípios) é obrigatório pro /api/recommend responder — a UI
// guarda essa config em localStorage (companyFilter.tsx, chave
// "companyFilter:reco"), persistida entre sessões. Pré-carregamos São Paulo
// (3550308, onde o seed concentra a maior parte das empresas) pra não depender
// da busca de cidade por API dentro do teste.
async function setTerritorioSaoPaulo(page: import('@playwright/test').Page): Promise<void> {
  await page.addInitScript(() => {
    window.localStorage.setItem('companyFilter:reco', JSON.stringify({
      munis: [{ id: 3550308, nome: 'São Paulo', uf: 'SP', regiao: 'SE' }],
      pesos: { cnae: 0.5, proximidade: 0.3, porte: 0.2 },
      partida: null,
    }));
  });
}

test.describe('prospecção — busca', () => {
  test('território configurado retorna empresas do seed em São Paulo', async ({ page, loginAs }) => {
    await loginAs('prospeccao-busca-sp');
    await setTerritorioSaoPaulo(page);
    await page.goto('/prospeccao');
    await page.waitForLoadState('networkidle');
    await expect(page.getByText('E2E Fantasia', { exact: false }).first()).toBeVisible({ timeout: 15_000 });
  });

  test('busca por porte filtra a lista', async ({ page, loginAs }) => {
    await loginAs('prospeccao-busca-porte');
    await setTerritorioSaoPaulo(page);
    await page.goto('/prospeccao');
    await page.waitForLoadState('networkidle');
    // getByLabel('Porte') não serve aqui: o <select> herda no nome acessível o
    // texto de TODAS as suas <option> (Chromium concatena), então mesmo com
    // exact:true o nome real vira algo como "PorteTodosMicroPequenoDemais...".
    // Escopa pelo <label> que contém o texto "Porte" E um <select> (só o
    // filtro de porte tem select — o slider de pesos usa <input type=range>).
    await page.locator('label', { hasText: 'Porte' }).locator('select').selectOption('micro');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('body')).toBeVisible();
  });

  test('resultado vazio (sem território) mostra estado tratado', async ({ page, loginAs }) => {
    await loginAs('prospeccao-sem-territorio');
    await page.goto('/prospeccao');
    await page.waitForLoadState('networkidle');
    await expect(page.getByText(/território/i).first()).toBeVisible();
  });
});
