import { useEffect, useState } from 'react';
import { api } from '../lib/api.ts';
import type { CatalogItem, PriceTable, RepresentedCompany } from '../lib/types.ts';
import { Badge, Btn, Card, EmptyState, Spinner, cn } from '../lib/ui.tsx';
import { Icon } from '../lib/icons.tsx';
import { brl, fmtDate } from '../lib/format.ts';

const inputCls = 'w-full rounded-xl border border-ink-200 bg-white px-3 py-2.5 text-sm text-ink-800 outline-none transition focus:border-brand-400 focus:ring-2 focus:ring-brand-200';

// Aba "Tabelas de preço" do Catálogo: uma tabela por representada/vigência;
// os itens apontam para o catálogo com preço acordado e teto de desconto.

interface ItemDraft { catalog_item_id: number; preco: string; desconto_max_pct: string }

export function PriceTables({ reps, catalog, adding, onCloseAdd }: {
  reps: RepresentedCompany[]; catalog: CatalogItem[]; adding: boolean; onCloseAdd: () => void;
}): React.JSX.Element {
  const [tables, setTables] = useState<PriceTable[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<PriceTable | null>(null);

  const load = async (): Promise<void> => {
    const r = await api.get<{ tables: PriceTable[] }>('/api/price-tables');
    setTables(r.tables);
    setLoading(false);
  };
  useEffect(() => { void load(); }, []);

  const remove = async (t: PriceTable): Promise<void> => {
    if (!confirm('Excluir esta tabela de preço?')) return;
    const before = tables;
    setTables((xs) => xs.filter((x) => x.id !== t.id));
    try { await api.del(`/api/price-tables/${t.id}`); }
    catch { setTables(before); alert('Não foi possível excluir a tabela.'); }
  };

  if (loading) return <Spinner />;

  return (
    <div className="space-y-2">
      {(adding || editing) && (
        <TableForm reps={reps} catalog={catalog} table={editing}
          onClose={() => { onCloseAdd(); setEditing(null); }}
          onSaved={() => { onCloseAdd(); setEditing(null); void load(); }} />
      )}
      {tables.length === 0 && !adding && (
        <EmptyState icon="layers" title="Nenhuma tabela de preço"
          hint="Crie uma tabela por representada com os preços e descontos acordados." />
      )}
      {tables.map((t) => (
        <div key={t.id} className={cn('flex items-start gap-3 rounded-xl border border-ink-200/70 bg-white p-3', !t.ativo && 'opacity-60')}>
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-ink-100 text-ink-500"><Icon name="layers" size={18} /></span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <p className="truncate text-sm font-semibold text-ink-800">{t.nome}</p>
              <Badge tone="brand">{t.represented_nome}</Badge>
              {!t.ativo && <Badge tone="neutral">inativa</Badge>}
            </div>
            <p className="mt-0.5 truncate text-xs text-ink-400">
              {fmtDate(t.vigencia_inicio)} → {t.vigencia_fim ? fmtDate(t.vigencia_fim) : 'sem fim'} · {t.itens} {t.itens === 1 ? 'item' : 'itens'}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <button onClick={() => void openEdit(t.id, setEditing)} aria-label="Editar tabela"
              className="grid h-8 w-8 place-items-center rounded-lg text-ink-400 hover:bg-ink-100"><Icon name="pencil" size={16} /></button>
            <button onClick={() => void remove(t)} aria-label="Excluir tabela"
              className="grid h-8 w-8 place-items-center rounded-lg text-ink-300 hover:bg-rose-50 hover:text-rose-500"><Icon name="trash" size={16} /></button>
          </div>
        </div>
      ))}
    </div>
  );
}

async function openEdit(id: number, setEditing: (t: PriceTable) => void): Promise<void> {
  const r = await api.get<{ table: PriceTable }>(`/api/price-tables/${id}`);
  setEditing(r.table);
}

function TableForm({ reps, catalog, table, onClose, onSaved }: {
  reps: RepresentedCompany[]; catalog: CatalogItem[]; table: PriceTable | null;
  onClose: () => void; onSaved: () => void;
}): React.JSX.Element {
  const [nome, setNome] = useState(table?.nome ?? '');
  const [representedId, setRepresentedId] = useState<string>(table ? String(table.represented_id) : '');
  const [inicio, setInicio] = useState(table?.vigencia_inicio?.slice(0, 10) ?? '');
  const [fim, setFim] = useState(table?.vigencia_fim?.slice(0, 10) ?? '');
  const [ativo, setAtivo] = useState(table?.ativo ?? true);
  const [items, setItems] = useState<ItemDraft[]>(
    (table?.items ?? []).map((i) => ({
      catalog_item_id: i.catalog_item_id, preco: String(i.preco),
      desconto_max_pct: i.desconto_max_pct != null ? String(i.desconto_max_pct) : '',
    })),
  );
  const [busy, setBusy] = useState(false);

  const disponiveis = catalog.filter((c) => c.ativo && !items.some((i) => i.catalog_item_id === c.id));
  const addItem = (id: number): void => {
    const cat = catalog.find((c) => c.id === id);
    setItems((xs) => [...xs, { catalog_item_id: id, preco: cat?.preco ?? '', desconto_max_pct: '' }]);
  };
  const setItem = (idx: number, patch: Partial<ItemDraft>): void =>
    setItems((xs) => xs.map((x, i) => (i === idx ? { ...x, ...patch } : x)));

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (!nome.trim() || representedId === '' || !inicio) return;
    if (items.some((i) => i.preco.trim() === '' || !Number.isFinite(Number(i.preco)))) {
      alert('Todo item precisa de preço.');
      return;
    }
    setBusy(true);
    const body = {
      nome: nome.trim(), represented_id: Number(representedId),
      vigencia_inicio: inicio, vigencia_fim: fim || null, ativo,
    };
    const payloadItems = items.map((i) => ({
      catalog_item_id: i.catalog_item_id, preco: Number(i.preco),
      desconto_max_pct: i.desconto_max_pct.trim() === '' ? null : Number(i.desconto_max_pct),
    }));
    try {
      if (table) {
        await api.patch(`/api/price-tables/${table.id}`, body);
        await api.put(`/api/price-tables/${table.id}/items`, { items: payloadItems });
      } else {
        await api.post('/api/price-tables', { ...body, items: payloadItems });
      }
      onSaved();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Não foi possível salvar a tabela.');
    } finally { setBusy(false); }
  };

  return (
    <Card className="border-brand-200 bg-brand-50/40 p-3">
      <form onSubmit={submit} className="space-y-2.5">
        <div className="grid gap-2.5 sm:grid-cols-2">
          <input autoFocus value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Nome da tabela *" className={inputCls} />
          <select value={representedId} onChange={(e) => setRepresentedId(e.target.value)} className={inputCls}>
            <option value="">Representada *</option>
            {reps.map((r) => <option key={r.id} value={r.id}>{r.nome}</option>)}
          </select>
        </div>
        <div className="grid gap-2.5 sm:grid-cols-3">
          <label className="block">
            <span className="text-xs font-semibold text-ink-600">Vigência início *</span>
            <input type="date" value={inicio} onChange={(e) => setInicio(e.target.value)} className={cn(inputCls, 'mt-1')} />
          </label>
          <label className="block">
            <span className="text-xs font-semibold text-ink-600">Vigência fim</span>
            <input type="date" value={fim} onChange={(e) => setFim(e.target.value)} className={cn(inputCls, 'mt-1')} />
          </label>
          <label className="mt-5 flex items-center gap-2 text-sm text-ink-700">
            <input type="checkbox" checked={ativo} onChange={(e) => setAtivo(e.target.checked)} /> Ativa
          </label>
        </div>

        <div className="space-y-1.5">
          {items.map((i, idx) => {
            const cat = catalog.find((c) => c.id === i.catalog_item_id);
            return (
              <div key={i.catalog_item_id} className="flex items-center gap-2 rounded-xl border border-ink-200/70 bg-white p-2">
                <span className="min-w-0 flex-1 truncate text-sm text-ink-700">{cat?.nome ?? `#${i.catalog_item_id}`}</span>
                <input type="number" min="0" step="0.01" value={i.preco} aria-label={`Preço ${cat?.nome ?? i.catalog_item_id}`}
                  onChange={(e) => setItem(idx, { preco: e.target.value })} placeholder="Preço *"
                  className="w-28 rounded-lg border border-ink-200 px-2 py-1.5 text-sm" />
                <input type="number" min="0" max="100" step="0.01" value={i.desconto_max_pct} aria-label={`Desconto máx ${cat?.nome ?? i.catalog_item_id}`}
                  onChange={(e) => setItem(idx, { desconto_max_pct: e.target.value })} placeholder="Desc. máx %"
                  className="w-28 rounded-lg border border-ink-200 px-2 py-1.5 text-sm" />
                <button type="button" aria-label="Remover item" onClick={() => setItems((xs) => xs.filter((_, j) => j !== idx))}
                  className="grid h-8 w-8 place-items-center rounded-lg text-ink-300 hover:bg-rose-50 hover:text-rose-500"><Icon name="x" size={15} /></button>
              </div>
            );
          })}
          {disponiveis.length > 0 && (
            <select value="" aria-label="Adicionar produto"
              onChange={(e) => { if (e.target.value !== '') addItem(Number(e.target.value)); }} className={inputCls}>
              <option value="">+ Adicionar produto do catálogo…</option>
              {disponiveis.map((c) => (
                <option key={c.id} value={c.id}>{c.nome}{c.preco != null ? ` (${brl(Number(c.preco))})` : ''}</option>
              ))}
            </select>
          )}
        </div>

        <div className="flex justify-end gap-2">
          <Btn variant="ghost" type="button" onClick={onClose}>Cancelar</Btn>
          <Btn icon="check" type="submit" disabled={busy}>{busy ? '…' : 'Salvar tabela'}</Btn>
        </div>
      </form>
    </Card>
  );
}
