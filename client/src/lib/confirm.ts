// Confirmação única da app via SweetAlert2. Substitui os confirm() nativos,
// que travam a thread e não seguem o tema. Mesmo espírito do toast.tsx:
// qualquer código chama confirmDialog() sem precisar de hook/portal próprio.
import Swal from 'sweetalert2';

export interface ConfirmOptions {
  title?: string;
  confirmText?: string;
  cancelText?: string;
}

const isDark = (): 'dark' | 'light' => document.documentElement.classList.contains('dark') ? 'dark' : 'light';

// Escolha de escopo para agendamentos em série: 'serie' (toda) | 'one' (só esta)
// | null (desistiu). Três botões via showDenyButton do SweetAlert2.
export async function serieScopeDialog(message: string, opts: { title?: string; danger?: boolean } = {}): Promise<'one' | 'serie' | null> {
  const btn = (extra: string): string =>
    `inline-flex items-center justify-center rounded-xl px-4 py-2.5 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 ${extra}`;
  const r = await Swal.fire({
    title: opts.title ?? 'Faz parte de uma série',
    text: message,
    icon: 'question',
    showDenyButton: true,
    showCancelButton: true,
    confirmButtonText: 'Toda a série',
    denyButtonText: 'Só esta',
    cancelButtonText: 'Voltar',
    reverseButtons: true,
    buttonsStyling: false,
    theme: isDark(),
    customClass: {
      popup: 'rounded-2xl',
      actions: 'gap-2',
      confirmButton: btn(opts.danger ? 'text-white bg-rose-600 hover:bg-rose-700 focus-visible:ring-rose-300' : 'text-white bg-brand-600 hover:bg-brand-700 focus-visible:ring-brand-300'),
      denyButton: btn('text-ink-700 bg-ink-100 hover:bg-ink-200 focus-visible:ring-brand-300'),
      cancelButton: btn('text-ink-600 hover:bg-ink-100 focus-visible:ring-brand-300'),
    },
  });
  if (r.isConfirmed) return 'serie';
  if (r.isDenied) return 'one';
  return null;
}

// Botões estilizados com as classes do Btn (ui.tsx); tema segue a classe
// `.dark` no <html> (fonte da verdade, ver theme.tsx) e não o prefers-color-scheme.
export async function confirmDialog(message: string, opts: ConfirmOptions = {}): Promise<boolean> {
  const r = await Swal.fire({
    title: opts.title ?? 'Tem certeza?',
    text: message,
    icon: 'warning',
    showCancelButton: true,
    confirmButtonText: opts.confirmText ?? 'Confirmar',
    cancelButtonText: opts.cancelText ?? 'Cancelar',
    reverseButtons: true,
    buttonsStyling: false,
    theme: document.documentElement.classList.contains('dark') ? 'dark' : 'light',
    customClass: {
      popup: 'rounded-2xl',
      actions: 'gap-2',
      confirmButton: 'inline-flex items-center justify-center rounded-xl px-4 py-2.5 text-sm font-semibold text-white bg-rose-600 hover:bg-rose-700 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-300',
      cancelButton: 'inline-flex items-center justify-center rounded-xl px-4 py-2.5 text-sm font-semibold text-ink-600 hover:bg-ink-100 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300',
    },
  });
  return r.isConfirmed;
}
