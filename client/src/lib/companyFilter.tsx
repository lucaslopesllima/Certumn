import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from './api.ts';
import type { Municipio } from './types.ts';
import { maskSearchCNPJ, maskCEP } from './format.ts';
import { Btn, cn } from './ui.tsx';
import { Icon } from './icons.tsx';
import { Cnae, seedCnae } from './cnae.tsx';

// Filtro de empresas reutilizado no Funil e na Prospecção (Recomendadas).
// No modo recommend, a barra também guarda a configuração da recomendação
// (território, partida e pesos do score) — que antes vinha do perfil-alvo e agora
// vive aqui, persistida no navegador e enviada ao /api/recommend a cada busca.

const inputCls = 'w-full rounded-xl border border-ink-200 bg-surface px-3 py-2.5 text-sm text-ink-800 outline-none transition focus:border-brand-400 focus:ring-2 focus:ring-brand-200';
const onlyDigits = (s: string): string => s.replace(/\D/g, '');
const parseCodes = (s: string): number[] => s.split(/[,\s]+/).map((x) => onlyDigits(x)).filter(Boolean).map(Number);
const parseUfs = (s: string): string[] => s.split(/[,\s]+/).map((x) => x.trim().toUpperCase()).filter((x) => x.length === 2);
const PORTE_OPTS = [
  { v: 'micro', l: 'Micro' }, { v: 'pequeno', l: 'Pequeno' },
  { v: 'demais', l: 'Demais' }, { v: 'nao_informado', l: 'Não informado' },
];

export interface Pesos { cnae: number; proximidade: number; porte: number }
export const DEFAULT_PESOS: Pesos = { cnae: 0.5, proximidade: 0.3, porte: 0.2 };

// Endereço de partida das rotas: origem que o usuário define à mão nos filtros,
// geocodificada para lat/lon. Sobrescreve o endereço da conta nos cálculos de
// distância/rota. Compartilhada entre telas (Prospecção + Planejador).
export interface Partida { label: string; lat: number; lon: number }

// Config da recomendação compartilhada entre telas (busca + mapa de cobertura).
// Guardada fora do filtro por-tela porque o território é um conceito global.
interface RecoCfg { munis: Municipio[]; pesos: Pesos; partida: Partida | null }
const RECO_KEY = 'companyFilter:reco';

function loadRecoCfg(): RecoCfg {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(RECO_KEY) : null;
    if (raw) {
      const p = JSON.parse(raw) as Partial<RecoCfg>;
      return { munis: p.munis ?? [], pesos: { ...DEFAULT_PESOS, ...p.pesos }, partida: p.partida ?? null };
    }
  } catch { /* storage indisponível */ }
  return { munis: [], pesos: { ...DEFAULT_PESOS }, partida: null };
}

// Lido por outras telas (ex.: mapa de cobertura) que precisam do mesmo território.
export function loadTerritorioIds(): number[] {
  return loadRecoCfg().munis.map((m) => m.id);
}

// Lido pelo Planejador de rota para usar a mesma origem definida nos filtros.
export function loadPartida(): Partida | null {
  return loadRecoCfg().partida;
}

// Mínimo que um item precisa expor para ser filtrável.
export interface FilterableCompany {
  razao_social: string; nome_fantasia: string | null; cnpj: string;
  cnae_principal: number; uf: string; municipio_id: number | null; porte: string;
}

export interface CompanyFilter {
  fq: string; setFq: (s: string) => void;
  fCnae: string; setFCnae: (s: string) => void;
  fUf: string; setFUf: (s: string) => void;
  fPorte: string; setFPorte: (s: string) => void;
  usarAlvo: boolean; setUsarAlvo: (b: boolean) => void;
  // config da recomendação (modo recommend)
  territorio: Municipio[]; setTerritorio: (m: Municipio[]) => void;
  pesos: Pesos; setPesos: (p: Pesos) => void;
  partida: Partida | null; setPartida: (p: Partida | null) => void;
  filtroAtivo: boolean;
  limpar: () => void;
  apply: <T extends FilterableCompany>(items: T[]) => T[];
}

interface Persisted { fq: string; fCnae: string; fUf: string; fPorte: string; usarAlvo: boolean }

function loadSaved(key: string): Persisted | null {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(key) : null;
    return raw ? (JSON.parse(raw) as Persisted) : null;
  } catch { return null; }
}

