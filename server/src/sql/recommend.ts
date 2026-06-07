// Builds the single recommendation SQL (no N+1). Two territory modes:
//  - municipio: c.municipio_id = ANY(territorio)        -> partial btree companies_municipio_ativa_idx
//  - radius:    ST_DWithin(geom, centroide, raio)        -> partial GIST companies_geom_ativa_idx
// CNAE fit tiers (classe=1.0 / divisao=0.6 / secao=0.3) are derived in-SQL from cnaes_alvo.
// Candidate pruning (cnae_divisao IN sections-of-target) keeps the scored set small and index-friendly.

export interface RecommendProfile {
  cnaes_alvo: number[];
  territorio_municipios: number[];
  territorio_raio_km: number | null;
  pesos: { cnae?: number; proximidade?: number; porte?: number };
}

export interface RecommendFilters {
  q?: string;            // texto: razão / fantasia / cnpj
  cnae?: number[];       // cnae_principal exato (varre a base toda p/ esses CNAEs)
  uf?: string[];         // UFs
  porte?: string;        // porte_emp
}

export interface RecommendArgs {
  orgId: number;
  profile: RecommendProfile;
  limit: number;
  offset: number;
  filters?: RecommendFilters;
}

const DEFAULT_NORM_M = 150_000; // proximity normalization in municipio mode (~150km)
const CAPITAL_REF = 1_000_000;  // capital_social normalization reference

