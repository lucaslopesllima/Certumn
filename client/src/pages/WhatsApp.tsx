import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  MainContainer, Sidebar, Search, ConversationList, Conversation, Avatar,
  ChatContainer, ConversationHeader, MessageList, Message, MessageSeparator,
  TypingIndicator, MessageInput,
} from '@chatscope/chat-ui-kit-react';
import '@chatscope/chat-ui-kit-styles/dist/default/styles.min.css';
import './whatsapp-theme.css';
import { useSearchParams } from 'react-router-dom';
import { api, getToken, ApiError } from '../lib/api.ts';
import { toast } from '../lib/toast.tsx';
import { Btn, Card, Spinner, cn } from '../lib/ui.tsx';
import { Icon } from '../lib/icons.tsx';
import { maskPhone } from '../lib/format.ts';
import { CompanySearch } from '../lib/companySearch.tsx';
import { OrderModal } from '../lib/orderModal.tsx';
import type { Contact, CompanyHit, WaChat, WaMessage, WaSchedule, WaStatus } from '../lib/types.ts';

// base64 do QR pode vir cru ou já como data URL — normaliza p/ <img src>.
function qrSrc(b64: string): string {
  return b64.startsWith('data:') ? b64 : `data:image/png;base64,${b64}`;
}

function hora(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

// Separador de data estilo WhatsApp: Hoje / Ontem / dd/mm/aaaa.
function dayLabel(iso: string): string {
  const d = new Date(iso); const now = new Date();
  const same = (a: Date, b: Date): boolean => a.toDateString() === b.toDateString();
  if (same(d, now)) return 'Hoje';
  const y = new Date(now); y.setDate(now.getDate() - 1);
  if (same(d, y)) return 'Ontem';
  return d.toLocaleDateString('pt-BR');
}

function nomeChat(c: WaChat): string {
  if (c.nome) return c.nome;
  if (c.remote_jid.endsWith('@g.us')) return 'Grupo';
  return c.numero ? maskPhone(c.numero) : c.remote_jid.split('@')[0];
}

// Identificadores do contato: telefone e/ou LID (após conciliar, os dois).
function chatIdent(c: WaChat): string {
  const parts: string[] = [];
  if (c.numero) parts.push(maskPhone(c.numero));
  if (c.lid) parts.push('LID');
  return parts.join(' · ') || c.remote_jid.split('@')[0];
}

// Avatar: foto do WhatsApp quando houver; senão um SVG com a inicial (evita
// imagem quebrada que o componente Avatar mostraria sem src).
function avatarSrc(c: WaChat): string {
  if (c.foto_url) return c.foto_url;
  const ch = (nomeChat(c).trim()[0] ?? '?').toUpperCase();
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='80' height='80'><rect width='100%' height='100%' fill='#25D366'/><text x='50%' y='52%' dy='.35em' text-anchor='middle' font-size='38' fill='white' font-family='sans-serif'>${ch}</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

// URL do proxy de mídia (token na query — tag de mídia não manda header).
function mediaUrl(m: WaMessage): string {
  return `/api/whatsapp/messages/${m.id}/media?token=${encodeURIComponent(getToken() ?? '')}`;
}

function detectType(mime: string): 'image' | 'video' | 'audio' | 'document' {
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  return 'document';
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).split(',')[1] ?? '');
    r.onerror = () => rej(new Error('falha ao ler arquivo'));
    r.readAsDataURL(file);
  });
}

// Painel de conexão: mostra QR e faz polling do estado até conectar.
function ConnectPanel({ onConnected }: { onConnected: () => void }): React.JSX.Element {
  const [qr, setQr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const start = async (): Promise<void> => {
    setBusy(true);
    try {
      const r = await api.post<{ qr: string | null; status: WaStatus }>('/api/whatsapp/connect');
      setQr(r.qr);
      if (r.status === 'conectado') { onConnected(); return; }
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Falha ao conectar');
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (!qr) return;
    const t = setInterval(() => {
      void api.get<{ status: WaStatus }>('/api/whatsapp/connection')
        .then((r) => { if (r.status === 'conectado') { clearInterval(t); onConnected(); } })
        .catch(() => undefined);
    }, 3000);
    return () => clearInterval(t);
  }, [qr, onConnected]);

  return (
    <div className="grid h-full place-items-center p-6">
      <Card className="flex max-w-sm flex-col items-center gap-4 p-8 text-center">
        <span className="grid h-12 w-12 place-items-center rounded-2xl bg-emerald-50 text-emerald-600">
          <Icon name="phone" size={24} />
        </span>
        <div>
          <h2 className="text-base font-semibold text-ink-800">Conectar WhatsApp</h2>
          <p className="mt-1 text-sm text-ink-500">
            Abra o WhatsApp no celular → <b>Aparelhos conectados</b> → <b>Conectar</b> e leia o QR.
          </p>
        </div>
        {qr ? (
          <img src={qrSrc(qr)} alt="QR Code" className="h-56 w-56 rounded-xl border border-ink-200" />
        ) : (
          <Btn onClick={() => void start()} disabled={busy} icon="phone">
            {busy ? 'Gerando QR…' : 'Gerar QR Code'}
          </Btn>
        )}
        {qr && <p className="text-xs text-ink-400">Aguardando leitura…</p>}
      </Card>
    </div>
  );
}

// Tique de status (saída): ✓ enviado, ✓✓ entregue, ✓✓ azul lido.
function Tick({ m }: { m: WaMessage }): React.JSX.Element | null {
  if (!m.from_me) return null;
  const two = m.status === 'entregue' || m.status === 'lido';
  return <span style={{ color: m.status === 'lido' ? '#53bdeb' : undefined }}>{two ? '✓✓' : '✓'}</span>;
}

const inputCls = 'w-full rounded-xl border border-ink-200 bg-white px-3 py-2.5 text-sm text-ink-800 outline-none transition focus:border-brand-400 focus:ring-2 focus:ring-brand-200';

// Shell de modal (mesmo padrão de sampleModal): overlay + card centralizado.
function Overlay({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }): React.JSX.Element {
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-ink-900/40 p-4" onClick={onClose}>
      <div className="flex max-h-[90vh] w-full max-w-md flex-col rounded-2xl border border-ink-200 bg-white shadow-pop" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 border-b border-ink-100 p-4">
          <h2 className="text-base font-semibold text-ink-800">{title}</h2>
          <button onClick={onClose} className="rounded-lg p-1 text-ink-400 hover:bg-ink-100"><Icon name="x" size={18} /></button>
        </div>
        <div className="space-y-3 overflow-auto p-4">{children}</div>
      </div>
    </div>
  );
}

