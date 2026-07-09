import type { FastifyInstance } from 'fastify';
import type { WebSocket } from 'ws';
import { one, query, withClient } from '../db.ts';
import { requireAuth, requirePermission, authorizeToken, AuthError } from '../auth.ts';
import { audit } from '../audit.ts';
import * as evo from '../evolution.ts';
import { mediaEnabled, saveMedia, mediaStream } from '../mediaStore.ts';
import { addConn, removeConn, broadcast } from '../ws.ts';
import {
  ensureSettings, setStatus, instanceName, upsertChat, insertMessage,
  CHAT_LABELS_SQL, relationshipForCompany, numeroToJid, mergeChats, deleteChat, syncGroupNames,
  normalizeNumero, jidToNumero,
} from '../whatsapp.ts';

// Sincronização de nomes de grupo já feita nesta sessão (por org) — roda uma vez
// ao abrir a lista de conversas, conserta grupos com nome de participante.
const groupsSynced = new Set<number>();

// Content-types que podem ser servidos inline (renderizados no browser). O mime da
// mídia vem do metadata do contato remoto (não confiável) — qualquer coisa fora
// desta lista vira octet-stream + attachment para nunca executar como HTML/JS.
const INLINE_MEDIA_MIME = new Set([
  'image/jpeg', 'image/png', 'image/gif', 'image/webp',
  'audio/ogg', 'audio/mpeg', 'audio/mp4', 'audio/aac', 'audio/amr', 'audio/wav',
  'video/mp4', 'video/3gpp', 'video/webm', 'video/quicktime',
  'application/pdf',
]);
function safeMediaType(mime: string | null): { type: string; inline: boolean } {
  const m = ((mime ?? '').split(';')[0] ?? '').trim().toLowerCase();
  if (INLINE_MEDIA_MIME.has(m)) return { type: m, inline: true };
  return { type: 'application/octet-stream', inline: false };
}

// 'open' (Evolution) -> 'conectado' etc. Normaliza p/ o vocabulário do front.
function mapState(state: string | null): string {
  if (state === 'open') return 'conectado';
  if (state === 'connecting') return 'conectando';
  return 'desconectado';
}