// storageKey separa a persistência por tela (funil vs prospecção).
export function useCompanyFilter(storageKey = 'default'): CompanyFilter {
  const key = `companyFilter:${storageKey}`;
  const saved = useMemo(() => loadSaved(key), [key]);
  const reco = useMemo(() => loadRecoCfg(), []);

  const [fq, setFq] = useState(saved?.fq ?? '');
  const [fCnae, setFCnae] = useState(saved?.fCnae ?? '');
  const [fUf, setFUf] = useState(saved?.fUf ?? '');
  const [fPorte, setFPorte] = useState(saved?.fPorte ?? '');
  const [usarAlvo, setUsarAlvo] = useState(saved?.usarAlvo ?? true);
  const [territorio, setTerritorio] = useState<Municipio[]>(reco.munis);
  const [pesos, setPesos] = useState<Pesos>(reco.pesos);
  const [partida, setPartida] = useState<Partida | null>(reco.partida);

  // Persiste o estado do filtro a cada mudança.
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify({ fq, fCnae, fUf, fPorte, usarAlvo }));
    } catch { /* storage indisponível */ }
  }, [key, fq, fCnae, fUf, fPorte, usarAlvo]);

  // Persiste a config da recomendação (compartilhada).
  useEffect(() => {
    try {
      localStorage.setItem(RECO_KEY, JSON.stringify({ munis: territorio, pesos, partida }));
    } catch { /* storage indisponível */ }
  }, [territorio, pesos, partida]);

  const muniIds = useMemo(() => territorio.map((m) => m.id), [territorio]);

  const apply = useMemo(() => {
    const cnaes = parseCodes(fCnae);
    const ufs = parseUfs(fUf);
    const muniSet = new Set(muniIds);
    const qd = onlyDigits(fq);
    const ql = fq.trim().toLowerCase();
    return <T extends FilterableCompany>(items: T[]): T[] => items.filter((c) => {
      if (ql) {
        const hay = `${c.razao_social} ${c.nome_fantasia ?? ''}`.toLowerCase();
        if (!(hay.includes(ql) || (qd !== '' && c.cnpj.includes(qd)))) return false;
      }
      if (cnaes.length && !cnaes.includes(c.cnae_principal)) return false;
      if (fPorte && c.porte !== fPorte) return false;
      if (ufs.length) {
        if (!ufs.includes(c.uf)) return false;             // UF da tela sobrescreve território
      } else if (usarAlvo && muniSet.size > 0) {
        if (c.municipio_id == null || !muniSet.has(c.municipio_id)) return false;
      }
      return true;
    });
  }, [fq, fCnae, fUf, fPorte, usarAlvo, muniIds]);

  const filtroAtivo = fq.trim() !== '' || fCnae.trim() !== '' || fUf.trim() !== '' || fPorte !== '' || usarAlvo;
  const limpar = (): void => { setFq(''); setFCnae(''); setFUf(''); setFPorte(''); setUsarAlvo(false); };

  return {
    fq, setFq, fCnae, setFCnae, fUf, setFUf, fPorte, setFPorte, usarAlvo, setUsarAlvo,
    territorio, setTerritorio, pesos, setPesos, partida, setPartida,
    filtroAtivo, limpar, apply,
  };
}

// Busca de CNAE por TEXTO ou código: digita "padaria" ou "478" e resolve via
// /api/cnae/search (sinônimos + descrição + trigrama). Guarda só os códigos em
// fCnae — formato que o filtro client-side e o /api/recommend já consomem.
interface CnaeHit { codigo: number; descricao: string; secao: string; divisao: number }
interface CnaeGrupo { divisao: number; secao: string; itens: CnaeHit[] }

