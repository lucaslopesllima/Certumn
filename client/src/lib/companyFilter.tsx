import { useEffect, useMemo, useState } from 'react';
import { api } from './api.ts';
import type { Profile } from './types.ts';
import { maskSearchCNPJ } from './format.ts';
import { Btn, cn } from './ui.tsx';

// Filtro de empresas reutilizado no Funil e na Prospecção (Recomendadas).
// Defaults vêm do público-alvo (target_profiles); o que é mexido na tela sobrescreve.

const inputCls = 'w-full rounded-xl border border-ink-200 bg-white px-3 py-2.5 text-sm text-ink-800 outline-none transition focus:border-brand-400 focus:ring-2 focus:ring-brand-200';
const onlyDigits = (s: string): string => s.replace(/\D/g, '');
const parseCodes = (s: string): number[] => s.split(/[,\s]+/).map((x) => onlyDigits(x)).filter(Boolean).map(Number);
const parseUfs = (s: string): string[] => s.split(/[,\s]+/).map((x) => x.trim().toUpperCase()).filter((x) => x.length === 2);
const PORTE_OPTS = [
  { v: 'micro', l: 'Micro' }, { v: 'pequeno', l: 'Pequeno' },
  { v: 'demais', l: 'Demais' }, { v: 'nao_informado', l: 'Não informado' },
];

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
  alvoCnaes: number[]; alvoMunis: number[];
  filtroAtivo: boolean;
  limpar: () => void;
  aplicarAlvo: () => void;
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

  const [alvoCnaes, setAlvoCnaes] = useState<number[]>([]);
  const [alvoMunis, setAlvoMunis] = useState<number[]>([]);
  const [fq, setFq] = useState(saved?.fq ?? '');
  const [fCnae, setFCnae] = useState(saved?.fCnae ?? '');
  const [fUf, setFUf] = useState(saved?.fUf ?? '');
  const [fPorte, setFPorte] = useState(saved?.fPorte ?? '');
  const [usarAlvo, setUsarAlvo] = useState(saved?.usarAlvo ?? true);

  useEffect(() => {
    void api.get<{ profile: Profile | null }>('/api/profile').then((r) => {
      setAlvoCnaes(r.profile?.cnaes_alvo ?? []);
      setAlvoMunis(r.profile?.territorio_municipios ?? []);
      if (!saved) setFCnae((r.profile?.cnaes_alvo ?? []).join(', ')); // prefill só se não há estado salvo
    }).catch(() => undefined);
  }, [saved]);

  // Persiste o estado do filtro a cada mudança.
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify({ fq, fCnae, fUf, fPorte, usarAlvo }));
    } catch { /* storage indisponível */ }
  }, [key, fq, fCnae, fUf, fPorte, usarAlvo]);

  const apply = useMemo(() => {
    const cnaes = parseCodes(fCnae);
    const ufs = parseUfs(fUf);
    const muniSet = new Set(alvoMunis);
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
  }, [fq, fCnae, fUf, fPorte, usarAlvo, alvoMunis]);

  const filtroAtivo = fq.trim() !== '' || fCnae.trim() !== '' || fUf.trim() !== '' || fPorte !== '' || usarAlvo;
  const limpar = (): void => { setFq(''); setFCnae(''); setFUf(''); setFPorte(''); setUsarAlvo(false); };
  const aplicarAlvo = (): void => { setFCnae(alvoCnaes.join(', ')); setUsarAlvo(true); };

  return {
    fq, setFq, fCnae, setFCnae, fUf, setFUf, fPorte, setFPorte, usarAlvo, setUsarAlvo,
    alvoCnaes, alvoMunis, filtroAtivo, limpar, aplicarAlvo, apply,
  };
}

export function CompanyFilterBar({ f }: { f: CompanyFilter }): React.JSX.Element {
  return (
    <div className="rounded-2xl border border-ink-200/70 bg-white p-3 shadow-card">
      <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-ink-500">Nome / CNPJ</span>
          <input value={f.fq} onChange={(e) => f.setFq(maskSearchCNPJ(e.target.value))} placeholder="Razão, fantasia ou CNPJ" className={inputCls} />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-ink-500">CNAE (códigos)</span>
          <input value={f.fCnae} onChange={(e) => f.setFCnae(e.target.value)} placeholder="Ex.: 4781400, 4782201" className={inputCls} />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-ink-500">UF</span>
          <input value={f.fUf} onChange={(e) => f.setFUf(e.target.value)} placeholder="Ex.: SC, PR" className={inputCls} />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-ink-500">Porte</span>
          <select value={f.fPorte} onChange={(e) => f.setFPorte(e.target.value)} className={inputCls}>
            <option value="">Todos</option>
            {PORTE_OPTS.map((p) => <option key={p.v} value={p.v}>{p.l}</option>)}
          </select>
        </label>
      </div>
      <div className="mt-2.5 flex flex-wrap items-center gap-3">
        <label className={cn('inline-flex items-center gap-2 text-xs font-medium text-ink-600', f.alvoMunis.length === 0 && 'opacity-50')}>
          <input type="checkbox" checked={f.usarAlvo} onChange={(e) => f.setUsarAlvo(e.target.checked)}
            className="h-4 w-4 rounded border-ink-300 text-brand-600 focus:ring-brand-300" disabled={f.alvoMunis.length === 0} />
          Restringir ao território do público-alvo
          {f.alvoMunis.length > 0 && <span className="text-ink-400">({f.alvoMunis.length} municípios)</span>}
        </label>
        <span className="text-xs text-ink-400">UF da tela sobrescreve o território.</span>
        <div className="ml-auto flex gap-2">
          {f.alvoCnaes.length > 0 && <Btn size="sm" variant="ghost" type="button" onClick={f.aplicarAlvo}>Público-alvo</Btn>}
          <Btn size="sm" variant="ghost" type="button" onClick={f.limpar}>Limpar</Btn>
        </div>
      </div>
    </div>
  );
}