// Visualizador de imagem em tela cheia (estilo WhatsApp Web): fundo escuro,
// fecha no clique fora / botão / Esc, com atalho pra abrir o original.
function ImageLightbox({ url, onClose }: { url: string | null; onClose: () => void }): React.JSX.Element | null {
  useEffect(() => {
    if (!url) return;
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [url, onClose]);
  if (!url) return null;
  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/80 p-4" onClick={onClose}>
      <a href={url} target="_blank" rel="noreferrer" title="Abrir original" onClick={(e) => e.stopPropagation()}
        className="absolute right-16 top-4 grid h-10 w-10 place-items-center rounded-full text-white/80 transition hover:bg-white/10">
        <Icon name="download" size={20} />
      </a>
      <button onClick={onClose} aria-label="Fechar" className="absolute right-4 top-4 grid h-10 w-10 place-items-center rounded-full text-white/80 transition hover:bg-white/10">
        <Icon name="x" size={22} />
      </button>
      <img src={url} alt="" className="max-h-[90vh] max-w-[90vw] rounded-lg object-contain" onClick={(e) => e.stopPropagation()} />
    </div>
  );
}

// Vincula a conversa a uma empresa da base (habilita "criar pedido" + funil).
function LinkModal({ chatId, current, onClose, onLinked }: { chatId: number; current: WaChat; onClose: () => void; onLinked: (c: WaChat) => void }): React.JSX.Element {
  const link = async (companyId: number | null): Promise<void> => {
    try {
      const r = await api.patch<{ chat: WaChat }>(`/api/whatsapp/chats/${chatId}/link`, { company_id: companyId });
      onLinked(r.chat);
      toast.success(companyId ? 'Conversa vinculada.' : 'Vínculo removido.');
      onClose();
    } catch (e) { toast.error(e instanceof ApiError ? e.message : 'Falha ao vincular'); }
  };
  return (
    <Overlay title="Vincular a uma empresa" onClose={onClose}>
      <p className="text-sm text-ink-500">Vincule a conversa a uma empresa da base para criar pedidos e ver o cliente no funil.</p>
      <CompanySearch onPick={(c: CompanyHit) => void link(c.id)} />
      {current.company_id != null && (
        <div className="flex items-center justify-between gap-2 rounded-xl border border-ink-200 px-3 py-2">
          <span className="min-w-0 truncate text-sm text-ink-700">{current.company_fantasia || current.company_nome}</span>
          <button onClick={() => void link(null)} className="shrink-0 text-xs font-semibold text-rose-600 hover:underline">Remover</button>
        </div>
      )}
    </Overlay>
  );
}

// Agenda mensagens de texto + lista/cancela pendentes da conversa.
function ScheduleModal({ chat, onClose }: { chat: WaChat; onClose: () => void }): React.JSX.Element {
  const [text, setText] = useState('');
  const [when, setWhen] = useState('');
  const [list, setList] = useState<WaSchedule[]>([]);
  const load = (): void => {
    void api.get<{ schedules: WaSchedule[] }>(`/api/whatsapp/schedules?chat_id=${chat.id}`)
      .then((r) => setList(r.schedules)).catch(() => undefined);
  };
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);
  const create = async (): Promise<void> => {
    const t = text.trim();
    if (!t || !when) { toast.error('Preencha mensagem e data.'); return; }
    const d = new Date(when);
    if (Number.isNaN(d.getTime()) || d.getTime() < Date.now()) { toast.error('Escolha uma data futura.'); return; }
    try {
      await api.post(`/api/whatsapp/chats/${chat.id}/schedule`, { text: t, agendado_para: d.toISOString() });
      toast.success('Mensagem agendada.'); setText(''); setWhen(''); load();
    } catch (e) { toast.error(e instanceof ApiError ? e.message : 'Falha ao agendar'); }
  };
  const cancel = async (id: number): Promise<void> => {
    try { await api.del(`/api/whatsapp/schedules/${id}`); load(); } catch { toast.error('Falha ao cancelar'); }
  };
  return (
    <Overlay title="Agendar mensagem" onClose={onClose}>
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} placeholder="Mensagem…" className={inputCls} />
      <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} className={inputCls} />
      <Btn onClick={() => void create()} icon="clock">Agendar</Btn>
      {list.length > 0 && (
        <div className="border-t border-ink-100 pt-3">
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-ink-400">Agendadas</p>
          <div className="max-h-52 space-y-1.5 overflow-y-auto pr-1">
          {list.map((s) => {
            // Passou do horário (ou já processada) → riscada e inativa; só pendente
            // futura pode ser cancelada.
            const passou = new Date(s.agendado_para).getTime() <= Date.now();
            const ativa = s.status === 'pendente' && !passou;
            const rotulo = s.status === 'enviado' ? 'enviada' : s.status === 'erro' ? 'falhou' : passou ? 'expirada' : null;
            return (
              <div key={s.id} className={cn('flex items-center justify-between gap-2 rounded-lg px-3 py-2',
                ativa ? 'bg-ink-50' : 'bg-ink-50/60 opacity-60')}>
                <div className="min-w-0">
                  <p className={cn('truncate text-sm', ativa ? 'text-ink-700' : 'text-ink-500 line-through')}>{s.corpo}</p>
                  <p className="text-[11px] text-ink-400">
                    {new Date(s.agendado_para).toLocaleString('pt-BR')}{rotulo ? ` · ${rotulo}` : ''}
                  </p>
                </div>
                {ativa && (
                  <button onClick={() => void cancel(s.id)} className="shrink-0 text-xs font-semibold text-rose-600 hover:underline">Cancelar</button>
                )}
              </div>
            );
          })}
          </div>
        </div>
      )}
    </Overlay>
  );
}

