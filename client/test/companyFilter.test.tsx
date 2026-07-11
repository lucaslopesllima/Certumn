// useCompanyFilter: filtragem client-side e persistência do filtro de empresas.
// O perfil-alvo foi removido; o território (municípios) agora vive no filtro,
// persistido no navegador (companyFilter:reco) e aplicado ao client-side.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useCompanyFilter, CompanyFilterBar, loadPartida, loadTerritorioIds, type FilterableCompany } from '../src/lib/companyFilter.tsx';
import { api } from '../src/lib/api.ts';
import type { Municipio } from '../src/lib/types.ts';

vi.mock('../src/lib/api.ts', () => ({ api: { get: vi.fn(), invalidate: vi.fn() }, ApiError: class extends Error {} }));
const m = vi.mocked(api);

const co = (over: Partial<FilterableCompany>): FilterableCompany => ({
  razao_social: 'Empresa Padrão LTDA', nome_fantasia: null, cnpj: '11222333000144',
  cnae_principal: 4781400, uf: 'SP', municipio_id: 100, porte: 'pequeno', ...over,
});
const mun = (id: number, uf = 'SP'): Municipio => ({ id, nome: `Cidade ${id}`, uf, regiao: 'Sudeste' });

beforeEach(() => {
  localStorage.clear();
  m.get.mockReset();
  m.get.mockImplementation(async (p: string) => {
    if (p.startsWith('/api/cnae/search')) return { grupos: [{ divisao: 47, secao: 'G', itens: [{ codigo: 4781400, descricao: 'Comércio de vestuário' }, { codigo: 4711301, descricao: 'Supermercado' }] }] };
    if (p === '/api/municipios/ufs') return { ufs: [{ uf: 'SP', total: 2 }, { uf: 'PR', total: 5 }] };
    if (p.startsWith('/api/municipios/search')) return { municipios: [mun(100), mun(200)] };
    if (p.startsWith('/api/municipios/by-uf')) return { municipios: [mun(100), mun(200)] };
    if (p.startsWith('/api/geocode')) return { geocode: { lat: -1, lon: -2, label: 'Endereço X' } };
    return {};
  });
});

