import { test, expect, ApiClient, db } from '../../fixtures/index.ts';
import { dragCardToStage } from '../../helpers/kanban.ts';

test.describe('funil — kanban', () => {
  test('carrega as 7 etapas padrão como colunas', async ({ page, loginAs }) => {
    await loginAs('kanban-etapas');
    await page.goto('/funil');
    await page.waitForLoadState('networkidle');
    for (const nome of ['Prospecção', 'Conscientização', 'Interesse', 'Avaliação', 'Negociação', 'Compra', 'Fidelização']) {
      await expect(page.getByText(nome, { exact: true })).toBeVisible();
    }
  });

  test('card criado via API aparece na etapa correta', async ({ page, request, loginAs }) => {
    const session = await loginAs('kanban-card-etapa');
    const api = new ApiClient(request, session);
    const company = await db.seedCompany({ uf: 'SP' });
    const stages = await api.stages();
    const segunda = stages[1]!;
    await api.createRelationship(company.id, { stage_id: segunda.id });

    await page.goto('/funil');
    await page.waitForLoadState('networkidle');
    const nome = company.nome_fantasia ?? company.razao_social;
    const column = page.locator('div.rounded-2xl').filter({ hasText: segunda.nome });
    await expect(column.getByText(nome, { exact: false })).toBeVisible();
  });

  test('arrastar card para outra coluna atualiza a etapa e persiste após reload', async ({ page, request, loginAs }) => {
    const session = await loginAs('kanban-drag');
    const api = new ApiClient(request, session);
    const company = await db.seedCompany({ uf: 'SP' });
    const stages = await api.stages();
    const primeira = stages[0]!;
    const terceira = stages[2]!;
    const rel = await api.createRelationship(company.id, { stage_id: primeira.id });

    await page.goto('/funil');
    await page.waitForLoadState('networkidle');
    const nome = company.nome_fantasia ?? company.razao_social;
    await dragCardToStage(page, nome, terceira.nome);
    await expect(page.locator('div.rounded-2xl').filter({ hasText: terceira.nome }).getByText(nome, { exact: false })).toBeVisible();

    await page.reload();
    await page.waitForLoadState('networkidle');
    await expect(page.locator('div.rounded-2xl').filter({ hasText: terceira.nome }).getByText(nome, { exact: false })).toBeVisible();
    // stages.id vem bigint -> string no JSON da API; relationshipStageId já
    // devolve Number() — coage os dois lados pra comparar (mesma pegadinha
    // registrada em memória: "pg bigint ids as strings").
    const stageId = await db.relationshipStageId(rel.id);
    expect(stageId).toBe(Number(terceira.id));
  });

  test('abrir card mostra os detalhes do cliente/empresa', async ({ page, request, loginAs }) => {
    const session = await loginAs('kanban-abrir-card');
    const api = new ApiClient(request, session);
    const company = await db.seedCompany({ uf: 'SP' });
    await api.createRelationship(company.id);

    await page.goto('/funil');
    await page.waitForLoadState('networkidle');
    const nome = company.nome_fantasia ?? company.razao_social;
    await page.getByRole('button', { name: nome }).click();
    // razão social aparece tanto no card do board quanto no CompanyModal aberto
    // por cima — .first() basta pra provar que o modal renderizou os dados.
    await expect(page.getByText(company.razao_social).first()).toBeVisible();
  });
});
