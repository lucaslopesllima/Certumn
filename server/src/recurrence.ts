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

// Gera os filhos pendentes de todos os modelos (ou de uma org só) num único
// INSERT set-based. Retorna quantos lançamentos novos foram criados. `hoje`
// injetável para teste.
//
// Para cada modelo, generate_series percorre do mês seguinte ao de origem até o
// mês atual (ou recorrencia_fim, o que vier antes). `vencimento + n meses` no
// Postgres preserva o dia com clamp no último dia do mês (31/jan + 1 mês =
// 28/fev), a mesma semântica do antigo addMonthsClamped em JS. Datas em UTC
// (toISOString) para não escorregar por fuso.
export async function materializeRecurrences(orgId?: number, hoje = new Date()): Promise<number> {
  const params: unknown[] = [hoje.toISOString().slice(0, 10)];
  let whereOrg = '';
  if (orgId !== undefined) { params.push(orgId); whereOrg = ` AND t.org_id = $${params.length}`; }
  const rows = await query<{ id: string }>(
    `INSERT INTO finance_entries
       (org_id, kind, descricao, valor, vencimento, status, categoria, categoria_id, notas,
        company_id, represented_id, owner_user_id, recorrencia_origem_id, recorrencia_competencia)
     SELECT t.org_id, t.kind, t.descricao, t.valor,
            (t.vencimento + make_interval(months => g.n))::date,
            'pendente', t.categoria, t.categoria_id, t.notas,
            t.company_id, t.represented_id, t.owner_user_id, t.id,
            date_trunc('month', t.vencimento + make_interval(months => g.n))::date
     FROM finance_entries t
     CROSS JOIN LATERAL generate_series(1,
       ((extract(year FROM $1::date) - extract(year FROM t.vencimento)) * 12
        + (extract(month FROM $1::date) - extract(month FROM t.vencimento)))::int) AS g(n)
     WHERE t.recorrencia = 'mensal' AND t.recorrencia_origem_id IS NULL AND t.status <> 'cancelado'${whereOrg}
       AND (t.recorrencia_fim IS NULL
            OR date_trunc('month', t.vencimento + make_interval(months => g.n))
               <= date_trunc('month', t.recorrencia_fim))
     ON CONFLICT (recorrencia_origem_id, recorrencia_competencia)
       WHERE recorrencia_origem_id IS NOT NULL DO NOTHING
     RETURNING id`,
    params,
  );
  return rows.length;
}