describe('useCompanyFilter', () => {
  it('restringe ao território (municipio_id) com usarAlvo ligado por padrão', () => {
    const { result } = renderHook(() => useCompanyFilter('t1'));
    expect(result.current.usarAlvo).toBe(true);
    act(() => result.current.setTerritorio([mun(100)]));
    const dentro = co({});
    const fora = co({ municipio_id: 999 });
    expect(result.current.apply([dentro, fora])).toEqual([dentro]);
  });

  it('filtra por texto (razão/fantasia/cnpj), cnae e porte', () => {
    const { result } = renderHook(() => useCompanyFilter('t2'));
    act(() => result.current.setUsarAlvo(false));

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

  it('UF da tela sobrescreve o território', () => {
    const { result } = renderHook(() => useCompanyFilter('t3'));
    act(() => result.current.setTerritorio([mun(100)]));
    act(() => result.current.setFUf('sc, pr'));
    const sc = co({ uf: 'SC', municipio_id: 999 }); // fora do território, mas UF manda
    expect(result.current.apply([sc, co({ uf: 'SP' })])).toEqual([sc]);
  });

  it('limpar zera os filtros e desliga o território', () => {
    const { result } = renderHook(() => useCompanyFilter('t4'));
    act(() => { result.current.setFq('x'); result.current.setTerritorio([mun(100)]); });
    expect(result.current.filtroAtivo).toBe(true);
    act(() => result.current.limpar());
    expect(result.current.fq).toBe('');
    expect(result.current.usarAlvo).toBe(false);
    expect(result.current.filtroAtivo).toBe(false);
  });

  it('persiste o filtro e o território no localStorage', async () => {
    const { result } = renderHook(() => useCompanyFilter('t5'));
    act(() => { result.current.setFCnae('4781400'); result.current.setTerritorio([mun(100)]); });
    await waitFor(() => {
      const saved = JSON.parse(localStorage.getItem('companyFilter:t5')!) as { fCnae: string };
      expect(saved.fCnae).toBe('4781400');
      const reco = JSON.parse(localStorage.getItem('companyFilter:reco')!) as { munis: Municipio[] };
      expect(reco.munis.map((mn) => mn.id)).toEqual([100]);
    });
  });

  it('estado salvo tem precedência sobre o default', () => {
    localStorage.setItem('companyFilter:t6',
      JSON.stringify({ fq: 'salvo', fCnae: '999', fUf: '', fPorte: '', usarAlvo: false }));
    const { result } = renderHook(() => useCompanyFilter('t6'));
    expect(result.current.fq).toBe('salvo');
    expect(result.current.fCnae).toBe('999');
    expect(result.current.usarAlvo).toBe(false);
  });
});

// ── Barra de filtros (UI): funil (avançado), CNAE search, partida, recomendação ──
function Bar({ recommend }: { recommend?: boolean }): React.JSX.Element {
  const f = useCompanyFilter('bar');
  return <CompanyFilterBar f={f} recommend={recommend} />;
}

describe('CompanyFilterBar — funil', () => {
  it('colapsa/expande a seção básica', async () => {
    render(<Bar />);
    const nome = screen.getByPlaceholderText('Razão, fantasia ou CNPJ');
    expect(nome).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Filtros' }));
    // seção fecha (grid-rows-[0fr]); o input segue no DOM mas colapsado — apenas exercita o toggle
    await userEvent.click(screen.getByRole('button', { name: 'Filtros' }));
  });

  it('máscara de nome/CNPJ, UF e porte atualizam o filtro', async () => {
    render(<Bar />);
    await userEvent.type(screen.getByPlaceholderText('Razão, fantasia ou CNPJ'), '11222333');
    await userEvent.type(screen.getByPlaceholderText('Ex.: SC, PR'), 'SC');
    await userEvent.selectOptions(screen.getByRole('combobox'), 'micro');
    expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe('micro');
  });

  it('território (avançado) habilita restrição e limpa', async () => {
    localStorage.setItem('companyFilter:reco', JSON.stringify({ munis: [mun(100), mun(200)], pesos: { cnae: 0.5, proximidade: 0.3, porte: 0.2 }, partida: null }));
    render(<Bar />);
    await userEvent.click(screen.getByRole('button', { name: /Filtros avançados/ }));
    const chk = await screen.findByRole('checkbox');
    expect(chk).not.toBeDisabled();
    expect(screen.getByText(/2 municípios/)).toBeInTheDocument();
    await userEvent.click(chk);
    await userEvent.click(screen.getByRole('button', { name: 'Limpar' }));
  });
});

describe('CnaeSearchInput', () => {
  const openAdv = async (): Promise<HTMLElement> => {
    render(<Bar />);
    return screen.getByPlaceholderText(/Atividade \(ex.: padaria\)/);
  };

  it('busca por texto, adiciona e remove código', async () => {
    const inp = await openAdv();
    await userEvent.type(inp, 'a'); // <2 chars: sem busca
    await userEvent.type(inp, 'ba');
    expect(await screen.findByText('Comércio de vestuário', undefined, { timeout: 2000 })).toBeInTheDocument();
    await userEvent.click(screen.getByText('Comércio de vestuário'));
    // chip aparece com o código
    expect(await screen.findByText('4781400')).toBeInTheDocument();
    // remove
    await userEvent.click(screen.getByText('4781400').closest('button')!);
    await waitFor(() => expect(screen.queryByText('4781400')).not.toBeInTheDocument());
  });

  it('Enter com dígitos adiciona; letras não; código repetido é ignorado', async () => {
    const inp = await openAdv();
    await userEvent.type(inp, '478{Enter}');
    expect((await screen.findAllByText('478')).length).toBeGreaterThan(0);
    await userEvent.type(inp, '478{Enter}'); // repetido → early return
    await userEvent.type(inp, 'abc{Enter}'); // sem dígitos → nada
  });

  it('foco reabre e sem resultados mostra aviso', async () => {
    m.get.mockImplementation(async () => ({ grupos: [] }));
    const inp = await openAdv();
    await userEvent.type(inp, 'zzz');
    expect(await screen.findByText(/Nenhum CNAE encontrado/, undefined, { timeout: 2000 })).toBeInTheDocument();
    fireEvent.blur(inp);
  });

  it('erro na API deixa a lista vazia', async () => {
    m.get.mockImplementation(async (p: string) => {
      if (p.startsWith('/api/cnae/search')) throw new Error('x');
      return {};
    });
    const inp = await openAdv();
    await userEvent.type(inp, 'padaria');
    await new Promise((r) => setTimeout(r, 400));
    expect(screen.queryByText('Comércio de vestuário')).not.toBeInTheDocument();
  });
});

describe('PartidaInput', () => {
  const origFetch = global.fetch;
  afterEach(() => { global.fetch = origFetch; });

  const openPartida = async (): Promise<void> => {
    render(<Bar />);
    await userEvent.click(screen.getByRole('button', { name: /Filtros avançados/ }));
  };

  it('CEP preenche endereço e "Definir" geocodifica; remover limpa', async () => {
    global.fetch = vi.fn().mockResolvedValue({ json: async () => ({ logradouro: 'Rua A', bairro: 'Centro', localidade: 'Blumenau', uf: 'SC' }) }) as unknown as typeof fetch;
    await openPartida();
    const cep = screen.getByPlaceholderText('CEP');
    await userEvent.type(cep, '89000000');
    await waitFor(() => expect((screen.getByPlaceholderText(/Rua XV de Novembro/) as HTMLInputElement).value).toContain('Rua A'));
    await userEvent.click(screen.getByRole('button', { name: 'Definir' }));
    expect(await screen.findByText('Endereço X')).toBeInTheDocument();
    await userEvent.click(screen.getByTitle('Remover endereço de partida'));
    await waitFor(() => expect(screen.queryByText('Endereço X')).not.toBeInTheDocument());
  });

  it('CEP não encontrado e falha de rede no CEP', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({ json: async () => ({ erro: true }) }) as unknown as typeof fetch;
    await openPartida();
    fireEvent.blur(screen.getByPlaceholderText('CEP'), { target: { value: '89000000' } });
    expect(await screen.findByText('CEP não encontrado.')).toBeInTheDocument();
    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('net'));
    const cep = screen.getByPlaceholderText('CEP');
    fireEvent.keyDown(cep, { key: 'Enter' });
    fireEvent.change(cep, { target: { value: '89000-000' } });
    await waitFor(() => expect(screen.getByText('Falha ao buscar o CEP.')).toBeInTheDocument());
  });

  it('endereço curto, não encontrado e falha na geocodificação', async () => {
    await openPartida();
    const q = screen.getByPlaceholderText(/Rua XV de Novembro/);
    fireEvent.keyDown(q, { key: 'Enter' }); // vazio/curto
    await userEvent.click(screen.getByRole('button', { name: 'Definir' }));
    expect(await screen.findByText(/mín. 3 caracteres/)).toBeInTheDocument();

    m.get.mockImplementationOnce(async () => ({ geocode: null }));
    await userEvent.type(q, 'Rua Longa 123');
    fireEvent.keyDown(q, { key: 'Enter' });
    expect(await screen.findByText('Endereço não encontrado.')).toBeInTheDocument();

    m.get.mockImplementationOnce(async () => { throw new Error('geo'); });
    await userEvent.click(screen.getByRole('button', { name: 'Definir' }));
    expect(await screen.findByText('Falha ao localizar o endereço.')).toBeInTheDocument();
  });
});

