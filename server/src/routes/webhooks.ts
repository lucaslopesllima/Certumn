import type { FastifyInstance } from 'fastify';
import { config } from '../config.ts';
import { query } from '../db.ts';
import { broadcast } from '../ws.ts';
import * as evo from '../evolution.ts';
import {
  orgByInstance, setStatus, upsertChat, insertMessage, instanceName, updateFoto, updateNome, jidToNumero,
  resolveChatId, updateFotoById,
} from '../whatsapp.ts';

// Subject de grupo já resolvido nesta sessão (org:jid) — evita refazer a busca a
// cada mensagem. Limpa a entrada em falha p/ permitir nova tentativa depois.
const groupNameDone = new Set<string>();

// Teto de eventos processados por request — evita que um POST forjado com um
// data[] gigante enfileire milhares de queries/chamadas Evolution (DoS).
const MAX_WEBHOOK_BATCH = 200;

type Msg = Record<string, unknown> | undefined;

// O conteúdo real vem embrulhado em envelopes: mensagem temporária
// (ephemeralMessage), visualização única (viewOnce*), documento com legenda e
// mensagem editada. Sem desembrulhar, extractText/mediaTipo não acham nada e o
// balão entra vazio ("a mensagem sumiu"). Desce até o miolo (teto de 5 pra não
// girar em payload malformado com ciclo).
function unwrap(message: Msg): Msg {
  let m = message;
  for (let i = 0; i < 5 && m; i++) {
    const inner = (m.ephemeralMessage ?? m.viewOnceMessage ?? m.viewOnceMessageV2 ?? m.viewOnceMessageV2Extension
      ?? m.documentWithCaptionMessage ?? m.editedMessage) as { message?: Record<string, unknown> } | undefined;
    const edited = (m.protocolMessage as { editedMessage?: Record<string, unknown> } | undefined)?.editedMessage;
    const next = inner?.message ?? edited;
    if (!next) return m;
    m = next;
  }
  return m;
}

// Chaves que carregam conteúdo exibível. O que não tem nenhuma delas é ruído de
// protocolo (senderKeyDistributionMessage, messageContextInfo, reactionMessage,
// protocolMessage de revogação, messageHistoryNotice, secretEncryptedMessage) —
// isso NÃO é mensagem de conversa e não pode virar balão vazio nem mexer na
// prévia/contador de não-lidas.
const CONTENT_KEYS = [
  'conversation', 'extendedTextMessage', 'imageMessage', 'videoMessage', 'audioMessage',
  'documentMessage', 'stickerMessage', 'ptvMessage', 'contactMessage', 'contactsArrayMessage',
  'locationMessage', 'liveLocationMessage', 'pollCreationMessage', 'pollCreationMessageV2',
  'pollCreationMessageV3', 'templateMessage', 'buttonsMessage', 'listMessage',
  'buttonsResponseMessage', 'listResponseMessage', 'templateButtonReplyMessage',
  'interactiveMessage', 'interactiveResponseMessage', 'productMessage', 'eventMessage',
];
function hasContent(message: Msg): boolean {
  return !!message && CONTENT_KEYS.some((k) => message[k]);
}

