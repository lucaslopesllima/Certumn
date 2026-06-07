import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { MapContainer, TileLayer, CircleMarker, Popup, useMap } from 'react-leaflet';
import type { LatLngBoundsExpression } from 'leaflet';
import { api, ApiError } from '../lib/api.ts';
import type { Recommendation } from '../lib/types.ts';
import { Btn, Badge, Card, EmptyState, PageHeader, ScoreBar, Segmented, Spinner, StatCard, cn, type Tone } from '../lib/ui.tsx';
import { Icon } from '../lib/icons.tsx';
import { CompanyFilterBar, useCompanyFilter } from '../lib/companyFilter.tsx';
import { CompanyModal } from '../lib/companyModal.tsx';
import { Cnae } from '../lib/cnae.tsx';

const MATCH_COLOR: Record<string, string> = {
  classe: '#039855', divisao: '#0284c7', secao: '#12b76a', nenhum: '#94a3b8',
};
const MATCH_LABEL: Record<string, string> = {
  classe: 'CNAE exato', divisao: 'Mesma divisão', secao: 'Mesma seção', nenhum: 'Sem match',
};
const MATCH_TONE: Record<string, Tone> = {
  classe: 'success', divisao: 'info', secao: 'brand', nenhum: 'neutral',
};

function FitBounds({ recs, focus }: { recs: Recommendation[]; focus: MapFocus | null }): null {
  const map = useMap();
  useEffect(() => {
    if (focus) return;  // com foco ativo, quem manda é o FlyTo
    const pts = recs.filter((r) => r.lat && r.lon).map((r) => [r.lat, r.lon] as [number, number]);
    if (pts.length > 0) map.fitBounds(pts as LatLngBoundsExpression, { padding: [40, 40], maxZoom: 13 });
  }, [recs, map, focus]);
  return null;
}

type MapFocus = { id: string; lat: number; lon: number };

// Centraliza/zoom na empresa focada (botão "Ver no mapa").
function FlyTo({ focus }: { focus: MapFocus | null }): null {
  const map = useMap();
  useEffect(() => {
    if (focus) map.setView([focus.lat, focus.lon], 15, { animate: true });
  }, [focus, map]);
  return null;
}

