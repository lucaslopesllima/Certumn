import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../lib/api.ts';
import { useAuth } from '../lib/auth.tsx';
import { useSellers, SellerFilter } from '../lib/sellers.tsx';
import type { Carrier, CatalogItem, CommissionEntry, KanbanCard, Order, OrderStatus, PriceTable, RepresentedCompany, TaxDefaults } from '../lib/types.ts';
import { Badge, Btn, Card, EmptyState, PageHeader, Spinner, StatCard, cn, type Tone } from '../lib/ui.tsx';
import { Icon } from '../lib/icons.tsx';
import { brl, csvNum, dec, fmtDate, numStr, todayStr } from '../lib/format.ts';
import { downloadCsv } from '../lib/export.ts';
import { toast } from '../lib/toast.tsx';

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

type Opt = { id: number; label: string };

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
  const [companies, setCompanies] = useState<(Opt & { relationship_id: number })[]>([]);
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [carriers, setCarriers] = useState<Carrier[]>([]);

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
    void api.get<{ cards: KanbanCard[] }>('/api/kanban').then((r) => {
      setCompanies(r.cards.map((c) => ({
        id: c.company_id, relationship_id: c.id, label: c.nome_fantasia || c.razao_social,
      })).sort((a, b) => a.label.localeCompare(b.label)));
    }).catch(() => undefined);
    void api.get<{ items: CatalogItem[] }>('/api/catalog')
      .then((r) => setCatalog(r.items.filter((i) => i.ativo))).catch(() => undefined);
    void api.get<{ carriers: Carrier[] }>('/api/carriers')
      .then((r) => setCarriers(r.carriers.filter((c) => c.ativo))).catch(() => undefined);
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
        <OrderModal order={editing} reps={reps} companies={companies} catalog={catalog} carriers={carriers}
          prefill={editing ? null : prefill}
          onClose={closeModal}
          onSaved={() => { closeModal(); void load(); }} />
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

// Campos de imposto por item (mesma ordem da config e do back). Rótulo p/ a grade.
const TAX_FIELDS = [
  ['icms_pct', 'ICMS %'], ['ipi_pct', 'IPI %'], ['st_pct', 'ST %'],
  ['pis_pct', 'PIS %'], ['cofins_pct', 'COFINS %'], ['iss_pct', 'ISS %'],
] as const;
type TaxKey = (typeof TAX_FIELDS)[number][0];

interface ItemDraft {
  catalog_item_id: number | null; descricao: string; qtd: string; preco_unit: string;
  desconto_pct: string; icms_pct: string; ipi_pct: string; st_pct: string;
  pis_pct: string; cofins_pct: string; iss_pct: string;
}
const EMPTY_ITEM: ItemDraft = {
  catalog_item_id: null, descricao: '', qtd: '1', preco_unit: '', desconto_pct: '',
  icms_pct: '', ipi_pct: '', st_pct: '', pis_pct: '', cofins_pct: '', iss_pct: '',
};

// Alíquotas default da org como strings, p/ preencher item novo (vazio = '').
const taxDraft = (d: TaxDefaults | null): Record<TaxKey, string> =>
  Object.fromEntries(TAX_FIELDS.map(([k]) => [k, d && d[k] ? String(d[k]) : ''])) as Record<TaxKey, string>;

const itemTotal = (i: ItemDraft): number => {
  const q = dec(i.qtd) || 0;
  const p = dec(i.preco_unit) || 0;
  const d = dec(i.desconto_pct) || 0;
  const imp = TAX_FIELDS.reduce((s, [k]) => s + (dec(i[k]) || 0), 0);
  return q * p * (1 - d / 100) * (1 + imp / 100);
};

