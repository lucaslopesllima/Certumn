// Lógica de domínio do WhatsApp compartilhada entre a rota (envio pela UI) e o
// webhook (recebimento da Evolution): nome da instância, upsert de conversa e
// inserção de mensagem com dedup. SQL cru via db.ts, sempre filtrando org_id.
import { one, query, withClient } from './db.ts';
import * as evo from './evolution.ts';
import { broadcast } from './ws.ts';

// Instância por org. Determinística → o webhook reverte instance_name → org.
export function instanceName(orgId: number): string {
  return `org_${orgId}`;
}

// Garante a linha de settings da org e devolve o instance_name.
export async function ensureSettings(orgId: number): Promise<string> {
  const name = instanceName(orgId);
  await query(
    `INSERT INTO org_whatsapp_settings (org_id, instance_name)
     VALUES ($1, $2) ON CONFLICT (org_id) DO NOTHING`,
    [orgId, name],
  );
  return name;
}

export async function setStatus(orgId: number, status: string, numero?: string | null): Promise<void> {
  await query(
    `UPDATE org_whatsapp_settings
        SET status = $2, numero = COALESCE($3, numero), updated_at = now()
      WHERE org_id = $1`,
    [orgId, status, numero ?? null],
  );
}

// Atualiza a foto de perfil da conversa (best-effort, vinda do CDN do WhatsApp).
export async function updateFoto(orgId: number, jid: string, url: string | null): Promise<void> {
  await query(
    'UPDATE whatsapp_chats SET foto_url = $3 WHERE org_id = $1 AND remote_jid = $2', [orgId, jid, url],
  );
}

// Idem, mas casa pelo id da conversa — usado quando o jid veio de um alias
// (@lid conciliado) e pode não ser o remote_jid primário.
export async function updateFotoById(orgId: number, chatId: string, url: string | null): Promise<void> {
  await query(
    'UPDATE whatsapp_chats SET foto_url = $3 WHERE org_id = $1 AND id = $2', [orgId, chatId, url],
  );
}

// Define o nome da conversa (usado p/ o subject do grupo, que o webhook não traz).
export async function updateNome(orgId: number, chatId: string, nome: string): Promise<void> {
  await query('UPDATE whatsapp_chats SET nome = $3 WHERE org_id = $1 AND id = $2', [orgId, chatId, nome]);
}

// Sincroniza em massa o nome (subject) dos grupos existentes no espelho —
// conserta de uma vez os que pegaram nome de participante. Só ATUALIZA conversas
// já existentes (não cria). Devolve quantas linhas corrigiu.
export async function syncGroupNames(orgId: number): Promise<number> {
  const groups = await evo.fetchAllGroups(instanceName(orgId));
  let n = 0;
  for (const g of groups) {
    if (!g.id || !g.id.endsWith('@g.us') || !g.subject) continue;
    const r = await query(
      `UPDATE whatsapp_chats SET nome = $3, foto_url = COALESCE(foto_url, $4)
        WHERE org_id = $1 AND remote_jid = $2 RETURNING id`,
      [orgId, g.id, g.subject, g.pictureUrl ?? null],
    );
    if (r.length) n++;
  }
  return n;
}

export async function orgByInstance(name: string): Promise<number | null> {
  const r = await one<{ org_id: string }>(
    'SELECT org_id FROM org_whatsapp_settings WHERE instance_name = $1', [name],
  );
  return r ? Number(r.org_id) : null;
}

// '5511999999999@s.whatsapp.net' -> '5511999999999'. Grupos (@g.us) passam cru.
export function jidToNumero(jid: string): string {
  return jid.split('@')[0]?.replace(/[^0-9]/g, '') ?? '';
}

// Telefone da base (DDD+numero, às vezes com máscara) -> dígitos com DDI 55.
// Sem DDI (<=11 dígitos) assume Brasil. Já com 55 na frente, mantém.
export function normalizeNumero(raw: string): string {
  const d = raw.replace(/[^0-9]/g, '');
  if (!d) return '';
  if (d.length <= 11) return `55${d}`;
  return d;
}

