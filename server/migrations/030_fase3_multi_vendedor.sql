-- 030 Fase 3 — multi-vendedor: carteira, perfil por vendedor e metas.
--
-- 1) routes/vehicles ganham owner_user_id: rota e veículo passam a ser do
--    vendedor (NULL = recurso compartilhado da org, preserva dados antigos).
-- 2) target_profiles vira 1 linha por (org, vendedor): user_id NULL é o perfil
--    padrão da org (fallback do recommend). A PK antiga era org_id — troca por
--    id sintético + UNIQUE NULLS NOT DISTINCT (org_id, user_id), que também
--    impede duas linhas "padrão" para a mesma org (PG15+).
-- 3) goals: meta mensal de venda por vendedor, opcionalmente por representada.

ALTER TABLE routes
  ADD COLUMN IF NOT EXISTS owner_user_id bigint REFERENCES users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS routes_org_owner_idx ON routes (org_id, owner_user_id);

ALTER TABLE vehicles
  ADD COLUMN IF NOT EXISTS owner_user_id bigint REFERENCES users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS vehicles_org_owner_idx ON vehicles (org_id, owner_user_id);

ALTER TABLE target_profiles
  ADD COLUMN IF NOT EXISTS user_id bigint REFERENCES users(id) ON DELETE CASCADE;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'target_profiles'::regclass AND conname = 'target_profiles_pkey'
      AND pg_get_constraintdef(oid) LIKE '%(org_id)%'
  ) THEN
    ALTER TABLE target_profiles DROP CONSTRAINT target_profiles_pkey;
    ALTER TABLE target_profiles ADD COLUMN id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY;
    ALTER TABLE target_profiles
      ADD CONSTRAINT target_profiles_org_user_uq UNIQUE NULLS NOT DISTINCT (org_id, user_id);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS goals (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id          bigint NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id         bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  represented_id  bigint REFERENCES represented_companies(id) ON DELETE CASCADE,
  competencia     date NOT NULL,                -- sempre dia 1 do mês
  valor_meta      numeric(14,2) NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT goals_uq UNIQUE NULLS NOT DISTINCT (org_id, user_id, represented_id, competencia)
);

CREATE INDEX IF NOT EXISTS goals_org_comp_idx ON goals (org_id, competencia);