function OrderModal({ order, reps, companies, catalog, carriers, prefill, onClose, onSaved }: {
  order: Order | null;
  reps: RepresentedCompany[];
  companies: (Opt & { relationship_id: number })[];
  catalog: CatalogItem[];
  carriers: Carrier[];
  prefill: { company_id: number; represented_id: number | null; relationship_id: number | null } | null;
  onClose: () => void; onSaved: () => void;
}): React.JSX.Element {
  const { user } = useAuth();
  const readOnly = order != null && order.status !== 'cotacao' && order.status !== 'rascunho';
  const [companyId, setCompanyId] = useState<number | null>(order?.company_id ?? prefill?.company_id ?? null);
  const [representedId, setRepresentedId] = useState<number | null>(order?.represented_id ?? prefill?.represented_id ?? null);
  const [cotacao, setCotacao] = useState(order ? order.status === 'cotacao' : false);
  const [validade, setValidade] = useState(order?.validade?.slice(0, 10) ?? '');
  const [condicao, setCondicao] = useState(order?.condicao_pagamento ?? '');
  const [carrierId, setCarrierId] = useState<number | null>(order?.carrier_id ?? null);
  const [frete, setFrete] = useState(order ? numStr(order.frete) : '');
  const [observacoes, setObservacoes] = useState(order?.observacoes ?? '');
  const [items, setItems] = useState<ItemDraft[]>(
    (order?.items ?? []).map((i) => ({
      catalog_item_id: i.catalog_item_id, descricao: i.descricao_snapshot, qtd: numStr(i.qtd),
      preco_unit: numStr(i.preco_unit), desconto_pct: String(Number(i.desconto_pct) || ''),
      icms_pct: String(Number(i.icms_pct) || ''), ipi_pct: String(Number(i.ipi_pct) || ''),
      st_pct: String(Number(i.st_pct) || ''), pis_pct: String(Number(i.pis_pct) || ''),
      cofins_pct: String(Number(i.cofins_pct) || ''), iss_pct: String(Number(i.iss_pct) || ''),
    })),
  );
  const [table, setTable] = useState<PriceTable | null>(null);
  const [taxDef, setTaxDef] = useState<TaxDefaults | null>(null);
  const [comissao, setComissao] = useState<CommissionEntry | null>(null);
  const [busy, setBusy] = useState(false);
  const [tried, setTried] = useState(false); // mostra erros inline só após tentar salvar

  // validação por item, reusada pra destacar campo e bloquear submit
  const itemErr = (i: ItemDraft): { desc: boolean; qtd: boolean; preco: boolean } => ({
    desc: !i.descricao.trim(),
    qtd: !(dec(i.qtd) > 0),
    preco: i.preco_unit.trim() === '' || !(dec(i.preco_unit) >= 0),
  });

  // pedido faturado/entregue tem comissão gerada — exibe a previsão
  // (admin vê o total; vendedor vê a própria parte).
  useEffect(() => {
    if (order == null || (order.status !== 'faturado' && order.status !== 'entregue')) return;
    void api.get<{ entries: CommissionEntry[] }>(`/api/commissions?order_id=${order.id}`)
      .then((r) => setComissao(r.entries[0] ?? null)).catch(() => undefined);
  }, [order]);

  // alíquotas default da org → preenchem impostos de itens novos.
  useEffect(() => {
    void api.get<{ tax: TaxDefaults }>('/api/tax-defaults')
      .then((r) => setTaxDef(r.tax)).catch(() => undefined);
  }, []);

  // representada escolhida -> carrega a tabela de preço vigente
  useEffect(() => {
    setTable(null);
    if (representedId == null) return;
    void api.get<{ table: PriceTable | null }>(`/api/price-tables/active?represented_id=${representedId}`)
      .then((r) => setTable(r.table)).catch(() => undefined);
  }, [representedId]);

  // ids vêm como string do back (bigint sem parser no pg) — coage os dois lados
  // pra casar com o id numérico do <select> (Number(value)).
  const tablePrice = (catalogItemId: number): string | null => {
    const it = table?.items?.find((x) => Number(x.catalog_item_id) === Number(catalogItemId));
    return it != null ? numStr(it.preco) : null;
  };

  // imposto do item novo: se o produto define ALGUM imposto, usa o do produto
  // (campo nulo = 0); senão cai inteiro no default da org.
  const itemTax = (cat?: CatalogItem): Record<TaxKey, string> => {
    const has = cat != null && TAX_FIELDS.some(([k]) => cat[k] != null);
    return has
      ? Object.fromEntries(TAX_FIELDS.map(([k]) => [k, numStr(cat[k])])) as Record<TaxKey, string>
      : taxDraft(taxDef);
  };

  const addCatalogItem = (id: number): void => {
    const cat = catalog.find((c) => Number(c.id) === Number(id));
    setItems((xs) => [...xs, {
      ...EMPTY_ITEM,
      ...itemTax(cat),
      catalog_item_id: id,
      descricao: cat?.nome ?? '',
      preco_unit: tablePrice(id) ?? numStr(cat?.preco),
    }]);
  };
  const setItem = (idx: number, patch: Partial<ItemDraft>): void =>
    setItems((xs) => xs.map((x, i) => (i === idx ? { ...x, ...patch } : x)));

  const total = items.reduce((s, i) => s + itemTotal(i), 0) + (dec(frete) || 0);

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (readOnly) return;
    setTried(true);
    if (companyId == null || representedId == null) { toast.error('Escolha o cliente e a representada.'); return; }
    if (items.length === 0) { toast.error('Adicione pelo menos um item.'); return; }
    // aponta o primeiro item incompleto pelo número, em vez de mensagem genérica
    const badIdx = items.findIndex((i) => { const er = itemErr(i); return er.desc || er.qtd || er.preco; });
    if (badIdx >= 0) { toast.error(`Item ${badIdx + 1}: preencha descrição, quantidade e preço.`); return; }
    setBusy(true);
    const num = (s: string): number | undefined => (s.trim() === '' ? undefined : dec(s));
    const body: Record<string, unknown> = {
      company_id: companyId,
      represented_id: representedId,
      relationship_id: order?.relationship_id
        ?? prefill?.relationship_id
        ?? companies.find((c) => Number(c.id) === Number(companyId))?.relationship_id
        ?? null,
      price_table_id: table != null ? table.id : null,
      validade: cotacao && validade ? validade : null,
      condicao_pagamento: condicao || null,
      carrier_id: carrierId,
      frete: dec(frete) || 0,
      observacoes: observacoes || null,
      items: items.map((i) => ({
        catalog_item_id: i.catalog_item_id,
        descricao: i.descricao.trim(),
        qtd: dec(i.qtd),
        preco_unit: dec(i.preco_unit),
        desconto_pct: num(i.desconto_pct) ?? 0,
        icms_pct: num(i.icms_pct) ?? 0,
        ipi_pct: num(i.ipi_pct) ?? 0,
        st_pct: num(i.st_pct) ?? 0,
        pis_pct: num(i.pis_pct) ?? 0,
        cofins_pct: num(i.cofins_pct) ?? 0,
        iss_pct: num(i.iss_pct) ?? 0,
      })),
    };
    try {
      if (order) await api.patch(`/api/orders/${order.id}`, body);
      else await api.post('/api/orders', { ...body, status: cotacao ? 'cotacao' : 'rascunho' });
      toast.success(order ? `Pedido #${order.numero} salvo.` : 'Pedido criado.');
      onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Não foi possível salvar o pedido.');
    } finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-[2000] grid place-items-center bg-ink-950/40 p-4" onClick={onClose}>
      <Card className="w-full max-w-2xl p-4 shadow-pop">
        <div onClick={(e) => e.stopPropagation()}>
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-bold text-ink-900">
              {order ? `Pedido #${order.numero}` : 'Novo pedido'}
              {readOnly && <span className="ml-2 text-xs font-medium text-ink-400">(somente leitura)</span>}
            </h3>
            <button onClick={onClose} aria-label="Fechar" className="grid h-8 w-8 place-items-center rounded-lg text-ink-400 hover:bg-ink-100">
              <Icon name="x" size={17} />
            </button>
          </div>
          <form onSubmit={submit} className="max-h-[75vh] space-y-3 overflow-auto pr-1">
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="block">
                <span className="text-xs font-semibold text-ink-600">Cliente (funil) *</span>
                <select value={companyId ?? ''} disabled={readOnly || order != null}
                  onChange={(e) => setCompanyId(e.target.value === '' ? null : Number(e.target.value))} className={cn(inputCls, 'mt-1')}>
                  <option value="">Escolha o cliente</option>
                  {companies.map((c) => <option key={c.relationship_id} value={c.id}>{c.label}</option>)}
                </select>
              </label>
              <label className="block">
                <span className="text-xs font-semibold text-ink-600">Representada *</span>
                <select value={representedId ?? ''} disabled={readOnly}
                  onChange={(e) => setRepresentedId(e.target.value === '' ? null : Number(e.target.value))} className={cn(inputCls, 'mt-1')}>
                  <option value="">Escolha a representada</option>
                  {reps.map((r) => <option key={r.id} value={r.id}>{r.nome}</option>)}
                </select>
              </label>
            </div>
            {representedId != null && (
              <p className="text-xs text-ink-400">
                {table ? <>Tabela de preço vigente: <span className="font-semibold text-ink-600">{table.nome}</span></> : 'Sem tabela de preço vigente — preços do catálogo.'}
              </p>
            )}

            <div className="space-y-1.5">
              <span className="text-xs font-semibold text-ink-600">Itens *</span>
              {items.map((i, idx) => {
                const err = tried ? itemErr(i) : { desc: false, qtd: false, preco: false };
                const fieldCls = (bad: boolean): string => cn('rounded-lg border bg-white px-2 py-1.5 text-sm',
                  bad ? 'border-rose-400 ring-1 ring-rose-200' : 'border-ink-200');
                return (
                <div key={idx} className="space-y-1.5 rounded-xl border border-ink-200/70 bg-ink-50/50 p-2">
                  <div className="flex items-center gap-2">
                    <input value={i.descricao} disabled={readOnly} aria-label={`Descrição item ${idx + 1}`} aria-invalid={err.desc}
                      onChange={(e) => setItem(idx, { descricao: e.target.value })} placeholder="Descrição *"
                      className={cn('min-w-0 flex-1', fieldCls(err.desc))} />
                    {!readOnly && (
                      <button type="button" aria-label={`Remover item ${idx + 1}`} onClick={() => setItems((xs) => xs.filter((_, j) => j !== idx))}
                        className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-ink-300 hover:bg-rose-50 hover:text-rose-500"><Icon name="x" size={15} /></button>
                    )}
                  </div>
                  <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-5">
                    {([['qtd', 'Qtd *'], ['preco_unit', 'Preço *'], ['desconto_pct', 'Desc %'], ...TAX_FIELDS] as const).map(([k, ph]) => {
                      const bad = (k === 'qtd' && err.qtd) || (k === 'preco_unit' && err.preco);
                      return (
                      <label key={k} className="block">
                        <span className="mb-0.5 block truncate text-[10px] font-semibold text-ink-500">{ph}</span>
                        <input type="text" inputMode="decimal" value={i[k]} disabled={readOnly} aria-label={`${ph} item ${idx + 1}`} aria-invalid={bad}
                          onChange={(e) => setItem(idx, { [k]: e.target.value.replace(/[^\d.,]/g, '') })} placeholder={ph}
                          className={cn(fieldCls(bad), 'w-full')} />
                      </label>
                      );
                    })}
                    <div className="col-span-3 sm:col-span-1">
                      <span className="mb-0.5 block text-[10px] font-semibold text-ink-500">Total</span>
                      <span className="tabnums grid h-[34px] place-items-center text-xs font-bold text-ink-700">{brl(itemTotal(i))}</span>
                    </div>
                  </div>
                </div>
                );
              })}
              {!readOnly && (
                <div className="grid gap-1.5 sm:grid-cols-2">
                  <select value="" aria-label="Adicionar item do catálogo"
                    onChange={(e) => { if (e.target.value !== '') addCatalogItem(Number(e.target.value)); }} className={inputCls}>
                    <option value="">+ Item do catálogo…</option>
                    {catalog.map((c) => {
                      const p = tablePrice(c.id) ?? (c.preco || null);
                      return <option key={c.id} value={c.id}>{c.nome}{p != null ? ` (${brl(Number(p))})` : ' — sem preço'}</option>;
                    })}
                  </select>
                  <Btn variant="ghost" type="button" icon="plus" onClick={() => setItems((xs) => [...xs, { ...EMPTY_ITEM, ...taxDraft(taxDef) }])}>
                    Item livre
                  </Btn>
                </div>
              )}
            </div>

            <div className="grid gap-2 sm:grid-cols-3">
              <label className="block">
                <span className="text-xs font-semibold text-ink-600">Frete (R$)</span>
                <input type="text" inputMode="decimal" value={frete} disabled={readOnly}
                  onChange={(e) => setFrete(e.target.value.replace(/[^\d.,]/g, ''))} className={cn(inputCls, 'mt-1')} />
              </label>
              <label className="block">
                <span className="text-xs font-semibold text-ink-600">Cond. pagamento</span>
                <input value={condicao} disabled={readOnly} onChange={(e) => setCondicao(e.target.value)}
                  placeholder="ex.: 28/56 dias" className={cn(inputCls, 'mt-1')} />
              </label>
              <label className="block">
                <span className="text-xs font-semibold text-ink-600">Transportadora</span>
                <select value={carrierId ?? ''} disabled={readOnly}
                  onChange={(e) => setCarrierId(e.target.value === '' ? null : Number(e.target.value))} className={cn(inputCls, 'mt-1')}>
                  <option value="">Sem transportadora</option>
                  {/* pedido antigo pode apontar para transportadora desativada — mantém a opção */}
                  {order?.carrier_id != null && !carriers.some((c) => c.id === order.carrier_id) && (
                    <option value={order.carrier_id}>{order.carrier_nome ?? `#${order.carrier_id}`}</option>
                  )}
                  {carriers.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
                </select>
              </label>
            </div>

            <div className="flex flex-wrap items-end gap-3">
              <label className="flex items-center gap-2 text-sm text-ink-700">
                <input type="checkbox" checked={cotacao} disabled={readOnly || order != null}
                  onChange={(e) => { setCotacao(e.target.checked); if (e.target.checked && !validade) setValidade(todayStr()); }} />
                É cotação
              </label>
              {cotacao && (
                <label className="block">
                  <span className="text-xs font-semibold text-ink-600">Válida até</span>
                  <input type="date" value={validade} disabled={readOnly} onChange={(e) => setValidade(e.target.value)} className={cn(inputCls, 'mt-1')} />
                </label>
              )}
            </div>

            <textarea value={observacoes} disabled={readOnly} onChange={(e) => setObservacoes(e.target.value)}
              placeholder="Observações" rows={2} className={inputCls} />

            {comissao && comissao.status !== 'cancelada' && (
              <p className="rounded-xl bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
                {user?.role === 'admin'
                  ? <>Comissão prevista: <span className="tabnums font-bold">{brl(Number(comissao.valor_previsto))}</span> ({Number(comissao.percent_aplicado)}%) · vendedor {brl(Number(comissao.valor_vendedor))}</>
                  : <>Sua comissão prevista: <span className="tabnums font-bold">{brl(Number(comissao.valor_vendedor))}</span></>}
                {comissao.status === 'recebida' ? ' · recebida' : comissao.status === 'divergente' ? ' · divergente' : ''}
              </p>
            )}

            <div className="flex items-center justify-between gap-2 pt-1">
              <span className="tabnums text-sm font-bold text-ink-900">Total: {brl(total)}</span>
              <div className="flex gap-2">
                <Btn variant="ghost" type="button" onClick={onClose}>{readOnly ? 'Fechar' : 'Cancelar'}</Btn>
                {!readOnly && <Btn icon="check" type="submit" disabled={busy}>{busy ? '…' : 'Salvar pedido'}</Btn>}
              </div>
            </div>
          </form>
        </div>
      </Card>
    </div>
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