export function numeroToJid(numero: string): string {
  return `${normalizeNumero(numero)}@s.whatsapp.net`;
}

// Relationship (funil) existente da org para a empresa, se houver.
export async function relationshipForCompany(orgId: number, companyId: number): Promise<{ id: string; represented_id: string | null } | null> {
  return one<{ id: string; represented_id: string | null }>(
    'SELECT id, represented_id FROM company_relationships WHERE org_id = $1 AND company_id = $2 ORDER BY id LIMIT 1',
    [orgId, companyId],
  );
}

// Conversa com rótulos do vínculo (empresa/funil/representada) p/ a UI.
export const CHAT_LABELS_SQL = `
  SELECT ch.id, ch.remote_jid, ch.numero, ch.lid, ch.nome, ch.foto_url, ch.last_message_at, ch.last_preview,
         ch.nao_lidas, ch.company_id, ch.relationship_id, ch.contact_id,
         co.razao_social AS company_nome, co.nome_fantasia AS company_fantasia,
         ct.nome AS contact_nome,
         r.represented_id, rc.nome AS represented_nome
    FROM whatsapp_chats ch
    LEFT JOIN companies co ON co.id = ch.company_id
    LEFT JOIN contacts ct ON ct.id = ch.contact_id AND ct.org_id = ch.org_id
    LEFT JOIN company_relationships r ON r.id = ch.relationship_id
    LEFT JOIN represented_companies rc ON rc.id = r.represented_id AND rc.org_id = ch.org_id`;

export interface ChatRow {
  id: string; remote_jid: string; numero: string | null; lid: string | null; nome: string | null;
  foto_url: string | null; last_message_at: string | null; last_preview: string | null;
  nao_lidas: number; company_id: string | null; relationship_id: string | null; contact_id: string | null;
}

const CHAT_COLS = `id, remote_jid, numero, lid, nome, foto_url, last_message_at, last_preview,
                   nao_lidas, company_id, relationship_id, contact_id`;

// Resolve jid -> chat_id pela tabela de aliases (suporta vários jids por contato,
// ex.: telefone + @lid depois de conciliar). null = jid ainda não conhecido.
export async function resolveChatId(orgId: number, jid: string): Promise<string | null> {
  const r = await one<{ chat_id: string }>(
    'SELECT chat_id FROM whatsapp_chat_jids WHERE org_id = $1 AND jid = $2', [orgId, jid],
  );
  return r?.chat_id ?? null;
}

// Aplica nome/preview/horário/não-lidas e devolve a conversa completa.
async function updateChatStats(
  orgId: number, chatId: string,
  opts: { nome?: string | null; preview?: string | null; momento?: string; incNaoLidas?: boolean },
): Promise<ChatRow> {
  const inc = opts.incNaoLidas ? 1 : 0;
  const reset = opts.incNaoLidas ? null : 0; // envio próprio zera não-lidas
  const row = await one<ChatRow>(
    `UPDATE whatsapp_chats SET
       nome = COALESCE($3, nome),
       last_message_at = GREATEST(last_message_at, COALESCE($4::timestamptz, now())),
       last_preview = COALESCE($5, last_preview),
       nao_lidas = COALESCE($6::int, nao_lidas + $7)
     WHERE id = $1 AND org_id = $2
     RETURNING ${CHAT_COLS}`,
    [chatId, orgId, opts.nome ?? null, opts.momento ?? null, opts.preview ?? null, reset, inc],
  );
  return row!;
}

