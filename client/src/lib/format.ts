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

// CNPJ: 00.000.000/0000-00
export const maskCNPJ = (v: string): string => {
  const d = v.replace(/\D/g, '').slice(0, 14);
  return d
    .replace(/^(\d{2})(\d)/, '$1.$2')
    .replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/\.(\d{3})(\d)/, '.$1/$2')
    .replace(/(\d{4})(\d)/, '$1-$2');
};

// link wa.me (WhatsApp click-to-chat). Assume DDI Brasil (55) quando ausente.
// Retorna null se não houver dígitos suficientes p/ um telefone válido.
export const waLink = (tel: string | null | undefined): string | null => {
  if (!tel) return null;
  const d = tel.replace(/\D/g, '');
  if (d.length < 10) return null;
  return `https://wa.me/${d.length <= 11 ? `55${d}` : d}`;
};
