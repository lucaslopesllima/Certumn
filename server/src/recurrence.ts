import { query } from './db.ts';

// Materializador de lançamentos recorrentes (Fase 6.1). Cada finance_entry com
// `recorrencia` preenchido e sem `recorrencia_origem_id` é um MODELO mensal: o
// próprio registro é o lançamento do mês de origem, e geramos um filho por mês
// decorrido até o mês atual (limitado por recorrencia_fim). Idempotente via
// índice único (recorrencia_origem_id, mês do vencimento) — pode rodar no boot
// e/ou via cron diário sem duplicar.
//
// Hoje só 'mensal' é tratado; qualquer outro valor de recorrencia é ignorado
// (o campo é texto livre para evoluir sem migration).

interface Template {
  id: string;
  org_id: string;
  kind: string;
  descricao: string;
  valor: string;
  vencimento: string;        // YYYY-MM-DD
  categoria: string | null;
  categoria_id: string | null;
  notas: string | null;
  company_id: string | null;
  represented_id: string | null;
  owner_user_id: string | null;
  recorrencia_fim: string | null;
}

// Soma `n` meses a uma data preservando o dia, com clamp no último dia do mês
// (31/jan + 1 mês = 28/fev). Trabalha em UTC para não escorregar por fuso.
function addMonthsClamped(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  const day = d.getUTCDate();
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return target.toISOString().slice(0, 10);
}

const monthKey = (iso: string): string => iso.slice(0, 7); // YYYY-MM

// Gera os filhos pendentes de todos os modelos (ou de uma org só). Retorna
// quantos lançamentos novos foram criados. `hoje` injetável para teste.
export async function materializeRecurrences(orgId?: number, hoje = new Date()): Promise<number> {
  const params: unknown[] = [];
  let whereOrg = '';
  if (orgId !== undefined) { params.push(orgId); whereOrg = ` AND org_id = $${params.length}`; }
  const templates = await query<Template>(
    `SELECT id, org_id, kind, descricao, valor, vencimento::text AS vencimento, categoria, categoria_id, notas,
            company_id, represented_id, owner_user_id, recorrencia_fim::text AS recorrencia_fim
     FROM finance_entries
     WHERE recorrencia = 'mensal' AND recorrencia_origem_id IS NULL AND status <> 'cancelado'${whereOrg}`,
    params,
  );

  const currentMonth = hoje.toISOString().slice(0, 7);
  let created = 0;
  for (const t of templates) {
    const fimMonth = t.recorrencia_fim ? monthKey(t.recorrencia_fim) : null;
    // do mês seguinte ao de origem até o mês atual (ou o fim, o que vier antes).
    for (let n = 1; ; n++) {
      const venc = addMonthsClamped(t.vencimento, n);
      const m = monthKey(venc);
      if (m > currentMonth) break;
      if (fimMonth && m > fimMonth) break;
      const rows = await query<{ id: string }>(
        `INSERT INTO finance_entries
           (org_id, kind, descricao, valor, vencimento, status, categoria, categoria_id, notas,
            company_id, represented_id, owner_user_id, recorrencia_origem_id, recorrencia_competencia)
         VALUES ($1, $2::finance_kind, $3, $4, $5, 'pendente', $6, $7, $8, $9, $10, $11, $12, $13)
         ON CONFLICT (recorrencia_origem_id, recorrencia_competencia)
           WHERE recorrencia_origem_id IS NOT NULL DO NOTHING
         RETURNING id`,
        [t.org_id, t.kind, t.descricao, t.valor, venc, t.categoria, t.categoria_id, t.notas,
          t.company_id, t.represented_id, t.owner_user_id, t.id, `${m}-01`],
      );
      if (rows.length > 0) created++;
    }
  }
  return created;
}