function CnaeSearchInput({ value, onChange, label }: { value: string; onChange: (s: string) => void; label: string }): React.JSX.Element {
  const [q, setQ] = useState('');
  const [grupos, setGrupos] = useState<CnaeGrupo[]>([]);
  const [open, setOpen] = useState(false);
  const deb = useRef<number | undefined>(undefined);

  const codes = useMemo(() => parseCodes(value), [value]);

  useEffect(() => {
    if (deb.current) clearTimeout(deb.current);
    const term = q.trim();
    if (term.length < 2) { setGrupos([]); return; }
    deb.current = window.setTimeout(async () => {
      const r = await api.get<{ grupos: CnaeGrupo[] }>(`/api/cnae/search?q=${encodeURIComponent(term)}`).catch(() => null);
      setGrupos(r?.grupos ?? []);
      setOpen(true);
    }, 250);
  }, [q]);

  const add = (code: number, descricao?: string): void => {
    if (!Number.isFinite(code) || codes.includes(code)) { setQ(''); setGrupos([]); return; }
    if (descricao) seedCnae(code, descricao);
    onChange([...codes, code].join(', '));
    setQ(''); setGrupos([]); setOpen(false);
  };
  const remove = (code: number): void => onChange(codes.filter((c) => c !== code).join(', '));

  // Enter com dígitos puros adiciona o código direto, sem depender da busca.
  const onKey = (e: React.KeyboardEvent): void => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const digits = onlyDigits(q);
    if (digits) add(Number(digits));
  };

  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-ink-500">{label}</span>
      <div className="relative">
        <input
          value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKey}
          onFocus={() => { if (grupos.length) setOpen(true); }}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          maxLength={120} placeholder="Atividade (ex.: padaria) ou código" className={inputCls}
        />
        {open && grupos.length > 0 && (
          <div className="absolute z-20 mt-1 max-h-72 w-full overflow-auto rounded-xl border border-ink-200 bg-surface py-1 shadow-pop">
            {grupos.map((g) => (
              <div key={g.divisao}>
                <div className="px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-ink-400">Divisão {g.divisao} · seção {g.secao}</div>
                {g.itens.map((it) => (
                  <button key={it.codigo} type="button" onMouseDown={(e) => e.preventDefault()}
                    onClick={() => add(it.codigo, it.descricao)} disabled={codes.includes(it.codigo)}
                    className="flex w-full items-start gap-2 px-3 py-1.5 text-left text-sm hover:bg-ink-50 disabled:opacity-40">
                    <span className="shrink-0 font-mono text-xs text-ink-400">{it.codigo}</span>
                    <span className="text-ink-700">{it.descricao}</span>
                  </button>
                ))}
              </div>
            ))}
          </div>
        )}
        {open && q.trim().length >= 2 && grupos.length === 0 && (
          <div className="absolute z-20 mt-1 w-full rounded-xl border border-ink-200 bg-surface px-3 py-2.5 text-sm text-ink-400 shadow-pop">
            Nenhum CNAE encontrado para “{q.trim()}”.
          </div>
        )}
      </div>
      {codes.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {codes.map((c) => (
            <button key={c} type="button" onClick={() => remove(c)}
              className="inline-flex items-center gap-1 rounded-full bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-700 ring-1 ring-inset ring-brand-200 hover:bg-brand-100">
              <span className="font-mono">{c}</span> <Cnae code={c} /> <Icon name="x" size={11} />
            </button>
          ))}
        </div>
      )}
    </label>
  );
}

