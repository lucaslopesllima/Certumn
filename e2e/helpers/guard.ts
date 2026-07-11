// Padrão repetido em todo spec de guard.ts: sem a permissão `code`, o item de
// menu correspondente some e a navegação direta pela URL redireciona pra "/".
import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';

export async function expectRouteBlocked(page: Page, route: string): Promise<void> {
  await page.goto(route);
  await expect(page).toHaveURL('/');
}

export async function expectMenuItemHidden(page: Page, label: string): Promise<void> {
  await expect(page.getByRole('link', { name: label, exact: true })).toHaveCount(0);
}
