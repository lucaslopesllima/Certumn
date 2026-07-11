import { test, expect } from '../../fixtures/index.ts';
import { createMember } from '../../fixtures/auth.ts';
import { rowFor } from '../../helpers/row.ts';

test.describe('grupos', () => {
  test('criar grupo customizado com subconjunto de permissões', async ({ page, request, loginAs }) => {
    const admin = await loginAs('grupos-criar', { tipoConta: 'escritorio' });
    void request;
    void admin;
    await page.goto('/grupos');
    await page.getByRole('button', { name: 'Novo grupo' }).click();
    await page.getByLabel('Nome do grupo').fill('Grupo E2E');
    await page.getByLabel('Pedidos: listar').check();
    await page.getByRole('button', { name: 'Salvar' }).click();
    await expect(page.getByText('Grupo E2E')).toBeVisible();
  });

  test('permissões do grupo refletem no menu do membro', async ({ page, request, loginAs }) => {
    const admin = await loginAs('grupos-reflexo', { tipoConta: 'escritorio' });
    await page.goto('/grupos');
    await page.getByRole('button', { name: 'Novo grupo' }).click();
    await page.getByLabel('Nome do grupo').fill('Grupo Reflexo E2E');
    await page.getByLabel('Pedidos: listar').check();
    await page.getByRole('button', { name: 'Salvar' }).click();
    await expect(page.getByText('Grupo Reflexo E2E')).toBeVisible();

    // pega o id do grupo recém-criado via API pra criar o membro
    const groups = await (await request.get('/api/groups', { headers: { authorization: `Bearer ${admin.token}` } })).json() as { groups: { id: number; nome: string }[] };
    const grupo = groups.groups.find((g) => g.nome === 'Grupo Reflexo E2E')!;
    const member = await createMember(request, admin, 'grupos-membro', { groupId: grupo.id });

    await page.addInitScript((t) => window.localStorage.setItem('rs_token', t), member.token);
    await page.goto('/');
    await expect(page.getByRole('link', { name: 'Pedidos' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Clientes' })).toHaveCount(0);
  });

  test('grupo Administrador não é editável (readOnly)', async ({ page, loginAs }) => {
    await loginAs('grupos-admin-readonly', { tipoConta: 'escritorio' });
    await page.goto('/grupos');
    const card = rowFor(page, 'Administrador', page.getByRole('button', { name: 'Ver' }));
    await card.getByRole('button', { name: 'Ver' }).click();
    await expect(page.getByText('não é editável')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Salvar' })).toHaveCount(0);
  });
});
