import { describe, it, expect } from 'vitest';
import { brl, brl0, fmtDate, todayStr, maskCEP, maskPlaca } from '../src/lib/format.ts';

// Intl usa NBSP entre "R$" e o número — normaliza para comparar.
const plain = (s: string): string => s.replace(/ /g, ' ');

describe('format', () => {
  it('brl formata com centavos', () => {
    expect(plain(brl(1234.5))).toBe('R$ 1.234,50');
    expect(plain(brl(0))).toBe('R$ 0,00');
  });

  it('brl0 arredonda sem centavos', () => {
    expect(plain(brl0(1234.5))).toBe('R$ 1.235');
    expect(plain(brl0(5000))).toBe('R$ 5.000');
  });

  it('fmtDate converte ISO sem shift de fuso', () => {
    expect(fmtDate('2026-06-12')).toBe('12/06/2026');
    expect(fmtDate('2026-01-01')).toBe('01/01/2026'); // viraria 31/12 com shift
  });

  it('todayStr devolve YYYY-MM-DD', () => {
    expect(todayStr()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('maskCEP formata 00000-000 e descarta excesso/letras', () => {
    expect(maskCEP('01310100')).toBe('01310-100');
    expect(maskCEP('01310')).toBe('01310');        // parcial sem hífen
    expect(maskCEP('013101')).toBe('01310-1');     // hífen a partir do 6º dígito
    expect(maskCEP('abc01310100xyz')).toBe('01310-100'); // só dígitos
    expect(maskCEP('013101009999')).toBe('01310-100');   // máx 8 dígitos
    expect(maskCEP('')).toBe('');
  });

  it('maskPlaca uppercase, alfanumérico, máx 7 (Mercosul e antiga)', () => {
    expect(maskPlaca('abc1d23')).toBe('ABC1D23');  // Mercosul
    expect(maskPlaca('abc1234')).toBe('ABC1234');  // antiga
    expect(maskPlaca('abc-1d23')).toBe('ABC1D23'); // tira separador
    expect(maskPlaca('abc1d2345')).toBe('ABC1D23'); // máx 7
    expect(maskPlaca('')).toBe('');
  });
});
