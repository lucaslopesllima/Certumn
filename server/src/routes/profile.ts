import type { FastifyInstance, FastifyRequest } from 'fastify';
import { one, query } from '../db.ts';
import { requireAuth } from '../auth.ts';
import { invalidOrgRef } from '../orgRefs.ts';
import { resolveProfile, exactProfile } from '../targetProfile.ts';

// Escopo do perfil-alvo alvo da requisição (Fase 3):
// - rep: sempre o próprio (ignora user_id do payload/query).
// - admin: user_id explícito (vendedor) ou null = perfil padrão da org.
// Retorna `undefined` em targetUser quando o admin não especifica (= org).
function profileScope(req: FastifyRequest, given: { user_id?: number | null }): number | null {
  if (req.auth!.role !== 'admin') return req.auth!.userId;
  return 'user_id' in given && given.user_id != null ? Number(given.user_id) : null;
}

export function profileRoutes(app: FastifyInstance): void {
  app.get('/api/profile', {
    preHandler: requireAuth,
    schema: { querystring: { type: 'object', properties: { user_id: { type: 'integer' } } } },
  }, async (req) => {
    const orgId = req.auth!.orgId;
    const q = req.query as { user_id?: number };
    const scope = profileScope(req, q);
    // efetivo (com fallback) p/ exibir; `own` indica se há linha própria do escopo.
    const profile = await resolveProfile(orgId, scope);
    const own = scope === null ? true : (await exactProfile(orgId, scope)) !== null;
    return { profile, scope_user_id: scope, own };
  });

  app.put('/api/profile', {
    preHandler: requireAuth,
    schema: {
      body: {
        type: 'object',
        properties: {
          user_id: { type: ['integer', 'null'] }, // admin: escopo do perfil (null = org)
          cnaes_alvo: { type: 'array', items: { type: 'integer' } },
          territorio_municipios: { type: 'array', items: { type: 'integer' } },
          territorio_raio_km: { type: ['integer', 'null'] },
          pesos: { type: 'object' },
          origem_endereco: { type: ['string', 'null'] },
          origem_lat: { type: ['number', 'null'] },
          origem_lon: { type: ['number', 'null'] },
        },
      },
    },
  }, async (req, reply) => {
    const orgId = req.auth!.orgId;
    const b = req.body as {
      user_id?: number | null;
      cnaes_alvo?: number[];
      territorio_municipios?: number[];
      territorio_raio_km?: number | null;
      pesos?: Record<string, number>;
      origem_endereco?: string | null;
      origem_lat?: number | null;
      origem_lon?: number | null;
    };
    const scope = profileScope(req, b);
    if (scope !== null) {
      const bad = await invalidOrgRef(orgId, { user_id: scope }, ['user_id']);
      if (bad) return reply.code(400).send({ error: 'user_id inválido' });
    }
    const hasOrigem = 'origem_endereco' in b || 'origem_lat' in b || 'origem_lon' in b;
    const rows = await query(
      `INSERT INTO target_profiles (org_id, user_id, cnaes_alvo, territorio_municipios, territorio_raio_km, pesos,
                                    origem_endereco, origem_lat, origem_lon)
       VALUES ($1, $10, COALESCE($2::int[],'{}'::int[]), COALESCE($3::int[],'{}'::int[]), $4::int,
               COALESCE($5::jsonb,'{"cnae":0.5,"proximidade":0.3,"porte":0.2}'::jsonb),
               $7::text, $8::double precision, $9::double precision)
       ON CONFLICT (org_id, user_id) DO UPDATE SET
         cnaes_alvo = COALESCE($2::int[], target_profiles.cnaes_alvo),
         territorio_municipios = COALESCE($3::int[], target_profiles.territorio_municipios),
         territorio_raio_km = $4::int,
         pesos = COALESCE($5::jsonb, target_profiles.pesos),
         origem_endereco = CASE WHEN $6 THEN $7::text ELSE target_profiles.origem_endereco END,
         origem_lat = CASE WHEN $6 THEN $8::double precision ELSE target_profiles.origem_lat END,
         origem_lon = CASE WHEN $6 THEN $9::double precision ELSE target_profiles.origem_lon END
       RETURNING org_id, user_id, cnaes_alvo, territorio_municipios, territorio_raio_km, pesos,
                 origem_endereco, origem_lat, origem_lon`,
      [orgId, b.cnaes_alvo ?? null, b.territorio_municipios ?? null, b.territorio_raio_km ?? null,
        b.pesos ? JSON.stringify(b.pesos) : null,
        hasOrigem, b.origem_endereco ?? null, b.origem_lat ?? null, b.origem_lon ?? null, scope],
    );
    return { profile: rows[0] };
  });

  // municipios available for territory selection (global read).
  app.get('/api/municipios', { preHandler: requireAuth }, async () => {
    const rows = await query(
      `SELECT id, nome, uf, regiao FROM municipios ORDER BY uf, nome`,
    );
    return { municipios: rows };
  });

  // Free-text municipio search (accent-insensitive) — typeahead for territory selection.
  app.get('/api/municipios/search', {
    preHandler: requireAuth,
    schema: {
      querystring: {
        type: 'object',
        required: ['q'],
        properties: { q: { type: 'string', minLength: 1 } },
      },
    },
  }, async (req) => {
    const { q } = req.query as { q: string };
    const term = q.trim().toLowerCase();
    const rows = await query(
      `SELECT id, nome, uf, regiao FROM municipios
       WHERE unaccent(lower(nome)) LIKE '%' || unaccent($1) || '%'
       ORDER BY (unaccent(lower(nome)) LIKE unaccent($1) || '%') DESC, nome
       LIMIT 30`,
      [term],
    );
    return { municipios: rows };
  });

  // Resolve labels for already-selected municipio ids (profile UI chips).
  app.get('/api/municipios/labels', {
    preHandler: requireAuth,
    schema: {
      querystring: {
        type: 'object',
        required: ['ids'],
        properties: { ids: { type: 'string' } }, // comma-separated
      },
    },
  }, async (req) => {
    const { ids } = req.query as { ids: string };
    const parsed = ids.split(',').map((s) => parseInt(s, 10)).filter(Number.isFinite);
    if (parsed.length === 0) return { municipios: [] };
    const rows = await query(
      `SELECT id, nome, uf, regiao FROM municipios WHERE id = ANY($1::int[]) ORDER BY nome`,
      [parsed],
    );
    return { municipios: rows };
  });

  // UF list with municipio counts — for "select whole state" in territory UI.
  app.get('/api/municipios/ufs', { preHandler: requireAuth }, async () => {
    const rows = await query<{ uf: string; regiao: string; total: number }>(
      `SELECT uf, min(regiao) AS regiao, count(*)::int AS total FROM municipios GROUP BY uf ORDER BY uf`,
    );
    return { ufs: rows };
  });

  // All municipios of one UF — expands a state selection into ids/chips.
  app.get('/api/municipios/by-uf', {
    preHandler: requireAuth,
    schema: {
      querystring: {
        type: 'object',
        required: ['uf'],
        properties: { uf: { type: 'string', minLength: 2, maxLength: 2 } },
      },
    },
  }, async (req) => {
    const { uf } = req.query as { uf: string };
    const rows = await query(
      `SELECT id, nome, uf, regiao FROM municipios WHERE uf = upper($1) ORDER BY nome`,
      [uf],
    );
    return { municipios: rows };
  });
}