export function Recommend(): React.JSX.Element {
  const [recs, setRecs] = useState<Recommendation[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [offset, setOffset] = useState(0);
  const [done, setDone] = useState(false);
  const [added, setAdded] = useState<Set<string>>(new Set());
  const [view, setView] = useState<'lista' | 'mapa'>('lista');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [viewing, setViewing] = useState<number | null>(null);
  const [focus, setFocus] = useState<MapFocus | null>(null);
  const filter = useCompanyFilter('prospeccao');
  const LIMIT = 20;

  // nº de filtros ativos. Regra: 0 = recomendação normal; >=2 = busca na base;
  // exatamente 1 é bloqueado (1 filtro só varreria milhões — sobrecarga).
  const nFiltros = [filter.fq.trim(), filter.fCnae.trim(), filter.fUf.trim(), filter.fPorte]
    .filter(Boolean).length;
  const filtroIncompleto = nFiltros === 1;

  const load = async (off: number): Promise<void> => {
    setLoading(true);
    setErr('');
    try {
      const qs = new URLSearchParams({ limit: String(LIMIT), offset: String(off) });
      if (filter.fq.trim()) qs.set('q', filter.fq.trim());
      if (filter.fCnae.trim()) qs.set('cnae', filter.fCnae.trim());
      if (filter.fUf.trim()) qs.set('uf', filter.fUf.trim());
      if (filter.fPorte) qs.set('porte', filter.fPorte);
      const r = await api.get<{ results: Recommendation[]; page: { count: number } }>(
        `/api/recommend?${qs.toString()}`,
      );
      setRecs((prev) => (off === 0 ? r.results : [...prev, ...r.results]));
      setDone(r.results.length < LIMIT);
      setOffset(off + r.results.length);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Erro ao buscar recomendações');
    } finally {
      setLoading(false);
    }
  };

  // recarrega do servidor (página 0) ao mudar qualquer filtro — busca na BASE TODA,
  // com debounce p/ não disparar a cada tecla. Roda também no mount.
  useEffect(() => {
    if (filtroIncompleto) return;  // exige 0 ou >=2 filtros — não consulta com 1 só
    const t = setTimeout(() => { void load(0); }, 350);
    return () => clearTimeout(t);
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [filter.fq, filter.fCnae, filter.fUf, filter.fPorte]);

  const addToFunnel = async (rec: Recommendation): Promise<void> => {
    try {
      await api.post('/api/relationships', { company_id: Number(rec.id) });
      setAdded((s) => new Set(s).add(rec.id));
    } catch (e) {
      alert((e as Error).message);
    }
  };

  const verNoMapa = (rec: Recommendation): void => {
    if (rec.lat == null || rec.lon == null) { alert('Empresa sem localização geográfica.'); return; }
    setFocus({ id: rec.id, lat: rec.lat, lon: rec.lon });
    setView('mapa');
  };

  // server já filtrou — nada de filtro client-side aqui.
  const visibleRecs = recs;

  const center = useMemo<[number, number]>(() => {
    const first = visibleRecs.find((r) => r.lat && r.lon);
    return first ? [first.lat, first.lon] : [-15.78, -47.93];
  }, [visibleRecs]);

  // analytics KPIs derived from the visible (filtered) recommendations
  const kpi = useMemo(() => {
    const n = visibleRecs.length;
    const avg = n ? visibleRecs.reduce((s, r) => s + r.score, 0) / n : 0;
    const exact = visibleRecs.filter((r) => r.reason.cnae_match === 'classe').length;
    const dists = visibleRecs.filter((r) => r.reason.distancia_km != null).map((r) => r.reason.distancia_km);
    const near = dists.length ? Math.min(...dists) : 0;
    return { n, avg, exact, near };
  }, [visibleRecs]);

  if (err && recs.length === 0) {
    return (
      <div className="p-4 sm:p-6">
        <Card className="border-amber-200 bg-amber-50 p-5">
          <p className="font-semibold text-amber-900">{err}</p>
          <Link to="/config" className="mt-2 inline-flex items-center gap-1 text-sm font-semibold text-brand-700 hover:underline">
            Configurar perfil-alvo <Icon name="chevronRight" size={15} />
          </Link>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="space-y-4 p-4 sm:p-6">
        <PageHeader
          title="Empresas recomendadas"
          subtitle={`${recs.length} no seu território · ranqueadas por fit`}
          actions={
            <div className="flex items-center gap-2">
              <Btn variant={filter.filtroAtivo ? 'primary' : 'soft'} icon="search" onClick={() => setFiltersOpen((v) => !v)}>
                Filtros{filter.filtroAtivo ? ' · ativos' : ''}
              </Btn>
              <Segmented value={view} onChange={(v) => { setFocus(null); setView(v); }} options={[
                { value: 'lista', label: 'Lista', icon: 'list' },
                { value: 'mapa', label: 'Mapa', icon: 'map' },
              ]} />
            </div>
          }
        />

        {filtersOpen && <CompanyFilterBar f={filter} />}

        {filtroIncompleto && (
          <Card className="border-amber-200 bg-amber-50 p-3">
            <p className="inline-flex items-center gap-2 text-sm text-amber-900">
              <Icon name="search" size={15} />
              Aplique <b>ao menos 2 filtros</b>.
            </p>
          </Card>
        )}

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard label={filter.filtroAtivo ? 'Resultados (filtrados)' : 'Recomendações'} value={kpi.n} icon="building" tone="brand" />
          <StatCard label="Score médio" value={(kpi.avg * 100).toFixed(0)} sub="de 100" icon="trendingUp" tone="success" />
          <StatCard label="CNAE exato" value={kpi.exact} sub="match de classe" icon="target" tone="info" />
          <StatCard label="Mais próxima" value={`${kpi.near.toFixed(0)} km`} icon="mapPin" tone="warn" />
        </div>
      </div>

      {view === 'mapa' ? (
        <div className="min-h-0 flex-1 px-4 pb-4 sm:px-6 sm:pb-6">
          <Card className="h-full overflow-hidden p-0">
            <MapContainer center={center} zoom={11} className="h-full w-full" scrollWheelZoom>
              <TileLayer attribution='&copy; OpenStreetMap' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
              <FitBounds recs={visibleRecs} focus={focus} />
              <FlyTo focus={focus} />
              {visibleRecs.filter((r) => r.lat && r.lon).map((r) => {
                const isFocus = focus?.id === r.id;
                return (
                <CircleMarker key={r.id} center={[r.lat, r.lon]} radius={isFocus ? 11 : 7}
                  ref={isFocus ? (m) => { m?.openPopup(); } : undefined}
                  pathOptions={{ color: isFocus ? '#dc2626' : MATCH_COLOR[r.reason.cnae_match],
                    weight: isFocus ? 3 : 1, fillOpacity: isFocus ? 0.9 : 0.7 }}>
                  <Popup>
                    <div className="space-y-1">
                      <p className="font-semibold">{r.razao_social}</p>
                      <p className="text-xs">Score {(r.score * 100).toFixed(0)} · {r.reason.distancia_km} km</p>
                      <button onClick={() => setViewing(Number(r.id))} className="text-xs font-semibold text-brand-700 underline">Ver dados da empresa</button>
                      {added.has(r.id)
                        ? <span className="text-xs text-emerald-600">✓ no funil</span>
                        : <button onClick={() => addToFunnel(r)} className="text-xs font-semibold text-brand-700 underline">+ Adicionar ao funil</button>}
                    </div>
                  </Popup>
                </CircleMarker>
                );
              })}
            </MapContainer>
          </Card>
        </div>
      ) : (
        <div className="min-h-0 flex-1 space-y-3 overflow-auto px-4 pb-4 sm:px-6 sm:pb-6">
          {visibleRecs.map((r) => (
            <RecCard key={r.id} rec={r} added={added.has(r.id)} onAdd={() => addToFunnel(r)}
              onView={() => setViewing(Number(r.id))} onViewMap={() => verNoMapa(r)} />
          ))}
          {!loading && recs.length > 0 && visibleRecs.length === 0 && (
            <p className="py-6 text-center text-sm text-ink-400">Nenhuma recomendação bate com os filtros.</p>
          )}
          {loading && <Spinner />}
          {!loading && !done && !filtroIncompleto && (
            <Btn variant="ghost" onClick={() => load(offset)}
              className="w-full border border-ink-200 bg-white text-ink-600 hover:bg-ink-50">
              Carregar mais
            </Btn>
          )}
          {recs.length === 0 && !loading && (
            <EmptyState icon="building" title="Nenhuma empresa nova no território"
              hint="Ajuste seus CNAEs-alvo ou amplie o território no Perfil-alvo." />
          )}
        </div>
      )}

      {viewing !== null && <CompanyModal companyId={viewing} onClose={() => setViewing(null)} />}
    </div>
  );
}

function RecCard({ rec, added, onAdd, onView, onViewMap }: { rec: Recommendation; added: boolean; onAdd: () => void; onView: () => void; onViewMap: () => void }): React.JSX.Element {
  const c = rec.reason.componentes;
  const score = rec.score * 100;
  return (
    <Card className="p-4 transition-shadow hover:shadow-pop">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-ink-100 text-ink-500">
            <Icon name="building" size={20} />
          </span>
          <div className="min-w-0">
            <div className="flex items-center gap-1">
              <p className="truncate font-semibold text-ink-900">{rec.nome_fantasia || rec.razao_social}</p>
              <button type="button" onClick={onView} title="Ver dados da empresa"
                className="shrink-0 rounded-md p-0.5 text-ink-300 transition hover:bg-ink-100 hover:text-brand-600">
                <Icon name="eye" size={15} />
              </button>
            </div>
            <p className="truncate text-xs text-ink-400">{rec.razao_social} · {rec.uf}</p>
          </div>
        </div>
        <div className="shrink-0 text-right">
          <div className={cn('tabnums text-xl font-bold', score >= 70 ? 'text-emerald-600' : score >= 40 ? 'text-brand-600' : 'text-ink-500')}>
            {score.toFixed(0)}
          </div>
          <div className="text-[10px] font-semibold uppercase tracking-wide text-ink-400">score</div>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        <Badge tone={MATCH_TONE[rec.reason.cnae_match]}>{MATCH_LABEL[rec.reason.cnae_match]}</Badge>
        <Badge tone="neutral"><Cnae code={rec.cnae_principal} /></Badge>
        <Badge tone="neutral"><Icon name="mapPin" size={12} />{rec.reason.distancia_km} km</Badge>
        <Badge tone="neutral">porte {rec.reason.porte}</Badge>
      </div>

      <div className="mt-3 flex gap-2">
        <ScoreBar label="CNAE" value={c.cnae} />
        <ScoreBar label="Prox." value={c.proximidade} />
        <ScoreBar label="Porte" value={c.porte} />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {added
          ? <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-emerald-600"><Icon name="check" size={16} /> Adicionado ao funil</span>
          : <Btn size="sm" icon="plus" onClick={onAdd}>Adicionar ao funil</Btn>}
        {rec.lat != null && rec.lon != null && (
          <Btn size="sm" variant="soft" icon="map" onClick={onViewMap}>Ver no mapa</Btn>
        )}
      </div>
    </Card>
  );
}
