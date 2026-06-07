import { useEffect, useSyncExternalStore } from 'react';
import { api } from './api.ts';
import { cn } from './ui.tsx';

// Tradutor de CNAE app-wide: troca o código pela descrição, truncada em 10 chars
// com reticências e tooltip (title) do texto completo. Cache global + batching:
// vários <Cnae> na tela resolvem os códigos faltantes numa só chamada a /api/cnae/labels.

const MAX = 10;
const cache = new Map<number, string>();
const listeners = new Set<() => void>();
let pending = new Set<number>();
let timer: ReturnType<typeof setTimeout> | null = null;

function emit(): void { for (const l of listeners) l(); }
function subscribe(l: () => void): () => void { listeners.add(l); return () => { listeners.delete(l); }; }

function flush(): void {
  timer = null;
  const codes = [...pending].filter((c) => !cache.has(c));
  pending = new Set();
  if (codes.length === 0) return;
  const CHUNK = 200; // mantém a URL curta
  for (let i = 0; i < codes.length; i += CHUNK) {
    const part = codes.slice(i, i + CHUNK);
    void api.get<{ labels: { codigo: number; descricao: string }[] }>(`/api/cnae/labels?codes=${part.join(',')}`)
      .then((r) => { for (const l of r.labels) cache.set(l.codigo, l.descricao); emit(); })
      .catch(() => undefined); // sem descrição -> fica o código como fallback
  }
}

function ensure(code: number): void {
  if (!Number.isFinite(code) || cache.has(code) || pending.has(code)) return;
  pending.add(code);
  if (timer == null) timer = setTimeout(flush, 50);
}

// Pré-popula o cache quando a descrição já veio do backend (ex.: /api/companies).
export function seedCnae(code: number | null | undefined, descricao: string | null | undefined): void {
  if (typeof code === 'number' && Number.isFinite(code) && descricao && !cache.has(code)) {
    cache.set(code, descricao); emit();
  }
}

export function useCnaeLabel(code: number): string | undefined {
  const desc = useSyncExternalStore(subscribe, () => cache.get(code));
  useEffect(() => { ensure(code); }, [code]);
  return desc;
}

const truncar = (s: string): string => (s.length > MAX ? `${s.slice(0, MAX)}…` : s);

// Mostra a descrição do CNAE (máx 10 chars + …) com tooltip do texto completo.
export function Cnae({ code, className }: { code: number | null | undefined; className?: string }): React.JSX.Element {
  const desc = useCnaeLabel(typeof code === 'number' && Number.isFinite(code) ? code : NaN);
  if (code == null) return <span className={className}>—</span>;
  const completo = desc ? `${code} — ${desc}` : String(code);
  const visivel = desc ? truncar(desc) : String(code);
  return <span className={cn('cursor-help', className)} title={completo}>{visivel}</span>;
}
