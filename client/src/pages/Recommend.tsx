import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { MapContainer, TileLayer, CircleMarker, Popup, Polyline, Tooltip, useMap, useMapEvents } from 'react-leaflet';
import type { LatLngBoundsExpression } from 'leaflet';
import { api, ApiError } from '../lib/api.ts';
import type { Recommendation, GeocodeResult } from '../lib/types.ts';
import { Btn, Badge, Card, EmptyState, PageHeader, ScoreBar, Segmented, Spinner, StatCard, cn, type Tone } from '../lib/ui.tsx';
import { Icon } from '../lib/icons.tsx';
import { CompanyFilterBar, useCompanyFilter } from '../lib/companyFilter.tsx';
import { CompanyModal } from '../lib/companyModal.tsx';
import { Cnae } from '../lib/cnae.tsx';
import { useSellers, SellerFilter } from '../lib/sellers.tsx';

const MATCH_COLOR: Record<string, string> = {
  classe: '#039855', divisao: '#0284c7', secao: '#12b76a', nenhum: '#94a3b8',
};
const MATCH_LABEL: Record<string, string> = {
  classe: 'CNAE exato', divisao: 'Mesma divisão', secao: 'Mesma seção', nenhum: 'Sem match',
};
const MATCH_TONE: Record<string, Tone> = {
  classe: 'success', divisao: 'info', secao: 'brand', nenhum: 'neutral',
};
const FILTERS_OPEN_KEY = 'prospeccao:filtersOpen';

function FitBounds({ pts, focus }: { pts: [number, number][]; focus: MapFocus | null }): null {
  const map = useMap();
  useEffect(() => {
    if (focus) return;  // com foco ativo, quem manda é o FlyTo
    if (pts.length > 0) map.fitBounds(pts as LatLngBoundsExpression, { padding: [40, 40], maxZoom: 13 });
  }, [pts, map, focus]);
  return null;
}

type MapFocus = { id: string; lat: number; lon: number };
type RouteInfo = { destId: string; origem: [number, number]; coords: [number, number][]; distKm: number; durMin: number };

// Centraliza/zoom na empresa focada (botão "Ver no mapa").
function FlyTo({ focus }: { focus: MapFocus | null }): null {
  const map = useMap();
  useEffect(() => {
    if (focus) map.setView([focus.lat, focus.lon], 15, { animate: true });
  }, [focus, map]);
  return null;
}

// Enquadra a rota traçada (origem + destino).
function FitRoute({ coords }: { coords: [number, number][] }): null {
  const map = useMap();
  useEffect(() => {
    if (coords.length > 0) map.fitBounds(coords as LatLngBoundsExpression, { padding: [50, 50] });
  }, [coords, map]);
  return null;
}

type Ponto = { r: Recommendation; lat: number; lon: number; exato?: boolean };
type Cluster = { key: string; n: number; lat: number; lon: number };

// Acima deste nº de pontos, agrupa por célula de grade (~1/4 de tile no zoom
// atual) — centenas de CircleMarkers individuais pesam no DOM. Clique no
// cluster aproxima; ao dar zoom a grade refina e os grupos se abrem.
const CLUSTER_THRESHOLD = 150;

function RecMarkers({ pontos, focus, renderMarker }: {
  pontos: Ponto[]; focus: MapFocus | null; renderMarker: (p: Ponto) => React.JSX.Element;
}): React.JSX.Element {
  const map = useMap();
  const [zoom, setZoom] = useState(map.getZoom());
  useMapEvents({ zoomend: () => setZoom(map.getZoom()) });

  const { singles, clusters } = useMemo(() => {
    if (pontos.length <= CLUSTER_THRESHOLD) return { singles: pontos, clusters: [] as Cluster[] };
    const cell = 360 / Math.pow(2, zoom + 2);
    const buckets = new Map<string, Ponto[]>();
    const singles: Ponto[] = [];
    for (const p of pontos) {
      if (focus?.id === p.r.id) { singles.push(p); continue; } // foco nunca clusteriza
      const k = `${Math.floor(p.lat / cell)}:${Math.floor(p.lon / cell)}`;
      const b = buckets.get(k);
      if (b) b.push(p); else buckets.set(k, [p]);
    }
    const clusters: Cluster[] = [];
    for (const [key, b] of buckets) {
      if (b.length === 1) { singles.push(b[0]!); continue; }
      clusters.push({
        key, n: b.length,
        lat: b.reduce((s, p) => s + p.lat, 0) / b.length,
        lon: b.reduce((s, p) => s + p.lon, 0) / b.length,
      });
    }
    return { singles, clusters };
  }, [pontos, zoom, focus]);

  return (
    <>
      {singles.map(renderMarker)}
      {clusters.map((c) => (
        <CircleMarker key={`cluster:${c.key}`} center={[c.lat, c.lon]}
          radius={Math.min(20, 11 + Math.log2(c.n) * 1.5)}
          pathOptions={{ color: '#1d4ed8', fillColor: '#3b82f6', fillOpacity: 0.8, weight: 2 }}
          eventHandlers={{ click: () => map.setView([c.lat, c.lon], Math.min(zoom + 2, 16)) }}>
          <Tooltip permanent direction="center"
            className="!rounded-full !border-0 !bg-transparent !p-0 !shadow-none text-xs font-bold !text-white">
            {c.n}
          </Tooltip>
        </CircleMarker>
      ))}
    </>
  );
}

