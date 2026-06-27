-- 033 Fase 6 — financeiro avançado + comunicação.
--
-- 1) finance_entries ganha:
--    - route_id: despesa de viagem lançada a partir de uma rota (Fase 5).
--    - recorrencia / recorrencia_fim: lançamento-modelo mensal. O próprio
--      registro é o lançamento do mês de origem; o materializador gera 1 filho
--      por mês decorrido (recurrence.ts).
--    - recorrencia_origem_id: filho aponta para o modelo. Índice único
--      (origem, mês do vencimento) torna a materialização idempotente.
--    "user_id (despesa de quem)" do roadmap já é coberto por owner_user_id.
-- 2) notifications: avisos in-app, materializados no fetch (sem websocket). A
--    `chave` é determinística (tipo:entidade) e única por usuário — o GET faz
--    upsert preservando `lida`, então marcar como lido persiste entre fetches.

ALTER TABLE finance_entries
  ADD COLUMN IF NOT EXISTS route_id               bigint REFERENCES routes(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS recorrencia            text,
  ADD COLUMN IF NOT EXISTS recorrencia_fim        date,
  ADD COLUMN IF NOT EXISTS recorrencia_origem_id  bigint REFERENCES finance_entries(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS recorrencia_competencia date;   -- mês de referência do filho (1º dia)

-- Idempotência do materializador: no máximo 1 filho por modelo por mês. Coluna
-- (não expressão) para evitar a exigência de IMMUTABLE no índice.
CREATE UNIQUE INDEX IF NOT EXISTS finance_recorrencia_uniq
  ON finance_entries (recorrencia_origem_id, recorrencia_competencia)
  WHERE recorrencia_origem_id IS NOT NULL;

-- Varredura de modelos ativos pelo materializador.
CREATE INDEX IF NOT EXISTS finance_recorrencia_modelo_idx
  ON finance_entries (org_id)
  WHERE recorrencia IS NOT NULL AND recorrencia_origem_id IS NULL;

CREATE TABLE IF NOT EXISTS notifications (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id      bigint NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id     bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tipo        text NOT NULL,            -- vencimento | agenda | comissao | parado
  chave       text NOT NULL,            -- determinística: tipo:entity_id
  titulo      text NOT NULL,
  payload     jsonb NOT NULL DEFAULT '{}',
  lida        boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, chave)
);

CREATE INDEX IF NOT EXISTS notifications_user_idx ON notifications (org_id, user_id, lida);
