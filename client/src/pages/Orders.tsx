import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../lib/api.ts';
import { useAuth } from '../lib/auth.tsx';
import { useSellers, SellerFilter } from '../lib/sellers.tsx';
import type { Order, OrderStatus, RepresentedCompany } from '../lib/types.ts';
import { Badge, Btn, Card, EmptyState, PageHeader, Spinner, StatCard, cn, type Tone } from '../lib/ui.tsx';
import { Icon } from '../lib/icons.tsx';
import { brl, csvNum, fmtDate } from '../lib/format.ts';
import { downloadCsv } from '../lib/export.ts';
import { toast } from '../lib/toast.tsx';
import { OrderModal } from '../lib/orderModal.tsx';

const inputCls = 'w-full rounded-xl border border-ink-200 bg-white px-3 py-2.5 text-sm text-ink-800 outline-none transition focus:border-brand-400 focus:ring-2 focus:ring-brand-200';

const STATUS_META: Record<OrderStatus, { label: string; tone: Tone }> = {
  cotacao: { label: 'Cotação', tone: 'info' },
  rascunho: { label: 'Rascunho', tone: 'neutral' },
  enviado: { label: 'Enviado', tone: 'warn' },
  faturado: { label: 'Faturado', tone: 'success' },
  entregue: { label: 'Entregue', tone: 'brand' },
  cancelado: { label: 'Cancelado', tone: 'danger' },
};

// Próximo passo do fluxo feliz por status (cancelar tratado à parte).
const NEXT: Partial<Record<OrderStatus, { to: OrderStatus; label: string }>> = {
  cotacao: { to: 'rascunho', label: 'Converter em pedido' },
  rascunho: { to: 'enviado', label: 'Enviar' },
  enviado: { to: 'faturado', label: 'Faturar' },
  faturado: { to: 'entregue', label: 'Entregar' },
};

