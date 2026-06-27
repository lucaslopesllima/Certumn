// Cliente da Evolution API (gateway WhatsApp). fetch nativo, mesmo estilo do
// cliente OSRM em routes.ts. A API key global vai no header `apikey` e opera
// todas as instâncias. config.evolutionApiUrl vazio = integração desligada.
import { config } from './config.ts';

export class EvolutionDisabledError extends Error {
  constructor() { super('integração WhatsApp não configurada'); }
}

function base(): string {
  if (!config.evolutionApiUrl || !config.evolutionApiKey) throw new EvolutionDisabledError();
  return config.evolutionApiUrl.replace(/\/+$/, '');
}

export function evolutionEnabled(): boolean {
  return !!(config.evolutionApiUrl && config.evolutionApiKey);
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${base()}${path}`, {
    method,
    headers: { apikey: config.evolutionApiKey, 'content-type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const raw = data?.response?.message ?? data?.message ?? `Evolution ${res.status}`;
    // A Evolution às vezes devolve um array de objetos (ex.: [{exists:false,...}]
    // ao validar número) — serializa legível em vez de "[object Object]".
    const msg = Array.isArray(raw)
      ? raw.map((m) => (typeof m === 'string' ? m
          : m?.exists === false ? `número não está no WhatsApp: ${m.number ?? m.jid ?? ''}`
          : JSON.stringify(m))).join('; ')
      : String(raw);
    throw new Error(msg);
  }
  return data as T;
}

export interface QrResult { code: string | null; base64: string | null; state: string | null }

// Cria a instância (idempotente do lado do chamador: 403/conflito é tratado como
// já existente). Registra o webhook que recebe os eventos de mensagem.
export async function createInstance(instanceName: string): Promise<void> {
  const webhook = config.whatsappWebhookUrl
    ? {
        webhook: {
          url: config.whatsappWebhookUrl,
          byEvents: false,
          base64: false,
          events: ['MESSAGES_UPSERT', 'MESSAGES_UPDATE', 'CONNECTION_UPDATE', 'PRESENCE_UPDATE', 'CONTACTS_UPSERT'],
        },
      }
    : {};
  await call('POST', '/instance/create', {
    instanceName,
    qrcode: true,
    integration: 'WHATSAPP-BAILEYS',
    ...webhook,
  });
}

// QR + estado atual da instância. Evolution devolve { instance: { state } } ou,
// quando aguardando leitura, { qrcode: { code, base64 } } / { base64, code }.
export async function connect(instanceName: string): Promise<QrResult> {
  const d = await call<{ code?: string; base64?: string; qrcode?: { code?: string; base64?: string }; instance?: { state?: string } }>(
    'GET', `/instance/connect/${encodeURIComponent(instanceName)}`,
  );
  return {
    code: d.qrcode?.code ?? d.code ?? null,
    base64: d.qrcode?.base64 ?? d.base64 ?? null,
    state: d.instance?.state ?? null,
  };
}

// 'open' = conectado | 'connecting' | 'close' = desconectado.
export async function connectionState(instanceName: string): Promise<string> {
  const d = await call<{ instance?: { state?: string } }>(
    'GET', `/instance/connectionState/${encodeURIComponent(instanceName)}`,
  );
  return d.instance?.state ?? 'close';
}

export async function logout(instanceName: string): Promise<void> {
  await call('DELETE', `/instance/logout/${encodeURIComponent(instanceName)}`);
}

// Envia texto. `number` em dígitos (DDI+DDD+numero) ou jid completo.
export async function sendText(instanceName: string, number: string, text: string): Promise<{ key?: { id?: string } }> {
  return call('POST', `/message/sendText/${encodeURIComponent(instanceName)}`, { number, text });
}

// Valida se números existem no WhatsApp e devolve o jid canônico de cada um.
// Usado p/ confirmar o telefone de um contato que chegou só como LID.
export async function whatsappNumbers(instanceName: string, numbers: string[]): Promise<Array<{ exists: boolean; jid: string; number: string }>> {
  const d = await call<Array<{ exists?: boolean; jid?: string; number?: string }>>(
    'POST', `/chat/whatsappNumbers/${encodeURIComponent(instanceName)}`, { numbers },
  );
  return Array.isArray(d) ? d.map((x) => ({ exists: !!x.exists, jid: x.jid ?? '', number: x.number ?? '' })) : [];
}

// Envia mídia (imagem/vídeo/documento). media = base64 (sem prefixo data:) ou URL.
export async function sendMedia(
  instanceName: string, number: string,
  m: { mediatype: 'image' | 'video' | 'document'; media: string; mimetype?: string; fileName?: string; caption?: string },
): Promise<{ key?: { id?: string } }> {
  return call('POST', `/message/sendMedia/${encodeURIComponent(instanceName)}`, { number, ...m });
}

// Envia áudio como mensagem de voz (ptt). audio = base64 ou URL.
export async function sendAudio(instanceName: string, number: string, audio: string): Promise<{ key?: { id?: string } }> {
  return call('POST', `/message/sendWhatsAppAudio/${encodeURIComponent(instanceName)}`, { number, audio });
}

// Baixa a mídia de uma mensagem recebida (o webhook só entrega metadata).
export async function getMediaBase64(
  instanceName: string, key: { id: string; remoteJid: string; fromMe: boolean },
): Promise<{ base64: string; mimetype?: string; fileName?: string }> {
  return call('POST', `/chat/getBase64FromMediaMessage/${encodeURIComponent(instanceName)}`, {
    message: { key }, convertToMp4: false,
  });
}

// Confirma leitura (ticks azuis pro contato). keys = mensagens recebidas.
export async function markRead(
  instanceName: string, readMessages: Array<{ id: string; remoteJid: string; fromMe: boolean }>,
): Promise<void> {
  if (readMessages.length === 0) return;
  await call('POST', `/chat/markMessageAsRead/${encodeURIComponent(instanceName)}`, { readMessages });
}

// Sinaliza presença ('composing' = digitando, 'recording' = gravando, 'paused').
export async function sendPresence(instanceName: string, number: string, presence: 'composing' | 'recording' | 'paused', delay = 1200): Promise<void> {
  await call('POST', `/chat/sendPresence/${encodeURIComponent(instanceName)}`, { number, presence, delay });
}

// URL da foto de perfil do contato (CDN do WhatsApp). Pode falhar (privacidade).
export async function profilePicture(instanceName: string, number: string): Promise<string | null> {
  const d = await call<{ profilePictureUrl?: string }>(
    'POST', `/chat/fetchProfilePictureUrl/${encodeURIComponent(instanceName)}`, { number },
  );
  return d.profilePictureUrl ?? null;
}

// Nome (subject) de um grupo. O webhook só traz o pushName do participante que
// enviou — o nome do grupo vem daqui. Devolve subject + foto, se houver.
export async function groupInfo(instanceName: string, groupJid: string): Promise<{ subject: string | null; pictureUrl: string | null }> {
  const d = await call<{ subject?: string; pictureUrl?: string }>(
    'GET', `/group/findGroupInfos/${encodeURIComponent(instanceName)}?groupJid=${encodeURIComponent(groupJid)}`,
  );
  return { subject: d.subject ?? null, pictureUrl: d.pictureUrl ?? null };
}

// Detalhes do grupo p/ a tela de dados: subject, descrição, tamanho e
// participantes (com jid + se é admin).
export async function groupDetails(instanceName: string, groupJid: string): Promise<{
  subject: string | null; desc: string | null; size: number | null;
  participants: Array<{ id: string; admin: string | null }>;
}> {
  const d = await call<{ subject?: string; desc?: string; size?: number; participants?: Array<{ id?: string; admin?: string | null }> }>(
    'GET', `/group/findGroupInfos/${encodeURIComponent(instanceName)}?groupJid=${encodeURIComponent(groupJid)}`,
  );
  return {
    subject: d.subject ?? null, desc: d.desc ?? null, size: d.size ?? null,
    participants: Array.isArray(d.participants) ? d.participants.map((p) => ({ id: p.id ?? '', admin: p.admin ?? null })) : [],
  };
}

// Todos os grupos da instância (sem participantes = leve). Usado p/ sincronizar
// em massa os nomes (subject) dos grupos já existentes no espelho.
export async function fetchAllGroups(instanceName: string): Promise<Array<{ id?: string; subject?: string; pictureUrl?: string | null }>> {
  const d = await call<Array<{ id?: string; subject?: string; pictureUrl?: string | null }>>(
    'GET', `/group/fetchAllGroups/${encodeURIComponent(instanceName)}?getParticipants=false`,
  );
  return Array.isArray(d) ? d : [];
}