// Endereço de partida das rotas: usuário digita um endereço livre, geocodifica
// via /api/geocode e guarda lat/lon. Vira a origem dos cálculos de distância/rota
// (sobrescreve o endereço da conta). Vazio = usa o endereço cadastrado da conta.
function PartidaInput({ value, onChange }: { value: Partida | null; onChange: (p: Partida | null) => void }): React.JSX.Element {
  const [cep, setCep] = useState('');
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [cepBusy, setCepBusy] = useState(false);
  const [erro, setErro] = useState('');

  // CEP -> endereço (ViaCEP). Preenche o campo de endereço; o usuário ajusta o
  // número se quiser e confirma em "Definir" (geocodificação Nominatim).
  const buscarCep = async (raw: string): Promise<void> => {
    const digits = onlyDigits(raw);
    if (digits.length !== 8) return;
    setCepBusy(true); setErro('');
    try {
      const resp = await fetch(`https://viacep.com.br/ws/${digits}/json/`);
      const j = await resp.json() as { logradouro?: string; bairro?: string; localidade?: string; uf?: string; erro?: boolean };
      if (j.erro) { setErro('CEP não encontrado.'); return; }
      const addr = [j.logradouro, j.bairro, [j.localidade, j.uf].filter(Boolean).join(' ')].filter(Boolean).join(', ');
      setQ(addr);
    } catch {
      setErro('Falha ao buscar o CEP.');
    } finally { setCepBusy(false); }
  };

  const buscar = async (): Promise<void> => {
    const term = q.trim();
    if (term.length < 3) { setErro('Digite um endereço (mín. 3 caracteres).'); return; }
    setBusy(true); setErro('');
    try {
      const r = await api.get<{ geocode: { lat: number; lon: number; label: string } | null }>(
        `/api/geocode?q=${encodeURIComponent(term)}`);
      if (!r.geocode) { setErro('Endereço não encontrado.'); return; }
      onChange({ label: r.geocode.label, lat: r.geocode.lat, lon: r.geocode.lon });
      setCep(''); setQ('');
    } catch {
      setErro('Falha ao localizar o endereço.');
    } finally { setBusy(false); }
  };

  return (
    <div className="block">
      <span className="text-xs font-semibold text-ink-600">Endereço de partida</span>
      {value ? (
        <div className="mt-1.5 flex items-start gap-2 rounded-xl border border-brand-200 bg-brand-50 px-3 py-2">
          <Icon name="mapPin" size={15} className="mt-0.5 shrink-0 text-brand-600" />
          <span className="min-w-0 flex-1 text-xs text-brand-900">{value.label}</span>
          <button type="button" onClick={() => onChange(null)} title="Remover endereço de partida"
            className="shrink-0 text-brand-700 hover:text-rose-600"><Icon name="x" size={14} /></button>
        </div>
      ) : (
        <div className="mt-1.5 flex flex-col gap-2 sm:flex-row">
          <input value={cep} inputMode="numeric"
            onChange={(e) => { const v = maskCEP(e.target.value); setCep(v); setErro(''); if (onlyDigits(v).length === 8) void buscarCep(v); }}
            onBlur={(e) => void buscarCep(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void buscarCep(cep); } }}
            placeholder={cepBusy ? 'Buscando…' : 'CEP'} className={cn(inputCls, 'sm:w-32 shrink-0')} />
          <input value={q} onChange={(e) => { setQ(e.target.value); setErro(''); }}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void buscar(); } }}
            maxLength={120} placeholder="Ex.: Rua XV de Novembro 100, Blumenau SC" className={cn(inputCls, 'flex-1')} />
          <Btn size="sm" type="button" variant="soft" onClick={() => void buscar()} disabled={busy} className="shrink-0">
            {busy ? '…' : 'Definir'}
          </Btn>
        </div>
      )}
      {erro && <p className="mt-1 text-[11px] text-rose-600">{erro}</p>}
    </div>
  );
}