export function whatsappRoutes(app: FastifyInstance): void {
  // Stream ao vivo: o browser abre ws://…/api/whatsapp/ws?token=JWT (o header
  // Authorization não vai em WebSocket do browser, então o token vem na query).
  app.get('/api/whatsapp/ws', { websocket: true }, (socket: WebSocket, req) => {
    const token = (req.query as { token?: string }).token;
    if (!token) { socket.close(1008, 'sem token'); return; }
    // authorizeToken (não verifyToken cru): valida ativo/token_version/permissão —
    // sem isso um usuário desativado ou sem whatsapp.view abriria o stream da org.
    authorizeToken(token, 'whatsapp.view').then(
      (claims) => {
        addConn(claims.orgId, socket);
        socket.on('close', () => removeConn(claims.orgId, socket));
      },
      () => socket.close(1008, 'não autorizado'),
    );
  });

  // Estado da conexão da org (cria a linha de settings na primeira visita).
  app.get('/api/whatsapp/status', { preHandler: [requireAuth, requirePermission('whatsapp.view')] }, async (req) => {
    const orgId = req.auth!.orgId;
    await ensureSettings(orgId);
    const s = await one<{ status: string; numero: string | null; updated_at: string }>(
      'SELECT status, numero, updated_at FROM org_whatsapp_settings WHERE org_id = $1', [orgId],
    );
    return { enabled: evo.evolutionEnabled(), status: s?.status ?? 'desconectado', numero: s?.numero ?? null };
  });

  // Inicia conexão: cria a instância (idempotente) e devolve o QR pra leitura.
  app.post('/api/whatsapp/connect', { preHandler: [requireAuth, requirePermission('whatsapp.connect')] }, async (req, reply) => {
    const orgId = req.auth!.orgId;
    const name = await ensureSettings(orgId);
    try {
      try { await evo.createInstance(name); } catch { /* já existe: segue pro connect */ }
      // O Baileys gera o QR de forma assíncrona (~1-3s após o create). A 1ª
      // chamada de connect pode vir sem base64 (count:0) — repesca até o QR ficar
      // pronto ou a instância já estar conectada.
      let qr = await evo.connect(name);
      for (let i = 0; i < 6 && !qr.base64 && qr.state !== 'open'; i++) {
        await new Promise((r) => setTimeout(r, 1000));
        qr = await evo.connect(name);
      }
      await setStatus(orgId, qr.state === 'open' ? 'conectado' : 'conectando');
      await audit(req, 'org_whatsapp_settings', orgId, 'connect', { instance: name });
      return { qr: qr.base64, code: qr.code, status: mapState(qr.state) };
    } catch (e) {
      if (e instanceof evo.EvolutionDisabledError) return reply.code(503).send({ error: e.message });
      return reply.code(502).send({ error: e instanceof Error ? e.message : 'falha ao conectar' });
    }
  });

  // Repesca o estado real na Evolution (o front chama em polling enquanto o QR
  // está aberto, até virar 'conectado').
  app.get('/api/whatsapp/connection', { preHandler: [requireAuth, requirePermission('whatsapp.view')] }, async (req, reply) => {
    const orgId = req.auth!.orgId;
    await ensureSettings(orgId);
    try {
      const state = await evo.connectionState(instanceName(orgId));
      const status = mapState(state);
      await setStatus(orgId, status);
      return { status };
    } catch (e) {
      if (e instanceof evo.EvolutionDisabledError) return reply.code(503).send({ error: e.message });
      return reply.code(502).send({ error: e instanceof Error ? e.message : 'falha ao consultar' });
    }
  });

  app.post('/api/whatsapp/disconnect', { preHandler: [requireAuth, requirePermission('whatsapp.connect')] }, async (req, reply) => {
    const orgId = req.auth!.orgId;
    try {
      await evo.logout(instanceName(orgId));
    } catch (e) {
      if (e instanceof evo.EvolutionDisabledError) return reply.code(503).send({ error: e.message });
      // logout pode falhar se já estava fora — segue zerando o status local.
    }
    await setStatus(orgId, 'desconectado', null);
    await audit(req, 'org_whatsapp_settings', orgId, 'disconnect', {});
    return { ok: true };
  });

  // Lista de conversas (lateral) com rótulos do vínculo, mais recentes primeiro.
  app.get('/api/whatsapp/chats', { preHandler: [requireAuth, requirePermission('whatsapp.view')] }, async (req) => {
    const orgId = req.auth!.orgId;
    const chats = await query(
      `${CHAT_LABELS_SQL}
        WHERE ch.org_id = $1
        ORDER BY ch.last_message_at DESC NULLS LAST
        LIMIT 200`,
      [orgId],
    );
    // Conserta nomes de grupo em massa, uma vez por sessão (não bloqueia a
    // resposta; ao terminar avisa o front pra recarregar a lista).
    if (!groupsSynced.has(orgId)) {
      groupsSynced.add(orgId);
      syncGroupNames(orgId).then(
        (n) => { if (n > 0) broadcast(orgId, 'chat-foto', { chat_id: 0 }); },
        () => groupsSynced.delete(orgId), // falhou (desconectado?) — tenta de novo depois
      );
    }
    return { chats };
  });

  // Mensagens de uma conversa (ordem cronológica). Zera não-lidas localmente e
  // dispara confirmação de leitura (ticks azuis) pro contato no WhatsApp.
  app.get('/api/whatsapp/chats/:id/messages', { preHandler: [requireAuth, requirePermission('whatsapp.view')] }, async (req, reply) => {
    const orgId = req.auth!.orgId;
    const chatId = (req.params as { id: string }).id;
    const chat = await one<{ id: string; remote_jid: string; nao_lidas: number }>(
      'SELECT id, remote_jid, nao_lidas FROM whatsapp_chats WHERE id = $1 AND org_id = $2', [chatId, orgId],
    );
    if (!chat) return reply.code(404).send({ error: 'conversa não encontrada' });
    const messages = await query<{ id: string; evolution_id: string | null; from_me: boolean }>(
      `SELECT id, evolution_id, from_me, tipo, corpo, status, momento, mime, file_name
         FROM whatsapp_messages
        WHERE chat_id = $1 AND org_id = $2
        ORDER BY momento
        LIMIT 500`,
      [chatId, orgId],
    );
    // Confirma leitura no WhatsApp só se havia não-lidas (evita chamada à toa).
    if (chat.nao_lidas > 0) {
      const reads = messages
        .filter((m) => !m.from_me && m.evolution_id)
        .slice(-30)
        .map((m) => ({ id: m.evolution_id as string, remoteJid: chat.remote_jid, fromMe: false }));
      evo.markRead(instanceName(orgId), reads).catch(() => undefined); // best-effort
    }
    await query('UPDATE whatsapp_chats SET nao_lidas = 0 WHERE id = $1 AND org_id = $2', [chatId, orgId]);
    return { messages };
  });

  // Marca conversa como lida sem refazer o fetch das mensagens. Usado quando uma
  // mensagem chega numa conversa já aberta (zera o contador no servidor pra não
  // reaparecer no próximo loadChats) e confirma leitura (ticks azuis) no WhatsApp.
  app.post('/api/whatsapp/chats/:id/read', { preHandler: [requireAuth, requirePermission('whatsapp.view')] }, async (req, reply) => {
    const orgId = req.auth!.orgId;
    const chatId = (req.params as { id: string }).id;
    const chat = await one<{ id: string; remote_jid: string; nao_lidas: number }>(
      'SELECT id, remote_jid, nao_lidas FROM whatsapp_chats WHERE id = $1 AND org_id = $2', [chatId, orgId],
    );
    if (!chat) return reply.code(404).send({ error: 'conversa não encontrada' });
    if (chat.nao_lidas > 0) {
      const reads = await query<{ evolution_id: string | null }>(
        `SELECT evolution_id FROM whatsapp_messages
          WHERE chat_id = $1 AND org_id = $2 AND from_me = false AND evolution_id IS NOT NULL
          ORDER BY momento DESC LIMIT 30`,
        [chatId, orgId],
      );
      const payload = reads.map((m) => ({ id: m.evolution_id as string, remoteJid: chat.remote_jid, fromMe: false }));
      if (payload.length) evo.markRead(instanceName(orgId), payload).catch(() => undefined); // best-effort
    }
    await query('UPDATE whatsapp_chats SET nao_lidas = 0 WHERE id = $1 AND org_id = $2', [chatId, orgId]);
    return { ok: true };
  });

  // Proxy de mídia: <img>/<audio>/<video>/<a> apontam pra cá (?token=JWT, já que
  // tag de mídia não manda header Authorization). Serve do disco (media_path) ou
  // do base64 legado; na 1ª vez baixa da Evolution e cacheia (disco se habilitado,
  // senão base64 na linha).
  // compress:false — binário já vai íntegro (comprimir mídia só queima CPU e
  // atrapalha o content-length do stream).
  app.get('/api/whatsapp/messages/:id/media', { compress: false }, async (req, reply) => {
    // Token pelo header Authorization (preferido — não vaza na URL/histórico/logs);
    // fallback pra ?token= por compat (fetch autenticado do client usa o header).
    const header = req.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7) : (req.query as { token?: string }).token;
    if (!token) return reply.code(401).send({ error: 'sem token' });
    let orgId: number;
    // authorizeToken: valida ativo/token_version/whatsapp.view (verifyToken cru
    // deixava usuário desativado/sem permissão baixar mídia da org por 7 dias).
    try { orgId = (await authorizeToken(token, 'whatsapp.view')).orgId; }
    catch (e) { return reply.code(e instanceof AuthError ? 403 : 401).send({ error: 'não autorizado' }); }
    const id = (req.params as { id: string }).id;
    const m = await one<{ evolution_id: string | null; from_me: boolean; tipo: string; mime: string | null; file_name: string | null; media_b64: string | null; media_path: string | null; remote_jid: string }>(
      `SELECT m.evolution_id, m.from_me, m.tipo, m.mime, m.file_name, m.media_b64, m.media_path, c.remote_jid
         FROM whatsapp_messages m JOIN whatsapp_chats c ON c.id = m.chat_id
        WHERE m.id = $1 AND m.org_id = $2`,
      [id, orgId],
    );
    if (!m || m.tipo === 'texto') return reply.code(404).send({ error: 'sem mídia' });

    // Mídia é imutável por mensagem: cache privado de 1 dia + ETag pelo id da
    // mensagem — revalidação vira 304 sem reler o arquivo. Headers só nas
    // respostas de mídia (304/200) pra não cachear resposta de erro.
    const etag = `"wa-media-${id}"`;
    const cacheHeaders = (): void => {
      reply.header('etag', etag);
      reply.header('cache-control', 'private, max-age=86400, immutable');
      // nosniff: impede o browser de reinterpretar o corpo como HTML/JS ignorando o
      // content-type que sanitizamos abaixo.
      reply.header('x-content-type-options', 'nosniff');
    };
    // Sanitiza o content-type: o mime vem do metadata do contato remoto (não
    // confiável). Servir cru + inline permitia XSS armazenado (mime text/html com
    // JS executa na origem do app, com o token na URL). Fora da allowlist →
    // octet-stream + attachment (download, nunca renderiza).
    const applyType = (rawMime: string | null): string => {
      const safe = safeMediaType(rawMime);
      const fname = m.file_name ? m.file_name.replace(/[\r\n"]/g, '') : null;
      const disp = safe.inline ? 'inline' : 'attachment';
      reply.header('content-disposition', fname ? `${disp}; filename="${fname}"` : disp);
      return safe.type;
    };
    if (req.headers['if-none-match'] === etag) {
      cacheHeaders();
      return reply.code(304).send();
    }

    let buf: Buffer | null = null;
    let mime = m.mime;
    // 1) disco (preferido): streama direto, sem carregar o arquivo inteiro em
    // memória. Arquivo sumido cai pro rebaixar abaixo.
    if (m.media_path) {
      try {
        const { stream, size } = await mediaStream(m.media_path);
        cacheHeaders();
        reply.header('content-length', size);
        return reply.type(applyType(mime)).send(stream);
      } catch { /* cai pros fallbacks */ }
    }
    // 2) base64 legado na linha.
    if (!buf && m.media_b64) buf = Buffer.from(m.media_b64, 'base64');
    // 3) 1ª vez: baixa da Evolution e persiste.
    if (!buf) {
      if (!m.evolution_id) return reply.code(404).send({ error: 'mídia indisponível' });
      try {
        const got = await evo.getMediaBase64(instanceName(orgId), { id: m.evolution_id, remoteJid: m.remote_jid, fromMe: m.from_me });
        mime = mime ?? got.mimetype ?? null;
        if (mediaEnabled()) {
          const rel = await saveMedia(orgId, id, got.base64, mime, m.file_name);
          await query('UPDATE whatsapp_messages SET media_path = $2, mime = COALESCE(mime,$3) WHERE id = $1', [id, rel, mime]);
        } else {
          await query('UPDATE whatsapp_messages SET media_b64 = $2, mime = COALESCE(mime,$3) WHERE id = $1', [id, got.base64, mime]);
        }
        buf = Buffer.from(got.base64, 'base64');
      } catch (e) {
        if (e instanceof evo.EvolutionDisabledError) return reply.code(503).send({ error: e.message });
        return reply.code(502).send({ error: 'falha ao baixar mídia' });
      }
    }
    cacheHeaders();
    return reply.type(applyType(mime)).send(buf);
  });

  // Envia texto numa conversa existente. Persiste a mensagem própria, atualiza a
  // prévia da conversa e empurra pro WebSocket (espelho nas outras abas).
  app.post('/api/whatsapp/chats/:id/send', {
    preHandler: [requireAuth, requirePermission('whatsapp.send')],
    schema: {
      body: { type: 'object', required: ['text'], properties: { text: { type: 'string', minLength: 1 } } },
    },
  }, async (req, reply) => {
    const orgId = req.auth!.orgId;
    const chatId = (req.params as { id: string }).id;
    const { text } = req.body as { text: string };
    const chat = await one<{ remote_jid: string; numero: string | null }>(
      'SELECT remote_jid, numero FROM whatsapp_chats WHERE id = $1 AND org_id = $2', [chatId, orgId],
    );
    if (!chat) return reply.code(404).send({ error: 'conversa não encontrada' });
    if (!chat.numero && chat.remote_jid.endsWith('@lid')) {
      return reply.code(422).send({ error: 'Contato sem número de telefone (LID — o WhatsApp ocultou o número). Concilie esta conversa com a de telefone do mesmo contato para poder enviar.' });
    }
    try {
      const sent = await evo.sendText(instanceName(orgId), chat.numero || chat.remote_jid, text);
      const evolutionId = sent.key?.id ?? null;
      const msg = await insertMessage(orgId, chatId, { evolutionId, fromMe: true, corpo: text, status: 'enviado' });
      await upsertChat(orgId, chat.remote_jid, { preview: text, incNaoLidas: false });
      if (msg) broadcast(orgId, 'message', { chat_id: Number(chatId), message: msg });
      return { message: msg };
    } catch (e) {
      if (e instanceof evo.EvolutionDisabledError) return reply.code(503).send({ error: e.message });
      return reply.code(502).send({ error: e instanceof Error ? e.message : 'falha ao enviar' });
    }
  });

  // Envia mídia (anexo): base64 vindo do upload do navegador. Cacheia o próprio
  // base64 na linha pra exibir de imediato sem rebaixar da Evolution.
  app.post('/api/whatsapp/chats/:id/send-media', {
    preHandler: [requireAuth, requirePermission('whatsapp.send')],
    // Anexo chega como base64 num JSON — o limite padrão de body (1MB) barraria
    // qualquer mídia real. 15MB cobre os anexos aceitos pelo front.
    bodyLimit: 15 * 1024 * 1024,
    schema: {
      body: {
        type: 'object',
        required: ['media', 'mediatype'],
        properties: {
          media: { type: 'string', minLength: 1 },          // base64 sem prefixo data:
          mediatype: { type: 'string', enum: ['image', 'video', 'document', 'audio'] },
          mimetype: { type: ['string', 'null'] },
          fileName: { type: ['string', 'null'] },
          caption: { type: ['string', 'null'] },
        },
      },
    },
  }, async (req, reply) => {
    const orgId = req.auth!.orgId;
    const chatId = (req.params as { id: string }).id;
    const b = req.body as { media: string; mediatype: 'image' | 'video' | 'document' | 'audio'; mimetype?: string | null; fileName?: string | null; caption?: string | null };
    const chat = await one<{ remote_jid: string; numero: string | null }>(
      'SELECT remote_jid, numero FROM whatsapp_chats WHERE id = $1 AND org_id = $2', [chatId, orgId],
    );
    if (!chat) return reply.code(404).send({ error: 'conversa não encontrada' });
    if (!chat.numero && chat.remote_jid.endsWith('@lid')) {
      return reply.code(422).send({ error: 'Contato sem número de telefone (LID). Concilie com a conversa de telefone do contato para poder enviar.' });
    }
    const dest = chat.numero || chat.remote_jid;
    const name = instanceName(orgId);
    try {
      const sent = b.mediatype === 'audio'
        ? await evo.sendAudio(name, dest, b.media)
        : await evo.sendMedia(name, dest, {
            mediatype: b.mediatype, media: b.media,
            mimetype: b.mimetype ?? undefined, fileName: b.fileName ?? undefined, caption: b.caption ?? undefined,
          });
      const tipo = b.mediatype === 'image' ? 'imagem' : b.mediatype === 'video' ? 'video' : b.mediatype === 'audio' ? 'audio' : 'documento';
      // Com disco habilitado grava o binário no volume; senão cacheia o base64 na
      // linha (pra exibir de imediato sem rebaixar da Evolution).
      const disk = mediaEnabled();
      const msg = await insertMessage(orgId, chatId, {
        evolutionId: sent.key?.id ?? null, fromMe: true, tipo, corpo: b.caption ?? null,
        status: 'enviado', mime: b.mimetype ?? null, fileName: b.fileName ?? null,
        mediaB64: disk ? null : b.media,
      });
      if (msg && disk) {
        const rel = await saveMedia(orgId, msg.id, b.media, b.mimetype ?? null, b.fileName ?? null);
        await query('UPDATE whatsapp_messages SET media_path = $2 WHERE id = $1', [msg.id, rel]);
      }
      await upsertChat(orgId, chat.remote_jid, { preview: b.caption || `[${tipo}]`, incNaoLidas: false });
      if (msg) broadcast(orgId, 'message', { chat_id: Number(chatId), message: msg });
      return { message: msg };
    } catch (e) {
      if (e instanceof evo.EvolutionDisabledError) return reply.code(503).send({ error: e.message });
      return reply.code(502).send({ error: e instanceof Error ? e.message : 'falha ao enviar mídia' });
    }
  });

  // Vincula (ou desvincula) a conversa a uma empresa da base. Resolve o
  // relationship do funil daquela empresa, se existir. Habilita "criar pedido".
  app.patch('/api/whatsapp/chats/:id/link', {
    preHandler: [requireAuth, requirePermission('whatsapp.link')],
    schema: { body: { type: 'object', properties: { company_id: { type: ['integer', 'null'] } } } },
  }, async (req, reply) => {
    const orgId = req.auth!.orgId;
    const chatId = (req.params as { id: string }).id;
    const { company_id } = req.body as { company_id?: number | null };
    const chat = await one<{ id: string }>('SELECT id FROM whatsapp_chats WHERE id = $1 AND org_id = $2', [chatId, orgId]);
    if (!chat) return reply.code(404).send({ error: 'conversa não encontrada' });
    let relId: string | null = null;
    if (company_id != null) { const r = await relationshipForCompany(orgId, company_id); relId = r?.id ?? null; }
    await query('UPDATE whatsapp_chats SET company_id = $3, relationship_id = $4 WHERE id = $1 AND org_id = $2',
      [chatId, orgId, company_id ?? null, relId]);
    await audit(req, 'whatsapp_chat', chatId, 'link', { company_id: company_id ?? null });
    const out = await one(`${CHAT_LABELS_SQL} WHERE ch.id = $1 AND ch.org_id = $2`, [chatId, orgId]);
    return { chat: out };
  });

  // Informa o telefone de um contato que chegou só como LID (número oculto).
  // Valida o número no WhatsApp, grava no contato e registra o jid de telefone
  // como alias da conversa — assim o envio passa a funcionar (sai pelo número).
  app.patch('/api/whatsapp/chats/:id/numero', {
    preHandler: [requireAuth, requirePermission('whatsapp.link')],
    schema: { body: { type: 'object', required: ['numero'], properties: { numero: { type: 'string', minLength: 8 } } } },
  }, async (req, reply) => {
    const orgId = req.auth!.orgId;
    const chatId = (req.params as { id: string }).id;
    const { numero } = req.body as { numero: string };
    const chat = await one<{ id: string }>('SELECT id FROM whatsapp_chats WHERE id = $1 AND org_id = $2', [chatId, orgId]);
    if (!chat) return reply.code(404).send({ error: 'conversa não encontrada' });
    const digits = normalizeNumero(numero);
    if (digits.length < 12) return reply.code(400).send({ error: 'número inválido (use DDD + número)' });
    let jid = `${digits}@s.whatsapp.net`;
    try {
      const res = await evo.whatsappNumbers(instanceName(orgId), [digits]);
      const hit = res.find((r) => r.exists);
      if (!hit) return reply.code(422).send({ error: 'número não encontrado no WhatsApp' });
      jid = hit.jid || jid;
    } catch (e) {
      if (e instanceof evo.EvolutionDisabledError) return reply.code(503).send({ error: e.message });
      return reply.code(502).send({ error: e instanceof Error ? e.message : 'falha ao validar número' });
    }
    await query('UPDATE whatsapp_chats SET numero = $3 WHERE id = $1 AND org_id = $2', [chatId, orgId, jidToNumero(jid)]);
    await query(
      `INSERT INTO whatsapp_chat_jids (org_id, jid, chat_id, tipo)
         VALUES ($1, $2, $3, 'phone') ON CONFLICT (org_id, jid) DO NOTHING`,
      [orgId, jid, chatId],
    );
    await audit(req, 'whatsapp_chat', chatId, 'set-numero', { numero: jidToNumero(jid) });
    const out = await one(`${CHAT_LABELS_SQL} WHERE ch.id = $1 AND ch.org_id = $2`, [chatId, orgId]);
    return { chat: out };
  });

  // Dados do grupo (painel de detalhes): descrição + participantes.
  app.get('/api/whatsapp/chats/:id/group', { preHandler: [requireAuth, requirePermission('whatsapp.view')] }, async (req, reply) => {
    const orgId = req.auth!.orgId;
    const id = (req.params as { id: string }).id;
    const chat = await one<{ remote_jid: string }>('SELECT remote_jid FROM whatsapp_chats WHERE id = $1 AND org_id = $2', [id, orgId]);
    if (!chat) return reply.code(404).send({ error: 'conversa não encontrada' });
    if (!chat.remote_jid.endsWith('@g.us')) return reply.code(400).send({ error: 'conversa não é um grupo' });
    try {
      const g = await evo.groupDetails(instanceName(orgId), chat.remote_jid);
      const participants = g.participants.map((p) => ({ numero: jidToNumero(p.id), jid: p.id, admin: p.admin }));
      return { subject: g.subject, desc: g.desc, size: g.size, participants };
    } catch (e) {
      if (e instanceof evo.EvolutionDisabledError) return reply.code(503).send({ error: e.message });
      return reply.code(502).send({ error: e instanceof Error ? e.message : 'falha ao buscar grupo' });
    }
  });

  // Concilia duas conversas do mesmo contato (telefone + @lid) numa só. `id` é a
  // conversa que permanece (primária); `other_id` é absorvida e removida.
  app.post('/api/whatsapp/chats/:id/merge', {
    preHandler: [requireAuth, requirePermission('whatsapp.link')],
    schema: { body: { type: 'object', required: ['other_id'], properties: { other_id: { type: 'integer' } } } },
  }, async (req, reply) => {
    const orgId = req.auth!.orgId;
    const id = (req.params as { id: string }).id;
    const { other_id } = req.body as { other_id: number };
    if (String(other_id) === String(id)) return reply.code(400).send({ error: 'selecione outra conversa' });
    try {
      await mergeChats(orgId, Number(id), Number(other_id));
    } catch (e) {
      return reply.code(400).send({ error: e instanceof Error ? e.message : 'falha ao conciliar' });
    }
    await audit(req, 'whatsapp_chat', id, 'merge', { other_id });
    broadcast(orgId, 'merged', { chat_id: Number(id), removed_id: Number(other_id) });
    const out = await one(`${CHAT_LABELS_SQL} WHERE ch.id = $1 AND ch.org_id = $2`, [id, orgId]);
    return { chat: out };
  });

  // Apaga a conversa (espelho local): mensagens, aliases e agendamentos somem
  // por ON DELETE CASCADE. Avisa as outras abas pelo WebSocket.
  app.delete('/api/whatsapp/chats/:id', { preHandler: [requireAuth, requirePermission('whatsapp.link')] }, async (req, reply) => {
    const orgId = req.auth!.orgId;
    const id = (req.params as { id: string }).id;
    const ok = await deleteChat(orgId, Number(id));
    if (!ok) return reply.code(404).send({ error: 'conversa não encontrada' });
    await audit(req, 'whatsapp_chat', id, 'delete', {});
    broadcast(orgId, 'chat-removed', { chat_id: Number(id) });
    return { ok: true };
  });

  // Abre/retoma uma conversa a partir de uma empresa do funil (ação no Kanban).
  // Cria o chat para o telefone informado e já vincula empresa + relationship.
  app.post('/api/whatsapp/chats/from-company', {
    preHandler: [requireAuth, requirePermission('whatsapp.send')],
    schema: {
      body: {
        type: 'object', required: ['company_id', 'numero'],
        properties: { company_id: { type: 'integer' }, numero: { type: 'string', minLength: 8 }, nome: { type: 'string' } },
      },
    },
  }, async (req, reply) => {
    const orgId = req.auth!.orgId;
    const { company_id, numero, nome: nomeBody } = req.body as { company_id: number; numero: string; nome?: string };
    const jid = numeroToJid(numero);
    if (jid.replace(/[^0-9]/g, '').length < 12) return reply.code(400).send({ error: 'número inválido' });
    const co = await one<{ razao_social: string; nome_fantasia: string | null }>(
      'SELECT razao_social, nome_fantasia FROM companies WHERE id = $1', [company_id],
    );
    // Nome explícito (ex.: conversa iniciada por um contato vinculado) tem prioridade
    // sobre o nome da empresa, pra a conversa exibir o contato e não a empresa.
    const nome = nomeBody?.trim() || (co ? (co.nome_fantasia || co.razao_social) : null);
    const chat = await upsertChat(orgId, jid, { nome, incNaoLidas: false });
    const rel = await relationshipForCompany(orgId, company_id);
    await query('UPDATE whatsapp_chats SET company_id = $3, relationship_id = $4 WHERE id = $1 AND org_id = $2',
      [chat.id, orgId, company_id, rel?.id ?? null]);
    const out = await one(`${CHAT_LABELS_SQL} WHERE ch.id = $1 AND ch.org_id = $2`, [chat.id, orgId]);
    return reply.code(201).send({ chat: out });
  });

  // Agenda uma mensagem de texto pra uma conversa (envio pelo processador).
  app.post('/api/whatsapp/chats/:id/schedule', {
    preHandler: [requireAuth, requirePermission('whatsapp.schedule')],
    schema: {
      body: {
        type: 'object', required: ['text', 'agendado_para'],
        properties: { text: { type: 'string', minLength: 1 }, agendado_para: { type: 'string', minLength: 10 } },
      },
    },
  }, async (req, reply) => {
    const orgId = req.auth!.orgId;
    const chatId = (req.params as { id: string }).id;
    const { text, agendado_para } = req.body as { text: string; agendado_para: string };
    const chat = await one<{ remote_jid: string; nome: string | null; numero: string | null; company_id: string | null }>(
      'SELECT remote_jid, nome, numero, company_id FROM whatsapp_chats WHERE id = $1 AND org_id = $2', [chatId, orgId]);
    if (!chat) return reply.code(404).send({ error: 'conversa não encontrada' });
    // Mesmo bloqueio do envio interativo: LID sem número não tem destinatário.
    if (!chat.numero && chat.remote_jid.endsWith('@lid')) {
      return reply.code(422).send({ error: 'Contato sem número de telefone (LID — o WhatsApp ocultou o número). Concilie esta conversa com a de telefone do mesmo contato para poder agendar.' });
    }
    const when = new Date(agendado_para);
    if (Number.isNaN(when.getTime())) return reply.code(400).send({ error: 'data inválida' });

    // Espelha na Agenda: compromisso 'whatsapp' + agendamento, numa transação só.
    const alvo = chat.nome || chat.numero || chat.remote_jid.split('@')[0];
    const titulo = `WhatsApp p/ ${alvo}: ${text.length > 60 ? `${text.slice(0, 60)}…` : text}`;
    const row = await withClient(async (c) => {
      await c.query('BEGIN');
      try {
        const act = (await c.query(
          `INSERT INTO activities (org_id, tipo, titulo, start_at, owner_user_id, company_id, status)
           VALUES ($1, 'whatsapp', $2, $3, $4, $5, 'pendente') RETURNING id`,
          [orgId, titulo, when.toISOString(), req.auth!.userId, chat.company_id],
        )).rows[0] as { id: string };
        const s = (await c.query(
          `INSERT INTO whatsapp_schedules (org_id, chat_id, remote_jid, corpo, agendado_para, owner_user_id, activity_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           RETURNING id, chat_id, corpo, agendado_para, status`,
          [orgId, chatId, chat.remote_jid, text, when.toISOString(), req.auth!.userId, act.id],
        )).rows[0];
        await c.query('COMMIT');
        return s;
      } catch (e) { await c.query('ROLLBACK'); throw e; }
    });
    return reply.code(201).send({ schedule: row });
  });

  // Agendamentos pendentes (opcionalmente de uma conversa).
  app.get('/api/whatsapp/schedules', {
    preHandler: [requireAuth, requirePermission('whatsapp.view')],
    schema: { querystring: { type: 'object', properties: { chat_id: { type: 'integer' } } } },
  }, async (req) => {
    const orgId = req.auth!.orgId;
    const { chat_id } = req.query as { chat_id?: number };
    // Inclui pendentes E os já processados (enviado/erro/expirado) p/ o modal
    // mostrar o histórico riscado; só esconde os cancelados.
    const where = ['org_id = $1', "status <> 'cancelado'"];
    const params: unknown[] = [orgId];
    if (chat_id != null) { params.push(chat_id); where.push(`chat_id = $${params.length}`); }
    const schedules = await query(
      `SELECT id, chat_id, corpo, agendado_para, status FROM whatsapp_schedules
        WHERE ${where.join(' AND ')} ORDER BY agendado_para LIMIT 200`,
      params,
    );
    return { schedules };
  });

  // Cancela um agendamento pendente.
  app.delete('/api/whatsapp/schedules/:id', { preHandler: [requireAuth, requirePermission('whatsapp.schedule')] }, async (req, reply) => {
    const orgId = req.auth!.orgId;
    const id = (req.params as { id: string }).id;
    const rows = await query<{ activity_id: string | null }>(
      `UPDATE whatsapp_schedules SET status = 'cancelado', updated_at = now()
        WHERE id = $1 AND org_id = $2 AND status = 'pendente' RETURNING activity_id`,
      [id, orgId],
    );
    if (rows.length === 0) return reply.code(404).send({ error: 'agendamento não encontrado' });
    // Cancelou o agendamento → remove o compromisso espelho da Agenda.
    if (rows[0]!.activity_id != null) {
      await query('DELETE FROM activities WHERE id = $1 AND org_id = $2', [rows[0]!.activity_id, orgId]);
    }
    return { ok: true };
  });
}
