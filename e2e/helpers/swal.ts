// confirmDialog() (client/src/lib/confirm.ts) é SweetAlert2 de verdade — DOM
// normal, não window.confirm. Botões usam os textos default da lib
// ("Confirmar"/"Cancelar") a menos que a chamada informe opts.confirmText.
import type { Page } from '@playwright/test';

export async function confirmSwal(page: Page, confirmText = 'Confirmar'): Promise<void> {
  await page.locator('.swal2-confirm', { hasText: confirmText }).click();
}

export async function cancelSwal(page: Page): Promise<void> {
  await page.locator('.swal2-cancel').click();
}

export async function swalTitle(page: Page): Promise<string | null> {
  return page.locator('.swal2-title').textContent();
}