// Extrai o texto da mensagem dos vários formatos do Baileys/Evolution.
function extractText(message: Msg): string | null {
  if (!message) return null;
  const s = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);
  const cap = (k: string): string | undefined => s((message[k] as { caption?: string } | undefined)?.caption);
  const loc = message.locationMessage as { name?: string; address?: string } | undefined;
  const contato = message.contactMessage as { displayName?: string } | undefined;
  const enquete = (message.pollCreationMessage ?? message.pollCreationMessageV2 ?? message.pollCreationMessageV3) as { name?: string } | undefined;
  // Template (mensagem de negócio/campanha): o texto fica em hydratedTemplate
  // (.hydratedContentText) ou, no formato novo, em interactiveMessageTemplate.body.
  const tpl = message.templateMessage as {
    hydratedTemplate?: { hydratedContentText?: string; hydratedTitleText?: string };
    hydratedFourRowTemplate?: { hydratedContentText?: string };
    interactiveMessageTemplate?: { body?: { text?: string } };
  } | undefined;
  const inter = message.interactiveMessage as { body?: { text?: string } } | undefined;
  return s((message.conversation as string))
    ?? s((message.extendedTextMessage as { text?: string } | undefined)?.text)
    ?? cap('imageMessage') ?? cap('videoMessage') ?? cap('ptvMessage') ?? cap('documentMessage')
    // Respostas de botão/lista: o que o contato escolheu é o texto da mensagem.
    ?? s((message.buttonsResponseMessage as { selectedDisplayText?: string } | undefined)?.selectedDisplayText)
    ?? s((message.templateButtonReplyMessage as { selectedDisplayText?: string } | undefined)?.selectedDisplayText)
    ?? s((message.listResponseMessage as { title?: string } | undefined)?.title)
    ?? s((message.interactiveResponseMessage as { body?: { text?: string } } | undefined)?.body?.text)
    ?? s(tpl?.hydratedTemplate?.hydratedContentText) ?? s(tpl?.hydratedFourRowTemplate?.hydratedContentText)
    ?? s(tpl?.interactiveMessageTemplate?.body?.text) ?? s(tpl?.hydratedTemplate?.hydratedTitleText)
    ?? s(inter?.body?.text)
    ?? (contato ? `👤 ${contato.displayName ?? 'Contato'}` : undefined)
    ?? (message.contactsArrayMessage ? '👤 Contatos' : undefined)
    ?? (loc ? `📍 ${loc.name ?? loc.address ?? 'Localização'}` : undefined)
    ?? (message.liveLocationMessage ? '📍 Localização em tempo real' : undefined)
    ?? (enquete ? `📊 ${enquete.name ?? 'Enquete'}` : undefined)
    ?? s((message.eventMessage as { name?: string } | undefined)?.name)
    ?? null;
}

function mediaTipo(message: Msg): string {
  if (!message) return 'texto';
  if (message.imageMessage) return 'imagem';
  if (message.stickerMessage) return 'imagem'; // figurinha = webp, renderiza como imagem
  if (message.audioMessage) return 'audio';
  if (message.videoMessage || message.ptvMessage) return 'video'; // ptv = vídeo-recado redondo
  if (message.documentMessage) return 'documento';
  return 'texto';
}

// mimetype/filename do metadata da mídia (o binário é baixado sob demanda).
function mediaMeta(message: Msg): { mime: string | null; fileName: string | null } {
  const pick = (message?.imageMessage ?? message?.stickerMessage ?? message?.audioMessage ?? message?.videoMessage
    ?? message?.ptvMessage ?? message?.documentMessage) as
    { mimetype?: string; fileName?: string } | undefined;
  return { mime: pick?.mimetype ?? null, fileName: pick?.fileName ?? null };
}

// timestamp em segundos (epoch) -> ISO. Indefinido cai pra agora (no insert).
function tsToIso(ts: unknown): string | undefined {
  const n = Number(ts);
  return Number.isFinite(n) && n > 0 ? new Date(n * 1000).toISOString() : undefined;
}

// remoteJidAlt/senderPn/senderLid: o WhatsApp (Baileys novo) entrega o MESMO
// contato pelos dois jids — telefone (@s.whatsapp.net) e LID (@lid) — no mesmo
// evento. O campo "Alt" traz a contraparte do remoteJid; senderPn/senderLid são
// fallback de outras versões. Usado pra unificar a conversa (não duplicar).
interface WaKey {
  remoteJid?: string; fromMe?: boolean; id?: string;
  remoteJidAlt?: string; senderPn?: string; senderLid?: string;
}

// Contraparte (telefone <-> lid) do remoteJid, se o evento trouxe. Só aceita jid
// de contato individual (s.whatsapp.net/lid) — ignora grupo/qualquer outro.
function altJidOf(key: WaKey | undefined): string | null {
  for (const c of [key?.remoteJidAlt, key?.senderPn, key?.senderLid]) {
    if (c && (c.endsWith('@s.whatsapp.net') || c.endsWith('@lid'))) return c;
  }
  return null;
}
interface WaMsg {
  key?: WaKey; pushName?: string; message?: Record<string, unknown>;
  messageTimestamp?: number; status?: string;
}

