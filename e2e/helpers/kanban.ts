// Kanban usa HTML5 DnD nativo (draggable + onDragStart/onDragOver/onDrop —
// client/src/pages/Kanban.tsx, sem lib de DnD). Playwright's dragTo() simula
// dragstart/dragover/drop com DataTransfer real e funciona em Chromium.
// Nenhum data-testid existe: o card é achado pelo <button title="Ver dados da
// empresa"> com o nome da empresa, subindo até o ancestral [draggable=true];
// a coluna, pela classe utilitária "rounded-2xl" (comum a Card) + o nome da
// etapa como texto (só a coluna daquela etapa tem esse texto no board).
import type { Page } from '@playwright/test';

export function cardLocator(page: Page, companyName: string) {
  return page.locator('[draggable="true"]').filter({ hasText: companyName });
}

export function columnLocator(page: Page, stageName: string) {
  return page.locator('div.rounded-2xl').filter({ hasText: stageName });
}

export async function dragCardToStage(page: Page, companyName: string, stageName: string): Promise<void> {
  const card = cardLocator(page, companyName);
  const column = columnLocator(page, stageName);
  await card.dragTo(column);
}