describe('RecommendConfig', () => {
  it('território por UF, por cidade, pesos e limpar', async () => {
    render(<Bar recommend />);
    // avançado já aberto no modo recommend → UFs carregam
    const sp = await screen.findByRole('button', { name: /^SP/ });
    await userEvent.click(sp); // não cheio → by-uf adiciona
    expect(await screen.findByText(/SP inteiro/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /SP inteiro/ })); // remove UF cheia

    // por cidade
    const busca = screen.getByPlaceholderText(/Buscar cidade/);
    await userEvent.type(busca, 'Blu');
    const opt = await screen.findByText('Cidade 100', undefined, { timeout: 2000 });
    await userEvent.click(opt);
    expect(await screen.findByText(/Cidade 100/)).toBeInTheDocument();
    // remove cidade solta (chip)
    const chips = screen.getAllByText(/Cidade 100/);
    await userEvent.click(chips[chips.length - 1].closest('button')!);

    // pesos
    const ranges = screen.getAllByRole('slider');
    fireEvent.change(ranges[0], { target: { value: '0.8' } });
    await userEvent.click(screen.getByRole('button', { name: 'Limpar filtros' }));
  });

  it('cidade já selecionada fica desabilitada; sem resultado avisa', async () => {
    localStorage.setItem('companyFilter:reco', JSON.stringify({ munis: [mun(100)], pesos: { cnae: 0.5, proximidade: 0.3, porte: 0.2 }, partida: null }));
    render(<Bar recommend />);
    await userEvent.type(screen.getByPlaceholderText(/Buscar cidade/), 'Cid');
    const added = await screen.findByText('adicionado', undefined, { timeout: 2000 });
    expect(added.closest('button')).toBeDisabled();

    m.get.mockImplementation(async (p: string) => {
      if (p === '/api/municipios/ufs') return { ufs: [] };
      if (p.startsWith('/api/municipios/search')) return { municipios: [] };
      return {};
    });
    await userEvent.clear(screen.getByPlaceholderText(/Buscar cidade/));
    await userEvent.type(screen.getByPlaceholderText(/Buscar cidade/), 'Xyz');
    expect(await screen.findByText(/Nenhuma cidade encontrada/, undefined, { timeout: 2000 })).toBeInTheDocument();
  });
});

describe('loaders exportados', () => {
  it('loadPartida e loadTerritorioIds leem do localStorage', () => {
    expect(loadPartida()).toBeNull();
    expect(loadTerritorioIds()).toEqual([]);
    localStorage.setItem('companyFilter:reco', JSON.stringify({ munis: [mun(1), mun(2)], pesos: {}, partida: { label: 'X', lat: 1, lon: 2 } }));
    expect(loadTerritorioIds()).toEqual([1, 2]);
    expect(loadPartida()).toEqual({ label: 'X', lat: 1, lon: 2 });
    // JSON inválido cai no fallback
    localStorage.setItem('companyFilter:reco', '{bad');
    expect(loadTerritorioIds()).toEqual([]);
  });
});