export function buildRecommendQuery(args: RecommendArgs): { text: string; params: unknown[] } {
  const { orgId, profile, limit, offset } = args;
  const cnaes = profile.cnaes_alvo ?? [];
  const municipios = profile.territorio_municipios ?? [];
  const radiusMode = !!profile.territorio_raio_km && profile.territorio_raio_km > 0;
  const normMeters = radiusMode ? profile.territorio_raio_km! * 1000 : DEFAULT_NORM_M;

  const wCnae = profile.pesos?.cnae ?? 0.5;
  const wProx = profile.pesos?.proximidade ?? 0.3;
  const wPorte = profile.pesos?.porte ?? 0.2;

  // $1 cnaes, $2 municipios, $3 orgId, $4 normMeters, $5 wCnae, $6 wProx, $7 wPorte,
  // $8 capitalRef, $9 limit, $10 offset, $11+ filtros (server-side, sobre a base toda)
  const params: unknown[] = [
    cnaes, municipios, orgId, normMeters, wCnae, wProx, wPorte, CAPITAL_REF, limit, offset,
  ];

  const territoryPredicate = radiusMode
    ? `ST_DWithin(c.geom, centro.g, $4)`
    : `c.municipio_id = ANY($2::int[])`;

  // Filtros server-side: viram WHERE sobre TODA a base (dentro do território/alvo),
  // não só a página carregada. CNAE explícito dispensa a poda por divisões-alvo.
  const f = args.filters ?? {};
  let p = params.length; // último índice usado (=10)
  const extra: string[] = [];

  let cnaePredicate: string;
  if (f.cnae && f.cnae.length > 0) {
    params.push(f.cnae); cnaePredicate = `c.cnae_principal = ANY($${++p}::int[])`;
  } else {
    cnaePredicate = `(cardinality($1::int[]) = 0 OR c.cnae_divisao IN (SELECT divisao FROM prune))`;
  }
  if (f.uf && f.uf.length > 0) { params.push(f.uf); extra.push(`c.uf = ANY($${++p}::text[])`); }
  if (f.porte) { params.push(f.porte); extra.push(`c.porte = $${++p}::porte_emp`); }
  if (f.q) {
    const digits = f.q.replace(/\D/g, '');
    params.push(`%${f.q}%`); const a = ++p;
    if (digits.length >= 2) {
      params.push(`${digits}%`); const b = ++p;
      extra.push(`(c.razao_social ILIKE $${a} OR c.nome_fantasia ILIKE $${a} OR c.cnpj LIKE $${b})`);
    } else {
      extra.push(`(c.razao_social ILIKE $${a} OR c.nome_fantasia ILIKE $${a})`);
    }
  }
  const extraPredicates = extra.length ? `\n    AND ${extra.join('\n    AND ')}` : '';

  const text = `
WITH divs AS (
  SELECT DISTINCT (x / 100000)::smallint AS divisao FROM unnest($1::int[]) x
),
secs AS (
  SELECT DISTINCT ds.secao FROM divs d JOIN cnae_divisao_secao ds ON ds.divisao = d.divisao
),
prune AS (
  SELECT DISTINCT ds.divisao FROM secs s JOIN cnae_divisao_secao ds ON ds.secao = s.secao
),
centro AS (
  SELECT ST_Centroid(ST_Collect(geom::geometry))::geography AS g
  FROM municipios WHERE id = ANY($2::int[])
),
cand AS (
  SELECT
    c.id, c.cnpj, c.razao_social, c.nome_fantasia, c.cnae_principal, c.cnae_divisao,
    c.municipio_id, c.uf, c.porte, c.capital_social,
    ST_Y(c.geom::geometry) AS lat, ST_X(c.geom::geometry) AS lon,
    ST_Distance(c.geom, centro.g, false) AS dist_m,
    cds.secao AS secao,
    CASE
      WHEN cardinality($1::int[]) = 0 THEN 0::numeric
      WHEN c.cnae_principal = ANY($1::int[]) THEN 1.0
      WHEN c.cnae_divisao IN (SELECT divisao FROM divs) THEN 0.6
      WHEN cds.secao IN (SELECT secao FROM secs) THEN 0.3
      ELSE 0::numeric
    END AS fit,
    (0.5 * (CASE c.porte WHEN 'demais' THEN 1.0 WHEN 'pequeno' THEN 0.7 WHEN 'micro' THEN 0.4 ELSE 0.2 END)
     + 0.5 * LEAST(ln(1 + c.capital_social) / ln(1 + $8::numeric), 1)) AS porte_s
  FROM companies c
  CROSS JOIN centro
  LEFT JOIN cnae_divisao_secao cds ON cds.divisao = c.cnae_divisao
  WHERE c.situacao_cadastral = 'ativa'
    AND ${territoryPredicate}
    AND ${cnaePredicate}
    AND (EXISTS (SELECT 1 FROM enabled_regions er WHERE er.uf = c.uf)
         OR EXISTS (SELECT 1 FROM enabled_regions er WHERE er.regiao = c.regiao))
    AND NOT EXISTS (
      SELECT 1 FROM company_relationships r WHERE r.org_id = $3 AND r.company_id = c.id
    )${extraPredicates}
)
SELECT
  id, cnpj, razao_social, nome_fantasia, cnae_principal, municipio_id, uf, porte,
  capital_social, lat, lon,
  ($5 * fit
   + $6 * (1 - LEAST(dist_m / $4, 1))
   + $7 * porte_s) AS score,
  jsonb_build_object(
    'cnae_match', CASE WHEN fit >= 1.0 THEN 'classe' WHEN fit >= 0.6 THEN 'divisao'
                       WHEN fit >= 0.3 THEN 'secao' ELSE 'nenhum' END,
    'cnae_principal', cnae_principal,
    'distancia_km', round((dist_m / 1000.0)::numeric, 1),
    'porte', porte,
    'capital_social', capital_social,
    'componentes', jsonb_build_object(
      'cnae', round(($5 * fit)::numeric, 3),
      'proximidade', round(($6 * (1 - LEAST(dist_m / $4, 1)))::numeric, 3),
      'porte', round(($7 * porte_s)::numeric, 3)
    )
  ) AS reason
FROM cand
ORDER BY score DESC
LIMIT $9 OFFSET $10
`;

  return { text, params };
}
