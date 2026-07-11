import { test, expect, ApiClient, db } from '../../fixtures/index.ts';

// Regressão: ao escolher um contato num agendamento de WhatsApp, o telefone dele
// deve preencher o campo de número. O id do contato vem string do pg (bigint) —
// a comparação precisa coagir os dois lados, senão o autofill nunca acha o contato.
test.describe('agenda — agendar WhatsApp (autofill do contato)', () => {
  test('escolher o contato preenche o número com o telefone dele', async ({ page, request, loginAs }) => {
    const session = await loginAs('agenda-wa-contato');
    const api = new ApiClient(request, session);

    // empresa no funil + contato com telefone vinculado a ela
    const company = await db.seedCompany({ uf: 'SP' });
    const stages = await api.stages();
    await api.createRelationship(company.id, { stage_id: stages[0]!.id });
    await api.post('/api/contacts', { nome: 'Contato WA E2E', company_id: company.id, telefone: '11912345678' });

    await page.goto('/agenda');
    await page.getByRole('button', { name: 'Lista' }).click();
    await page.getByRole('button', { name: 'Adicionar' }).first().click();
    await page.locator('form').getByRole('button', { name: 'WhatsApp' }).click();

    // escolhe a empresa do funil → carrega os contatos → escolhe o contato
    await page.getByLabel('Empresa do funil').selectOption(String(company.id));
    await page.getByLabel('Contato').selectOption({ label: 'Contato WA E2E' });

    // o número é preenchido com o telefone do contato
    await expect(page.getByPlaceholder(/91234-5678/)).toHaveValue('11912345678');
  });
});
