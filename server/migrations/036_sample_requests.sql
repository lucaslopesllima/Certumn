-- 036 — solicitações de amostra (sample requests). Vive SÓ dentro do funil
-- (relationship_id NOT NULL): é uma ação de prospecção, não um pedido. Relaciona
-- um produto do catálogo; opcionalmente vincula um contato (quem recebe) e um
-- compromisso na agenda (follow-up gerado na criação). produto_snapshot guarda o
-- nome do item na hora — catálogo pode mudar/sumir, a amostra registra o que foi.

DO $$ BEGIN
  CREATE TYPE sample_status AS ENUM ('solicitada','enviada','recebida','cancelada');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS sample_requests (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id           bigint NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  relationship_id  bigint NOT NULL REFERENCES company_relationships(id) ON DELETE CASCADE,
  catalog_item_id  bigint REFERENCES catalog_items(id) ON DELETE SET NULL,
  produto_snapshot text NOT NULL,
  contact_id       bigint REFERENCES contacts(id) ON DELETE SET NULL,
  activity_id      bigint REFERENCES activities(id) ON DELETE SET NULL,
  owner_user_id    bigint REFERENCES users(id) ON DELETE SET NULL,
  status           sample_status NOT NULL DEFAULT 'solicitada',
  quantidade       numeric(16,3),
  data_solicitacao date NOT NULL DEFAULT current_date,
  data_prevista    date,
  notas            text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sample_requests_rel_idx        ON sample_requests (relationship_id);
CREATE INDEX IF NOT EXISTS sample_requests_org_status_idx ON sample_requests (org_id, status);
