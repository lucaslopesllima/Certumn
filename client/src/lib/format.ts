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

// link wa.me (WhatsApp click-to-chat). Assume DDI Brasil (55) quando ausente.
// Retorna null se não houver dígitos suficientes p/ um telefone válido.
export const waLink = (tel: string | null | undefined): string | null => {
  if (!tel) return null;
  const d = tel.replace(/\D/g, '');
  if (d.length < 10) return null;
  return `https://wa.me/${d.length <= 11 ? `55${d}` : d}`;
};
