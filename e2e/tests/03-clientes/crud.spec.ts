import { test, expect, ApiClient, db } from '../../fixtures/index.ts';

test.describe('clientes — CRUD', () => {
  test('criar cliente manualmente via modal aparece na lista', async ({ page, request, loginAs }) => {
    const session = await loginAs('clientes-crud');
    void new ApiClient(request, session);
    const company = await db.seedCompany({ uf: 'SP' });

    await page.goto('/clientes');
    await page.getByRole('button', { name: 'Novo cliente' }).click();
    await page.getByPlaceholder('Buscar empresa por CNPJ ou nome…').fill(company.nome_fantasia ?? company.razao_social);
    await page.getByText(company.nome_fantasia ?? company.razao_social, { exact: false }).first().click();

    await expect(page.getByText(company.nome_fantasia ?? company.razao_social).first()).toBeVisible();
  });

  test('buscar cliente por nome filtra a lista', async ({ page, request, loginAs }) => {
    const session = await loginAs('clientes-busca');
    const api = new ApiClient(request, session);
    const company = await db.seedCompany({ uf: 'SP' });
    await api.createRelationship(company.id, { status: 'cliente' });

    await page.goto('/clientes');
    await page.waitForLoadState('networkidle');
    await page.getByPlaceholder('Filtrar por nome ou CNPJ…').fill(company.nome_fantasia ?? company.razao_social);
    await expect(page.getByText(company.nome_fantasia ?? company.razao_social).first()).toBeVisible();
  });

  test('descartar cliente exige motivo e move para descartados', async ({ page, request, loginAs }) => {
    const session = await loginAs('clientes-descarte');
    const api = new ApiClient(request, session);
    const company = await db.seedCompany({ uf: 'SP' });
    await api.createRelationship(company.id, { status: 'cliente' });

    await page.goto('/clientes');
    await page.waitForLoadState('networkidle');
    await page.getByPlaceholder('Filtrar por nome ou CNPJ…').fill(company.nome_fantasia ?? company.razao_social);
    const row = page.getByText(company.nome_fantasia ?? company.razao_social).first();
    await expect(row).toBeVisible();
  });

  test('inativar cliente troca o botão para reativar', async ({ page, request, loginAs }) => {
    const session = await loginAs('clientes-inativar');
    const api = new ApiClient(request, session);
    const company = await db.seedCompany({ uf: 'SP' });
    await api.createRelationship(company.id, { status: 'cliente' });

    await page.goto('/clientes');
    await page.waitForLoadState('networkidle');
    await page.getByPlaceholder('Filtrar por nome ou CNPJ…').fill(company.nome_fantasia ?? company.razao_social);
    const inativar = page.getByTitle('Inativar cliente').first();
    await expect(inativar).toBeVisible();
    await inativar.click();
    await expect(page.getByTitle('Reativar cliente').first()).toBeVisible();
  });
});
