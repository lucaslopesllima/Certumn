// Sistema de toast único da app. Substitui os ~25 alert() nativos (erro) e os
// flashes inline "Salvo" que sumiam em 1.5s (sucesso). Barramento em nível de
// módulo: qualquer código chama toast.success/error/info sem precisar de hook.
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon, type IconName } from './icons.tsx';
import { cn } from './ui.tsx';

export type ToastKind = 'success' | 'error' | 'info';
export interface ToastItem { id: number; kind: ToastKind; msg: string }

type Listener = (items: ToastItem[]) => void;

let items: ToastItem[] = [];
let seq = 0;
const listeners = new Set<Listener>();
const timers = new Map<number, ReturnType<typeof setTimeout>>();

function emit(): void { for (const l of listeners) l(items); }

function dismiss(id: number): void {
  items = items.filter((t) => t.id !== id);
  const h = timers.get(id);
  if (h) { clearTimeout(h); timers.delete(id); }
  emit();
}

function push(kind: ToastKind, msg: string): void {
  const id = ++seq;
  items = [...items, { id, kind, msg }];
  emit();
  // erro fica mais tempo (4.5s) que sucesso/info (3s) — mais a ler/agir.
  timers.set(id, setTimeout(() => dismiss(id), kind === 'error' ? 4500 : 3000));
}

export const toast = {
  success: (msg: string): void => push('success', msg),
  error: (msg: string): void => push('error', msg),
  info: (msg: string): void => push('info', msg),
};

const STYLE: Record<ToastKind, { icon: IconName; ring: string; fg: string }> = {
  success: { icon: 'check', ring: 'border-emerald-200 bg-emerald-50', fg: 'text-emerald-700' },
  error: { icon: 'alertTriangle', ring: 'border-rose-200 bg-rose-50', fg: 'text-rose-700' },
  info: { icon: 'bell', ring: 'border-sky-200 bg-sky-50', fg: 'text-sky-700' },
};

// Montado uma vez em main.tsx. Renderiza a pilha num portal, fixo no topo.
export function ToastHost(): React.JSX.Element {
  const [list, setList] = useState<ToastItem[]>(items);
  useEffect(() => {
    listeners.add(setList);
    return () => { listeners.delete(setList); };
  }, []);

  return createPortal(
    <div className="pointer-events-none fixed inset-x-0 top-3 z-[3000] flex flex-col items-center gap-2 px-3"
      role="region" aria-label="Notificações" aria-live="polite">
      {list.map((t) => {
        const s = STYLE[t.kind];
        return (
          <div key={t.id} role="status"
            className={cn('pointer-events-auto flex w-full max-w-sm items-start gap-2.5 rounded-xl border px-3.5 py-2.5 shadow-pop',
              'animate-[toastIn_.18s_ease-out]', s.ring)}>
            <Icon name={s.icon} size={18} className={cn('mt-0.5 shrink-0', s.fg)} />
            <span className="min-w-0 flex-1 text-sm font-medium text-ink-800">{t.msg}</span>
            <button onClick={() => dismiss(t.id)} aria-label="Fechar"
              className={cn('shrink-0 rounded-md p-0.5 transition-colors hover:bg-black/5', s.fg)}>
              <Icon name="x" size={15} />
            </button>
          </div>
        );
      })}
    </div>,
    document.body,
  );
}
