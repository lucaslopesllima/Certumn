-- 028 Cadastro de transportadoras (org-scoped) + vínculo no pedido.
-- orders.transportadora (texto livre) permanece para dados antigos; pedidos
-- novos referenciam carrier_id. Exclusão é soft (ativo=false) — pedido emitido
-- não pode perder o rótulo da transportadora.

CREATE TABLE IF NOT EXISTS carriers (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id      bigint NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  nome        text NOT NULL,
  cnpj        text,
  telefone    text,
  email       text,
  contato     text,                    -- pessoa de contato
  observacoes text,
  ativo       boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS carriers_org_idx ON carriers (org_id, ativo, nome);

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS carrier_id bigint REFERENCES carriers(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS orders_carrier_idx ON orders (carrier_id);
