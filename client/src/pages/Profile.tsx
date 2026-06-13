import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api.ts';
import type { CnaeGrupo, CnaeItem, Municipio, Profile as TProfile } from '../lib/types.ts';
import { Btn, Card, Spinner, cn } from '../lib/ui.tsx';
import { Icon } from '../lib/icons.tsx';
import { Cnae, seedCnae } from '../lib/cnae.tsx';
import { useOptionalUser } from '../lib/auth.tsx';
import { useSellers, sellerLabel } from '../lib/sellers.tsx';
import { toast } from '../lib/toast.tsx';

const DIV_LABEL = (secao: string): string =>
  secao === 'C' ? 'Indústria / Fabricação' : secao === 'G' ? 'Comércio' : `Seção ${secao}`;
const inputCls = 'w-full rounded-xl border border-ink-200 bg-white px-3 py-2.5 text-sm text-ink-800 outline-none transition focus:border-brand-400 focus:ring-2 focus:ring-brand-200';

function SectionTitle({ title, hint }: { title: string; hint?: string }): React.JSX.Element {
  return (
    <div className="mb-3">
      <h3 className="text-sm font-semibold text-ink-900">{title}</h3>
      {hint && <p className="mt-0.5 text-xs text-ink-400">{hint}</p>}
    </div>
  );
}