// Registra um jid como alias da conversa e popula numero/lid se ainda faltarem
// (sem sobrescrever o que já houver). Idempotente.
async function registerJid(orgId: number, chatId: string, jid: string): Promise<void> {
  const isLid = jid.endsWith('@lid');
  const isGroup = jid.endsWith('@g.us');
  const tipo = isLid ? 'lid' : isGroup ? 'grupo' : 'phone';
  await query(
    `INSERT INTO whatsapp_chat_jids (org_id, jid, chat_id, tipo)
       VALUES ($1, $2, $3, $4) ON CONFLICT (org_id, jid) DO NOTHING`,
    [orgId, jid, chatId, tipo],
  );
  if (isLid) {
    await query('UPDATE whatsapp_chats SET lid = COALESCE(lid, $3) WHERE org_id = $1 AND id = $2', [orgId, chatId, jid]);
  } else if (!isGroup) {
    await query('UPDATE whatsapp_chats SET numero = COALESCE(numero, $3) WHERE org_id = $1 AND id = $2', [orgId, chatId, jidToNumero(jid)]);
  }
}

// Upsert da conversa resolvendo o jid pelos aliases. `altJid` é o OUTRO jid do
// mesmo contato (telefone <-> @lid) quando o WhatsApp entrega os dois no mesmo
// evento: garante uma única conversa pros dois. Se cada jid já caiu numa conversa
// distinta, concilia (merge) automaticamente — evita o par telefone/lid duplicado.
export async function upsertChat(
  orgId: number,
  jid: string,
  opts: { nome?: string | null; preview?: string | null; momento?: string; incNaoLidas?: boolean } = {},
  altJid?: string | null,
): Promise<ChatRow> {
  const alt = altJid && altJid !== jid ? altJid : null;
  let chatId = await resolveChatId(orgId, jid);
  const altChatId = alt ? await resolveChatId(orgId, alt) : null;

  if (chatId && altChatId && chatId !== altChatId) {
    // Mesmo contato em duas conversas separadas: concilia, mantendo a mais antiga
    // (menor id) como primária. Acontece só uma vez — depois os aliases convergem.
    const keep = Number(chatId) <= Number(altChatId) ? chatId : altChatId;
    const drop = keep === chatId ? altChatId : chatId;
    await mergeChats(orgId, Number(keep), Number(drop));
    chatId = keep;
    // Avisa as abas: a conversa `drop` foi absorvida pela `keep` (some da lista).
    broadcast(orgId, 'merged', { chat_id: Number(keep), removed_id: Number(drop) });
  } else if (chatId == null) {
    chatId = altChatId;
  }

  if (chatId == null) {
    // Cria. Prefere o jid de telefone como remote_jid primário (não oculta número).
    const phoneJid = [jid, alt].find((j) => j?.endsWith('@s.whatsapp.net')) ?? null;
    const lidJid = [jid, alt].find((j) => j?.endsWith('@lid')) ?? null;
    const primaryJid = phoneJid ?? jid;
    const created = await one<{ id: string }>(
      `INSERT INTO whatsapp_chats (org_id, remote_jid, numero, lid)
         VALUES ($1, $2, $3, $4)
       ON CONFLICT (org_id, remote_jid) DO UPDATE SET remote_jid = EXCLUDED.remote_jid
       RETURNING id`,
      [orgId, primaryJid, phoneJid ? jidToNumero(phoneJid) : null, lidJid],
    );
    chatId = created!.id;
  }

  await registerJid(orgId, chatId, jid);
  if (alt) await registerJid(orgId, chatId, alt);

  return updateChatStats(orgId, chatId, opts);
}

