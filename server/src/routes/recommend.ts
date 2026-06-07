import type { FastifyInstance } from 'fastify';
import { one, withClient } from '../db.ts';
import { requireAuth } from '../auth.ts';
import { config } from '../config.ts';
import { buildRecommendQuery, type RecommendProfile, type RecommendFilters } from '../sql/recommend.ts';

const PORTES = new Set(['nao_informado', 'micro', 'pequeno', 'demais']);

function parseFilters(q: { q?: string; cnae?: string; uf?: string; porte?: string }): RecommendFilters {
  const cnae = (q.cnae ?? '').split(/[,\s]+/).map((x) => parseInt(x, 10)).filter(Number.isFinite);
  const uf = (q.uf ?? '').split(/[,\s]+/).map((x) => x.trim().toUpperCase()).filter((x) => x.length === 2);
  const texto = (q.q ?? '').trim();
  return {
    q: texto || undefined,
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
    // Regra anti-sobrecarga: 0 filtros (recomendação) ou >=2; exatamente 1 é barrado.
    const nAtivos = [filters.q, filters.cnae, filters.uf, filters.porte].filter(Boolean).length;
    if (nAtivos === 1) {
      return reply.code(400).send({ error: 'Aplique ao menos 2 filtros para buscar na base (evita varredura pesada).' });
    }

    const profile = await one<RecommendProfile>(
      `SELECT cnaes_alvo, territorio_municipios, territorio_raio_km, pesos
       FROM target_profiles WHERE org_id = $1`,
      [orgId],
    );
    if (!profile) return reply.code(400).send({ error: 'perfil-alvo não configurado' });
    if ((!profile.territorio_municipios || profile.territorio_municipios.length === 0)) {
      return reply.code(400).send({ error: 'defina o território (municípios) no perfil-alvo' });
    }

    const { text, params } = buildRecommendQuery({ orgId, profile, limit, offset, filters });

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
