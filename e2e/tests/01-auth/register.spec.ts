import { test, expect } from '@playwright/test';
import { uniqEmail } from '../../fixtures/auth.ts';

test.describe('cadastro', () => {
  test('cadastro tipo individual esconde Equipe/Grupos/Carteiras no menu', async ({ page }) => {
    await page.goto('/login');
    await page.getByRole('button', { name: 'Criar conta' }).click();
    await expect(page.getByText('Tipo de conta')).toBeVisible();
    await page.getByText('Individual', { exact: true }).click();
    await page.getByLabel('Seu nome / razão social').fill('Representante Individual E2E');
    await page.getByLabel('E-mail').fill(uniqEmail('cadastro-individual'));
    await page.locator('input[type="password"]').fill('senha123');
    await page.locator('form').getByRole('button', { name: 'Criar conta' }).click();

    await expect(page).toHaveURL('/');
    await expect(page.getByRole('link', { name: 'Equipe' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Grupos' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Carteiras' })).toHaveCount(0);
  });

  test('cadastro tipo escritório mostra menu completo pro admin', async ({ page }) => {
    await page.goto('/login');
    await page.getByRole('button', { name: 'Criar conta' }).click();
    await page.getByText('Escritório', { exact: true }).click();
    await page.getByLabel('Nome do escritório').fill('Escritório E2E');
    await page.getByLabel('E-mail').fill(uniqEmail('cadastro-escritorio'));
    await page.locator('input[type="password"]').fill('senha123');
    await page.locator('form').getByRole('button', { name: 'Criar conta' }).click();

    await expect(page).toHaveURL('/');
    await expect(page.getByRole('link', { name: 'Equipe' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Grupos' })).toBeVisible();
  });

  test('cadastro com email já usado retorna erro', async ({ page, request }) => {
    const email = uniqEmail('duplicado');
    await request.post('/api/auth/register', { data: { org_nome: 'Org Original', email, senha: 'senha123' } });

    await page.goto('/login');
    await page.getByRole('button', { name: 'Criar conta' }).click();
    await page.getByLabel('Seu nome / razão social').fill('Outra Org');
    await page.getByLabel('E-mail').fill(email);
    await page.locator('input[type="password"]').fill('senha123');
    await page.locator('form').getByRole('button', { name: 'Criar conta' }).click();

    await expect(page.getByText('email já cadastrado')).toBeVisible();
    await expect(page).toHaveURL('/login');
  });

  test('cadastro com senha curta é bloqueado pela validação do form', async ({ page }) => {
    await page.goto('/login');
    await page.getByRole('button', { name: 'Criar conta' }).click();
    await page.getByLabel('Seu nome / razão social').fill('Org Senha Curta');
    await page.getByLabel('E-mail').fill(uniqEmail('senha-curta'));
    const senha = page.locator('input[type="password"]');
    await senha.fill('123');
    await page.locator('form').getByRole('button', { name: 'Criar conta' }).click();
    // maxLength/minLength de validação HTML nativa mantém o form na mesma página.
    await expect(page).toHaveURL('/login');
  });

  test('após cadastro, o funil nasce com as 7 etapas padrão', async ({ page, request }) => {
    const email = uniqEmail('7-etapas');
    const reg = await request.post('/api/auth/register', { data: { org_nome: 'Org Etapas', email, senha: 'senha123' } });
    const { token } = (await reg.json()) as { token: string };
    const stagesRes = await request.get('/api/stages', { headers: { authorization: `Bearer ${token}` } });
    const { stages } = (await stagesRes.json()) as { stages: { nome: string }[] };
    expect(stages).toHaveLength(7);
    expect(stages.map((s) => s.nome)).toEqual([
      'Prospecção', 'Conscientização', 'Interesse', 'Avaliação', 'Negociação', 'Compra', 'Fidelização',
    ]);
  });

  test('após cadastro escritório, os grupos RBAC padrão existem', async ({ page, request }) => {
    const email = uniqEmail('grupos-padrao');
    const reg = await request.post('/api/auth/register', { data: { org_nome: 'Org Grupos', email, senha: 'senha123', tipo_conta: 'escritorio' } });
    const { token } = (await reg.json()) as { token: string };
    const groupsRes = await request.get('/api/groups', { headers: { authorization: `Bearer ${token}` } });
    const { groups } = (await groupsRes.json()) as { groups: { nome: string }[] };
    const nomes = groups.map((g) => g.nome).sort();
    expect(nomes).toEqual(['Administrador', 'Financeiro', 'Gerente', 'Vendedor'].sort());
  });
});
