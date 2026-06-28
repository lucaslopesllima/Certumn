// Builds the single recommendation SQL (no N+1). Território por município:
//  c.municipio_id = ANY(territorio) -> partial btree companies_municipio_ativa_idx
// CNAE fit tiers (classe=1.0 / divisao=0.6 / secao=0.3) come from arrays computed app-side
// (divisoesAlvo/secoesAlvo/pruneDivisoes). Eram CTEs, mas CTE vira "hashed SubPlan" no
// planner e a poda por divisão só rodava DEPOIS do fetch do heap (centenas de milhares de
// páginas por busca). Como = ANY($array) o planner combina os índices (BitmapAnd geom/divisão).

export interface RecommendProfile {
  cnaes_alvo: number[];
  territorio_municipios: number[];
  pesos: { cnae?: number; proximidade?: number; porte?: number };
  // Endereço de partida (origem das rotas) definido nos filtros. Quando presente,
  // a proximidade é medida a partir daqui em vez do centroide do território.
  partida?: { lat: number; lon: number } | null;
}

export interface RecommendFilters {
  q?: string;            // texto: razão / fantasia / cnpj
  uf?: string[];         // UFs
  porte?: string;        // porte_emp
}

export interface RecommendArgs {
  orgId: number;
  profile: RecommendProfile;
  limit: number;
  offset: number;
  filters?: RecommendFilters;
  // derivados de cnaes_alvo + cnae_divisao_secao (calculados na rota, cacheados):
  divisoesAlvo: number[];   // divisões dos CNAEs alvo (fit 0.6)
  secoesAlvo: string[];     // seções dessas divisões (fit 0.3)
  pruneDivisoes: number[];  // todas as divisões dessas seções (poda de candidatos)
}

const DEFAULT_NORM_M = 150_000; // proximity normalization in municipio mode (~150km)
const CAPITAL_REF = 1_000_000;  // capital_social normalization reference

export function buildRecommendQuery(args: RecommendArgs): { text: string; params: unknown[] } {
  const { orgId, profile, limit, offset } = args;
  const cnaes = profile.cnaes_alvo ?? [];
  const municipios = profile.territorio_municipios ?? [];
  const normMeters = DEFAULT_NORM_M;

  const wCnae = profile.pesos?.cnae ?? 0.5;
  const wProx = profile.pesos?.proximidade ?? 0.3;
  const wPorte = profile.pesos?.porte ?? 0.2;

  // $1 cnaes, $2 municipios, $3 orgId, $4 normMeters, $5 wCnae, $6 wProx, $7 wPorte,
  // $8 capitalRef, $9 limit, $10 offset, $11 divisoesAlvo, $12 secoesAlvo,
  // $13 partidaLat, $14 partidaLon, $15+ poda/filtros (param sem referência dá 42P18)
  const partida = profile.partida ?? null;
  const params: unknown[] = [
    cnaes, municipios, orgId, normMeters, wCnae, wProx, wPorte, CAPITAL_REF, limit, offset,
    args.divisoesAlvo, args.secoesAlvo, partida ? partida.lat : null, partida ? partida.lon : null,
  ];

  const territoryPredicate = `c.municipio_id = ANY($2::int[])`;

  // Filtros server-side: viram WHERE sobre TODA a base (dentro do território/alvo),
  // não só a página carregada.
  const f = args.filters ?? {};
  let p = params.length; // último índice usado (=14)
  const extra: string[] = [];

  // Candidatos podados pelas divisões das seções-alvo (sem CNAE-alvo, varre o território todo).
  params.push(args.pruneDivisoes);
  const cnaePredicate = `(cardinality($1::int[]) = 0 OR c.cnae_divisao = ANY($${++p}::smallint[]))`;
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
WITH centro AS (
  SELECT ST_Centroid(ST_Collect(geom::geometry))::geography AS g
  FROM municipios WHERE id = ANY($2::int[])
),
origem AS (
  -- referência da proximidade: endereço de partida (se informado) ou centroide do território
  SELECT CASE WHEN $13::float8 IS NOT NULL
              THEN ST_SetSRID(ST_MakePoint($14::float8, $13::float8), 4326)::geography
              ELSE (SELECT g FROM centro) END AS g
),
cand AS (
  SELECT
    c.id, c.cnpj, c.razao_social, c.nome_fantasia, c.cnae_principal, c.cnae_divisao,
    c.municipio_id, c.uf, c.porte, c.capital_social,
    -- ponto da empresa: cache de geocode (rua/cep — mesma fonte do "Ver no mapa")
    -- -> geom da empresa -> centroide do município. Sempre traz distância/ponto.
    ST_Y(pt.g::geometry) AS lat, ST_X(pt.g::geometry) AS lon,
    ST_Distance(pt.g, origem.g, false) AS dist_m,
    cds.secao AS secao,
    CASE
      WHEN cardinality($1::int[]) = 0 THEN 0::numeric
      WHEN c.cnae_principal = ANY($1::int[]) THEN 1.0
      WHEN c.cnae_divisao = ANY($11::smallint[]) THEN 0.6
      WHEN cds.secao = ANY($12::text[]) THEN 0.3
      ELSE 0::numeric
    END AS fit,
    (0.5 * (CASE c.porte WHEN 'demais' THEN 1.0 WHEN 'pequeno' THEN 0.7 WHEN 'micro' THEN 0.4 ELSE 0.2 END)
     + 0.5 * LEAST(ln(1 + c.capital_social) / ln(1 + $8::numeric), 1)) AS porte_s
  FROM companies c
  CROSS JOIN centro
  CROSS JOIN origem
  LEFT JOIN municipios mun ON mun.id = c.municipio_id
  LEFT JOIN company_geocode gc ON gc.company_id = c.id AND gc.precisao <> 'municipio'
  LEFT JOIN LATERAL (
    SELECT COALESCE(
      CASE WHEN gc.lat IS NOT NULL THEN ST_SetSRID(ST_MakePoint(gc.lon, gc.lat), 4326)::geography END,
      c.geom, mun.geom
    ) AS g
  ) pt ON true
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
