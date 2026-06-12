-- 021 planejador de rota: rota salva + paradas ordenadas (TSP via OSRM /trip).
-- A rota é sempre ida-e-volta (roundtrip) à origem (endereço da org), então
-- dist_km/custo_total já cobrem o retorno. As paradas guardam um snapshot de
-- lat/lon (o geocode da empresa pode mudar/expirar; a rota salva fica estável).
-- vehicle_id usa SET NULL: apagar o veículo não destrói o histórico de rotas.
CREATE TABLE IF NOT EXISTS routes (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id       bigint NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  vehicle_id   bigint REFERENCES vehicles(id) ON DELETE SET NULL,
  nome         text NOT NULL,
  origem_lat   double precision NOT NULL,            -- snapshot da origem usada
  origem_lon   double precision NOT NULL,
  dist_km      numeric(8,2),                         -- total (ida+volta), cacheado
  dur_min      numeric(8,2),
  preco_litro  numeric(6,3),                         -- preço usado no cálculo
  litros       numeric(8,2),                         -- combustível estimado
  custo_total  numeric(10,2),
  geometry     jsonb,                                -- polyline OSRM (geojson) p/ render
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS routes_org_idx ON routes (org_id, created_at DESC);

CREATE TABLE IF NOT EXISTS route_stops (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  route_id    bigint NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
  company_id  bigint NOT NULL REFERENCES companies(id),
  seq         smallint NOT NULL,                     -- ordem otimizada (0 = 1ª visita)
  lat         double precision NOT NULL,             -- snapshot do geocode
  lon         double precision NOT NULL,
  leg_dist_km numeric(8,2),                          -- trecho da parada anterior até esta
  leg_dur_min numeric(8,2),
  UNIQUE (route_id, seq)
);

CREATE INDEX IF NOT EXISTS route_stops_route_idx ON route_stops (route_id);
