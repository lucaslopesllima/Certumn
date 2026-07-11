import { test, expect, ApiClient } from '../../fixtures/index.ts';

function isoInOneHour(): string {
  const d = new Date(Date.now() + 3600_000);
  d.setSeconds(0, 0);
  return d.toISOString().slice(0, 16);
}

test.describe('agenda — agendar WhatsApp', () => {
  test('cria compromisso WhatsApp pelo modal: espelha na agenda e gera o agendamento', async ({ page, request, loginAs }) => {
    const session = await loginAs('agenda-whatsapp');
    const api = new ApiClient(request, session);

    await page.goto('/agenda');
    await page.getByRole('button', { name: 'Lista' }).click();
    await page.getByRole('button', { name: 'Adicionar' }).first().click();
    // escolhe o tipo de agendamento WhatsApp → mostra número + mensagem
    await page.locator('form').getByRole('button', { name: 'WhatsApp' }).click();
    await page.getByPlaceholder(/91234-5678/).fill('11999990000');
    await page.getByPlaceholder(/Texto da mensagem/).fill('Mensagem WhatsApp E2E');
    await page.getByLabel('Enviar em').fill(isoInOneHour());
    await page.getByRole('button', { name: 'Salvar' }).click();

    // compromisso espelho aparece na lista (título derivado da mensagem)
    await expect(page.getByText(/Mensagem WhatsApp E2E/)).toBeVisible({ timeout: 20_000 });

    // e o agendamento de WhatsApp foi de fato criado
    const { schedules } = await api.get<{ schedules: { corpo: string }[] }>('/api/whatsapp/schedules');
    expect(schedules.some((s) => s.corpo === 'Mensagem WhatsApp E2E')).toBe(true);

    // o compromisso espelho é do tipo whatsapp e está pendente
    const { activities } = await api.get<{ activities: { tipo: string; titulo: string; status: string }[] }>(
      `/api/activities?from=${new Date(Date.now() - 3600_000).toISOString()}&to=${new Date(Date.now() + 7 * 86_400_000).toISOString()}`,
    );
    const act = activities.find((a) => a.titulo.includes('Mensagem WhatsApp E2E'));
    expect(act?.tipo).toBe('whatsapp');
    expect(act?.status).toBe('pendente');
  });
});
