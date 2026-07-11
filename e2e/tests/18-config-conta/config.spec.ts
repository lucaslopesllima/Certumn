import { test, expect } from '../../fixtures/index.ts';

const MAILPIT_API = process.env.E2E_MAILPIT_API ?? 'http://localhost:8025';

test.describe('configurações — SMTP', () => {
  test('salvar configuração de SMTP persiste', async ({ page, loginAs }) => {
    await loginAs('config-smtp-salvar', { tipoConta: 'escritorio' });
    await page.goto('/config');
    // Settings.tsx tem navegação por seções (Representadas/Contatos/.../SMTP) —
    // os campos de SMTP só renderizam depois de clicar na seção correspondente.
    await page.getByRole('button', { name: 'E-mail (SMTP)' }).click();
    await page.getByLabel('Host').fill('mailpit');
    await page.getByLabel('Porta', { exact: true }).fill('1025');
    await page.getByLabel('E-mail de origem').fill('e2e-config@prospecta.local');
    await page.getByRole('button', { name: 'Salvar' }).click();
    await page.waitForLoadState('networkidle');
    await page.reload();
    await page.getByRole('button', { name: 'E-mail (SMTP)' }).click();
    await expect(page.getByLabel('Host')).toHaveValue('mailpit');
  });

  test('enviar e-mail de teste chega no Mailpit', async ({ page, request, loginAs }) => {
    const session = await loginAs('config-smtp-teste', { tipoConta: 'escritorio' });
    await request.put('/api/settings/smtp', {
      headers: { authorization: `Bearer ${session.token}` },
      data: { host: 'mailpit', port: 1025, secure: false, from_email: 'e2e-teste@prospecta.local', enabled: true },
    });

    await page.goto('/config');
    await page.getByRole('button', { name: 'E-mail (SMTP)' }).click();
    await page.getByRole('button', { name: 'Enviar teste' }).click();
    await expect(page.getByText(/E-mail de teste enviado/)).toBeVisible({ timeout: 15_000 });

    await expect.poll(async () => {
      const res = await request.get(`${MAILPIT_API}/api/v1/search?query=to:${session.user.email}`);
      if (!res.ok()) return 0;
      const body = (await res.json()) as { total: number };
      return body.total;
    }, { timeout: 20_000 }).toBeGreaterThanOrEqual(1);
  });
});
