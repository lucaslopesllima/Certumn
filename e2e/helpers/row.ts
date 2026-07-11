// Localizador robusto de "linha" (row) de lista: acha o <div> mais profundo que
// contém tanto o texto identificador (nome do item) quanto a ação buscada como
// descendentes — evita contar `.locator('..')` manualmente, que quebra sempre
// que o texto e o botão de ação não são irmãos diretos (quase nunca são, nesta
// app: título/valor ficam num wrapper, os botões de ação noutro, ambos filhos
// do mesmo card/row pai).
import type { Locator, Page } from '@playwright/test';

export function rowFor(page: Page, text: string, action: Locator): Locator {
  // Pedidos usa <tr> (tabela); a maioria das outras listas usa <div> (cards).
  return page.locator('div, tr').filter({ hasText: text }).filter({ has: action }).last();
}
