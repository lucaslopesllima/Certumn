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

// Extrai o texto da mensagem dos vários formatos do Baileys/Evolution.
function extractText(message: Record<string, unknown> | undefined): string | null {
  if (!message) return null;
  const ext = message.extendedTextMessage as { text?: string } | undefined;
  const img = message.imageMessage as { caption?: string } | undefined;
  const vid = message.videoMessage as { caption?: string } | undefined;
  return (message.conversation as string) ?? ext?.text ?? img?.caption ?? vid?.caption ?? null;
}

function mediaTipo(message: Record<string, unknown> | undefined): string {
  if (!message) return 'texto';
  if (message.imageMessage) return 'imagem';
  if (message.stickerMessage) return 'imagem'; // figurinha = webp, renderiza como imagem
  if (message.audioMessage) return 'audio';
  if (message.videoMessage) return 'video';
  if (message.documentMessage) return 'documento';
  return 'texto';
}

// mimetype/filename do metadata da mídia (o binário é baixado sob demanda).
function mediaMeta(message: Record<string, unknown> | undefined): { mime: string | null; fileName: string | null } {
  const pick = (message?.imageMessage ?? message?.stickerMessage ?? message?.audioMessage ?? message?.videoMessage ?? message?.documentMessage) as
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

export function webhookRoutes(app: FastifyInstance): void {
  // Recebe eventos da Evolution. Sem JWT (é máquina-a-máquina): valida o token
  // opcional da query e mapeia a instância -> org. Responde rápido e nunca
  // derruba — erro de um evento não pode travar a entrega dos próximos.
  app.post('/api/webhooks/whatsapp', async (req, reply) => {
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
        const list = Array.isArray(body.data) ? body.data : [body.data];
        for (const raw of list as WaMsg[]) {
          const jid = raw?.key?.remoteJid;
          if (!jid || jid === 'status@broadcast') continue;
          const fromMe = !!raw.key?.fromMe;
          const isGroup = jid.endsWith('@g.us');
          // Grupo não tem dedup telefone/lid (remoteJid é o grupo); só 1:1.
          const altJid = isGroup ? null : altJidOf(raw.key);
          const message = raw.message;
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
          if (msg) broadcast(orgId, 'message', { chat_id: chat.id, message: msg, chat });
          // Foto de perfil na 1ª aparição da conversa (best-effort, assíncrono).
          if (!chat.foto_url && jid.endsWith('@s.whatsapp.net')) {
            evo.profilePicture(instanceName(orgId), jidToNumero(jid)).then(
              (url) => { if (url) { void updateFoto(orgId, jid, url); broadcast(orgId, 'chat-foto', { chat_id: chat.id, foto_url: url }); } },
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
                  if (g.subject || g.pictureUrl) broadcast(orgId, 'chat-foto', { chat_id: chat.id });
                },
                () => { groupNameDone.delete(key); }, // permite nova tentativa depois
              );
            }
          }
        }
        return reply.code(200).send({ ok: true });
      }

      if (event === 'messages.update') {
        // Atualização de status de entrega/leitura (saída). Reflete no registro.
        const list = Array.isArray(body.data) ? body.data : [body.data];
        for (const raw of list as Array<{ key?: WaKey; update?: { status?: string }; status?: string }>) {
          const id = raw?.key?.id;
          const st = raw.update?.status ?? raw.status;
          if (!id || !st) continue;
          const map: Record<string, string> = { DELIVERY_ACK: 'entregue', READ: 'lido', PLAYED: 'lido', SERVER_ACK: 'enviado' };
          const status = map[String(st)] ?? null;
          if (!status) continue;
          await query(
            'UPDATE whatsapp_messages SET status = $3 WHERE org_id = $1 AND evolution_id = $2',
            [orgId, id, status],
          );
          broadcast(orgId, 'message-status', { evolution_id: id, status });
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
        const list = Array.isArray(body.data) ? body.data : [body.data];
        for (const raw of list as Array<{ remoteJid?: string; id?: string; pushName?: string; profilePicUrl?: string | null }>) {
          const jid = raw?.remoteJid ?? raw?.id;
          if (!jid || jid === 'status@broadcast') continue;
          const url = raw.profilePicUrl ?? null;
          if (!url) continue;
          const chatId = await resolveChatId(orgId, jid);
          if (!chatId) continue; // contato sem conversa: ignora
          await updateFotoById(orgId, chatId, url);
          broadcast(orgId, 'chat-foto', { chat_id: chatId, foto_url: url });
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
