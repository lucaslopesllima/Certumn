// geocodeAddr com fetch mockado: cobre Nominatim (precisões, erros) e o
// fallback BrasilAPI. O throttle (~1.1s entre chamadas Nominatim) roda de
// verdade na sequência de casos — sem fakes de timer.
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import { geocodeAddr, geocodeText } from '../src/geocode.ts';

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);
afterAll(() => vi.unstubAllGlobals());
beforeEach(() => fetchMock.mockReset());

const ok = (body: unknown): Response =>
  ({ ok: true, json: async () => body } as unknown as Response);
const bad = (): Response => ({ ok: false, json: async () => ({}) } as unknown as Response);

const ADDR = { logradouro: 'Rua A', numero: '10', cidade: 'São Paulo', uf: 'SP', cep: '01001000' };

describe('geocodeAddr', () => {
  it('nominatim building -> precisão rua', async () => {
    fetchMock.mockResolvedValueOnce(ok([{ lat: '-23.5', lon: '-46.6', addresstype: 'building' }]));
    expect(await geocodeAddr(ADDR)).toEqual({ lat: -23.5, lon: -46.6, precisao: 'rua', fonte: 'nominatim' });
    expect(String(fetchMock.mock.calls[0]![0])).toContain('nominatim');
  });

  it('nominatim road -> rua_aprox', async () => {
    fetchMock.mockResolvedValueOnce(ok([{ lat: '-23.5', lon: '-46.6', addresstype: 'road' }]));
    expect((await geocodeAddr(ADDR))?.precisao).toBe('rua_aprox');
  });

  it('sem rua, só CEP -> precisão cep (nominatim)', async () => {
    fetchMock.mockResolvedValueOnce(ok([{ lat: '-23.5', lon: '-46.6' }]));
    expect((await geocodeAddr({ cep: '01001000' }))?.precisao).toBe('cep');
  });

  it('nominatim non-200 -> fallback brasilapi', async () => {
    fetchMock
      .mockResolvedValueOnce(bad())
      .mockResolvedValueOnce(ok({ location: { coordinates: { latitude: '-23.1', longitude: '-46.1' } } }));
    expect(await geocodeAddr(ADDR)).toEqual({ lat: -23.1, lon: -46.1, precisao: 'cep', fonte: 'brasilapi' });
  });

  it('nominatim vazio + brasilapi non-200 -> null', async () => {
    fetchMock.mockResolvedValueOnce(ok([])).mockResolvedValueOnce(bad());
    expect(await geocodeAddr(ADDR)).toBeNull();
  });

  it('nominatim lança + brasilapi sem coordenadas -> null', async () => {
    fetchMock.mockRejectedValueOnce(new Error('net')).mockResolvedValueOnce(ok({ location: {} }));
    expect(await geocodeAddr(ADDR)).toBeNull();
  });

  it('brasilapi lança -> null', async () => {
    fetchMock.mockResolvedValueOnce(ok([])).mockRejectedValueOnce(new Error('net'));
    expect(await geocodeAddr(ADDR)).toBeNull();
  });

  it('sem rua e sem CEP nem chama a rede', async () => {
    expect(await geocodeAddr({ cidade: 'São Paulo' })).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('CEP com tamanho inválido não consulta brasilapi', async () => {
    fetchMock.mockResolvedValueOnce(ok([]));
    expect(await geocodeAddr({ logradouro: 'Rua A', cep: '123' })).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1); // só o nominatim
  });
});

describe('geocodeText', () => {
  it('termo curto (<3) devolve null sem chamar a rede', async () => {
    expect(await geocodeText('ab')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('sucesso devolve lat/lon + label', async () => {
    fetchMock.mockResolvedValueOnce(ok([{ lat: '-23.5', lon: '-46.6', display_name: 'Av. Paulista, SP' }]));
    expect(await geocodeText('Avenida Paulista')).toEqual({
      lat: -23.5, lon: -46.6, precisao: 'texto', fonte: 'nominatim', label: 'Av. Paulista, SP',
    });
    expect(String(fetchMock.mock.calls[0]![0])).toContain('nominatim');
  });
  it('sem display_name usa o próprio termo como label', async () => {
    fetchMock.mockResolvedValueOnce(ok([{ lat: '-1', lon: '-2' }]));
    expect((await geocodeText('Centro'))?.label).toBe('Centro');
  });
  it('resposta não-ok -> null', async () => {
    fetchMock.mockResolvedValueOnce(bad());
    expect(await geocodeText('Rua X')).toBeNull();
  });
  it('resposta vazia -> null', async () => {
    fetchMock.mockResolvedValueOnce(ok([]));
    expect(await geocodeText('Rua Y')).toBeNull();
  });
  it('fetch lança -> null', async () => {
    fetchMock.mockRejectedValueOnce(new Error('net'));
    expect(await geocodeText('Rua Z')).toBeNull();
  });
});
