import type { FastifyInstance } from 'fastify';
import { one, query, withClient } from '../db.ts';
import { requireAuth } from '../auth.ts';
import { config } from '../config.ts';
import { buildRecommendQuery, type RecommendProfile, type RecommendFilters } from '../sql/recommend.ts';

const PORTES = new Set(['nao_informado', 'micro', 'pequeno', 'demais']);

// cnae_divisao_secao é estática (~99 linhas, escrita só por seed) — cache em memória.
let divisaoSecao: Map<number, string> | null = null;
async function getDivisaoSecao(): Promise<Map<number, string>> {
  if (!divisaoSecao) {
    const rows = await query<{ divisao: number; secao: string }>(
      'SELECT divisao, secao FROM cnae_divisao_secao',
    );
    divisaoSecao = new Map(rows.map((r) => [r.divisao, r.secao]));
  }
  return divisaoSecao;
}

// Tiers de fit calculados aqui (e não em CTE) p/ virarem = ANY($array) no SQL:
// arrays indexáveis deixam o planner combinar índices na poda de candidatos.
async function cnaeTiers(cnaesAlvo: number[]): Promise<{
  divisoesAlvo: number[]; secoesAlvo: string[]; pruneDivisoes: number[];
}> {
  const map = await getDivisaoSecao();
  const divisoesAlvo = [...new Set(cnaesAlvo.map((c) => Math.floor(c / 100000)))];
  const secoesAlvo = [...new Set(divisoesAlvo.map((d) => map.get(d)).filter((s): s is string => !!s))];
  const secSet = new Set(secoesAlvo);
  const pruneDivisoes = [...map.entries()].filter(([, s]) => secSet.has(s)).map(([d]) => d);
  return { divisoesAlvo, secoesAlvo, pruneDivisoes };
}

function parseFilters(q: { q?: string; cnae?: string; uf?: string; porte?: string }): RecommendFilters {
  const cnae = (q.cnae ?? '').split(/[,\s]+/).map((x) => parseInt(x, 10)).filter(Number.isFinite);
  const uf = (q.uf ?? '').split(/[,\s]+/).map((x) => x.trim().toUpperCase()).filter((x) => x.length === 2);
  const texto = (q.q ?? '').trim();
  return {
    // <3 chars: o GIN trgm não indexa o padrão -> ILIKE '%x%' vira seq scan
    // na base inteira a cada tecla. Ignora até o termo ficar utilizável.
    q: texto.length >= 3 ? texto : undefined,
    cnae: cnae.length ? cnae : undefined,
    uf: uf.length ? uf : undefined,
    porte: q.porte && PORTES.has(q.porte) ? q.porte : undefined,
  };
}

export function recommendRoutes(app: FastifyInstance): void {
  app.get('/api/recommend', {
    preHandler: requireAuth,
    schema: {
      querystring: {
        type: 'object',
        properties: {
          limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
          offset: { type: 'integer', minimum: 0, default: 0 },
          q: { type: 'string' },
          cnae: { type: 'string' },
          uf: { type: 'string' },
          porte: { type: 'string' },
        },
      },
    },
  }, async (req, reply) => {
    const orgId = req.auth!.orgId;
    const query = req.query as { limit?: number; offset?: number; q?: string; cnae?: string; uf?: string; porte?: string };
    const { limit = 20, offset = 0 } = query;
    const filters = parseFilters(query);

    const profile = await one<RecommendProfile>(
      `SELECT cnaes_alvo, territorio_municipios, territorio_raio_km, pesos
       FROM target_profiles WHERE org_id = $1`,
      [orgId],
    );
    if (!profile) return reply.code(400).send({ error: 'perfil-alvo não configurado' });
    if ((!profile.territorio_municipios || profile.territorio_municipios.length === 0)) {
      return reply.code(400).send({ error: 'defina o território (municípios) no perfil-alvo' });
    }

    const tiers = await cnaeTiers(profile.cnaes_alvo ?? []);
    const { text, params } = buildRecommendQuery({ orgId, profile, limit, offset, filters, ...tiers });

    // Run in a tx on a single connection so SET LOCAL work_mem applies to the recommendation sort.
    const result = await withClient(async (client) => {
      await client.query('BEGIN');
      await client.query(`SET LOCAL work_mem = '${config.recommendWorkMem}'`);
      const r = await client.query(text, params);
      await client.query('COMMIT');
      return r.rows;
    });

    return { results: result, page: { limit, offset, count: result.length } };
  });
}