// Concilia a conversa atual (primária) com outra do mesmo contato (telefone+LID).
function MergeModal({ current, chats, onClose, onMerged }: { current: WaChat; chats: WaChat[]; onClose: () => void; onMerged: () => void }): React.JSX.Element {
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const opts = useMemo(() => {
    const s = q.trim().toLowerCase();
    return chats.filter((c) => c.id !== current.id)
      .filter((c) => !s || nomeChat(c).toLowerCase().includes(s) || (c.numero ?? '').includes(s) || (c.lid ?? '').includes(s));
  }, [chats, current, q]);
  const merge = async (other: WaChat): Promise<void> => {
    if (!confirm(`Conciliar "${nomeChat(other)}" em "${nomeChat(current)}"? As mensagens serão unificadas e a outra conversa removida.`)) return;
    setBusy(true);
    try {
      await api.post(`/api/whatsapp/chats/${current.id}/merge`, { other_id: other.id });
      toast.success('Conversas conciliadas.');
      onMerged(); onClose();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Falha ao conciliar');
    } finally { setBusy(false); }
  };
  return (
    <Overlay title="Conciliar conversas" onClose={onClose}>
      <p className="text-sm text-ink-500">
        Una a conversa de telefone com a de <b>@lid</b> do mesmo contato. <b>{nomeChat(current)}</b> permanece e absorve a escolhida.
      </p>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar conversa…" className={inputCls} />
      <div className="max-h-72 space-y-1 overflow-auto">
        {opts.length === 0 ? (
          <p className="py-4 text-center text-sm text-ink-400">Nenhuma outra conversa.</p>
        ) : opts.map((c) => (
          <button key={c.id} disabled={busy} onClick={() => void merge(c)}
            className="flex w-full items-center justify-between gap-2 rounded-lg border border-ink-100 px-3 py-2 text-left transition hover:bg-ink-50 disabled:opacity-50">
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium text-ink-800">{nomeChat(c)}</span>
              <span className="block truncate text-[11px] text-ink-400">{chatIdent(c)}</span>
            </span>
            <Icon name="arrowRight" size={15} className="shrink-0 text-ink-400" />
          </button>
        ))}
      </div>
    </Overlay>
  );
}

// Nova conversa: procura um contato/empresa cadastrado no sistema (base) e abre
// a conversa pelo telefone cadastrado (from-company já cria/vincula o chat).
function NewChatModal({ onClose, onOpened }: { onClose: () => void; onOpened: (chatId: number) => void }): React.JSX.Element {
  const [busy, setBusy] = useState(false);
  const start = async (c: CompanyHit): Promise<void> => {
    const numero = c.telefone1 || c.telefone2;
    if (!numero) { toast.error('Contato sem telefone cadastrado.'); return; }
    setBusy(true);
    try {
      const r = await api.post<{ chat: { id: number } }>('/api/whatsapp/chats/from-company', { company_id: c.id, numero });
      onOpened(r.chat.id);
      onClose();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Falha ao abrir conversa');
    } finally { setBusy(false); }
  };
  return (
    <Overlay title="Nova conversa" onClose={onClose}>
      <p className="text-sm text-ink-500">Procure um contato cadastrado no sistema (CNPJ ou nome) para iniciar a conversa pelo telefone cadastrado.</p>
      <div className={busy ? 'pointer-events-none opacity-50' : ''}>
        <CompanySearch onPick={(c: CompanyHit) => void start(c)} placeholder="Buscar contato por CNPJ ou nome…" />
      </div>
    </Overlay>
  );
}

// Informa/confirma o telefone de um contato que chegou só como LID (número
// oculto). Valida no WhatsApp e grava o número — habilita o envio.
function NumberModal({ chatId, onClose, onSet }: { chatId: number; onClose: () => void; onSet: (c: WaChat) => void }): React.JSX.Element {
  const [numero, setNumero] = useState('');
  const [busy, setBusy] = useState(false);
  const confirm = async (): Promise<void> => {
    const n = numero.replace(/\D/g, '');
    if (n.length < 10) { toast.error('Informe o número com DDD.'); return; }
    setBusy(true);
    try {
      const r = await api.patch<{ chat: WaChat }>(`/api/whatsapp/chats/${chatId}/numero`, { numero: n });
      onSet(r.chat);
      toast.success('Número confirmado.');
      onClose();
    } catch (e) { toast.error(e instanceof ApiError ? e.message : 'Falha ao confirmar número'); }
    finally { setBusy(false); }
  };
  return (
    <Overlay title="Informar número do contato" onClose={onClose}>
      <p className="text-sm text-ink-500">
        Este contato chegou como <b>LID</b> (número oculto pelo WhatsApp). Informe o telefone com DDD
        para confirmar o destinatário e habilitar o envio.
      </p>
      <input value={numero} onChange={(e) => setNumero(maskPhone(e.target.value))} inputMode="numeric"
        placeholder="(11) 98765-4321" className={inputCls} autoFocus />
      <Btn onClick={() => void confirm()} disabled={busy} icon="check">{busy ? 'Confirmando…' : 'Confirmar número'}</Btn>
    </Overlay>
  );
}

