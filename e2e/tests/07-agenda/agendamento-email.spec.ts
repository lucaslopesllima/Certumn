import { test, expect, ApiClient } from '../../fixtures/index.ts';

function isoInOneHour(): string {
  const d = new Date(Date.now() + 3600_000);
  d.setSeconds(0, 0);
  return d.toISOString().slice(0, 16);
}

test.describe('agenda — agendar e-mail', () => {
  test('cria compromisso de e-mail pelo modal: espelha na agenda e gera o agendamento', async ({ page, request, loginAs }) => {
    const session = await loginAs('agenda-email');
    const api = new ApiClient(request, session);

    await page.goto('/agenda');
    await page.getByRole('button', { name: 'Lista' }).click();
    await page.getByRole('button', { name: 'Adicionar' }).first().click();
    // escolhe o tipo de agendamento E-mail → mostra os campos da tela de e-mail
    await page.locator('form').getByRole('button', { name: 'E-mail' }).click();
    await page.getByPlaceholder('seu@email.com').fill('remetente-e2e@empresa.com');
    await page.getByPlaceholder(/contato@empresa.com/).fill('cliente-e2e@empresa.com');
    await page.getByPlaceholder('Assunto do e-mail').fill('Assunto E-mail E2E');
    await page.getByPlaceholder('Conteúdo do e-mail').fill('Corpo do e-mail agendado pela agenda.');
    await page.getByLabel('Enviar em').fill(isoInOneHour());
    await page.getByRole('button', { name: 'Salvar' }).click();

    // compromisso espelho aparece na lista (título derivado do assunto)
    await expect(page.getByText(/Assunto E-mail E2E/)).toBeVisible({ timeout: 20_000 });

    // e o agendamento de e-mail foi de fato criado
    const { schedules } = await api.get<{ schedules: { assunto: string; destinatario: string }[] }>('/api/email-schedules');
    const sched = schedules.find((s) => s.assunto === 'Assunto E-mail E2E');
    expect(sched?.destinatario).toBe('cliente-e2e@empresa.com');

    // o compromisso espelho é do tipo email e está pendente
    const { activities } = await api.get<{ activities: { tipo: string; titulo: string; status: string }[] }>(
      `/api/activities?from=${new Date(Date.now() - 3600_000).toISOString()}&to=${new Date(Date.now() + 7 * 86_400_000).toISOString()}`,
    );
    const act = activities.find((a) => a.titulo.includes('Assunto E-mail E2E'));
    expect(act?.tipo).toBe('email');
    expect(act?.status).toBe('pendente');
  });
});
