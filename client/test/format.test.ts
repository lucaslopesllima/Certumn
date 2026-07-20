import { describe, it, expect } from 'vitest';
import { brl, brl0, fmtDate, todayStr, maskCEP, maskPhone, maskPlaca, isEmail, maskCNPJ, validCNPJ, invalidCNPJ, maskCPF, validCPF, maskUF } from '../src/lib/format.ts';

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

  it('maskPhone formata fixo e celular', () => {
    expect(maskPhone('1133334444')).toBe('(11) 3333-4444');
    expect(maskPhone('11933334444')).toBe('(11) 93333-4444');
    expect(maskPhone('11')).toBe('(11');
    expect(maskPhone('')).toBe('('); // quirk pré-existente: \d{0,2} casa vazio
  });

  it('maskPhone descarta DDI 55 de número vindo do WhatsApp', () => {
    expect(maskPhone('5547991788956')).toBe('(47) 99178-8956'); // 13 díg (celular)
    expect(maskPhone('554791788956')).toBe('(47) 9178-8956');   // 12 díg (sem nono)
    expect(maskPhone('5533334444')).toBe('(55) 3333-4444');     // DDD 55 nacional mantém
    expect(maskPhone('55999998888')).toBe('(55) 99999-8888');   // celular DDD 55 mantém
  });

  it('maskPlaca uppercase, alfanumérico, máx 7 (Mercosul e antiga)', () => {
    expect(maskPlaca('abc1d23')).toBe('ABC1D23');  // Mercosul
    expect(maskPlaca('abc1234')).toBe('ABC1234');  // antiga
    expect(maskPlaca('abc-1d23')).toBe('ABC1D23'); // tira separador
    expect(maskPlaca('abc1d2345')).toBe('ABC1D23'); // máx 7
    expect(maskPlaca('')).toBe('');
  });

  it('isEmail exige algo@algo.tld e ignora espaços nas bordas', () => {
    expect(isEmail('a@b.co')).toBe(true);
    expect(isEmail('  a@b.co  ')).toBe(true);
    expect(isEmail('a@b')).toBe(false);      // type=email nativo aceitaria
    expect(isEmail('a b@c.co')).toBe(false); // espaço no meio
    expect(isEmail('')).toBe(false);
  });

  it('validCNPJ confere dígitos verificadores', () => {
    expect(validCNPJ('11.222.333/0001-81')).toBe(true); // com máscara
    expect(validCNPJ('11222333000181')).toBe(true);
    expect(validCNPJ('11222333000144')).toBe(false); // DV errado
    expect(validCNPJ('00000000000000')).toBe(false); // sequência repetida
    expect(validCNPJ('123')).toBe(false);            // incompleto
  });

  it('validCNPJ aceita CNPJ alfanumérico (RFB 2026, charCode − 48)', () => {
    expect(validCNPJ('12.ABC.345/01DE-35')).toBe(true); // exemplo da especificação
    expect(validCNPJ('12abc34501de35')).toBe(true);     // minúscula normaliza
    expect(validCNPJ('12ABC34501DE36')).toBe(false);    // DV errado
    expect(validCNPJ('12ABC34501DEAA')).toBe(false);    // DV tem que ser numérico
  });

  it('maskCNPJ formata numérico e alfanumérico; DV só aceita dígito', () => {
    expect(maskCNPJ('11222333000181')).toBe('11.222.333/0001-81');
    expect(maskCNPJ('112223')).toBe('11.222.3');            // parcial
    expect(maskCNPJ('12abc34501de35')).toBe('12.ABC.345/01DE-35'); // alfanumérico uppercase
    expect(maskCNPJ('12ABC34501DEXY')).toBe('12.ABC.345/01DE');    // letra no DV descartada
    expect(maskCNPJ('')).toBe('');
  });

  it('invalidCNPJ conta letras no comprimento do alfanumérico', () => {
    expect(invalidCNPJ('12ABC34501DE36')).toBe(true);  // completo, DV errado
    expect(invalidCNPJ('12ABC34501DE35')).toBe(false); // válido
    expect(invalidCNPJ('12ABC345')).toBe(false);       // parcial não trava
  });

  it('invalidCNPJ só bloqueia CNPJ completo com DV errado (legado parcial passa)', () => {
    expect(invalidCNPJ('11222333000144')).toBe(true);  // 14 díg, DV errado
    expect(invalidCNPJ('11222333000181')).toBe(false); // válido
    expect(invalidCNPJ('123')).toBe(false);            // parcial/legado não trava
    expect(invalidCNPJ('')).toBe(false);
  });

  it('maskCPF formata 000.000.000-00', () => {
    expect(maskCPF('52998224725')).toBe('529.982.247-25');
    expect(maskCPF('529982')).toBe('529.982');
    expect(maskCPF('5299822472599')).toBe('529.982.247-25'); // máx 11 dígitos
    expect(maskCPF('')).toBe('');
  });

  it('validCPF confere dígitos verificadores', () => {
    expect(validCPF('529.982.247-25')).toBe(true);
    expect(validCPF('52998224725')).toBe(true);
    expect(validCPF('52998224724')).toBe(false); // DV errado
    expect(validCPF('11111111111')).toBe(false); // sequência repetida
    expect(validCPF('123')).toBe(false);
  });

  it('maskUF só letras, uppercase, 2 chars', () => {
    expect(maskUF('sc')).toBe('SC');
    expect(maskUF('s1c2p')).toBe('SC');
    expect(maskUF('')).toBe('');
  });
});