// Cria/edita um contato vinculado à empresa da conversa. Novo contato já vem com
// o telefone do WhatsApp pré-preenchido (relaciona o contato ao número do chat).
function ContactFormModal({ companyId, contact, defaultPhone, onClose, onSaved, onDeleted }: {
  companyId: number; contact: Contact | null; defaultPhone?: string | null;
  onClose: () => void; onSaved: (c: Contact) => void; onDeleted: (id: number) => void;
}): React.JSX.Element {
  const [nome, setNome] = useState(contact?.nome ?? '');
  const [cargo, setCargo] = useState(contact?.cargo ?? '');
  const [telefone, setTelefone] = useState(contact?.telefone ?? (defaultPhone ? maskPhone(defaultPhone) : ''));
  const [email, setEmail] = useState(contact?.email ?? '');
  const [busy, setBusy] = useState(false);

  const save = async (): Promise<void> => {
    const n = nome.trim();
    if (!n) { toast.error('Informe o nome.'); return; }
    setBusy(true);
    try {
      const body = {
        nome: n, cargo: cargo.trim() || null, telefone: telefone.trim() || null,
        email: email.trim() || null, company_id: companyId,
      };
      const r = contact
        ? await api.patch<{ contact: Contact }>(`/api/contacts/${contact.id}`, body)
        : await api.post<{ contact: Contact }>('/api/contacts', body);
      toast.success(contact ? 'Contato atualizado.' : 'Contato criado.');
      onSaved(r.contact);
      onClose();
    } catch (e) { toast.error(e instanceof ApiError ? e.message : 'Falha ao salvar contato'); }
    finally { setBusy(false); }
  };

  const remove = async (): Promise<void> => {
    if (!contact || !confirm(`Excluir o contato "${contact.nome}"?`)) return;
    setBusy(true);
    try {
      await api.del(`/api/contacts/${contact.id}`);
      toast.success('Contato excluído.');
      onDeleted(contact.id);
      onClose();
    } catch (e) { toast.error(e instanceof ApiError ? e.message : 'Falha ao excluir'); }
    finally { setBusy(false); }
  };

  return (
    <Overlay title={contact ? 'Editar contato' : 'Novo contato'} onClose={onClose}>
      <input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Nome *" className={inputCls} autoFocus />
      <input value={cargo} onChange={(e) => setCargo(e.target.value)} placeholder="Cargo" className={inputCls} />
      <input value={telefone} onChange={(e) => setTelefone(maskPhone(e.target.value))} inputMode="tel" placeholder="Telefone" className={inputCls} />
      <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" placeholder="E-mail" className={inputCls} />
      <div className="flex items-center justify-between gap-2">
        {contact ? (
          <button onClick={() => void remove()} disabled={busy} className="text-xs font-semibold text-rose-600 hover:underline disabled:opacity-50">Excluir</button>
        ) : <span />}
        <Btn onClick={() => void save()} disabled={busy} icon="check">{busy ? 'Salvando…' : 'Salvar'}</Btn>
      </div>
    </Overlay>
  );
}

interface GroupParticipant { numero: string; jid: string; admin: string | null }
interface GroupData { subject: string | null; desc: string | null; size: number | null; participants: GroupParticipant[] }