export function ProfileForm(): React.JSX.Element {
  const user = useOptionalUser();
  const sellers = useSellers();
  // escopo do perfil em edição (admin): null = perfil padrão da org, ou um vendedor.
  // rep edita sempre o próprio (backend ignora o escopo do payload).
  const [scopeUser, setScopeUser] = useState<number | null>(null);
  const [cnaes, setCnaes] = useState<CnaeItem[]>([]);          // selected, with labels
  const [selMun, setSelMun] = useState<Municipio[]>([]);       // selected municipios (full objects → chip labels)
  const [raio, setRaio] = useState<number | ''>('');
  const [pesos, setPesos] = useState({ cnae: 0.5, proximidade: 0.3, porte: 0.2 });
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);

  // origem fixa p/ cálculo de rota
  const [origemEndereco, setOrigemEndereco] = useState('');
  const [origemLat, setOrigemLat] = useState<number | null>(null);
  const [origemLon, setOrigemLon] = useState<number | null>(null);
  const [geocoding, setGeocoding] = useState(false);

  // CNAE search
  const [q, setQ] = useState('');
  const [grupos, setGrupos] = useState<CnaeGrupo[]>([]);
  const [searching, setSearching] = useState(false);
  const debounce = useRef<number | undefined>(undefined);

  // municipio search (typeahead)
  const [munQ, setMunQ] = useState('');
  const [munResults, setMunResults] = useState<Municipio[]>([]);
  const munDebounce = useRef<number | undefined>(undefined);

  // UF list (+ totals) for whole-state selection
  const [ufs, setUfs] = useState<{ uf: string; total: number }[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const qs = user?.role === 'admin' && scopeUser !== null ? `?user_id=${scopeUser}` : '';
      const [p, u] = await Promise.all([
        api.get<{ profile: TProfile | null }>(`/api/profile${qs}`),
        api.get<{ ufs: { uf: string; total: number }[] }>('/api/municipios/ufs'),
      ]);
      if (cancelled) return;
      setUfs(u.ufs);
      // limpa estado anterior ao trocar de escopo
      setCnaes([]); setSelMun([]); setRaio(''); setPesos({ cnae: 0.5, proximidade: 0.3, porte: 0.2 });
      setOrigemEndereco(''); setOrigemLat(null); setOrigemLon(null);
      if (p.profile) {
        setRaio(p.profile.territorio_raio_km ?? '');
        if (p.profile.pesos) setPesos({ ...{ cnae: 0.5, proximidade: 0.3, porte: 0.2 }, ...p.profile.pesos });
        setOrigemEndereco(p.profile.origem_endereco ?? '');
        setOrigemLat(p.profile.origem_lat ?? null);
        setOrigemLon(p.profile.origem_lon ?? null);
        const codes = p.profile.cnaes_alvo ?? [];
        if (codes.length) {
          const r = await api.get<{ labels: CnaeItem[] }>(`/api/cnae/labels?codes=${codes.join(',')}`);
          if (!cancelled) setCnaes(r.labels);
        }
        const mids = p.profile.territorio_municipios ?? [];
        if (mids.length) {
          const mr = await api.get<{ municipios: Municipio[] }>(`/api/municipios/labels?ids=${mids.join(',')}`);
          if (!cancelled) setSelMun(mr.municipios);
        }
      }
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [scopeUser, user?.role]);

  // pré-popula o cache de descrições dos CNAEs selecionados (chips traduzem na hora)
  useEffect(() => { for (const c of cnaes) seedCnae(c.codigo, c.descricao); }, [cnaes]);

  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current);
    if (q.trim().length < 2) { setGrupos([]); setSearching(false); return; }
    setSearching(true);
    debounce.current = window.setTimeout(async () => {
      try {
        const r = await api.get<{ grupos: CnaeGrupo[] }>(`/api/cnae/search?q=${encodeURIComponent(q.trim())}`);
        setGrupos(r.grupos);
      } finally { setSearching(false); }
    }, 300);
  }, [q]);

  useEffect(() => {
    if (munDebounce.current) clearTimeout(munDebounce.current);
    if (munQ.trim().length < 1) { setMunResults([]); return; }
    munDebounce.current = window.setTimeout(async () => {
      const r = await api.get<{ municipios: Municipio[] }>(`/api/municipios/search?q=${encodeURIComponent(munQ.trim())}`);
      setMunResults(r.municipios);
    }, 250);
  }, [munQ]);

  const toggleCnae = (item: CnaeItem): void => {
    setCnaes((prev) => prev.some((c) => c.codigo === item.codigo)
      ? prev.filter((c) => c.codigo !== item.codigo)
      : [...prev, item]);
  };
  const addMun = (m: Municipio): void => {
    setSelMun((prev) => prev.some((x) => x.id === m.id) ? prev : [...prev, m]);
    setMunQ(''); setMunResults([]);
  };
  const removeMun = (id: number): void => setSelMun((prev) => prev.filter((x) => x.id !== id));
  const removeUf = (uf: string): void => setSelMun((prev) => prev.filter((x) => x.uf !== uf));
  const toggleUf = async (uf: string, full: boolean): Promise<void> => {
    if (full) { removeUf(uf); return; }
    const r = await api.get<{ municipios: Municipio[] }>(`/api/municipios/by-uf?uf=${uf}`);
    setSelMun((prev) => {
      const ids = new Set(prev.map((m) => m.id));
      return [...prev, ...r.municipios.filter((m) => !ids.has(m.id))];
    });
  };

  // Geocodifica o endereço via Nominatim (OSM) → lat/lon.
  const geocodar = async (): Promise<void> => {
    const q = origemEndereco.trim();
    if (!q) return;
    setGeocoding(true);
    try {
      const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=br&q=${encodeURIComponent(q)}`;
      const resp = await fetch(url, { headers: { 'Accept-Language': 'pt-BR' } });
      const arr = await resp.json() as { lat: string; lon: string; display_name: string }[];
      if (!arr.length) { toast.error('Endereço não encontrado.'); return; }
      setOrigemLat(Number(arr[0]!.lat));
      setOrigemLon(Number(arr[0]!.lon));
      toast.success('Coordenadas encontradas.');
    } catch { toast.error('Falha ao geocodificar.'); }
    finally { setGeocoding(false); }
  };

  const save = async (): Promise<void> => {
    try {
      await api.put('/api/profile', {
        user_id: user?.role === 'admin' ? scopeUser : undefined,
        cnaes_alvo: cnaes.map((c) => c.codigo),
        territorio_municipios: selMun.map((m) => m.id),
        territorio_raio_km: raio === '' ? null : Number(raio),
        pesos,
        origem_endereco: origemEndereco.trim() || null,
        origem_lat: origemLat,
        origem_lon: origemLon,
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      toast.success('Perfil-alvo salvo.');
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Não foi possível salvar o perfil.'); }
  };

  if (loading) return <div className="p-6"><Spinner /></div>;

  // territory aggregation: which UFs are fully covered → collapse to a state chip
  const countByUf: Record<string, number> = {};
  for (const m of selMun) countByUf[m.uf] = (countByUf[m.uf] ?? 0) + 1;
  const isFull = (uf: string, total: number): boolean => (countByUf[uf] ?? 0) === total && total > 0;
  const fullUfs = ufs.filter((u) => isFull(u.uf, u.total)).map((u) => u.uf);
  const looseCities = selMun.filter((m) => !fullUfs.includes(m.uf)).sort((a, b) => a.nome.localeCompare(b.nome));

  return (
    <div className="space-y-5">
      {user?.role === 'admin' && sellers.length > 1 && (
        <Card className="flex flex-wrap items-center gap-2 p-3">
          <span className="text-xs font-semibold text-ink-600">Perfil-alvo de:</span>
          <select value={scopeUser ?? 'org'}
            onChange={(e) => setScopeUser(e.target.value === 'org' ? null : Number(e.target.value))}
            className={cn(inputCls, 'w-auto')}>
            <option value="org">Padrão da organização</option>
            {sellers.map((u) => <option key={u.id} value={u.id}>{sellerLabel(u)}</option>)}
          </select>
          <span className="text-xs text-ink-400">
            {scopeUser === null
              ? 'Usado por vendedores sem perfil próprio.'
              : 'Sobrescreve o padrão para este vendedor na recomendação.'}
          </span>
        </Card>
      )}
      <div className="grid gap-5 xl:grid-cols-2">
      {/* CNAE search */}
      <Card className="p-4">
        <SectionTitle title="CNAEs-alvo" hint="Digite um termo livre (ex.: “roupas”, “padaria”)." />
        <div className="relative">
          <Icon name="search" size={17} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar CNAE…" className={cn(inputCls, 'pl-9')} />
          {searching && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] text-ink-400">buscando…</span>}
        </div>
        {q.trim().length >= 2 && !searching && grupos.length === 0 && (
          <p className="mt-2 text-xs text-ink-400">Nenhum CNAE encontrado para “{q.trim()}”.</p>
        )}

        {cnaes.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {cnaes.map((c) => (
              <button key={c.codigo} onClick={() => toggleCnae(c)} title={`${c.codigo} — ${c.descricao}`}
                className="inline-flex items-center gap-1 rounded-full bg-brand-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-brand-700">
                <span className="tabnums opacity-80">{c.codigo}</span>
                <Cnae code={c.codigo} className="!cursor-pointer text-white" />
                <Icon name="x" size={12} />
              </button>
            ))}
          </div>
        )}

        {grupos.map((g) => (
          <div key={g.divisao} className="mt-4">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-400">
              {DIV_LABEL(g.secao)} · divisão {g.divisao}
            </p>
            <div className="mt-1 space-y-1">
              {g.itens.map((it) => {
                const on = cnaes.some((c) => c.codigo === it.codigo);
                return (
                  <button key={it.codigo} onClick={() => toggleCnae(it)}
                    className={cn('flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition-colors',
                      on ? 'bg-brand-50 text-brand-700' : 'text-ink-700 hover:bg-ink-50')}>
                    <span className={cn('grid h-4 w-4 shrink-0 place-items-center rounded border',
                      on ? 'border-brand-600 bg-brand-600 text-white' : 'border-ink-300 text-transparent')}>
                      <Icon name="check" size={11} />
                    </span>
                    <span className="tabnums text-xs text-ink-400">{it.codigo}</span>
                    <span className="truncate">{it.descricao}</span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </Card>

      {/* Territory */}
      <Card className="p-4">
        <SectionTitle title="Território" hint="Busque e adicione os municípios. O raio (km) é opcional — quando definido, recomenda por proximidade ao centro do território." />

        {/* whole-state selection */}
        <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-ink-400">Por estado</p>
        <div className="flex flex-wrap gap-1">
          {ufs.map((u) => {
            const full = isFull(u.uf, u.total);
            const partial = !full && (countByUf[u.uf] ?? 0) > 0;
            return (
              <button key={u.uf} onClick={() => void toggleUf(u.uf, full)} title={`${u.total} municípios`}
                className={cn('rounded-lg px-2 py-1 text-xs font-bold transition-colors',
                  full ? 'bg-brand-600 text-white hover:bg-brand-700'
                    : partial ? 'bg-brand-50 text-brand-700 ring-1 ring-inset ring-brand-200'
                    : 'bg-ink-100 text-ink-500 hover:bg-ink-200')}>
                {u.uf}{partial && <span className="ml-1 font-medium opacity-70">{countByUf[u.uf]}</span>}
              </button>
            );
          })}
        </div>

        {/* city typeahead */}
        <p className="mb-1.5 mt-4 text-[11px] font-semibold uppercase tracking-wider text-ink-400">Por cidade</p>
        <div className="relative">
          <Icon name="search" size={17} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
          <input value={munQ} onChange={(e) => setMunQ(e.target.value)} placeholder="Buscar cidade (ex.: Blumenau)…" className={cn(inputCls, 'pl-9')} />
          {munResults.length > 0 && (
            <div className="absolute z-20 mt-1 max-h-60 w-full overflow-auto rounded-xl border border-ink-200 bg-white py-1 shadow-pop">
              {munResults.map((m) => {
                const on = selMun.some((x) => x.id === m.id);
                return (
                  <button key={m.id} onClick={() => addMun(m)} disabled={on}
                    className={cn('flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-ink-50 disabled:opacity-40',
                      on && 'cursor-default')}>
                    <span className="truncate text-ink-700"><Icon name="mapPin" size={13} className="mr-1.5 inline text-ink-400" />{m.nome}</span>
                    <span className="shrink-0 text-xs font-semibold text-ink-400">{on ? 'adicionado' : m.uf}</span>
                  </button>
                );
              })}
            </div>
          )}
          {munQ.trim().length >= 1 && munResults.length === 0 && (
            <div className="absolute z-20 mt-1 w-full rounded-xl border border-ink-200 bg-white px-3 py-2.5 text-sm text-ink-400 shadow-pop">
              Nenhuma cidade encontrada para “{munQ.trim()}”.
            </div>
          )}
        </div>

        {/* selected: full states collapse to one chip, rest as city chips */}
        {selMun.length > 0 ? (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {fullUfs.map((uf) => (
              <button key={uf} onClick={() => removeUf(uf)}
                className="inline-flex items-center gap-1 rounded-full bg-ink-800 px-2.5 py-1 text-xs font-semibold text-white hover:bg-ink-900">
                <Icon name="layers" size={12} /> {uf} inteiro · {countByUf[uf]} <Icon name="x" size={12} />
              </button>
            ))}
            {looseCities.map((m) => (
              <button key={m.id} onClick={() => removeMun(m.id)}
                className="inline-flex items-center gap-1 rounded-full bg-brand-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-brand-700">
                {m.nome} <span className="text-brand-200">· {m.uf}</span> <Icon name="x" size={12} />
              </button>
            ))}
          </div>
        ) : (
          <p className="mt-3 text-xs text-ink-400">Nenhum município selecionado ainda.</p>
        )}

        <label className="mt-4 block">
          <span className="text-xs font-semibold text-ink-600">Raio (km) — opcional</span>
          <input type="number" min={0} value={raio} onChange={(e) => setRaio(e.target.value === '' ? '' : Number(e.target.value))}
            placeholder="ex.: 50" className={cn(inputCls, 'mt-1 w-32')} />
        </label>
      </Card>

      {/* Origem fixa p/ rotas */}
      <Card className="p-4 xl:col-span-2">
        <SectionTitle title="Origem das rotas" hint="Endereço-base usado como ponto de partida ao traçar rota até uma empresa. Se vazio, usa a localização do navegador." />
        <div className="flex flex-col gap-2 sm:flex-row">
          <input value={origemEndereco}
            onChange={(e) => { setOrigemEndereco(e.target.value); setOrigemLat(null); setOrigemLon(null); }}
            placeholder="Ex.: Rua das Flores, 100, Centro, Florianópolis - SC" className={cn(inputCls, 'flex-1')} />
          <Btn variant="soft" icon="search" onClick={() => void geocodar()} disabled={geocoding || !origemEndereco.trim()}>
            {geocoding ? 'Buscando…' : 'Buscar coordenadas'}
          </Btn>
        </div>
        {origemLat != null && origemLon != null ? (
          <p className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-emerald-600">
            <Icon name="mapPin" size={13} /> Coordenadas: {origemLat.toFixed(5)}, {origemLon.toFixed(5)}
          </p>
        ) : origemEndereco.trim() ? (
          <p className="mt-2 text-xs text-amber-600">Clique em “Buscar coordenadas” e salve para usar como origem.</p>
        ) : null}
      </Card>

      {/* Weights */}
      <Card className="p-4 xl:col-span-2">
        <SectionTitle title="Pesos do score" hint="Quanto cada fator influencia o ranqueamento." />
        {(['cnae', 'proximidade', 'porte'] as const).map((k) => (
          <label key={k} className="mt-3 block">
            <div className="flex justify-between text-xs font-semibold text-ink-600">
              <span className="capitalize">{k}</span><span className="tabnums text-brand-600">{pesos[k].toFixed(2)}</span>
            </div>
            <input type="range" min={0} max={1} step={0.05} value={pesos[k]}
              onChange={(e) => setPesos((p) => ({ ...p, [k]: Number(e.target.value) }))}
              className="mt-1.5 w-full accent-brand-600" />
          </label>
        ))}
      </Card>
      </div>

      <div className="flex items-center gap-3">
        <Btn icon="check" onClick={save}>Salvar perfil</Btn>
        {saved && <span className="inline-flex items-center gap-1 text-sm font-semibold text-emerald-600"><Icon name="check" size={16} /> Salvo</span>}
      </div>
    </div>
  );
}
