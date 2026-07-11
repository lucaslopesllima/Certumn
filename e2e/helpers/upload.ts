// CSVs de teste gerados inline — sem fixtures binárias no repo.
export function clientesCsv(cnpjs: string[]): Buffer {
  return Buffer.from(cnpjs.join('\n'), 'utf8');
}

export function pedidosImportCsv(rows: { nf: string; data: string; cnpj: string; valor: string }[]): Buffer {
  const header = 'nf;data;cnpj;valor';
  const lines = rows.map((r) => `${r.nf};${r.data};${r.cnpj};${r.valor}`);
  return Buffer.from([header, ...lines].join('\n'), 'utf8');
}

export function commissionsReconcileCsv(rows: { pedido: string; valor: string; data: string }[]): Buffer {
  const header = 'pedido;valor;data';
  const lines = rows.map((r) => `${r.pedido};${r.valor};${r.data}`);
  return Buffer.from([header, ...lines].join('\n'), 'utf8');
}
