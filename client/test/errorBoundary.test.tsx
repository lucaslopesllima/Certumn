import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ErrorBoundary } from '../src/lib/ErrorBoundary.tsx';

function Bomb(): never {
  throw new Error('explodiu');
}

describe('ErrorBoundary', () => {
  it('renderiza os filhos quando não há erro', () => {
    render(<ErrorBoundary><p>conteúdo ok</p></ErrorBoundary>);
    expect(screen.getByText('conteúdo ok')).toBeInTheDocument();
  });

  it('captura exceção de render e mostra fallback com recarregar', () => {
    // React loga o erro no console — silencia só aqui
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<ErrorBoundary><Bomb /></ErrorBoundary>);
    expect(screen.getByText('Algo deu errado')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Recarregar' })).toBeInTheDocument();
    spy.mockRestore();
  });
});