// Painel lateral de dados do contato/grupo (estilo WhatsApp Web): avatar grande,
// identificadores, empresa vinculada, mídia compartilhada e — em grupo —
// descrição + participantes.
function ContactDetails({ chat, messages, onClose, onLink, onOrder, onNumber }: {
  chat: WaChat; messages: WaMessage[]; onClose: () => void;
  onLink: () => void; onOrder: () => void; onNumber: () => void;
}): React.JSX.Element {
  const isGroup = chat.remote_jid.endsWith('@g.us');
  const [group, setGroup] = useState<GroupData | null>(null);
  useEffect(() => {
    if (!isGroup) return;
    void api.get<GroupData>(`/api/whatsapp/chats/${chat.id}/group`).then(setGroup).catch(() => undefined);
  }, [chat.id, isGroup]);

  const [lightbox, setLightbox] = useState<string | null>(null);
  // Contatos da empresa vinculada (cria/edita aqui mesmo). Só carrega quando há empresa.
  const [contatos, setContatos] = useState<Contact[]>([]);
  const [contactModal, setContactModal] = useState<{ contact: Contact | null } | null>(null);
  useEffect(() => {
    if (isGroup || chat.company_id == null) { setContatos([]); return; }
    void api.get<{ contacts: Contact[] }>(`/api/contacts?company_id=${chat.company_id}`)
      .then((r) => setContatos(r.contacts)).catch(() => undefined);
  }, [chat.company_id, isGroup]);

  const media = useMemo(() => messages.filter((m) => m.tipo === 'imagem' || m.tipo === 'video'), [messages]);
  const needsNumber = !chat.numero && chat.remote_jid.endsWith('@lid');

  return (
   <>
    <aside className="absolute inset-y-0 right-0 z-30 flex w-full max-w-sm flex-col border-l border-ink-200 bg-white shadow-pop animate-[toastIn_.18s_ease-out]">
      <div className="flex items-center gap-3 bg-[#f0f2f5] px-4 py-3">
        <button onClick={onClose} aria-label="Fechar" className="grid h-8 w-8 place-items-center rounded-full text-[#54656f] hover:bg-black/5">
          <Icon name="x" size={18} />
        </button>
        <span className="text-base font-semibold text-[#111b21]">{isGroup ? 'Dados do grupo' : 'Dados do contato'}</span>
      </div>

      <div className="min-h-0 flex-1 space-y-2 overflow-auto bg-[#f0f2f5] pb-6">
        {/* Identidade */}
        <div className="flex flex-col items-center gap-2 bg-white px-6 py-6">
          <img src={avatarSrc(chat)} alt="" className="h-32 w-32 rounded-full object-cover" />
          <h2 className="text-xl font-semibold text-ink-900">{nomeChat(chat)}</h2>
          <p className="text-sm text-ink-500">{isGroup ? (group?.size ? `${group.size} participantes` : 'Grupo') : chatIdent(chat)}</p>
          {needsNumber && (
            <button onClick={onNumber} className="mt-1 rounded-lg bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-700 hover:bg-amber-100">
              Informar número
            </button>
          )}
        </div>

        {isGroup && group?.desc && (
          <div className="bg-white px-6 py-4">
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-400">Descrição</p>
            <p className="whitespace-pre-wrap text-sm text-ink-700">{group.desc}</p>
          </div>
        )}

        {/* Empresa (domínio Prospecta) */}
        {!isGroup && (
          <div className="bg-white px-6 py-4">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-400">Empresa</p>
            {chat.company_id != null ? (
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-sm text-ink-800">
                  <Icon name="building" size={16} className="text-ink-400" />
                  <span className="truncate">{chat.company_fantasia || chat.company_nome}</span>
                </div>
                <div className="flex gap-2">
                  <Btn size="sm" icon="plus" onClick={onOrder}>Criar pedido</Btn>
                  <Btn size="sm" variant="soft" icon="pencil" onClick={onLink}>Trocar</Btn>
                </div>
              </div>
            ) : (
              <Btn size="sm" variant="soft" icon="building" onClick={onLink}>Vincular empresa</Btn>
            )}
          </div>
        )}

        {/* Contatos da empresa (cria/edita) — exige empresa vinculada */}
        {!isGroup && chat.company_id != null && (
          <div className="bg-white px-6 py-4">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-wide text-ink-400">Contatos</p>
              <button onClick={() => setContactModal({ contact: null })}
                className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-600 hover:underline">
                <Icon name="plus" size={13} /> Novo
              </button>
            </div>
            {contatos.length === 0 ? (
              <p className="text-sm text-ink-400">Nenhum contato.</p>
            ) : (
              <div className="space-y-1.5">
                {contatos.map((ct) => (
                  <button key={ct.id} onClick={() => setContactModal({ contact: ct })}
                    className="flex w-full items-center justify-between gap-2 rounded-lg border border-ink-100 px-3 py-2 text-left transition hover:bg-ink-50">
                    <span className="min-w-0">
                      <span className="block truncate text-sm text-ink-700">{ct.nome}{ct.cargo ? ` · ${ct.cargo}` : ''}</span>
                      {(ct.telefone || ct.email) && (
                        <span className="block truncate text-[11px] text-ink-400">
                          {[ct.telefone && maskPhone(ct.telefone), ct.email].filter(Boolean).join(' · ')}
                        </span>
                      )}
                    </span>
                    <Icon name="pencil" size={14} className="shrink-0 text-ink-400" />
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Mídia compartilhada */}
        <div className="bg-white px-6 py-4">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-400">Mídia, links e docs</p>
          {media.length === 0 ? (
            <p className="text-sm text-ink-400">Nenhuma mídia.</p>
          ) : (
            <div className="grid grid-cols-3 gap-1.5">
              {media.slice(-18).reverse().map((m) => {
                const url = mediaUrl(m);
                return (
                  <button key={m.id} onClick={() => (m.tipo === 'imagem' ? setLightbox(url) : window.open(url, '_blank'))}
                    className="relative aspect-square overflow-hidden rounded-lg bg-ink-100">
                    {m.tipo === 'imagem'
                      ? <img src={url} alt="" className="h-full w-full object-cover" />
                      : <span className="grid h-full w-full place-items-center text-ink-400"><Icon name="eye" size={20} /></span>}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Participantes do grupo */}
        {isGroup && (
          <div className="bg-white px-6 py-4">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-400">
              Participantes{group ? ` (${group.participants.length})` : ''}
            </p>
            {!group ? (
              <p className="text-sm text-ink-400">Carregando…</p>
            ) : (
              <div className="space-y-1.5">
                {group.participants.map((p) => (
                  <div key={p.jid} className="flex items-center justify-between gap-2 text-sm">
                    <span className="truncate text-ink-700">{p.numero ? maskPhone(p.numero) : p.jid.split('@')[0]}</span>
                    {p.admin && <span className="shrink-0 rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-600">{p.admin === 'superadmin' ? 'dono' : 'admin'}</span>}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </aside>
    {contactModal && chat.company_id != null && (
      <ContactFormModal companyId={chat.company_id} contact={contactModal.contact} defaultPhone={chat.numero}
        onClose={() => setContactModal(null)}
        onSaved={(c) => setContatos((xs) => (xs.some((x) => x.id === c.id) ? xs.map((x) => (x.id === c.id ? c : x)) : [...xs, c]))}
        onDeleted={(id) => setContatos((xs) => xs.filter((x) => x.id !== id))} />
    )}
    <ImageLightbox url={lightbox} onClose={() => setLightbox(null)} />
   </>
  );
}

export function WhatsApp(): React.JSX.Element {
  const [status, setStatus] = useState<WaStatus | null>(null);
  const [enabled, setEnabled] = useState(true);
  const [chats, setChats] = useState<WaChat[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [messages, setMessages] = useState<WaMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [busca, setBusca] = useState('');
  const [typingJid, setTypingJid] = useState<string | null>(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const [schedOpen, setSchedOpen] = useState(false);
  const [mergeOpen, setMergeOpen] = useState(false);
  const [orderOpen, setOrderOpen] = useState(false);
  const [newChatOpen, setNewChatOpen] = useState(false);
  const [numberOpen, setNumberOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [sp] = useSearchParams();
  const activeRef = useRef<number | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const openedParam = useRef(false);
  activeRef.current = activeId;

  const loadStatus = (): Promise<void> =>
    api.get<{ enabled: boolean; status: WaStatus }>('/api/whatsapp/status')
      .then((r) => { setEnabled(r.enabled); setStatus(r.status); })
      .catch(() => { setStatus('desconectado'); });

  const loadChats = (): Promise<void> =>
    api.get<{ chats: WaChat[] }>('/api/whatsapp/chats').then((r) => setChats(r.chats)).catch(() => undefined);

  useEffect(() => { void loadStatus(); }, []);
  useEffect(() => { if (status === 'conectado') void loadChats(); }, [status]);

  // Abertura direta vinda do funil (/whatsapp?chat=ID), uma vez só.
  useEffect(() => {
    if (openedParam.current) return;
    const c = sp.get('chat');
    if (c && chats.some((x) => x.id === Number(c))) { openChat(Number(c)); openedParam.current = true; }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chats, sp]);

  const openChat = (id: number): void => {
    setActiveId(id);
    void api.get<{ messages: WaMessage[] }>(`/api/whatsapp/chats/${id}/messages`)
      .then((r) => setMessages(r.messages)).catch(() => undefined);
    setChats((cs) => cs.map((c) => (c.id === id ? { ...c, nao_lidas: 0 } : c)));
  };

  // Remove a conversa do espelho local (mensagens/agendamentos vão junto).
  const delChat = async (chat: WaChat): Promise<void> => {
    if (!confirm(`Apagar a conversa com "${nomeChat(chat)}"? As mensagens serão removidas deste painel.`)) return;
    try {
      await api.del(`/api/whatsapp/chats/${chat.id}`);
      setChats((cs) => cs.filter((c) => c.id !== chat.id));
      if (activeRef.current === chat.id) { setActiveId(null); setMessages([]); }
      toast.success('Conversa apagada.');
    } catch (e) { toast.error(e instanceof ApiError ? e.message : 'Falha ao apagar'); }
  };

  // some o "digitando…" sozinho se parar de chegar presença.
  useEffect(() => {
    if (!typingJid) return;
    const t = setTimeout(() => setTypingJid(null), 6000);
    return () => clearTimeout(t);
  }, [typingJid]);

  // WebSocket: espelho ao vivo. Reconecta sozinho ao cair.
  useEffect(() => {
    if (status !== 'conectado') return;
    const token = getToken();
    if (!token) return;
    let ws: WebSocket | null = null;
    let stop = false;
    let retry: ReturnType<typeof setTimeout>;

    const connect = (): void => {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      ws = new WebSocket(`${proto}://${location.host}/api/whatsapp/ws?token=${encodeURIComponent(token)}`);
      ws.onmessage = (ev) => {
        let msg: { event: string; data: { chat_id?: number; removed_id?: number; message?: WaMessage; status?: WaStatus; evolution_id?: string; remote_jid?: string; typing?: boolean } };
        try { msg = JSON.parse(ev.data as string); } catch { return; }
        if (msg.event === 'status') { setStatus(msg.data.status ?? 'desconectado'); return; }
        if (msg.event === 'chat-foto') { void loadChats(); return; }
        if (msg.event === 'chat-removed') {
          const rid = msg.data.chat_id;
          setChats((cs) => cs.filter((c) => c.id !== rid));
          if (activeRef.current === rid) { setActiveId(null); setMessages([]); }
          return;
        }
        if (msg.event === 'merged') {
          void loadChats();
          if (activeRef.current === msg.data.removed_id && msg.data.chat_id != null) { setActiveId(msg.data.chat_id); }
          return;
        }
        if (msg.event === 'presence') { setTypingJid(msg.data.typing ? (msg.data.remote_jid ?? null) : null); return; }
        if (msg.event === 'message-status') {
          setMessages((ms) => ms.map((m) => (m.evolution_id === msg.data.evolution_id ? { ...m, status: msg.data.status as string } : m)));
          return;
        }
        if (msg.event === 'message' && msg.data.message) {
          const m = msg.data.message;
          void loadChats();
          if (Number(msg.data.chat_id) === activeRef.current) {
            setMessages((ms) => (ms.some((x) => x.id === m.id) ? ms : [...ms, m]));
          }
        }
      };
      ws.onclose = () => { if (!stop) retry = setTimeout(connect, 3000); };
    };
    connect();
    return () => { stop = true; clearTimeout(retry); ws?.close(); };
  }, [status]);

  const active = useMemo(() => chats.find((c) => c.id === activeId) ?? null, [chats, activeId]);
  // Contato só-LID (sem número): não dá pra enviar até informar o telefone.
  const needsNumber = !!active && !active.numero && active.remote_jid.endsWith('@lid');
  const filtered = useMemo(() => {
    const q = busca.trim().toLowerCase();
    if (!q) return chats;
    return chats.filter((c) => nomeChat(c).toLowerCase().includes(q) || (c.numero ?? '').includes(q));
  }, [chats, busca]);

  // "Criar pedido" abre o modal de pedido in-place (sem sair da conversa),
  // pré-preenchido com a empresa vinculada.
  const orderPrefill = useMemo(() => (active?.company_id == null ? null : {
    company_id: active.company_id,
    represented_id: active.represented_id,
    relationship_id: active.relationship_id,
    company_label: active.company_fantasia || active.company_nome || undefined,
  }), [active]);

  const send = async (): Promise<void> => {
    const text = draft.replace(/<[^>]*>/g, '').trim();
    if (!text || activeId == null) return;
    if (needsNumber) { setNumberOpen(true); return; } // pede o número antes de enviar
    setDraft('');
    try {
      const r = await api.post<{ message: WaMessage | null }>(`/api/whatsapp/chats/${activeId}/send`, { text });
      if (r.message) setMessages((ms) => (ms.some((x) => x.id === r.message!.id) ? ms : [...ms, r.message!]));
      void loadChats();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Falha ao enviar');
      setDraft(text);
    }
  };

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>): Promise<void> => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f || activeId == null) return;
    if (needsNumber) { setNumberOpen(true); return; } // pede o número antes de enviar
    if (f.size > 16 * 1024 * 1024) { toast.error('Arquivo acima de 16MB.'); return; }
    try {
      const media = await fileToBase64(f);
      const r = await api.post<{ message: WaMessage | null }>(`/api/whatsapp/chats/${activeId}/send-media`, {
        media, mediatype: detectType(f.type), mimetype: f.type || null, fileName: f.name, caption: null,
      });
      if (r.message) setMessages((ms) => (ms.some((x) => x.id === r.message!.id) ? ms : [...ms, r.message!]));
      void loadChats();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Falha ao enviar arquivo');
    }
  };

  // Renderiza uma mensagem (texto ou mídia) no formato do @chatscope.
  const renderMessage = (m: WaMessage): React.JSX.Element => {
    const direction = m.from_me ? 'outgoing' : 'incoming';
    const footer = <Message.Footer><span style={{ fontSize: 11, opacity: 0.65 }}>{hora(m.momento)} <Tick m={m} /></span></Message.Footer>;
    if (m.tipo === 'texto') {
      return <Message key={m.id} model={{ message: m.corpo ?? '', direction, position: 'single' }}>{footer}</Message>;
    }
    const url = mediaUrl(m);
    let content: ReactNode;
    if (m.tipo === 'imagem') {
      content = <img src={url} alt="" style={{ maxWidth: 240, borderRadius: 8, cursor: 'pointer', display: 'block' }} onClick={() => setLightbox(url)} />;
    } else if (m.tipo === 'video') {
      content = <video src={url} controls style={{ maxWidth: 260, borderRadius: 8, display: 'block' }} />;
    } else if (m.tipo === 'audio') {
      content = <audio src={url} controls />;
    } else {
      content = (
        <a href={url} target="_blank" rel="noreferrer" style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'inherit' }}>
          <Icon name="mail" size={18} /> {m.file_name ?? 'arquivo'}
        </a>
      );
    }
    return (
      <Message key={m.id} model={{ direction, position: 'single', type: 'custom' }}>
        <Message.CustomContent>
          {content}
          {m.corpo && <div style={{ marginTop: 4 }}>{m.corpo}</div>}
        </Message.CustomContent>
        {footer}
      </Message>
    );
  };

  // Lista com separadores de data + indicador de digitação no fim.
  const listItems = useMemo(() => {
    const items: ReactNode[] = [];
    let lastDay = '';
    for (const m of messages) {
      const day = new Date(m.momento).toDateString();
      if (day !== lastDay) { items.push(<MessageSeparator key={`sep-${m.id}`} content={dayLabel(m.momento)} />); lastDay = day; }
      items.push(renderMessage(m));
    }
    return items;
  }, [messages]);

  if (status === null) return <Spinner label="Carregando…" />;
  if (!enabled) {
    return (
      <div className="grid h-full place-items-center p-6">
        <Card className="max-w-sm p-8 text-center text-sm text-ink-500">
          Integração WhatsApp não configurada no servidor (defina <code>EVOLUTION_API_URL</code> e
          <code> EVOLUTION_API_KEY</code>).
        </Card>
      </div>
    );
  }
  if (status !== 'conectado') {
    return <ConnectPanel onConnected={() => { setStatus('conectado'); }} />;
  }

  const isTyping = !!active && typingJid === active.remote_jid;

  return (
    <div className="h-full">
      <input ref={fileRef} type="file" hidden onChange={(e) => void onFile(e)} />
      <div className="wa-web relative h-full overflow-hidden">
        <MainContainer responsive>
          <Sidebar position="left" scrollable>
            <div className="flex items-center justify-between gap-2 bg-[#f0f2f5] px-4 py-2.5">
              <span className="text-base font-semibold text-[#111b21]">Conversas</span>
              <button title="Nova conversa" onClick={() => setNewChatOpen(true)}
                className="grid h-8 w-8 place-items-center rounded-full text-[#54656f] hover:bg-black/5">
                <Icon name="pencil" size={18} />
              </button>
            </div>
            <Search placeholder="Buscar conversa…" value={busca}
              onChange={(v: string) => setBusca(v)} onClearClick={() => setBusca('')} />
            <ConversationList>
              {filtered.map((c) => (
                <Conversation key={c.id} name={nomeChat(c)} info={c.last_preview ?? ''}
                  active={c.id === activeId} unreadCnt={c.nao_lidas || undefined}
                  lastActivityTime={c.last_message_at ? hora(c.last_message_at) : undefined}
                  onClick={() => openChat(c.id)}>
                  <Avatar src={avatarSrc(c)} name={nomeChat(c)} />
                </Conversation>
              ))}
            </ConversationList>
          </Sidebar>

          {active ? (
            <ChatContainer>
              <ConversationHeader>
                <Avatar src={avatarSrc(active)} name={nomeChat(active)}
                  onClick={() => setDetailsOpen(true)} style={{ cursor: 'pointer' }} />
                <ConversationHeader.Content userName={nomeChat(active)}
                  onClick={() => setDetailsOpen(true)} style={{ cursor: 'pointer' }}
                  info={isTyping ? 'digitando…'
                    : needsNumber ? 'número oculto (LID) — informe o telefone'
                    : active.company_id != null ? (active.company_fantasia || active.company_nome || '')
                    : chatIdent(active)} />
                <ConversationHeader.Actions>
                  {needsNumber && (
                    <button title="Informar número do contato" onClick={() => setNumberOpen(true)}
                      className="grid h-8 w-8 place-items-center rounded-lg text-amber-600 hover:bg-amber-50">
                      <Icon name="phone" size={18} />
                    </button>
                  )}
                  {active.company_id != null && (
                    <button title="Criar pedido" onClick={() => setOrderOpen(true)}
                      className="grid h-8 w-8 place-items-center rounded-lg text-ink-500 hover:bg-ink-100">
                      <Icon name="plus" size={18} />
                    </button>
                  )}
                  <button title="Conciliar conversas (telefone + LID)" onClick={() => setMergeOpen(true)}
                    className="grid h-8 w-8 place-items-center rounded-lg text-ink-500 hover:bg-ink-100">
                    <Icon name="layers" size={18} />
                  </button>
                  <button title="Agendar mensagem" onClick={() => setSchedOpen(true)}
                    className="grid h-8 w-8 place-items-center rounded-lg text-ink-500 hover:bg-ink-100">
                    <Icon name="clock" size={18} />
                  </button>
                  <button title={active.company_id != null ? 'Empresa vinculada' : 'Vincular empresa'} onClick={() => setLinkOpen(true)}
                    className={cn('grid h-8 w-8 place-items-center rounded-lg hover:bg-ink-100', active.company_id != null ? 'text-emerald-600' : 'text-ink-500')}>
                    <Icon name="users" size={18} />
                  </button>
                  <button title="Apagar conversa" onClick={() => void delChat(active)}
                    className="grid h-8 w-8 place-items-center rounded-lg text-ink-500 hover:bg-rose-50 hover:text-rose-600">
                    <Icon name="trash" size={18} />
                  </button>
                </ConversationHeader.Actions>
              </ConversationHeader>
              <MessageList typingIndicator={isTyping ? <TypingIndicator content="digitando…" /> : undefined}>
                {listItems}
              </MessageList>
              <MessageInput placeholder="Digite uma mensagem…" value={draft}
                onChange={(v: string) => setDraft(v)} onSend={() => void send()}
                onAttachClick={() => fileRef.current?.click()} sendButton attachButton autoFocus />
            </ChatContainer>
          ) : (
            <ChatContainer>
              <MessageList>
                <div className="grid h-full place-items-center text-sm text-ink-400">
                  Selecione uma conversa
                </div>
              </MessageList>
            </ChatContainer>
          )}
        </MainContainer>
        {active && detailsOpen && (
          <ContactDetails chat={active} messages={messages} onClose={() => setDetailsOpen(false)}
            onLink={() => { setDetailsOpen(false); setLinkOpen(true); }}
            onOrder={() => { setDetailsOpen(false); setOrderOpen(true); }}
            onNumber={() => { setDetailsOpen(false); setNumberOpen(true); }} />
        )}
      </div>
      {active && linkOpen && (
        <LinkModal chatId={active.id} current={active} onClose={() => setLinkOpen(false)}
          onLinked={(c) => setChats((cs) => cs.map((x) => (x.id === c.id ? c : x)))} />
      )}
      {active && schedOpen && <ScheduleModal chat={active} onClose={() => setSchedOpen(false)} />}
      {active && mergeOpen && (
        <MergeModal current={active} chats={chats} onClose={() => setMergeOpen(false)} onMerged={() => void loadChats()} />
      )}
      {orderOpen && orderPrefill && (
        <OrderModal prefill={orderPrefill} onClose={() => setOrderOpen(false)} onSaved={() => setOrderOpen(false)} />
      )}
      {newChatOpen && (
        <NewChatModal onClose={() => setNewChatOpen(false)}
          onOpened={(id) => { void loadChats().then(() => openChat(id)); }} />
      )}
      {active && numberOpen && (
        <NumberModal chatId={active.id} onClose={() => setNumberOpen(false)}
          onSet={(c) => setChats((cs) => cs.map((x) => (x.id === c.id ? c : x)))} />
      )}
      <ImageLightbox url={lightbox} onClose={() => setLightbox(null)} />
    </div>
  );
}
