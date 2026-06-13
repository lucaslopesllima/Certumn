// Export CSV genérico (Fase 4). BOM UTF-8 no início para o Excel abrir os
// acentos corretamente; separador ';' (padrão pt-BR) e valores entre aspas com
// escape de aspas internas.
type Cell = string | number | boolean | null | undefined;

export function downloadCsv(filename: string, headers: string[], rows: Cell[][]): void {
  const esc = (v: Cell): string => {
    const s = v == null ? '' : String(v);
    return `"${s.replace(/"/g, '""')}"`;
  };
  const linhas = [headers, ...rows].map((r) => r.map(esc).join(';'));
  const csv = `﻿${linhas.join('\r\n')}`;
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename.endsWith('.csv') ? filename : `${filename}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