// Seção colapsável (acordeão) reutilizada para básico/avançado. Mesmo padrão
// grid-rows-[1fr]/[0fr] + overflow-hidden usado no Recommend para animar altura.
// `nested` deixa o cabeçalho discreto (avançado dentro do básico).
function FilterSection({ title, open, onToggle, nested = false, children }: {
  title: string; open: boolean; onToggle: () => void; nested?: boolean; children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className={cn(nested && 'rounded-xl border border-ink-200/70 bg-ink-50/40')}>
      <button type="button" onClick={onToggle} aria-expanded={open}
        className={cn('flex w-full items-center justify-between gap-2 text-left', nested ? 'px-3 py-2' : 'p-3')}>
        <span className={cn('font-semibold', nested ? 'text-[11px] uppercase tracking-wider text-ink-500' : 'text-sm text-ink-900')}>{title}</span>
        <Icon name="chevronRight" size={15}
          className={cn('shrink-0 text-ink-400 transition-transform duration-300 ease-out', open ? 'rotate-90' : 'rotate-0')} />
      </button>
      <div className={cn('grid transition-[grid-template-rows] duration-300 ease-in-out', open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]')}>
        <div className="overflow-hidden">
          <div className={cn(nested ? 'px-3 pb-3' : 'p-3 pt-0')}>{children}</div>
        </div>
      </div>
    </div>
  );
}

export function CompanyFilterBar({ f, recommend = false }: { f: CompanyFilter; recommend?: boolean }): React.JSX.Element {
  const [basicoOpen, setBasicoOpen] = useState(true);
  // No modo recommend o território (avançado) é necessário para haver resultado —
  // começa aberto. No funil é opcional, começa recolhido.
  const [avancadoOpen, setAvancadoOpen] = useState(recommend);

  return (
    <div className="space-y-3">
      <div className="rounded-2xl border border-ink-200/70 bg-surface shadow-card">
        <FilterSection title="Filtros" open={basicoOpen} onToggle={() => setBasicoOpen((v) => !v)}>
          <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-ink-500">Nome / CNPJ</span>
              <input value={f.fq} onChange={(e) => f.setFq(maskSearchCNPJ(e.target.value))} maxLength={120} placeholder="Razão, fantasia ou CNPJ" className={inputCls} />
            </label>
            <CnaeSearchInput value={f.fCnae} onChange={f.setFCnae} label={recommend ? 'CNAEs-alvo' : 'CNAE'} />
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-ink-500">UF</span>
              <input value={f.fUf} onChange={(e) => f.setFUf(e.target.value)} maxLength={120} placeholder="Ex.: SC, PR" className={inputCls} />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-ink-500">Porte</span>
              <select value={f.fPorte} onChange={(e) => f.setFPorte(e.target.value)} className={inputCls}>
                <option value="">Todos</option>
                {PORTE_OPTS.map((p) => <option key={p.v} value={p.v}>{p.l}</option>)}
              </select>
            </label>
          </div>

          {/* Avançado aninhado dentro do básico */}
          <div className="mt-2.5">
            <FilterSection title="Filtros avançados" open={avancadoOpen} onToggle={() => setAvancadoOpen((v) => !v)} nested>
              {recommend ? (
                <RecommendConfig f={f} />
              ) : (
                <div className="space-y-2.5">
                  <PartidaInput value={f.partida} onChange={f.setPartida} />
                  <div className="flex flex-wrap items-center gap-3 border-t border-ink-100 pt-2.5">
                    <label className={cn('inline-flex items-center gap-2 text-xs font-medium text-ink-600', f.territorio.length === 0 && 'opacity-50')}>
                      <input type="checkbox" checked={f.usarAlvo} onChange={(e) => f.setUsarAlvo(e.target.checked)}
                        className="h-4 w-4 rounded border-ink-300 text-brand-600 focus:ring-brand-300" disabled={f.territorio.length === 0} />
                      Restringir ao território
                      {f.territorio.length > 0 && <span className="text-ink-400">({f.territorio.length} municípios)</span>}
                    </label>
                    <span className="text-xs text-ink-400">UF da tela sobrescreve o território.</span>
                    <div className="ml-auto">
                      <Btn size="sm" variant="ghost" type="button" onClick={f.limpar}>Limpar</Btn>
                    </div>
                  </div>
                </div>
              )}
            </FilterSection>
          </div>
        </FilterSection>
      </div>
    </div>
  );
}

// Painel de configuração do score (modo recommend): território (municípios + UF
// inteiro), endereço de partida e pesos. Migrado da antiga tela de Perfil-alvo.
function RecommendConfig({ f }: { f: CompanyFilter }): React.JSX.Element {
  const [munQ, setMunQ] = useState('');
  const [munResults, setMunResults] = useState<Municipio[]>([]);
  const [ufs, setUfs] = useState<{ uf: string; total: number }[]>([]);
  const munDebounce = useRef<number | undefined>(undefined);

  useEffect(() => {
    void api.get<{ ufs: { uf: string; total: number }[] }>('/api/municipios/ufs')
      .then((r) => setUfs(r?.ufs ?? [])).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (munDebounce.current) clearTimeout(munDebounce.current);
    if (munQ.trim().length < 1) { setMunResults([]); return; }
    munDebounce.current = window.setTimeout(async () => {
      const r = await api.get<{ municipios: Municipio[] }>(`/api/municipios/search?q=${encodeURIComponent(munQ.trim())}`);
      setMunResults(r?.municipios ?? []);
    }, 250);
  }, [munQ]);

  const sel = f.territorio;
  const addMun = (m: Municipio): void => {
    if (!sel.some((x) => x.id === m.id)) f.setTerritorio([...sel, m]);
    setMunQ(''); setMunResults([]);
  };
  const removeMun = (id: number): void => f.setTerritorio(sel.filter((x) => x.id !== id));
  const removeUf = (uf: string): void => f.setTerritorio(sel.filter((x) => x.uf !== uf));
  const toggleUf = async (uf: string, full: boolean): Promise<void> => {
    if (full) { removeUf(uf); return; }
    const novos = (await api.get<{ municipios: Municipio[] }>(`/api/municipios/by-uf?uf=${uf}`))?.municipios ?? [];
    const ids = new Set(sel.map((m) => m.id));
    f.setTerritorio([...sel, ...novos.filter((m) => !ids.has(m.id))]);
  };

  const countByUf: Record<string, number> = {};
  for (const m of sel) countByUf[m.uf] = (countByUf[m.uf] ?? 0) + 1;
  const isFull = (uf: string, total: number): boolean => (countByUf[uf] ?? 0) === total && total > 0;
  const fullUfs = ufs.filter((u) => isFull(u.uf, u.total)).map((u) => u.uf);
  const looseCities = sel.filter((m) => !fullUfs.includes(m.uf)).sort((a, b) => a.nome.localeCompare(b.nome));

  return (
    <div className="grid gap-3 lg:grid-cols-2">
      {/* Território */}
      <div className="rounded-2xl border border-ink-200/70 bg-surface p-3 shadow-card">
        <h4 className="text-sm font-semibold text-ink-900">Território</h4>
        <p className="mb-1.5 mt-3 text-[11px] font-semibold uppercase tracking-wider text-ink-400">Por estado</p>
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

        <p className="mb-1.5 mt-4 text-[11px] font-semibold uppercase tracking-wider text-ink-400">Por cidade</p>
        <div className="relative">
          <Icon name="search" size={17} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
          <input value={munQ} onChange={(e) => setMunQ(e.target.value)} maxLength={120} placeholder="Buscar cidade (ex.: Blumenau)…" className={cn(inputCls, 'pl-9')} />
          {munResults.length > 0 && (
            <div className="absolute z-20 mt-1 max-h-60 w-full overflow-auto rounded-xl border border-ink-200 bg-surface py-1 shadow-pop">
              {munResults.map((m) => {
                const on = sel.some((x) => x.id === m.id);
                return (
                  <button key={m.id} onClick={() => addMun(m)} disabled={on}
                    className={cn('flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-ink-50 disabled:opacity-40', on && 'cursor-default')}>
                    <span className="truncate text-ink-700"><Icon name="mapPin" size={13} className="mr-1.5 inline text-ink-400" />{m.nome}</span>
                    <span className="shrink-0 text-xs font-semibold text-ink-400">{on ? 'adicionado' : m.uf}</span>
                  </button>
                );
              })}
            </div>
          )}
          {munQ.trim().length >= 1 && munResults.length === 0 && (
            <div className="absolute z-20 mt-1 w-full rounded-xl border border-ink-200 bg-surface px-3 py-2.5 text-sm text-ink-400 shadow-pop">
              Nenhuma cidade encontrada para “{munQ.trim()}”.
            </div>
          )}
        </div>

        {sel.length > 0 ? (
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
          <p className="mt-3 text-xs text-ink-400">Nenhum município selecionado — defina o território para buscar.</p>
        )}

        <div className="mt-4">
          <PartidaInput value={f.partida} onChange={f.setPartida} />
        </div>
      </div>

      {/* Pesos do score */}
      <div className="rounded-2xl border border-ink-200/70 bg-surface p-3 shadow-card">
        <h4 className="text-sm font-semibold text-ink-900">Pesos do score</h4>
        <p className="mt-0.5 text-xs text-ink-400">Quanto cada fator influencia o ranqueamento.</p>
        {(['cnae', 'proximidade', 'porte'] as const).map((k) => (
          <label key={k} className="mt-3 block">
            <div className="flex justify-between text-xs font-semibold text-ink-600">
              <span className="capitalize">{k}</span><span className="tabnums text-brand-600">{f.pesos[k].toFixed(2)}</span>
            </div>
            <input type="range" min={0} max={1} step={0.05} value={f.pesos[k]}
              onChange={(e) => f.setPesos({ ...f.pesos, [k]: Number(e.target.value) })}
              className="mt-1.5 w-full accent-brand-600" />
          </label>
        ))}
        <div className="mt-4 flex justify-end">
          <Btn size="sm" variant="ghost" type="button" onClick={f.limpar}>Limpar filtros</Btn>
        </div>
      </div>
    </div>
  );
}