// Concilia duas conversas (ex.: telefone + @lid do mesmo contato): move
// mensagens/agendamentos/aliases da `other` pra `primary` e funde os metadados.
// Tudo numa transação; devolve a conversa primária resultante.
export async function mergeChats(orgId: number, primaryId: number, otherId: number): Promise<ChatRow> {
  return withClient(async (c) => {
    await c.query('BEGIN');
    try {
      const both = await c.query('SELECT id FROM whatsapp_chats WHERE org_id = $1 AND id = ANY($2::bigint[])',
        [orgId, [primaryId, otherId]]);
      if (both.rows.length !== 2) throw new Error('conversa inválida');
      await c.query('UPDATE whatsapp_messages SET chat_id = $1 WHERE chat_id = $2 AND org_id = $3', [primaryId, otherId, orgId]);
      await c.query('UPDATE whatsapp_schedules SET chat_id = $1 WHERE chat_id = $2 AND org_id = $3', [primaryId, otherId, orgId]);
      await c.query('UPDATE whatsapp_chat_jids SET chat_id = $1 WHERE chat_id = $2 AND org_id = $3', [primaryId, otherId, orgId]);
      await c.query(
        `UPDATE whatsapp_chats p SET
           numero = COALESCE(p.numero, o.numero),
           lid = COALESCE(p.lid, o.lid),
           nome = COALESCE(p.nome, o.nome),
           foto_url = COALESCE(p.foto_url, o.foto_url),
           company_id = COALESCE(p.company_id, o.company_id),
           relationship_id = COALESCE(p.relationship_id, o.relationship_id),
           last_message_at = GREATEST(p.last_message_at, o.last_message_at),
           last_preview = CASE WHEN COALESCE(o.last_message_at,'-infinity') > COALESCE(p.last_message_at,'-infinity')
                               THEN o.last_preview ELSE p.last_preview END,
           nao_lidas = p.nao_lidas + o.nao_lidas
         FROM whatsapp_chats o
         WHERE p.id = $1 AND o.id = $2 AND p.org_id = $3`,
        [primaryId, otherId, orgId],
      );
      await c.query('DELETE FROM whatsapp_chats WHERE id = $1 AND org_id = $2', [otherId, orgId]);
      const out = await c.query(`SELECT ${CHAT_COLS} FROM whatsapp_chats WHERE id = $1 AND org_id = $2`, [primaryId, orgId]);
      await c.query('COMMIT');
      return out.rows[0] as ChatRow;
    } catch (e) {
      await c.query('ROLLBACK');
      throw e;
    }
  });
}

// Apaga a conversa (e, por ON DELETE CASCADE, mensagens/aliases/agendamentos).
// Devolve true se removeu; false se a conversa não existia na org.
export async function deleteChat(orgId: number, chatId: number): Promise<boolean> {
  const rows = await query<{ id: string }>(
    'DELETE FROM whatsapp_chats WHERE id = $1 AND org_id = $2 RETURNING id', [chatId, orgId],
  );
  return rows.length > 0;
}

export interface MessageRow {
  id: string; chat_id: string; evolution_id: string | null; from_me: boolean;
  tipo: string; corpo: string | null; status: string | null; momento: string;
  mime: string | null; file_name: string | null;
}

// Insere a mensagem; ON CONFLICT no índice de dedup evita duplicar reentrega de
// webhook. Devolve a linha inserida, ou null se já existia (não reprocessar).
export async function insertMessage(
  orgId: number,
  chatId: string,
  m: {
    evolutionId?: string | null; fromMe: boolean; tipo?: string; corpo?: string | null;
    status?: string | null; momento?: string; mime?: string | null; fileName?: string | null;
    mediaB64?: string | null; mediaPath?: string | null;
  },
): Promise<MessageRow | null> {
  // Sem evolution_id (ex.: envio otimista) não há como deduplicar — insere direto.
  if (m.evolutionId) {
    const dup = await one<{ id: string }>(
      'SELECT id FROM whatsapp_messages WHERE org_id = $1 AND evolution_id = $2', [orgId, m.evolutionId],
    );
    if (dup) return null;
  }
  return one<MessageRow>(
    `INSERT INTO whatsapp_messages
       (org_id, chat_id, evolution_id, from_me, tipo, corpo, status, momento, mime, file_name, media_b64, media_path)
     VALUES ($1, $2, $3, $4, COALESCE($5,'texto'), $6, $7, COALESCE($8::timestamptz, now()), $9, $10, $11, $12)
     RETURNING id, chat_id, evolution_id, from_me, tipo, corpo, status, momento, mime, file_name`,
    [orgId, chatId, m.evolutionId ?? null, m.fromMe, m.tipo ?? null, m.corpo ?? null,
      m.status ?? null, m.momento ?? null, m.mime ?? null, m.fileName ?? null, m.mediaB64 ?? null, m.mediaPath ?? null],
  );
}
