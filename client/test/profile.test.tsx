// Perfil-alvo (ProfileForm): carga com labels, busca de CNAE/município e PUT.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ProfileForm } from '../src/pages/Profile.tsx';
import { api } from '../src/lib/api.ts';

vi.mock('../src/lib/api.ts', async (orig) => {
  const real = await orig() as Record<string, unknown>;
  return { ...real, api: { get: vi.fn(), put: vi.fn(), post: vi.fn(), patch: vi.fn(), del: vi.fn() } };
});
const m = vi.mocked(api);

beforeEach(() => {
  vi.mocked(m.get).mockReset();
  vi.mocked(m.put).mockReset();
  m.get.mockImplementation(async (p: string) => {
    if (p === '/api/profile') {
      return { profile: {
        cnaes_alvo: [4781400], territorio_municipios: [100],
        territorio_raio_km: null, pesos: { cnae: 0.5, proximidade: 0.3, porte: 0.2 },
        origem_endereco: null, origem_lat: null, origem_lon: null,
      } };
    }
    if (p === '/api/municipios/ufs') return { ufs: [{ uf: 'SP', total: 2 }] };
    if (p.startsWith('/api/cnae/labels')) {
      return { labels: [{ codigo: 4781400, descricao: 'Comércio varejista do vestuário', secao: 'G', divisao: 47 }] };
    }
    if (p.startsWith('/api/municipios/labels')) {
      return { municipios: [{ id: 100, nome: 'São Paulo', uf: 'SP', regiao: 'SE' }] };
    }
    if (p.startsWith('/api/cnae/search')) {
      return { grupos: [{ divisao: 10, secao: 'C', itens: [{ codigo: 1011201, descricao: 'Frigorífico - abate de bovinos', secao: 'C', divisao: 10 }] }] };
    }
    if (p.startsWith('/api/municipios/search')) {
      return { municipios: [{ id: 200, nome: 'Campinas', uf: 'SP', regiao: 'SE' }] };
    }
    return {};
  });
});

describe('ProfileForm', () => {
  it('carrega o perfil com chips resolvidos (CNAE e município)', async () => {
    render(<ProfileForm />);
    // <Cnae> trunca a descrição em 10 chars; o texto completo fica no title
    expect(await screen.findByTitle(/4781400 — Comércio varejista do vestuário/)).toBeInTheDocument();
    expect(await screen.findByText(/São Paulo/)).toBeInTheDocument();
  });

  it('busca CNAE por termo livre e adiciona ao alvo', async () => {
    render(<ProfileForm />);
    await screen.findAllByTitle(/4781400 — Comércio varejista do vestuário/);

    await userEvent.type(screen.getByPlaceholderText('Buscar CNAE…'), 'frigorifico');
    const opcao = await screen.findByText(/abate de bovinos/, undefined, { timeout: 2000 });
    await userEvent.click(opcao.closest('button')!);

    // salvar inclui o novo código
    await userEvent.click(screen.getByRole('button', { name: 'Salvar perfil' }));
    await waitFor(() => expect(m.put).toHaveBeenCalledWith('/api/profile',
      expect.objectContaining({ cnaes_alvo: expect.arrayContaining([4781400, 1011201]) })));
  });

  it('busca município e adiciona ao território; salvar manda os ids', async () => {
    render(<ProfileForm />);
    await screen.findByText(/São Paulo/);

    await userEvent.type(screen.getByPlaceholderText(/Buscar cidade/), 'campinas');
    const opcao = await screen.findByText(/Campinas/, undefined, { timeout: 2000 });
    await userEvent.click(opcao.closest('button')!);

    await userEvent.click(screen.getByRole('button', { name: 'Salvar perfil' }));
    await waitFor(() => expect(m.put).toHaveBeenCalledWith('/api/profile',
      expect.objectContaining({ territorio_municipios: expect.arrayContaining([100, 200]) })));
  });

  it('raio vazio vira null no PUT', async () => {
    render(<ProfileForm />);
    await screen.findByText(/São Paulo/);
    await userEvent.click(screen.getByRole('button', { name: 'Salvar perfil' }));
    await waitFor(() => expect(m.put).toHaveBeenCalledWith('/api/profile',
      expect.objectContaining({ territorio_raio_km: null })));
  });
});
