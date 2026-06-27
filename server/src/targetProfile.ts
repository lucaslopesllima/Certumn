import { one } from './db.ts';

// Perfil-alvo efetivo (Fase 3): cada vendedor pode ter território/CNAEs
// próprios (linha user_id = vendedor). Sem linha própria, cai no perfil padrão
// da org (user_id NULL), criado no register. A resolução é "own > fallback":
// ordena user_id NULL por último e pega o primeiro.
export interface ResolvedProfile {
  org_id: number;
  user_id: number | null;
  cnaes_alvo: number[];
  territorio_municipios: number[];
  territorio_raio_km: number | null;
  pesos: Record<string, number>;
  origem_endereco: string | null;
  origem_lat: number | null;
  origem_lon: number | null;
}

const COLS = `org_id, user_id, cnaes_alvo, territorio_municipios, territorio_raio_km, pesos,
  origem_endereco, origem_lat, origem_lon`;

// Perfil efetivo de um vendedor (own > org default). userId NULL resolve direto
// o perfil padrão da org.
export function resolveProfile(orgId: number, userId: number | null): Promise<ResolvedProfile | null> {
  if (userId === null) {
    return one<ResolvedProfile>(
      `SELECT ${COLS} FROM target_profiles WHERE org_id = $1 AND user_id IS NULL`, [orgId],
    );
  }
  return one<ResolvedProfile>(
    `SELECT ${COLS} FROM target_profiles
     WHERE org_id = $1 AND (user_id = $2 OR user_id IS NULL)
     ORDER BY (user_id IS NULL)
     LIMIT 1`,
    [orgId, userId],
  );
}

// Linha exata de um escopo (sem fallback) — para a tela de edição saber se o
// vendedor já tem perfil próprio ou está herdando o da org.
export function exactProfile(orgId: number, userId: number | null): Promise<ResolvedProfile | null> {
  return one<ResolvedProfile>(
    `SELECT ${COLS} FROM target_profiles
     WHERE org_id = $1 AND user_id IS NOT DISTINCT FROM $2`,
    [orgId, userId],
  );
}
