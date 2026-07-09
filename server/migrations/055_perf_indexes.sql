-- 055 Índices de performance para listagens tenant-scoped (auditoria 2026-07).
-- Cobrem ORDER BY/filtros que hoje forçam sort ou seq scan conforme o volume
-- por org cresce. A base global companies já está coberta (005/018/022/023).

-- Listagem padrão do audit log: WHERE org_id ORDER BY created_at DESC, id DESC.
-- O índice existente (org_id, entity, entity_id, created_at) não serve a ordenação
-- quando entity não é filtrado.
CREATE INDEX IF NOT EXISTS audit_org_created_idx
  ON audit_log (org_id, created_at DESC, id DESC);

-- Funil/kanban e lista de relacionamentos: ORDER BY updated_at DESC.
CREATE INDEX IF NOT EXISTS rel_org_updated_idx
  ON company_relationships (org_id, updated_at DESC);

-- Escopo por vendedor (fase 3): listas filtram org_id + owner_user_id.
CREATE INDEX IF NOT EXISTS orders_org_owner_idx
  ON orders (org_id, owner_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS finance_entries_org_owner_idx
  ON finance_entries (org_id, owner_user_id, vencimento);

CREATE INDEX IF NOT EXISTS activities_org_owner_start_idx
  ON activities (org_id, owner_user_id, start_at);

-- FK sem índice: DELETE em catalog_items faz seq scan em order_items
-- (ON DELETE SET NULL). order_items é a maior tabela filha.
CREATE INDEX IF NOT EXISTS order_items_catalog_idx
  ON order_items (catalog_item_id);
