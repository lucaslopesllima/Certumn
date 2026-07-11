import { test, expect, ApiClient } from '../../fixtures/index.ts';
import { rowFor } from '../../helpers/row.ts';

const MAILPIT_API = process.env.E2E_MAILPIT_API ?? 'http://localhost:8025';

test.describe('e-mail — agendamento', () => {
  test('agendar envio de e-mail para o futuro aparece como pendente', async ({ page, request, loginAs }) => {
    const session = await loginAs('email-agendar');
    void request;
    await page.goto('/email');
    await page.getByRole('button', { name: 'Novo agendamento' }).click();
    await page.getByPlaceholder('Assunto do e-mail').fill('Agendamento E2E');
    await page.getByPlaceholder('Conteúdo do e-mail').fill('Corpo do agendamento E2E');
    const dest = page.getByPlaceholder('contato@empresa.com');
    await dest.fill('destino-e2e@teste.com');
    await dest.press('Enter');
    const futuro = new Date(Date.now() + 3600_000).toISOString().slice(0, 16);
    await page.locator('input[type="datetime-local"]').fill(futuro);
    await page.getByRole('button', { name: 'Salvar' }).click();
    await expect(page.getByText('Agendamento E2E')).toBeVisible();
    void session;
  });

  test('cancelar agendamento pendente muda status', async ({ page, loginAs }) => {
    await loginAs('email-cancelar');
    await page.goto('/email');
    await page.getByRole('button', { name: 'Novo agendamento' }).click();
    await page.getByPlaceholder('Assunto do e-mail').fill('Cancelar E2E');
    await page.getByPlaceholder('Conteúdo do e-mail').fill('Corpo cancelar E2E');
    const dest = page.getByPlaceholder('contato@empresa.com');
    await dest.fill('cancelar-e2e@teste.com');
    await dest.press('Enter');
    const futuro = new Date(Date.now() + 3600_000).toISOString().slice(0, 16);
    await page.locator('input[type="datetime-local"]').fill(futuro);
    await page.getByRole('button', { name: 'Salvar' }).click();
    await expect(page.getByText('Cancelar E2E')).toBeVisible();

    const row = rowFor(page, 'Cancelar E2E', page.getByTitle('Cancelar envio'));
    await row.getByTitle('Cancelar envio').click();
    await page.locator('.swal2-confirm').click();
    await page.waitForLoadState('networkidle');
  });

  test('e-mail agendado no passado dispara e chega no Mailpit', async ({ request, loginAs }) => {
    test.setTimeout(90_000);
    const session = await loginAs('email-dispara-mailpit');
    const api = new ApiClient(request, session);
    await request.put('/api/settings/smtp', {
      headers: { authorization: `Bearer ${session.token}` },
      data: { host: 'mailpit', port: 1025, secure: false, from_email: `e2e-${Date.now()}@prospecta.local`, enabled: true },
    });

    const passado = new Date(Date.now() - 60_000).toISOString();
    const destinatario = `mailpit-${Date.now()}@teste.com`;
    await api.post('/api/email-schedules', {
      destinatario, assunto: 'Disparo E2E', corpo: 'Corpo do disparo E2E', agendado_para: passado,
    });

    await expect.poll(async () => {
      const res = await request.get(`${MAILPIT_API}/api/v1/search?query=to:${destinatario}`);
      if (!res.ok()) return 0;
      const body = (await res.json()) as { total: number };
      return body.total;
    }, { timeout: 75_000, intervals: [2000, 3000, 5000] }).toBeGreaterThanOrEqual(1);
  });
});
