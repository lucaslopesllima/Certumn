import { test, expect } from '../../fixtures/index.ts';

test.describe('conta', () => {
  test('editar perfil da organização persiste', async ({ page, loginAs }) => {
    await loginAs('conta-perfil');
    await page.goto('/conta');
    await page.getByPlaceholder('(00) 00000-0000').fill('11987654321');
    await page.getByRole('button', { name: 'Salvar dados' }).click();
    await page.waitForLoadState('networkidle');
  });

  test('upgrade individual→escritório habilita menus office', async ({ page, loginAs }) => {
    await loginAs('conta-upgrade', { tipoConta: 'individual' });
    await page.goto('/conta');
    await expect(page.getByText('Conta Individual')).toBeVisible();
    await page.getByRole('button', { name: 'Migrar para escritório' }).click();
    await page.getByRole('button', { name: 'Confirmar migração' }).click();
    await expect(page.getByText('Conta migrada para escritório.')).toBeVisible();

    await page.goto('/');
    await expect(page.getByRole('link', { name: 'Equipe' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Grupos' })).toBeVisible();
  });

  test('após upgrade, grupos RBAC padrão ficam visíveis em /grupos', async ({ page, request, loginAs }) => {
    const session = await loginAs('conta-upgrade-grupos', { tipoConta: 'individual' });
    await request.post('/api/account/upgrade', { headers: { authorization: `Bearer ${session.token}` } });
    await page.reload();
    await page.goto('/grupos');
    await expect(page.getByText('Administrador')).toBeVisible();
    await expect(page.getByText('Vendedor')).toBeVisible();
  });
});
