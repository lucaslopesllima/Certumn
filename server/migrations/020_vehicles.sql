-- 020 cadastro de veículos do representante (org-scoped).
-- Usado pelo planejador de rota para estimar consumo/custo de combustível:
--   litros = distância_km / consumo_kml ; custo = litros * preço_litro.
-- combustivel: gasolina|etanol|diesel|flex (flex escolhe o preço na hora do cálculo).
CREATE TABLE IF NOT EXISTS vehicles (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id        bigint NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  nome          text NOT NULL,                       -- "Fiat Strada 2022"
  placa         text,
  combustivel   text NOT NULL DEFAULT 'gasolina',
  consumo_kml   numeric(5,2) NOT NULL,               -- km por litro (ex.: 12.50)
  tanque_litros numeric(6,2),                        -- opcional, p/ alerta de autonomia
  preco_litro   numeric(6,3),                        -- preço padrão do litro (override no cálculo)
  ativo         boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS vehicles_org_idx ON vehicles (org_id) WHERE ativo;
