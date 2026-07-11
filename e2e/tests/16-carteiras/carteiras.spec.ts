import { test, expect, ApiClient, db } from '../../fixtures/index.ts';
import { createMember } from '../../fixtures/auth.ts';

test.describe('carteiras', () => {
  test('listar carteiras por vendedor mostra os clientes corretos', async ({ page, request, loginAs }) => {
    const admin = await loginAs('carteiras-listar', { tipoConta: 'escritorio' });
    const api = new ApiClient(request, admin);
    const vendedor = await createMember(request, admin, 'carteiras-vendedor');
    const company = await db.seedCompany({ uf: 'SP' });
    await api.post('/api/relationships', { company_id: company.id, owner_user_id: vendedor.user.id, status: 'cliente' });

    await page.goto('/carteiras');
    await page.waitForLoadState('networkidle');
    await expect(page.getByText(company.nome_fantasia ?? company.razao_social, { exact: false })).toBeVisible();
  });

  test('transferir carteira de um vendedor para outro move os clientes', async ({ page, request, loginAs }) => {
    const admin = await loginAs('carteiras-transferir', { tipoConta: 'escritorio' });
    const api = new ApiClient(request, admin);
    const vendedorA = await createMember(request, admin, 'carteiras-origem');
    const vendedorB = await createMember(request, admin, 'carteiras-destino');
    const company = await db.seedCompany({ uf: 'SP' });
    await api.post('/api/relationships', { company_id: company.id, owner_user_id: vendedorA.user.id, status: 'cliente' });

    const res = await api.post<{ transferred: number }>('/api/relationships/transfer', {
      from_user_id: vendedorA.user.id, to_user_id: vendedorB.user.id,
    });
    expect(res.transferred).toBeGreaterThanOrEqual(1);
    void page;
  });

  test('conta individual não acessa /carteiras', async ({ page, request }) => {
    const { registerOrg, setSession } = await import('../../fixtures/auth.ts');
    const session = await registerOrg(request, 'carteiras-individual', { tipoConta: 'individual' });
    await setSession(page, session);
    await page.goto('/carteiras');
    await expect(page).toHaveURL('/');
  });
});