// Espelha UMA mensagem recebida no webhook: resolve a conversa, grava e avisa o
// front. Lança em erro de banco/Evolution — quem chama isola por mensagem.
async function processUpsert(orgId: number, raw: WaMsg): Promise<void> {
  const jid = raw?.key?.remoteJid;
  if (!jid || jid === 'status@broadcast') return;
  const fromMe = !!raw.key?.fromMe;
  const isGroup = jid.endsWith('@g.us');
  // Grupo não tem dedup telefone/lid (remoteJid é o grupo); só 1:1.
  const altJid = isGroup ? null : altJidOf(raw.key);
  const message = unwrap(raw.message);
  // Ruído de protocolo (reação, distribuição de chave, revogação...): não é
  // balão de conversa — sai antes de mexer na prévia/contador de não-lidas.
  if (!hasContent(message)) return;
  const texto = extractText(message);
  const tipo = mediaTipo(message);
  const meta = mediaMeta(message);
  const momento = tsToIso(raw.messageTimestamp);
  const chat = await upsertChat(orgId, jid, {
    // Em grupo o pushName é do PARTICIPANTE que enviou, não do grupo — não
    // usa como nome da conversa (o subject vem do groupInfo abaixo).
    nome: fromMe || isGroup ? null : (raw.pushName ?? null),
    preview: texto ?? `[${tipo === 'texto' ? 'mídia' : tipo}]`,
    momento,
    incNaoLidas: !fromMe,
  }, altJid);
  const msg = await insertMessage(orgId, chat.id, {
    evolutionId: raw.key?.id ?? null,
    fromMe,
    tipo,
    corpo: texto,
    momento,
    status: fromMe ? 'enviado' : null,
    mime: meta.mime,
    fileName: meta.fileName,
  });
  if (msg) broadcast(orgId, 'message', { chat_id: Number(chat.id), message: msg, chat });
  // Foto de perfil na 1ª aparição da conversa (best-effort, assíncrono).
  if (!chat.foto_url && jid.endsWith('@s.whatsapp.net')) {
    evo.profilePicture(instanceName(orgId), jidToNumero(jid)).then(
      (url) => { if (url) { void updateFoto(orgId, jid, url); broadcast(orgId, 'chat-foto', { chat_id: Number(chat.id), foto_url: url }); } },
      () => undefined,
    );
  }
  // Nome do grupo (subject): o webhook não traz: busca uma vez por
  // grupo/processo e corrige conversas que pegaram nome de participante.
  if (isGroup) {
    const key = `${orgId}:${jid}`;
    if (!groupNameDone.has(key)) {
      groupNameDone.add(key);
      evo.groupInfo(instanceName(orgId), jid).then(
        (g) => {
          if (g.subject) void updateNome(orgId, chat.id, g.subject);
          if (g.pictureUrl) void updateFoto(orgId, jid, g.pictureUrl);
          if (g.subject || g.pictureUrl) broadcast(orgId, 'chat-foto', { chat_id: Number(chat.id) });
        },
        () => { groupNameDone.delete(key); }, // permite nova tentativa depois
      );
    }
  }
}