export function Orders(): React.JSX.Element {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<'todos' | OrderStatus>('todos');
  const [representedId, setRepresentedId] = useState<'todos' | number>('todos');
  const [ownerId, setOwnerId] = useState<'todos' | number>('todos');
  const sellers = useSellers();
  const [editing, setEditing] = useState<Order | null>(null);
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  const [nfModal, setNfModal] = useState<Order | null>(null);

  const [reps, setReps] = useState<RepresentedCompany[]>([]);

  // pré-preenchimento vindo do Kanban (?company_id=&represented_id=&relationship_id=)
  const prefill = useMemo(() => {
    const cid = params.get('company_id');
    if (!cid) return null;
    return {
      company_id: Number(cid),
      represented_id: params.get('represented_id') ? Number(params.get('represented_id')) : null,
      relationship_id: params.get('relationship_id') ? Number(params.get('relationship_id')) : null,
    };
  }, [params]);

  const load = async (): Promise<void> => {
    const r = await api.get<{ orders: Order[] }>('/api/orders');
    setOrders(r.orders);
    setLoading(false);
  };
  useEffect(() => { void load(); }, []);
  useEffect(() => {
    void api.get<{ empresas: RepresentedCompany[] }>('/api/represented')
      .then((r) => setReps(r.empresas.filter((e) => e.ativo))).catch(() => undefined);
  }, []);
  useEffect(() => { if (prefill) setAdding(true); }, [prefill]);

  const filtered = useMemo(() => orders.filter((o) =>
    (status === 'todos' || o.status === status)
    && (representedId === 'todos' || o.represented_id === representedId)
    && (ownerId === 'todos' || o.owner_user_id === ownerId)
  ), [orders, status, representedId, ownerId]);

  const kpis = useMemo(() => {
    let aberto = 0, faturado = 0;
    for (const o of filtered) {
      const v = Number(o.total);
      if (o.status === 'faturado' || o.status === 'entregue') faturado += v;
      else if (o.status !== 'cancelado') aberto += v;
    }
    return { aberto, faturado };
  }, [filtered]);

  const transition = async (o: Order, to: OrderStatus, nf?: string | null): Promise<void> => {
    // faturar pede o nº da NF — abre modal em vez de prompt nativo
    if (to === 'faturado' && nf === undefined) { setNfModal(o); return; }
    try {
      const r = await api.post<{ order: Order }>(`/api/orders/${o.id}/transition`, { status: to, nf_numero: nf ?? undefined });
      setOrders((xs) => xs.map((x) => (x.id === o.id ? r.order : x)));
      toast.success(to === 'cancelado' ? `Pedido #${o.numero} cancelado.` : `Pedido #${o.numero}: ${STATUS_META[to].label}.`);
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Não foi possível atualizar o pedido.'); }
  };

  const remove = async (o: Order): Promise<void> => {
    if (!confirm(`Excluir o pedido #${o.numero}?`)) return;
    const before = orders;
    setOrders((xs) => xs.filter((x) => x.id !== o.id));
    try { await api.del(`/api/orders/${o.id}`); toast.success(`Pedido #${o.numero} excluído.`); }
    catch { setOrders(before); toast.error('Não foi possível excluir o pedido.'); }
  };

  const exportar = (): void => downloadCsv('pedidos',
    ['Número', 'Cliente', 'Representada', 'Vendedor', 'Status', 'NF', 'Total', 'Criado em'],
    filtered.map((o) => [o.numero, o.company_nome, o.represented_nome, o.owner_nome ?? o.owner_email ?? '',
      STATUS_META[o.status].label, o.nf_numero ?? '', csvNum(o.total), fmtDate(o.created_at)]));

  const openEdit = async (o: Order): Promise<void> => {
    const r = await api.get<{ order: Order }>(`/api/orders/${o.id}`);
    setEditing(r.order);
  };

  // Abre o HTML do pedido/cotação numa aba e dispara a impressão (→ PDF). O HTML
  // vem do servidor (papel timbrado da org); evita gerador de PDF no bundle.
  const printOrder = async (o: Order): Promise<void> => {
    try {
      const { html } = await api.get<{ html: string }>(`/api/orders/${o.id}/print`);
      const w = window.open('', '_blank');
      if (!w) { toast.error('Permita pop-ups para gerar a impressão.'); return; }
      w.document.write(html);
      w.document.close();
      w.focus();
      w.print();
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Não foi possível gerar a impressão.'); }
  };

  const closeModal = (): void => {
    setAdding(false); setEditing(null);
    if (prefill) setParams({}, { replace: true });
  };

  return (
    <div className="flex h-full flex-col gap-4 p-4 sm:p-6">
      <PageHeader title="Pedidos" subtitle="Cotações e pedidos de venda por representada"
        actions={
          <div className="flex gap-2">
            <Btn variant="ghost" icon="download" onClick={exportar} disabled={filtered.length === 0}>Exportar</Btn>
            {user?.role === 'admin' && (
              <Btn variant="ghost" icon="arrowDown" onClick={() => setImporting(true)}>Importar NF</Btn>
            )}
            <Btn icon="plus" onClick={() => setAdding(true)}>Novo pedido</Btn>
          </div>
        } />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <StatCard label="Em aberto" value={brl(kpis.aberto)} icon="trendingUp" tone="info" />
        <StatCard label="Total faturado" value={brl(kpis.faturado)} icon="check" tone="success" />
        <StatCard label="Pedidos" value={String(filtered.length)} icon="list" tone="brand" />
      </div>

      <Card className="flex flex-wrap items-center gap-3 p-3">
        <select value={status} onChange={(e) => setStatus(e.target.value as typeof status)} aria-label="Filtrar por status"
          className="rounded-lg border border-ink-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-ink-600 outline-none focus:border-brand-400">
          <option value="todos">Todos os status</option>
          {Object.entries(STATUS_META).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        <select value={representedId} onChange={(e) => setRepresentedId(e.target.value === 'todos' ? 'todos' : Number(e.target.value))}
          aria-label="Filtrar por representada"
          className="rounded-lg border border-ink-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-ink-600 outline-none focus:border-brand-400">
          <option value="todos">Todas as representadas</option>
          {reps.map((r) => <option key={r.id} value={r.id}>{r.nome}</option>)}
        </select>
        <SellerFilter value={ownerId} onChange={setOwnerId} sellers={sellers} />
      </Card>

      {loading ? (
        <Spinner />
      ) : filtered.length === 0 ? (
        <EmptyState icon="list" title="Nenhum pedido" hint="Crie uma cotação ou pedido para começar." />
      ) : (
        <div className="min-h-0 flex-1 space-y-2 overflow-auto">
          {filtered.map((o) => (
            <Row key={o.id} o={o} showOwner={user?.role === 'admin'} onEdit={() => void openEdit(o)} onRemove={() => void remove(o)}
              onTransition={(to) => void transition(o, to)} onPrint={() => void printOrder(o)} />
          ))}
        </div>
      )}

      {(adding || editing) && (
        <OrderModal order={editing} prefill={editing ? null : prefill}
          onClose={closeModal} onSaved={() => { closeModal(); void load(); }} />
      )}
      {importing && (
        <ImportModal onClose={() => setImporting(false)} onDone={() => { setImporting(false); void load(); }} />
      )}
      {nfModal && (
        <NfModal order={nfModal} onClose={() => setNfModal(null)}
          onConfirm={(nf) => { const o = nfModal; setNfModal(null); void transition(o, 'faturado', nf); }} />
      )}
    </div>
  );
}

// Captura o nº da NF ao faturar — substitui o prompt() nativo. NF é opcional.
function NfModal({ order, onClose, onConfirm }: { order: Order; onClose: () => void; onConfirm: (nf: string | null) => void }): React.JSX.Element {
  const [nf, setNf] = useState('');
  const submit = (e: React.FormEvent): void => { e.preventDefault(); onConfirm(nf.trim() || null); };
  return (
    <div className="fixed inset-0 z-[2100] grid place-items-center bg-ink-950/40 p-4" onClick={onClose}>
      <Card className="w-full max-w-sm p-4 shadow-pop" >
        <div onClick={(e) => e.stopPropagation()}>
          <h3 className="mb-1 text-sm font-bold text-ink-900">Faturar pedido #{order.numero}</h3>
          <p className="mb-3 text-xs text-ink-400">Informe o número da nota fiscal (opcional).</p>
          <form onSubmit={submit} className="space-y-3">
            <input value={nf} onChange={(e) => setNf(e.target.value)} autoFocus inputMode="numeric"
              placeholder="Número da NF" className={inputCls} />
            <div className="flex justify-end gap-2">
              <Btn variant="ghost" type="button" onClick={onClose}>Cancelar</Btn>
              <Btn icon="check" type="submit">Faturar</Btn>
            </div>
          </form>
        </div>
      </Card>
    </div>
  );
}

function Row({ o, showOwner, onEdit, onRemove, onTransition, onPrint }: {
  o: Order; showOwner: boolean; onEdit: () => void; onRemove: () => void;
  onTransition: (to: OrderStatus) => void; onPrint: () => void;
}): React.JSX.Element {
  const meta = STATUS_META[o.status];
  const next = NEXT[o.status];
  const editable = o.status === 'cotacao' || o.status === 'rascunho';
  return (
    <Card className="flex items-center gap-3 p-3">
      <button onClick={onEdit} className="flex min-w-0 flex-1 items-center gap-3 text-left" title={editable ? 'Editar pedido' : 'Ver pedido'}>
        <span className="tabnums grid h-9 w-12 shrink-0 place-items-center rounded-xl bg-ink-100 text-xs font-bold text-ink-600">
          #{o.numero}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-ink-800">{o.company_nome}</p>
          <p className="truncate text-xs text-ink-400">
            {o.represented_nome}
            {o.carrier_nome ?? o.transportadora ? ` · ${o.carrier_nome ?? o.transportadora}` : ''}
            {o.nf_numero ? ` · NF ${o.nf_numero}` : ''}
            {o.status === 'cotacao' && o.validade ? ` · válida até ${fmtDate(o.validade)}` : ''}
            {showOwner && (o.owner_nome || o.owner_email) ? ` · ${o.owner_nome ?? o.owner_email}` : ''}
            {` · ${fmtDate(o.created_at)}`}
          </p>
        </div>
      </button>
      <div className="flex shrink-0 flex-col items-end gap-1">
        <span className="tabnums text-sm font-bold text-ink-800">{brl(Number(o.total))}</span>
        <Badge tone={meta.tone}>{meta.label}</Badge>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <button onClick={onPrint} title="Imprimir / PDF"
          className="grid h-8 w-8 place-items-center rounded-lg text-ink-300 hover:bg-brand-50 hover:text-brand-600"><Icon name="download" size={16} /></button>
        {next && (
          <Btn variant="ghost" className="px-2 py-1 text-xs" onClick={() => onTransition(next.to)}>{next.label}</Btn>
        )}
        {o.status !== 'cancelado' && o.status !== 'entregue' && (
          <button onClick={() => onTransition('cancelado')} title="Cancelar pedido"
            className="grid h-8 w-8 place-items-center rounded-lg text-ink-300 hover:bg-rose-50 hover:text-rose-500"><Icon name="x" size={16} /></button>
        )}
        {editable && (
          <button onClick={onRemove} aria-label={`Excluir pedido ${o.numero}`}
            className="grid h-8 w-8 place-items-center rounded-lg text-ink-300 hover:bg-rose-50 hover:text-rose-500"><Icon name="trash" size={16} /></button>
        )}
      </div>
    </Card>
  );
}

function ImportModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }): React.JSX.Element {
  const [csv, setCsv] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ processadas: number; faturadas: number } | null>(null);

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (!csv.trim()) return;
    setBusy(true);
    try {
      const r = await api.post<{ processadas: number; faturadas: number }>('/api/orders/import', { csv });
      setResult(r);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Não foi possível importar.');
    } finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-[2000] grid place-items-center bg-ink-950/40 p-4" onClick={onClose}>
      <Card className="w-full max-w-lg p-4 shadow-pop">
        <div onClick={(e) => e.stopPropagation()}>
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-bold text-ink-900">Importar faturamento (CSV)</h3>
            <button onClick={onClose} aria-label="Fechar" className="grid h-8 w-8 place-items-center rounded-lg text-ink-400 hover:bg-ink-100">
              <Icon name="x" size={17} />
            </button>
          </div>
          {result ? (
            <div className="space-y-3">
              <p className="text-sm text-ink-700">
                {result.faturadas} de {result.processadas} linha(s) faturada(s).
              </p>
              <div className="flex justify-end"><Btn onClick={onDone}>Concluir</Btn></div>
            </div>
          ) : (
            <form onSubmit={submit} className="space-y-3">
              <p className="text-xs text-ink-400">
                Cabeçalho com colunas <code>nf, data, cnpj, valor</code> (separador vírgula ou ponto-e-vírgula).
                Pedidos <strong>enviados</strong> com mesmo CNPJ e valor são marcados como faturados.
              </p>
              <textarea value={csv} onChange={(e) => setCsv(e.target.value)} rows={8}
                placeholder={'nf;data;cnpj;valor\n123;01/06/2026;00.000.000/0000-00;1.234,56'}
                className={cn(inputCls, 'font-mono text-xs')} />
              <div className="flex justify-end gap-2">
                <Btn variant="ghost" type="button" onClick={onClose}>Cancelar</Btn>
                <Btn icon="check" type="submit" disabled={busy}>{busy ? '…' : 'Importar'}</Btn>
              </div>
            </form>
          )}
        </div>
      </Card>
    </div>
  );
}
