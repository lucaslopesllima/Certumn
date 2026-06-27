// Sino de notificações (Fase 6.2): badge de não lidas, dropdown, marcar lido.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { NotificationBell } from '../src/App.tsx';
import { api } from '../src/lib/api.ts';

vi.mock('../src/lib/api.ts', async (orig) => {
  const real = await orig() as Record<string, unknown>;
  return { ...real, api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), del: vi.fn() } };
});
const m = vi.mocked(api);

const notif = (over: Record<string, unknown>): Record<string, unknown> => ({
  id: 1, tipo: 'agenda', chave: 'agenda:1', titulo: 'Compromisso em breve: Reunião',
  payload: {}, lida: false, created_at: '', ...over,
});

beforeEach(() => {
  vi.mocked(m.get).mockReset();
  vi.mocked(m.patch).mockReset();
  vi.mocked(m.post).mockReset();
  m.get.mockResolvedValue({
    notifications: [
      notif({ id: 1, lida: false }),
      notif({ id: 2, tipo: 'vencimento', titulo: 'Conta a receber vence amanhã', lida: true }),
    ],
    nao_lidas: 1,
  });
  m.patch.mockResolvedValue({});
  m.post.mockResolvedValue({});
});

const mount = (): ReturnType<typeof render> =>
  render(<MemoryRouter><NotificationBell variant="light" /></MemoryRouter>);

describe('NotificationBell', () => {
  it('mostra badge de não lidas e lista no dropdown', async () => {
    mount();
    expect(await screen.findByText('1')).toBeInTheDocument(); // badge
    await userEvent.click(screen.getByLabelText('Notificações'));
    expect(await screen.findByText(/Compromisso em breve/)).toBeInTheDocument();
    expect(screen.getByText(/Conta a receber vence/)).toBeInTheDocument();
  });

  it('clicar numa não lida faz PATCH read e navega', async () => {
    mount();
    await userEvent.click(await screen.findByLabelText('Notificações'));
    await userEvent.click(screen.getByText(/Compromisso em breve/));
    expect(m.patch).toHaveBeenCalledWith('/api/notifications/1/read');
  });

  it('marcar todas chama o endpoint', async () => {
    mount();
    await userEvent.click(await screen.findByLabelText('Notificações'));
    await userEvent.click(await screen.findByText('Marcar todas'));
    await waitFor(() => expect(m.post).toHaveBeenCalledWith('/api/notifications/read-all'));
  });
});
