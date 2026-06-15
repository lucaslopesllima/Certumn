// Formatadores compartilhados (antes duplicados em Kanban/Finance/Routes/Catalog).

// moeda com centavos (financeiro, catálogo)
export const brl = (v: number): string =>
  v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

// moeda sem centavos (KPIs/cards, onde centavo é ruído)
export const brl0 = (v: number): string =>
  v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });

// 'YYYY-MM-DD' -> data pt-BR (T00:00:00 evita shift de fuso)
export const fmtDate = (iso: string): string =>
  new Date(iso + 'T00:00:00').toLocaleDateString('pt-BR');

export const todayStr = (): string => new Date().toISOString().slice(0, 10);

// Number de valor digitado aceitando vírgula OU ponto decimal (pt-BR). Para
// inputs type="text"/inputMode="decimal" onde o usuário pode digitar "1,5".
// '' / inválido -> NaN (caller trata com `|| 0` ou checagem própria).
export const dec = (s: string | number | null | undefined): number =>
  s == null || s === '' ? NaN : Number(String(s).replace(',', '.'));

// numeric cru do banco -> string limpa para input de edição. Tira zeros à
// direita SEM arredondar (preserva precisão): '90.000000'->'90',
// '10.330000'->'10.33', '10.333'->'10.333'. Mantém o valor cru editável; o
// arredondamento acontece só na borda (NF/exibição via brl).
export const numStr = (v: number | string | null | undefined): string =>
  v == null || v === '' ? '' : String(Number(v));

// número p/ célula de CSV no padrão pt-BR (vírgula decimal), sem símbolo —
// o Excel pt-BR lê como número. Ex.: 1234.5 -> "1234,50".
export const csvNum = (v: number | string): string => {
  const n = Number(v);
  return Number.isFinite(n)
    ? n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: false })
    : '0,00';
};

/* ── Máscaras de entrada (aplicar no onChange) ──────────────────────────────
   Formatam enquanto o usuário digita; quando o backend espera número puro,
   guardar só os dígitos/parse no estado. Sem dependência — string slicing. */

// telefone BR: (11) 3333-4444 / (11) 93333-4444
export const maskPhone = (v: string): string => {
  const d = v.replace(/\D/g, '').slice(0, 11);
  if (d.length <= 2) return d.replace(/^(\d{0,2})/, '($1');
  if (d.length <= 6) return d.replace(/^(\d{2})(\d{0,4})/, '($1) $2');
  if (d.length <= 10) return d.replace(/^(\d{2})(\d{4})(\d{0,4})/, '($1) $2-$3');
  return d.replace(/^(\d{2})(\d{5})(\d{0,4})/, '($1) $2-$3');
};

// CEP: 00000-000
export const maskCEP = (v: string): string => {
  const d = v.replace(/\D/g, '').slice(0, 8);
  return d.replace(/^(\d{5})(\d)/, '$1-$2');
};

// Placa BR: ABC1D23 (Mercosul) ou ABC1234 (antiga). Uppercase + só
// letras/dígitos, máx 7 chars. Não força layout (aceita ambos formatos);
// posição 5 pode ser letra (Mercosul) ou dígito (antiga).
export const maskPlaca = (v: string): string =>
  v.replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 7);

// CNPJ: 00.000.000/0000-00
export const maskCNPJ = (v: string): string => {
  const d = v.replace(/\D/g, '').slice(0, 14);
  return d
    .replace(/^(\d{2})(\d)/, '$1.$2')
    .replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/\.(\d{3})(\d)/, '.$1/$2')
    .replace(/(\d{4})(\d)/, '$1-$2');
};

// Máscara p/ campos de busca que aceitam nome OU CNPJ. Só formata como CNPJ
// quando a entrada é numérica (sem letras) e já tem ≥4 dígitos em sequência;
// texto de nome passa intacto. O backend/filtros extraem só os dígitos, então
// a máscara é cosmética e não quebra a busca. Casado com a regra do servidor
// em /api/companies/search (CNPJ quando sem letras e ≥4 dígitos).
export const maskSearchCNPJ = (v: string): string =>
  /[a-zA-Z]/.test(v) || v.replace(/\D/g, '').length < 4 ? v : maskCNPJ(v);

// Percentual 0–100 p/ inputs type="text" inputMode="decimal": mantém só
// dígitos + 1 separador decimal (até 2 casas), normaliza p/ vírgula e capa
// em 100. Guarda string editável; o caller faz dec() no submit. '' fica ''.
export const maskPct = (v: string): string => {
  const [int, ...rest] = v.replace(/[^\d.,]/g, '').replace(/[.,]/g, ',').split(',');
  const out = rest.length ? `${int},${rest.join('').slice(0, 2)}` : int;
  return dec(out) > 100 ? '100' : out;
};

// link wa.me (WhatsApp click-to-chat). Assume DDI Brasil (55) quando ausente.
// Retorna null se não houver dígitos suficientes p/ um telefone válido.
export const waLink = (tel: string | null | undefined): string | null => {
  if (!tel) return null;
  const d = tel.replace(/\D/g, '');
  if (d.length < 10) return null;
  return `https://wa.me/${d.length <= 11 ? `55${d}` : d}`;
};
