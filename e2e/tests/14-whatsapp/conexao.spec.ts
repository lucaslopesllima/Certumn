import { test, expect } from '../../fixtures/index.ts';

test.describe('whatsapp — conexão', () => {
  test('gerar QR Code exibe a imagem (stub Evolution)', async ({ page, loginAs }) => {
    await loginAs('whatsapp-conectar');
    await page.goto('/whatsapp');
    await page.getByRole('button', { name: 'Gerar QR Code' }).click();
    await expect(page.getByAltText('QR Code')).toBeVisible({ timeout: 15_000 });
  });

  test('status reflete "conectado" após polling (stub sempre retorna open)', async ({ page, request, loginAs }) => {
    const session = await loginAs('whatsapp-status');
    const statusRes = await request.get('/api/whatsapp/connection', {
      headers: { authorization: `Bearer ${session.token}` },
    });
    expect(statusRes.ok()).toBeTruthy();
    const body = (await statusRes.json()) as { status: string };
    expect(body.status).toBe('conectado');
    void page;
  });

  test('desconectar instância zera o status', async ({ request, loginAs }) => {
    const session = await loginAs('whatsapp-desconectar');
    const res = await request.post('/api/whatsapp/disconnect', {
      headers: { authorization: `Bearer ${session.token}` },
    });
    expect(res.ok()).toBeTruthy();
    const statusRes = await request.get('/api/whatsapp/status', {
      headers: { authorization: `Bearer ${session.token}` },
    });
    const body = (await statusRes.json()) as { status: string };
    expect(body.status).toBe('desconectado');
  });
});