export function webhookRoutes(app: FastifyInstance): void {
  // Recebe eventos da Evolution. Sem JWT (é máquina-a-máquina): valida o token
  // opcional da query e mapeia a instância -> org. Responde rápido e nunca
  // derruba — erro de um evento não pode travar a entrega dos próximos.
  app.post('/api/webhooks/whatsapp', {
    // Rate-limit generoso: a Evolution é a única origem legítima, mas sem limite o
    // endpoint (sem JWT) vira vetor de DoS/amplificação. config.ts já obriga o token
    // em produção com Evolution ligada.
    config: { rateLimit: { max: 600, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    if (config.whatsappWebhookToken) {
      const token = (req.query as { token?: string }).token;
      if (token !== config.whatsappWebhookToken) return reply.code(401).send({ error: 'token inválido' });
    }
    const body = req.body as { event?: string; instance?: string; data?: unknown };
    const event = String(body.event ?? '').toLowerCase().replace(/_/g, '.');
    const orgId = body.instance ? await orgByInstance(body.instance) : null;
    if (!orgId) return reply.code(202).send({ ok: true }); // instância desconhecida: ignora

    try {
      if (event === 'connection.update') {
        const state = (body.data as { state?: string })?.state;
        const status = state === 'open' ? 'conectado' : state === 'connecting' ? 'conectando' : 'desconectado';
        await setStatus(orgId, status);
        broadcast(orgId, 'status', { status });
        return reply.code(200).send({ ok: true });
      }

      if (event === 'messages.upsert') {
        // data pode vir como objeto único ou lista de mensagens.
        const list = (Array.isArray(body.data) ? body.data : [body.data]).slice(0, MAX_WEBHOOK_BATCH);
        for (const raw of list as WaMsg[]) {
          // Falha numa mensagem não pode derrubar as seguintes: sem isolar, o
          // primeiro erro abortava o resto do lote e, como a resposta é sempre
          // 200 (pra Evolution não reentregar em loop), as mensagens do lote se
          // perdiam de vez.
          try {
            await processUpsert(orgId, raw);
          } catch (e) {
            req.log.error({ err: e, jid: raw?.key?.remoteJid }, 'falha ao processar mensagem do lote');
          }
        }
        return reply.code(200).send({ ok: true });
      }

      if (event === 'messages.update') {
        // Atualização de status de entrega/leitura (saída). Reflete no registro.
        // Evolution v2 manda o payload plano ({ keyId, status }); versões antigas
        // aninham em key.id/update.status — aceita os dois formatos.
        const list = (Array.isArray(body.data) ? body.data : [body.data]).slice(0, MAX_WEBHOOK_BATCH);
        for (const raw of list as Array<{ key?: WaKey; keyId?: string; update?: { status?: string }; status?: string }>) {
          const id = raw?.key?.id ?? raw?.keyId;
          const st = raw.update?.status ?? raw.status;
          if (!id || !st) continue;
          const map: Record<string, string> = { DELIVERY_ACK: 'entregue', READ: 'lido', PLAYED: 'lido', SERVER_ACK: 'enviado' };
          const status = map[String(st)] ?? null;
          if (!status) continue;
          // Acks chegam fora de ordem (SERVER_ACK pode vir depois do READ) —
          // nunca rebaixa: só aplica se o novo status avança na escala.
          const updated = await query(
            `UPDATE whatsapp_messages SET status = $3
              WHERE org_id = $1 AND evolution_id = $2
                AND COALESCE(CASE status WHEN 'enviado' THEN 1 WHEN 'entregue' THEN 2 WHEN 'lido' THEN 3 END, 0)
                  < CASE $3 WHEN 'enviado' THEN 1 WHEN 'entregue' THEN 2 WHEN 'lido' THEN 3 ELSE 0 END
              RETURNING id`,
            [orgId, id, status],
          );
          if (updated.length > 0) broadcast(orgId, 'message-status', { evolution_id: id, status });
        }
        return reply.code(200).send({ ok: true });
      }

      if (event === 'presence.update') {
        // { id: jid, presences: { <jid>: { lastKnownPresence: 'composing'|'recording'|'available'|... } } }
        const d = body.data as { id?: string; presences?: Record<string, { lastKnownPresence?: string }> };
        const jid = d?.id;
        if (jid) {
          const p = d.presences ? Object.values(d.presences)[0]?.lastKnownPresence : undefined;
          const typing = p === 'composing' || p === 'recording';
          broadcast(orgId, 'presence', { remote_jid: jid, typing });
        }
        return reply.code(200).send({ ok: true });
      }

      if (event === 'contacts.upsert' || event === 'contacts.update') {
        // Sincronização de contatos: traz a foto de perfil (profilePicUrl), que o
        // webhook de mensagem não entrega. Só ATUALIZA conversas já existentes no
        // espelho — não cria contato pra cada entrada da agenda.
        const list = (Array.isArray(body.data) ? body.data : [body.data]).slice(0, MAX_WEBHOOK_BATCH);
        for (const raw of list as Array<{ remoteJid?: string; id?: string; pushName?: string; profilePicUrl?: string | null }>) {
          const jid = raw?.remoteJid ?? raw?.id;
          if (!jid || jid === 'status@broadcast') continue;
          const url = raw.profilePicUrl ?? null;
          if (!url) continue;
          const chatId = await resolveChatId(orgId, jid);
          if (!chatId) continue; // contato sem conversa: ignora
          await updateFotoById(orgId, chatId, url);
          broadcast(orgId, 'chat-foto', { chat_id: Number(chatId), foto_url: url });
        }
        return reply.code(200).send({ ok: true });
      }

      return reply.code(202).send({ ok: true }); // evento não tratado
    } catch (e) {
      req.log.error({ err: e, event }, 'falha ao processar webhook whatsapp');
      return reply.code(200).send({ ok: true }); // nunca devolve erro pra Evolution reentregar em loop
    }
  });
}
