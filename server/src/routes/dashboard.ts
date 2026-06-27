import type { FastifyInstance, FastifyRequest } from 'fastify';
import { one, query } from '../db.ts';
import { requireAuth } from '../auth.ts';

// Dashboard (Fase 4): uma chamada agrega funil, vendas vs. meta, comissões,
// agenda do dia, alertas de inatividade/estagnação e (admin) ranking de vendas.
// Escopo por carteira: rep vê só os próprios números; admin vê o consolidado e
// pode focar um vendedor via ?user_id.

// Cláusula de dono para o WHERE dinâmico de cada agregação. rep: força o próprio;
// admin: aplica o filtro opcional ?user_id, senão vê tudo.
function ownerClause(req: FastifyRequest, userIdQ: number | undefined, col: string, params: unknown[]): string {
  if (req.auth!.role !== 'admin') { params.push(req.auth!.userId); return ` AND ${col} = $${params.length}`; }
  if (userIdQ !== undefined) { params.push(userIdQ); return ` AND ${col} = $${params.length}`; }
  return '';
}

export function dashboardRoutes(app: FastifyInstance): void {
  app.get('/api/dashboard', {
    preHandler: requireAuth,
    schema: {
      querystring: {
        type: 'object',
        properties: {
          competencia: { type: 'string', pattern: '^\\d{4}-\\d{2}$' },
          user_id: { type: 'integer' },
        },
      },
    },
  }, async (req) => {
    const orgId = req.auth!.orgId;
    const q = req.query as { competencia?: string; user_id?: number };
    const comp = q.competencia ?? new Date().toISOString().slice(0, 7);
    const monthStart = `${comp}-01`;

    const org = await one<{ inatividade_dias: number }>(
      'SELECT inatividade_dias FROM organizations WHERE id = $1', [orgId],
    );
    const inatividadeDias = org?.inatividade_dias ?? 30;

    // 1) Funil por stage (negócios ativos: exclui descartados).
    const funilParams: unknown[] = [orgId];
    const funilOwner = ownerClause(req, q.user_id, 'r.owner_user_id', funilParams);
    const funil = await query(
      `SELECT s.id, s.nome, s.ordem,
              count(r.id)::int AS qtd,
              COALESCE(sum(r.valor_estimado), 0) AS valor
       FROM stages s
       LEFT JOIN company_relationships r
         ON r.stage_id = s.id AND r.org_id = s.org_id
        AND r.status <> 'descartado'${funilOwner}
       WHERE s.org_id = $1
       GROUP BY s.id, s.nome, s.ordem
       ORDER BY s.ordem`,
      funilParams,
    );

    // 2) Vendas do mês (faturado/entregue) vs. meta (goals da competência).
    const vendasParams: unknown[] = [orgId, monthStart];
    const vendasOwner = ownerClause(req, q.user_id, 'o.owner_user_id', vendasParams);
    const vendas = await one<{ total: string; qtd: number }>(
      `SELECT COALESCE(sum(o.total), 0) AS total, count(*)::int AS qtd
       FROM orders o
       WHERE o.org_id = $1 AND o.status IN ('faturado','entregue')
         AND date_trunc('month', o.faturado_em) = $2::date${vendasOwner}`,
      vendasParams,
    );
    const metaParams: unknown[] = [orgId, monthStart];
    const metaOwner = ownerClause(req, q.user_id, 'user_id', metaParams);
    const meta = await one<{ valor_meta: string }>(
      `SELECT COALESCE(sum(valor_meta), 0) AS valor_meta
       FROM goals WHERE org_id = $1 AND competencia = $2::date${metaOwner}`,
      metaParams,
    );

    // 3) Comissões do mês.
    const comParams: unknown[] = [orgId, monthStart];
    const comOwner = ownerClause(req, q.user_id, 'user_id', comParams);
    const comissoes = await one<{ previsto: string; recebido: string; divergentes: number }>(
      `SELECT
         COALESCE(sum(valor_previsto) FILTER (WHERE status <> 'cancelada'), 0) AS previsto,
         COALESCE(sum(valor_recebido) FILTER (WHERE status IN ('recebida','divergente')), 0) AS recebido,
         count(*) FILTER (WHERE status = 'divergente')::int AS divergentes
       FROM commission_entries
       WHERE org_id = $1 AND competencia = $2::date${comOwner}`,
      comParams,
    );

    // 4) Agenda de hoje (compromissos pendentes).
    const agParams: unknown[] = [orgId];
    const agOwner = ownerClause(req, q.user_id, 'a.owner_user_id', agParams);
    const agenda = await query(
      `SELECT a.id, a.tipo, a.titulo, a.start_at, a.company_id, c.razao_social
       FROM activities a
       LEFT JOIN companies c ON c.id = a.company_id
       WHERE a.org_id = $1 AND a.status = 'pendente'
         AND a.start_at >= current_date AND a.start_at < current_date + 1${agOwner}
       ORDER BY a.start_at`,
      agParams,
    );

    // 5a) Alerta de inatividade: prospects sem contato há N+ dias (data_contato,
    // ou created_at quando nunca houve contato).
    const inatParams: unknown[] = [orgId, inatividadeDias];
    const inatOwner = ownerClause(req, q.user_id, 'r.owner_user_id', inatParams);
    const semContato = await query(
      `SELECT r.id, r.company_id, c.razao_social, c.nome_fantasia,
              COALESCE(r.data_contato, r.created_at::date)::text AS ultimo_contato,
              (current_date - COALESCE(r.data_contato, r.created_at::date))::int AS dias
       FROM company_relationships r
       JOIN companies c ON c.id = r.company_id
       WHERE r.org_id = $1 AND r.status = 'prospect'
         AND COALESCE(r.data_contato, r.created_at::date) < current_date - $2::int${inatOwner}
       ORDER BY dias DESC
       LIMIT 20`,
      inatParams,
    );

    // 5b) Negócios parados no mesmo stage há 30+ dias (ainda no funil ativo).
    const paradoParams: unknown[] = [orgId];
    const paradoOwner = ownerClause(req, q.user_id, 'r.owner_user_id', paradoParams);
    const parados = await query(
      `SELECT r.id, r.company_id, c.razao_social, c.nome_fantasia, s.nome AS stage,
              r.stage_changed_at::date::text AS desde,
              (current_date - r.stage_changed_at::date)::int AS dias
       FROM company_relationships r
       JOIN companies c ON c.id = r.company_id
       LEFT JOIN stages s ON s.id = r.stage_id
       WHERE r.org_id = $1 AND r.status = 'prospect'
         AND r.stage_changed_at < now() - interval '30 days'${paradoOwner}
       ORDER BY dias DESC
       LIMIT 20`,
      paradoParams,
    );

    // 6) Ranking de vendas do mês por vendedor (consolidado — só admin).
    let ranking: unknown[] = [];
    if (req.auth!.role === 'admin' && q.user_id === undefined) {
      ranking = await query(
        `SELECT u.id AS user_id, u.nome, u.email,
                COALESCE(sum(o.total), 0) AS total, count(o.id)::int AS qtd
         FROM users u
         LEFT JOIN orders o
           ON o.owner_user_id = u.id AND o.org_id = u.org_id
          AND o.status IN ('faturado','entregue')
          AND date_trunc('month', o.faturado_em) = $2::date
         WHERE u.org_id = $1 AND u.ativo
         GROUP BY u.id, u.nome, u.email
         ORDER BY total DESC`,
        [orgId, monthStart],
      );
    }

    return {
      competencia: comp,
      inatividade_dias: inatividadeDias,
      funil,
      vendas: { total: Number(vendas?.total ?? 0), qtd: vendas?.qtd ?? 0, meta: Number(meta?.valor_meta ?? 0) },
      comissoes: {
        previsto: Number(comissoes?.previsto ?? 0),
        recebido: Number(comissoes?.recebido ?? 0),
        divergentes: comissoes?.divergentes ?? 0,
      },
      agenda,
      alertas: { sem_contato: semContato, parados },
      ranking,
    };
  });
}
