-- 046 Agenda — vínculo opcional com representada e contato.
--
-- O compromisso passa a referenciar a empresa representada e o contato
-- (cadastros), além da empresa do funil já existente. ON DELETE SET NULL:
-- apagar a representada/contato não apaga o compromisso, só zera o vínculo.

ALTER TABLE activities
  ADD COLUMN IF NOT EXISTS represented_id bigint REFERENCES represented_companies(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS contact_id     bigint REFERENCES contacts(id) ON DELETE SET NULL;
