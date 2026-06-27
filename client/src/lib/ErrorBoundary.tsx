import { Component, type ReactNode } from 'react';

// Sem isso, qualquer exceção de render derruba o app inteiro em tela branca.
// Class component porque error boundary ainda não existe em hooks.
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error): { error: Error } {
    return { error };
  }

  componentDidCatch(error: Error): void {
    console.error('Erro não tratado na UI:', error);
  }

  render(): ReactNode {
    if (!this.state.error) return this.props.children;
    return (
      <div className="grid min-h-dvh place-items-center bg-ink-50 p-4">
        <div className="w-full max-w-sm rounded-2xl border border-ink-200 bg-white p-6 text-center shadow-sm">
          <p className="text-lg font-bold text-ink-900">Algo deu errado</p>
          <p className="mt-1 text-sm text-ink-500">
            A tela encontrou um erro inesperado. Recarregue para continuar.
          </p>
          <button
            onClick={() => { this.setState({ error: null }); location.reload(); }}
            className="mt-4 rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700">
            Recarregar
          </button>
        </div>
      </div>
    );
  }
}
