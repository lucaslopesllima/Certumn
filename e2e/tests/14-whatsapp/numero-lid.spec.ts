import { test, expect } from '../../fixtures/index.ts';

// Confirmação do telefone de um contato que chegou só como LID (número oculto
// pelo WhatsApp). O contato não tem número → não dá pra enviar até informar.
// O stub da Evolution ecoa o número em /chat/whatsappNumbers; número contendo
// '000000' volta como inexistente (caminho 422).

const WEBHOOK_TOKEN = process.env.E2E_WHATSAPP_WEBHOOK_TOKEN ?? 'e2e-webhook-token';

async function ensureWhatsappConnected(request: import('@playwright/test').APIRequestContext, token: string) {
  await request.get('/api/whatsapp/connection', { headers: { authorization: `Bearer ${token}` } });
}

// Simula uma mensagem recebida de um jid @lid — cria a conversa só-LID (sem numero).
async function simulateLidIncoming(request: import('@playwright/test').APIRequestContext, orgId: number, texto: string) {
  const lid = `${Date.now()}${Math.floor(Math.random() * 1000)}@lid`;
  const res = await request.post(`/api/webhooks/whatsapp?token=${WEBHOOK_TOKEN}`, {
    data: {
      event: 'messages.upsert',
      instance: `org_${orgId}`,
      data: {
        key: { remoteJid: lid, fromMe: false, id: `LID-${Date.now()}-${Math.random().toString(36).slice(2)}` },
        pushName: 'Contato LID E2E',
        message: { conversation: texto },
        messageTimestamp: Math.floor(Date.now() / 1000),
      },
    },
  });
  expect(res.status()).toBe(200);
}

async function openLidChat(page: import('@playwright/test').Page) {
  await page.goto('/whatsapp');
  await page.waitForLoadState('networkidle');
  await page.getByText('Contato LID E2E').first().click();
  // Cabeçalho sinaliza que é LID sem número informado.
  await expect(page.getByText('número oculto (LID) — informe o telefone')).toBeVisible({ timeout: 15_000 });
}

test.describe('whatsapp — confirmar número (LID)', () => {
  test('informar número válido habilita a conversa', async ({ page, request, loginAs }) => {
    const session = await loginAs('wa-lid-ok');
    await ensureWhatsappConnected(request, session.token);
    await simulateLidIncoming(request, session.user.org_id, 'Oi, cheguei como LID');
    await openLidChat(page);

    await page.getByTitle('Informar número do contato').click();
    await expect(page.getByText('Informar número do contato')).toBeVisible();
    await page.getByPlaceholder('(11) 98765-4321').fill('47992297790');
    await page.getByRole('button', { name: 'Confirmar número' }).click();

    // Modal fecha e o cabeçalho não mostra mais o aviso de LID sem número.
    await expect(page.getByText('Informar número do contato')).toBeHidden();
    await expect(page.getByText('número oculto (LID) — informe o telefone')).toBeHidden({ timeout: 15_000 });
  });

  test('número inexistente no WhatsApp é recusado', async ({ page, request, loginAs }) => {
    const session = await loginAs('wa-lid-nao');
    await ensureWhatsappConnected(request, session.token);
    await simulateLidIncoming(request, session.user.org_id, 'Oi de novo LID');
    await openLidChat(page);

    await page.getByTitle('Informar número do contato').click();
    // '000000' faz o stub responder exists:false → backend 422.
    await page.getByPlaceholder('(11) 98765-4321').fill('4700000000');
    await page.getByRole('button', { name: 'Confirmar número' }).click();

    await expect(page.getByText('número não encontrado no WhatsApp')).toBeVisible({ timeout: 15_000 });
    // Segue como LID (número não foi gravado).
    await expect(page.getByText('número oculto (LID) — informe o telefone')).toBeVisible();
  });

  test('tentar enviar sem número abre o modal de confirmação', async ({ page, request, loginAs }) => {
    const session = await loginAs('wa-lid-send');
    await ensureWhatsappConnected(request, session.token);
    await simulateLidIncoming(request, session.user.org_id, 'Manda algo pra mim');
    await openLidChat(page);

    await page.getByPlaceholder('Digite uma mensagem…').fill('Olá!');
    await page.getByLabel('Enviar').click();
    await expect(page.getByText('Informar número do contato')).toBeVisible({ timeout: 15_000 });
  });
});
