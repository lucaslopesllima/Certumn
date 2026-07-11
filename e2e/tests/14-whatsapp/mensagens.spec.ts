import { test, expect } from '../../fixtures/index.ts';

const WEBHOOK_TOKEN = process.env.E2E_WHATSAPP_WEBHOOK_TOKEN ?? 'e2e-webhook-token';

// (1) O webhook resolve instance_name -> org_id via org_whatsapp_settings, que
// só existe depois que a org visita QUALQUER endpoint de whatsapp (ensureSettings
// em whatsapp.ts) — sem isso o webhook responde 202 e ignora o evento.
// (2) WhatsApp.tsx só renderiza a lista de chats com status === 'conectado'
// (senão mostra a tela de conectar/QR) — GET /connection consulta o stub
// (sempre devolve state 'open') e grava esse status, então já resolve os dois.
async function ensureWhatsappConnected(request: import('@playwright/test').APIRequestContext, token: string) {
  await request.get('/api/whatsapp/connection', { headers: { authorization: `Bearer ${token}` } });
}

async function simulateIncoming(request: import('@playwright/test').APIRequestContext, orgId: number, texto: string, jid = '5511988887777@s.whatsapp.net') {
  return request.post(`/api/webhooks/whatsapp?token=${WEBHOOK_TOKEN}`, {
    data: {
      event: 'messages.upsert',
      instance: `org_${orgId}`,
      data: {
        key: { remoteJid: jid, fromMe: false, id: `WEBHOOK-${Date.now()}-${Math.random().toString(36).slice(2)}` },
        pushName: 'Contato E2E',
        message: { conversation: texto },
        messageTimestamp: Math.floor(Date.now() / 1000),
      },
    },
  });
}

test.describe('whatsapp — mensagens', () => {
  test('receber mensagem via webhook aparece no chat via WebSocket sem reload', async ({ page, request, loginAs }) => {
    const session = await loginAs('whatsapp-receber');
    await ensureWhatsappConnected(request, session.token);
    await page.goto('/whatsapp');
    await page.waitForLoadState('networkidle');

    const res = await simulateIncoming(request, session.user.org_id, 'Olá, tenho interesse no produto E2E!');
    expect(res.status()).toBe(200);

    await expect(page.getByText('Olá, tenho interesse no produto E2E!')).toBeVisible({ timeout: 15_000 });
  });

  test('enviar mensagem de texto para um chat', async ({ page, request, loginAs }) => {
    const session = await loginAs('whatsapp-enviar');
    await ensureWhatsappConnected(request, session.token);
    await simulateIncoming(request, session.user.org_id, 'Mensagem inicial E2E');

    await page.goto('/whatsapp');
    await page.waitForLoadState('networkidle');
    await expect(page.getByText('Mensagem inicial E2E')).toBeVisible({ timeout: 15_000 });
    await page.getByText('Contato E2E').first().click();

    await page.getByPlaceholder('Digite uma mensagem…').fill('Resposta enviada via e2e');
    await page.getByLabel('Enviar').click();
    await expect(page.getByText('Resposta enviada via e2e')).toBeVisible();
  });

  test('marcar mensagens como lidas', async ({ page, request, loginAs }) => {
    const session = await loginAs('whatsapp-ler');
    await ensureWhatsappConnected(request, session.token);
    await simulateIncoming(request, session.user.org_id, 'Mensagem para marcar como lida E2E');

    await page.goto('/whatsapp');
    await page.waitForLoadState('networkidle');
    await page.getByText('Contato E2E').first().click();
    await page.waitForLoadState('networkidle');
  });
});
