// useCompanyFilter: filtragem client-side, persistência e prefill do público-alvo.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useCompanyFilter, type FilterableCompany } from '../src/lib/companyFilter.tsx';
import { api } from '../src/lib/api.ts';

vi.mock('../src/lib/api.ts', () => ({
  api: { get: vi.fn() },
}));
const apiGet = vi.mocked(api.get);

const co = (over: Partial<FilterableCompany>): FilterableCompany => ({
  razao_social: 'Empresa Padrão LTDA', nome_fantasia: null, cnpj: '11222333000144',
  cnae_principal: 4781400, uf: 'SP', municipio_id: 100, porte: 'pequeno', ...over,
});

beforeEach(() => {
  apiGet.mockReset();
  apiGet.mockResolvedValue({ profile: { cnaes_alvo: [4781400], territorio_municipios: [100] } });
});

describe('useCompanyFilter', () => {
  it('prefill do CNAE-alvo quando não há estado salvo; usa território', async () => {
    const { result } = renderHook(() => useCompanyFilter('t1'));
    await waitFor(() => expect(result.current.alvoCnaes).toEqual([4781400]));
    expect(result.current.fCnae).toBe('4781400');

    const dentro = co({});
    const fora = co({ municipio_id: 999 });
    expect(result.current.apply([dentro, fora])).toEqual([dentro]); // usarAlvo default true
  });

  it('filtra por texto (razão/fantasia/cnpj), cnae e porte', async () => {
    const { result } = renderHook(() => useCompanyFilter('t2'));
    await waitFor(() => expect(result.current.alvoCnaes.length).toBe(1));

    act(() => { result.current.setUsarAlvo(false); result.current.setFCnae(''); });

    act(() => result.current.setFq('padaria'));
    const padaria = co({ razao_social: 'Padaria Pão Quente' });
    expect(result.current.apply([padaria, co({})])).toEqual([padaria]);

    act(() => result.current.setFq('11222333'));
    expect(result.current.apply([co({})])).toHaveLength(1); // bate no CNPJ

    act(() => { result.current.setFq(''); result.current.setFCnae('1111111'); });
    expect(result.current.apply([co({})])).toHaveLength(0);

    act(() => { result.current.setFCnae(''); result.current.setFPorte('micro'); });
    expect(result.current.apply([co({ porte: 'micro' }), co({})])).toHaveLength(1);
  });

  it('UF da tela sobrescreve o território', async () => {
    const { result } = renderHook(() => useCompanyFilter('t3'));
    await waitFor(() => expect(result.current.alvoMunis).toEqual([100]));
    act(() => result.current.setFUf('sc, pr'));
    const sc = co({ uf: 'SC', municipio_id: 999 }); // fora do território, mas UF manda
    expect(result.current.apply([sc, co({ uf: 'SP' })])).toEqual([sc]);
  });

  it('limpar zera tudo; aplicarAlvo restaura CNAEs; persiste no localStorage', async () => {
    const { result } = renderHook(() => useCompanyFilter('t4'));
    await waitFor(() => expect(result.current.alvoCnaes.length).toBe(1));

    act(() => { result.current.setFq('x'); result.current.limpar(); });
    expect(result.current.fq).toBe('');
    expect(result.current.usarAlvo).toBe(false);
    expect(result.current.filtroAtivo).toBe(false);

    act(() => result.current.aplicarAlvo());
    expect(result.current.fCnae).toBe('4781400');
    expect(result.current.usarAlvo).toBe(true);

    await waitFor(() => {
      const saved = JSON.parse(localStorage.getItem('companyFilter:t4')!) as { fCnae: string };
      expect(saved.fCnae).toBe('4781400');
    });
  });

  it('estado salvo tem precedência sobre o prefill', async () => {
    localStorage.setItem('companyFilter:t5',
      JSON.stringify({ fq: 'salvo', fCnae: '999', fUf: '', fPorte: '', usarAlvo: false }));
    const { result } = renderHook(() => useCompanyFilter('t5'));
    await waitFor(() => expect(result.current.alvoCnaes.length).toBe(1));
    expect(result.current.fq).toBe('salvo');
    expect(result.current.fCnae).toBe('999'); // sem prefill por cima
  });
});