export function Recommend(): React.JSX.Element {
  const [recs, setRecs] = useState<Recommendation[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [offset, setOffset] = useState(0);
  const [done, setDone] = useState(false);
  const [added, setAdded] = useState<Set<string>>(new Set());
  const [view, setView] = useState<'lista' | 'mapa'>('lista');
  // simulação de vendedor (admin): vê a recomendação com o território/CNAEs do vendedor.
  const [simUser, setSimUser] = useState<'todos' | number>('todos');
  const sellers = useSellers();
  const [filtersOpen, setFiltersOpen] = useState(() => {
    try { return localStorage.getItem(FILTERS_OPEN_KEY) === '1'; } catch { return false; }
  });
  const [viewing, setViewing] = useState<number | null>(null);
  const [focus, setFocus] = useState<MapFocus | null>(null);
  const [route, setRoute] = useState<RouteInfo | null>(null);
  const [routingId, setRoutingId] = useState<string | null>(null);
  const [origemFixa, setOrigemFixa] = useState<{ lat: number; lon: number } | null>(null);
  const [geoCache, setGeoCache] = useState<Record<string, { lat: number; lon: number; precisao: string }>>({});
  const filter = useCompanyFilter('prospeccao');
  const LIMIT = 20;

  // Geocode sob demanda do endereço (lat/lon exato), cacheado no banco e em memória.
  // Fallback: a própria coord da recomendação (centroide do município).
  const geocodeRec = async (rec: Recommendation): Promise<{ lat: number; lon: number; precisao: string }> => {
    if (geoCache[rec.id]) return geoCache[rec.id]!;
    try {
      const r = await api.get<{ geocode: GeocodeResult }>(`/api/companies/${rec.id}/geocode`);
      const g = { lat: r.geocode.lat, lon: r.geocode.lon, precisao: r.geocode.precisao };
      setGeoCache((s) => ({ ...s, [rec.id]: g }));
      return g;
    } catch {
      return { lat: rec.lat, lon: rec.lon, precisao: 'municipio' };
    }
  };

  // origem fixa do perfil (config) p/ rotas
  useEffect(() => {
    void api.get<{ profile: { origem_lat: number | null; origem_lon: number | null } | null }>('/api/profile')
      .then((r) => {
        const p = r.profile;
        if (p?.origem_lat != null && p?.origem_lon != null) setOrigemFixa({ lat: p.origem_lat, lon: p.origem_lon });
      }).catch(() => undefined);
  }, []);

  // Rota (OSRM público) da localização atual do rep até a empresa escolhida.
  const traceRoute = async (rec: Recommendation): Promise<void> => {
    if (rec.lat == null || rec.lon == null) { alert('Empresa sem localização geográfica.'); return; }
    setRoutingId(rec.id);
    try {
      // origem = endereço do usuário logado (org) no banco, geocodificado;
      // fallbacks: origem do perfil-alvo -> geolocalização do navegador.
      let o: { lat: number; lon: number } | null = null;
      try {
        const r = await api.get<{ origem: { lat: number; lon: number } | null }>('/api/account/origem');
        if (r.origem) o = { lat: r.origem.lat, lon: r.origem.lon };
      } catch { /* ignora, tenta fallback */ }
      if (!o) o = origemFixa;
      if (!o) {
        if (!navigator.geolocation) { alert('Cadastre seu endereço em Configurações (conta) para traçar rotas.'); return; }
        const pos = await new Promise<GeolocationPosition>((res, rej) =>
          navigator.geolocation.getCurrentPosition(res, rej, { enableHighAccuracy: true, timeout: 10000 }));
        o = { lat: pos.coords.latitude, lon: pos.coords.longitude };
      }
      const d = await geocodeRec(rec); // destino exato (geocode do endereço)
      const url = `https://router.project-osrm.org/route/v1/driving/${o.lon},${o.lat};${d.lon},${d.lat}?overview=full&geometries=geojson`;
      const resp = await fetch(url);
      const j = await resp.json() as { code: string; routes?: { distance: number; duration: number; geometry: { coordinates: [number, number][] } }[] };
      if (j.code !== 'Ok' || !j.routes?.length) { alert('Não foi possível traçar a rota.'); return; }
      const rt = j.routes[0]!;
      setRoute({
        destId: rec.id,
        origem: [o.lat, o.lon],
        coords: rt.geometry.coordinates.map(([lon, lat]) => [lat, lon] as [number, number]),
        distKm: rt.distance / 1000,
        durMin: rt.duration / 60,
      });
      setView('mapa');
      setFocus(null);
    } catch (e) {
      alert(e instanceof GeolocationPositionError ? 'Permissão de localização negada.' : 'Falha ao traçar rota.');
    } finally { setRoutingId(null); }
  };

  // nº de filtros ativos. Regra: >=1 filtro busca na base; 0 filtros = tela vazia
  // (não busca nada, evita varrer a base inteira sem critério).
  const nFiltros = [filter.fq.trim(), filter.fCnae.trim(), filter.fUf.trim(), filter.fPorte]
    .filter(Boolean).length;
  const semFiltro = nFiltros === 0;

  // Aborta a busca anterior antes de disparar a próxima — sem isso uma resposta
  // lenta de filtro antigo pode sobrescrever a da busca atual (race).
  const loadCtl = useRef<AbortController | null>(null);
  const load = async (off: number): Promise<void> => {
    loadCtl.current?.abort();
    const ac = new AbortController();
    loadCtl.current = ac;
    setLoading(true);
    setErr('');
    try {
      const qs = new URLSearchParams({ limit: String(LIMIT), offset: String(off) });
      if (filter.fq.trim()) qs.set('q', filter.fq.trim());
      if (filter.fCnae.trim()) qs.set('cnae', filter.fCnae.trim());
      if (filter.fUf.trim()) qs.set('uf', filter.fUf.trim());
      if (filter.fPorte) qs.set('porte', filter.fPorte);
      if (simUser !== 'todos') qs.set('user_id', String(simUser));
      const r = await api.get<{ results: Recommendation[]; page: { count: number } }>(
        `/api/recommend?${qs.toString()}`, { signal: ac.signal },
      );
      setRecs((prev) => (off === 0 ? r.results : [...prev, ...r.results]));
      setDone(r.results.length < LIMIT);
      setOffset(off + r.results.length);
    } catch (e) {
      if (ac.signal.aborted) return; // busca substituída/página fechada — ignora
      setErr(e instanceof ApiError ? e.message : 'Erro ao buscar recomendações');
    } finally {
      if (!ac.signal.aborted) setLoading(false);
    }
  };
  useEffect(() => () => loadCtl.current?.abort(), []);

  // recarrega do servidor (página 0) ao mudar qualquer filtro — busca na BASE TODA,
  // com debounce p/ não disparar a cada tecla. Roda também no mount.
  useEffect(() => {
    if (semFiltro) {  // sem filtro -> tela vazia, sem consultar
      setRecs([]); setDone(true); setOffset(0); setErr('');
      setLoading(false); // sem isso o spinner inicial nunca dá lugar ao empty state
      return;
    }
    const t = setTimeout(() => { void load(0); }, 350);
    return () => clearTimeout(t);
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [filter.fq, filter.fCnae, filter.fUf, filter.fPorte, simUser]);

  // No mapa, plota só o que já está carregado na lista — sem auto-paginar.

  // Persiste se a barra de filtros está aberta.
  useEffect(() => {
    try { localStorage.setItem(FILTERS_OPEN_KEY, filtersOpen ? '1' : '0'); } catch { /* storage indisponível */ }
  }, [filtersOpen]);

  const addToFunnel = async (rec: Recommendation): Promise<void> => {
    try {
      await api.post('/api/relationships', { company_id: Number(rec.id) });
      setAdded((s) => new Set(s).add(rec.id));
    } catch (e) {
      alert((e as Error).message);
    }
  };

  const verNoMapa = async (rec: Recommendation): Promise<void> => {
    if (rec.lat == null || rec.lon == null) { alert('Empresa sem localização geográfica.'); return; }
    setView('mapa');
    const g = await geocodeRec(rec); // pino exato (geocode do endereço)
    setFocus({ id: rec.id, lat: g.lat, lon: g.lon });
  };

  // server já filtrou — nada de filtro client-side aqui.
  const visibleRecs = recs;

  const center = useMemo<[number, number]>(() => {
    const first = visibleRecs.find((r) => r.lat && r.lon);
    return first ? [first.lat, first.lon] : [-15.78, -47.93];
  }, [visibleRecs]);

  // Empresas da mesma cidade compartilham o centroide do município (sem geocode de
  // rua), então empilham num ponto só. Espalha em espiral quem divide coordenada,
  // pra TODOS os pontos ficarem visíveis e clicáveis.
  const pontos = useMemo(() => {
    const out: { r: Recommendation; lat: number; lon: number; exato?: boolean }[] = [];
    const grupos = new Map<string, Recommendation[]>();
    for (const r of visibleRecs) {
      if (r.lat == null || r.lon == null) continue;
      const e = geoCache[r.id];
      if (e) { out.push({ r, lat: e.lat, lon: e.lon, exato: e.precisao !== 'municipio' }); continue; }
      const k = `${r.lat.toFixed(5)},${r.lon.toFixed(5)}`;
      const g = grupos.get(k);
      if (g) g.push(r); else grupos.set(k, [r]);
    }
    for (const g of grupos.values()) {
      if (g.length === 1) { out.push({ r: g[0], lat: g[0].lat, lon: g[0].lon }); continue; }
      g.forEach((r, i) => {
        const ang = i * 2.3999632;             // ângulo áureo (rad)
        const rad = 0.0012 * Math.sqrt(i);     // cresce p/ fora (~centenas de metros)
        out.push({ r, lat: r.lat + rad * Math.cos(ang), lon: r.lon + rad * Math.sin(ang) });
      });
    }
    return out;
  }, [visibleRecs, geoCache]);
  const bounds = useMemo(() => pontos.map((p) => [p.lat, p.lon] as [number, number]), [pontos]);

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
          subtitle={semFiltro ? 'Selecione um filtro para buscar empresas' : `${recs.length} resultado(s) · ranqueados por fit`}
          actions={
            <div className="flex items-center gap-2">
              <SellerFilter value={simUser} onChange={setSimUser} sellers={sellers} />
              {view === 'lista' && (
                <Btn variant={filter.filtroAtivo ? 'primary' : 'soft'} icon="search" onClick={() => setFiltersOpen((v) => !v)}>
                  Filtros{filter.filtroAtivo ? ' · ativos' : ''}
                </Btn>
              )}
              <Segmented value={view} onChange={(v) => { setFocus(null); setView(v); }} options={[
                { value: 'lista', label: 'Lista', icon: 'list' },
                { value: 'mapa', label: 'Mapa', icon: 'map' },
              ]} />
            </div>
          }
        />

        {view === 'lista' && filtersOpen && <CompanyFilterBar f={filter} />}

        {view === 'lista' && (
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label={filter.filtroAtivo ? 'Resultados (filtrados)' : 'Recomendações'} value={kpi.n} icon="building" tone="brand" />
            <StatCard label="Score médio" value={(kpi.avg * 100).toFixed(0)} sub="de 100" icon="trendingUp" tone="success" />
            <StatCard label="CNAE exato" value={kpi.exact} sub="match de classe" icon="target" tone="info" />
            <StatCard label="Mais próxima" value={`${kpi.near.toFixed(0)} km`} icon="mapPin" tone="warn" />
          </div>
        )}
      </div>

      {view === 'mapa' ? (
        <div className="flex min-h-0 flex-1 flex-col gap-2 px-4 pb-4 sm:px-6 sm:pb-6">
          {route && (
            <div className="flex items-center gap-3 rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-sm">
              <Icon name="map" size={16} className="text-blue-600" />
              <span className="font-semibold text-blue-900">{route.distKm.toFixed(1)} km</span>
              <span className="text-blue-700">· ~{Math.round(route.durMin)} min de carro</span>
              <button onClick={() => setRoute(null)} className="ml-auto text-xs font-semibold text-blue-700 underline">Limpar rota</button>
            </div>
          )}
          <Card className="min-h-0 flex-1 overflow-hidden p-0">
            <MapContainer center={center} zoom={11} className="h-full w-full" scrollWheelZoom>
              <TileLayer attribution='&copy; OpenStreetMap' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
              <FitBounds pts={bounds} focus={focus} />
              <FlyTo focus={focus} />
              <RecMarkers pontos={pontos} focus={focus} renderMarker={({ r, lat, lon }) => {
                const isFocus = focus?.id === r.id;
                return (
                <CircleMarker key={r.id} center={[lat, lon]} radius={isFocus ? 11 : 7}
                  ref={isFocus ? (m) => { m?.openPopup(); } : undefined}
                  pathOptions={{ color: isFocus ? '#dc2626' : MATCH_COLOR[r.reason.cnae_match],
                    weight: isFocus ? 3 : 1, fillOpacity: isFocus ? 0.9 : 0.7 }}>
                  <Popup>
                    <div className="space-y-1">
                      <p className="font-semibold">{r.razao_social}</p>
                      <p className="text-xs">Score {(r.score * 100).toFixed(0)} · {r.reason.distancia_km} km</p>
                      <div className="flex flex-nowrap items-center gap-3 pt-0.5">
                        <button onClick={() => setViewing(Number(r.id))} className="whitespace-nowrap text-xs font-semibold text-brand-700 underline">Ver dados da empresa</button>
                        {added.has(r.id)
                          ? <span className="whitespace-nowrap text-xs text-emerald-600">✓ no funil</span>
                          : <button onClick={() => addToFunnel(r)} className="whitespace-nowrap text-xs font-semibold text-brand-700 underline">+ Adicionar ao funil</button>}
                        <button onClick={() => void traceRoute(r)} disabled={routingId === r.id}
                          className="whitespace-nowrap text-xs font-semibold text-blue-700 underline disabled:opacity-50">
                          {routingId === r.id ? 'Traçando…' : 'Traçar rota'}
                        </button>
                      </div>
                    </div>
                  </Popup>
                </CircleMarker>
                );
              }} />
              {route && (
                <>
                  <Polyline positions={route.coords} pathOptions={{ color: '#2563eb', weight: 5, opacity: 0.8 }} />
                  <CircleMarker center={route.origem} radius={7} pathOptions={{ color: '#2563eb', fillColor: '#3b82f6', fillOpacity: 1 }}>
                    <Popup>{origemFixa ? 'Origem (endereço do perfil)' : 'Sua localização'}</Popup>
                  </CircleMarker>
                  <FitRoute coords={route.coords} />
                </>
              )}
            </MapContainer>
          </Card>
        </div>
      ) : (
        <div className="min-h-0 flex-1 space-y-3 overflow-auto px-4 pb-4 sm:px-6 sm:pb-6">
          {visibleRecs.map((r) => (
            <RecCard key={r.id} rec={r} added={added.has(r.id)} onAdd={() => addToFunnel(r)}
              onView={() => setViewing(Number(r.id))} onViewMap={() => verNoMapa(r)}
              onRoute={() => void traceRoute(r)} routing={routingId === r.id} />
          ))}
          {!loading && recs.length > 0 && visibleRecs.length === 0 && (
            <p className="py-6 text-center text-sm text-ink-400">Nenhuma recomendação bate com os filtros.</p>
          )}
          {loading && <Spinner />}
          {!loading && !done && !semFiltro && (
            <Btn variant="ghost" onClick={() => load(offset)}
              className="w-full border border-ink-200 bg-white text-ink-600 hover:bg-ink-50">
              Carregar mais
            </Btn>
          )}
          {recs.length === 0 && !loading && (semFiltro
            ? <EmptyState icon="search" title="Selecione um filtro"
                hint="Use texto, CNAE, UF ou porte nos Filtros para buscar empresas na base." />
            : <EmptyState icon="building" title="Nenhuma empresa encontrada"
                hint="Nenhuma empresa bate com os filtros aplicados. Ajuste os critérios." />)}
        </div>
      )}

      {viewing !== null && <CompanyModal companyId={viewing} onClose={() => setViewing(null)} />}
    </div>
  );
}

function RecCard({ rec, added, onAdd, onView, onViewMap, onRoute, routing }: { rec: Recommendation; added: boolean; onAdd: () => void; onView: () => void; onViewMap: () => void; onRoute: () => void; routing: boolean }): React.JSX.Element {
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
        {rec.lat != null && rec.lon != null && (
          <Btn size="sm" variant="soft" icon="map" onClick={onRoute} disabled={routing}>{routing ? 'Traçando…' : 'Rota'}</Btn>
        )}
      </div>
    </Card>
  );
}
