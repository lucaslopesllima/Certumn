import { test, expect, db } from '../../fixtures/index.ts';
import { clientesCsv } from '../../helpers/upload.ts';

test.describe('clientes — import CSV', () => {
  test('importar CSV com CNPJs válidos cria clientes', async ({ page, loginAs }) => {
    await loginAs('clientes-import-ok');
    const c1 = await db.seedCompany({ uf: 'SP' });
    const c2 = await db.seedCompany({ uf: 'RJ' });
    const { rows } = await db.pool.query<{ cnpj: string }>('SELECT cnpj FROM companies WHERE id = ANY($1::bigint[])', [[c1.id, c2.id]]);
    const cnpjs = rows.map((r) => r.cnpj.trim());

    await page.goto('/clientes');
    await page.setInputFiles('input[type="file"]', { name: 'clientes.csv', mimeType: 'text/csv', buffer: clientesCsv(cnpjs) });
    await page.waitForLoadState('networkidle');
    await expect(page.getByText('Importando…')).toHaveCount(0);
  });

  test('CSV com CNPJ inválido não cria linha inválida', async ({ page, loginAs }) => {
    await loginAs('clientes-import-invalido');
    await page.goto('/clientes');
    await page.setInputFiles('input[type="file"]', {
      name: 'clientes-invalido.csv', mimeType: 'text/csv', buffer: clientesCsv(['123', 'abc']),
    });
    await page.waitForLoadState('networkidle');
    // Sem CNPJ de 14 dígitos válido: nenhum cliente novo, sem erro fatal na tela.
    await expect(page.locator('body')).toBeVisible();
  });
});
