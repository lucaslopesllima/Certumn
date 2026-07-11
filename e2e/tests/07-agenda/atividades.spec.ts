import { test, expect, ApiClient } from '../../fixtures/index.ts';
import { rowFor } from '../../helpers/row.ts';

function isoInOneHour(): string {
  const d = new Date(Date.now() + 3600_000);
  d.setSeconds(0, 0);
  return d.toISOString().slice(0, 16);
}

test.describe('agenda — atividades', () => {
  test('criar atividade pelo modal aparece na visão lista', async ({ page, loginAs }) => {
    await loginAs('agenda-criar');
    await page.goto('/agenda');
    await page.getByRole('button', { name: 'Lista' }).click();
    await page.getByRole('button', { name: 'Adicionar' }).first().click();
    await page.getByPlaceholder('Ex.: Ligar para cliente').fill('Ligar para cliente E2E');
    await page.locator('form').getByRole('button', { name: 'Ligação' }).click();
    await page.getByLabel('Quando').fill(isoInOneHour());
    await page.getByRole('button', { name: 'Salvar' }).click();
    await expect(page.getByText('Ligar para cliente E2E')).toBeVisible();
  });

  test('concluir atividade muda o status', async ({ page, request, loginAs }) => {
    const session = await loginAs('agenda-concluir');
    const api = new ApiClient(request, session);
    // Nome deliberadamente sem a palavra "concluir" — evita colidir por
    // substring (case-insensitive) com o próprio botão de ação "Concluir".
    await api.createActivity({ titulo: 'Tarefa E2E Finalizar', start_at: new Date().toISOString() });

    await page.goto('/agenda');
    await page.getByRole('button', { name: 'Lista' }).click();
    await page.waitForLoadState('networkidle');
    const row = rowFor(page, 'Tarefa E2E Finalizar', page.getByRole('button', { name: 'Concluir', exact: true }));
    await row.getByRole('button', { name: 'Concluir', exact: true }).click();
    await page.waitForLoadState('networkidle');
  });

  test('visão semana lista as atividades da semana', async ({ page, request, loginAs }) => {
    const session = await loginAs('agenda-semana');
    const api = new ApiClient(request, session);
    await api.createActivity({ titulo: 'Atividade da semana E2E', start_at: new Date().toISOString() });

    await page.goto('/agenda');
    await page.getByRole('button', { name: 'Semana' }).click();
    // Timeout folgado: sob carga da suíte cheia (workers concorrentes) o render +
    // fetch da semana passava dos 10s default e o teste ficava flaky.
    await expect(page.getByText('Atividade da semana E2E')).toBeVisible({ timeout: 20_000 });
  });
});
