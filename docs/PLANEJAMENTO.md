# Planejamento de Implementação — ERP de Representação Comercial

> Roadmap para evoluir o sistema de CRM de prospecção para ERP completo de escritório
> de representação (1–N vendedores, N representadas).
> Estimativas assumem 1 dev em tempo integral. Cada fase termina deployável.

---

## Visão geral das fases

| Fase | Tema | Duração | Depende de |
|------|------|---------|------------|
| 0 | Fundação técnica (auditoria, usuários, testes, backup) | 1–2 sem | — |
| 1 | Pedidos de venda + tabelas de preço | 3–4 sem | 0 |
| 2 | Comissionamento + conciliação | 2–3 sem | 1 |
| 3 | Multi-vendedor (carteira, visibilidade, metas) | 2–3 sem | 0 |
| 4 | Dashboard + relatórios + alertas | 2 sem | 1, 2, 3 |
| 5 | Campo (check-in, rota da agenda, PWA) | 3 sem | 3 |
| 6 | Financeiro avançado + comunicação | 2–3 sem | 2 |

Total: ~16–20 semanas. Fases 3 e 5 podem rodar em paralelo com 1 e 2 se houver segundo dev.

---

## Fase 0 — Fundação técnica (1–2 sem) ✅ CONCLUÍDA

> Implementada em `feature/fase0-fundacao` (jun/2026). Migration: 024_users_admin_audit.sql.

Pré-requisito das demais fases. Sem isso, multi-vendedor e pedidos ficam sem rastreabilidade.

### 0.1 Gestão de usuários (admin cria vendedor)
- **Migration**: `users` ganha `nome`, `ativo boolean`, `must_change_password boolean`.
- **Backend**: `POST /api/users` (admin cria user com senha provisória), `GET /api/users`,
  `PATCH /api/users/:id` (ativar/desativar, trocar role). Fluxo de troca obrigatória de senha
  no primeiro login. Sem SMTP nesta fase — convite por e-mail fica para Fase 6.
- **Middleware** `requireRole('admin')` em rotas administrativas.
- **Frontend**: página `Equipe` (lista, criar, desativar) visível só para admin.

### 0.2 Auditoria
- **Migration**: `audit_log (id, org_id, user_id, entity text, entity_id, action text, diff jsonb, created_at)`.
  Índice `(org_id, entity, entity_id)`.
- **Backend**: helper `audit(req, entity, id, action, diff)` chamado em todo PATCH/DELETE de
  `relationships`, `finance`, `orders` (futuro), `users`. Não auditar GET.
- **Frontend**: aba "Histórico" no modal da empresa/pedido (read-only).

### 0.3 Testes mínimos
- Vitest + `fastify.inject()` (sem servidor real). Banco de teste via docker-compose.
- Cobrir fluxos: register/login, isolamento de tenant (org A não lê dados da org B),
  recommend (smoke), CRUD relationships. Novas fases exigem teste dos endpoints novos.

### 0.4 Backup automatizado
- Serviço no `docker-compose.prod.yml`: container cron com `pg_dump` diário, retenção 14 dias,
  destino volume + (opcional) rclone para storage externo.

**Critério de aceite**: admin cadastra segundo vendedor pela UI; toda alteração de funil gera
linha em `audit_log`; `npm test` verde; backup gera arquivo diário.

---

## Fase 1 — Pedidos de venda + tabelas de preço (3–4 sem) ✅ CONCLUÍDA

> Implementada em `feature/fase0-fundacao` (jun/2026). Migrations: 026_price_tables.sql,
> 027_orders.sql. Filtros de vendedor/período já existem na API (`owner_user_id`, `from`, `to`);
> a UI expõe status + representada (vendedor entra na Fase 3).

Maior lacuna. Transforma o sistema em ERP.

### 1.1 Modelo de dados
```sql
-- migration 022_price_tables.sql
price_tables (id, org_id, represented_id FK, nome, vigencia_inicio date,
              vigencia_fim date NULL, ativo bool, created_at)
price_table_items (id, price_table_id FK, catalog_item_id FK, preco numeric,
                   desconto_max_pct numeric, UNIQUE(price_table_id, catalog_item_id))

-- migration 023_orders.sql
CREATE TYPE order_status AS ENUM
  ('cotacao','rascunho','enviado','faturado','entregue','cancelado');
orders (id, org_id, numero int,                -- sequencial por org (seq por tenant)
        relationship_id FK NULL, company_id FK,
        represented_id FK, owner_user_id FK, price_table_id FK NULL,
        status order_status, validade date NULL,           -- p/ cotação
        condicao_pagamento text, transportadora text, frete numeric,
        observacoes text, total numeric,
        nf_numero text NULL, emitido_em, faturado_em, created_at, updated_at,
        UNIQUE(org_id, numero))
order_items (id, order_id FK, catalog_item_id FK, descricao_snapshot text,
             qtd numeric, preco_unit numeric, desconto_pct numeric,
             ipi_pct numeric, st_pct numeric, total numeric)
```
- Cotação = pedido com `status='cotacao'` + `validade`. Conversão = transição de status.
  Evita duplicar tabelas.
- `order_items` guarda snapshot de descrição/preço (catálogo muda, pedido não).

### 1.2 Backend
- `routes/orders.ts`: CRUD + `POST /api/orders/:id/transition {status}` com máquina de
  estados validada (cotacao→rascunho→enviado→faturado→entregue; cancelado de qualquer um;
  sem voltar de faturado). Total recalculado server-side a partir dos itens.
- `routes/priceTables.ts`: CRUD; ao montar pedido, endpoint
  `GET /api/price-tables/active?represented_id=` retorna tabela vigente.
- Validar `desconto_max_pct` no item (warning ou bloqueio configurável).
- Auditar transições de status.

### 1.3 Frontend
- Página `Pedidos` (`/pedidos`): lista com filtros (status, representada, vendedor, período),
  totalizadores no topo.
- Form de pedido: escolher cliente (busca no funil), representada → carrega tabela de preço
  vigente → adicionar itens com qtd/desconto → total automático.
- Botão "Novo pedido" no card do Kanban (pré-preenche cliente/representada).
- Página `Tabelas de preço` dentro de Catálogo (aba), com vigência.

### 1.4 Importação de faturamento (fechamento do ciclo)
- `POST /api/orders/import` aceitando CSV (colunas mapeáveis: nf, data, cliente CNPJ, valor).
  Faz match com pedidos `enviado` e marca `faturado` + `nf_numero`. XML NF-e fica para fase
  posterior (parser dedicado).

**Critério de aceite**: criar cotação → converter em pedido → enviar → marcar faturado com NF;
total bate com soma dos itens; tabela de preço vigente aplicada automaticamente; vendedor só
edita pedido próprio em rascunho.

---

## Fase 2 — Comissionamento + conciliação (2–3 sem) ✅ CONCLUÍDA

> Implementada em `feature/fase0-fundacao` (jun/2026). Migration: 029_commissions.sql.
> A resolução de regra é POR ITEM do pedido (produto > cliente > vendedor > geral) e o
> lançamento (1 por pedido, UNIQUE(order_id)) guarda snapshot do percentual/split efetivos.
> Frete fica fora da base de comissão. Re-baixa atualiza o mesmo espelho no financeiro.

Coração do negócio de representação. Diferencial competitivo.

### 2.1 Modelo de dados
```sql
-- migration 024_commissions.sql
commission_rules (id, org_id, represented_id FK,
                  catalog_item_id FK NULL, company_id FK NULL, user_id FK NULL,
                  percent numeric, vendedor_split_pct numeric,   -- % da comissão p/ vendedor
                  vigencia_inicio date, vigencia_fim date NULL, ativo bool)
-- precedência na resolução: produto > cliente > vendedor > regra geral da representada

CREATE TYPE commission_status AS ENUM ('prevista','recebida','divergente','cancelada');
commission_entries (id, org_id, order_id FK, user_id FK, represented_id FK,
                    competencia date,                 -- mês de referência
                    valor_previsto numeric, valor_recebido numeric NULL,
                    status commission_status, recebida_em date NULL,
                    observacao text, created_at)
```

### 2.2 Backend
- Ao transitar pedido para `faturado`: resolver regra de comissão (precedência acima),
  criar `commission_entries` (1 por pedido) com `valor_previsto = total × percent`.
- `routes/commissions.ts`:
  - `GET /api/commissions?competencia=&represented_id=&status=` — extrato.
  - `PATCH /api/commissions/:id/settle {valor_recebido, recebida_em}` — marca recebida;
    se `valor_recebido ≠ valor_previsto` (tolerância configurável), status `divergente`.
  - `POST /api/commissions/reconcile` — conciliação em lote: recebe lista (CSV) de
    pagamentos da representada, faz match por pedido/NF, aponta divergências.
- Integração financeiro: ao liquidar comissão, criar `finance_entries`
  (kind=receber, categoria='comissao', represented_id, status=liquidado).
- Split: visão "a pagar ao vendedor" = `valor_recebido × vendedor_split_pct`.

### 2.3 Frontend
- Página `Comissões` (`/comissoes`): visão mensal por representada — previsto vs. recebido,
  divergências em destaque, ação de baixa individual e em lote (import CSV).
- Aba "Regras" : CRUD de `commission_rules` com indicação visual de precedência.
- No pedido: comissão prevista exibida (admin sempre; vendedor vê a própria parte).

**Critério de aceite**: pedido faturado gera comissão prevista correta segundo precedência;
conciliação CSV marca recebidas e aponta divergência; lançamento espelhado no financeiro.

---

## Fase 3 — Multi-vendedor de verdade (2–3 sem)

Depende da Fase 0 (gestão de usuários). Paralelizável com Fases 1–2.

### 3.1 Visibilidade por carteira (RBAC efetivo)
- Regra: `role='rep'` vê apenas registros com `owner_user_id = userId` em
  `relationships`, `activities`, `orders`, `commissions` (parte própria), `routes`.
  `role='admin'` vê tudo + filtro por vendedor.
- Implementação: helper `scopeOwner(req)` que injeta `AND owner_user_id = $X` quando rep.
  Aplicar em todos os SELECTs tenant-scoped. Testes de isolamento por vendedor obrigatórios.
- `routes` e `vehicles` ganham `owner_user_id` (migration) — rota é do vendedor.

### 3.2 Transferência de carteira
- `POST /api/relationships/transfer {from_user_id, to_user_id, ids?[]}` — em lote ou total
  (desligamento de vendedor). Admin only. Auditado.

### 3.3 Território e perfil por vendedor
- **Migration**: `target_profiles` ganha `user_id FK NULL` + `UNIQUE(org_id, user_id)`.
  `user_id NULL` = perfil padrão da org (fallback).
- `/api/recommend` usa perfil do vendedor logado; admin pode simular qualquer vendedor.
- Anti-conflito: recomendação exclui empresas já no funil de QUALQUER vendedor da org
  (comportamento atual já garante via UNIQUE org+company — manter e documentar).

### 3.4 Metas
```sql
-- migration 025_goals.sql
goals (id, org_id, user_id FK, represented_id FK NULL,
       competencia date, valor_meta numeric, UNIQUE(org_id, user_id, represented_id, competencia))
```
- `GET /api/goals/progress?competencia=` — meta vs. realizado (soma de pedidos faturados).
- UI: aba Metas na página Equipe (admin define; vendedor acompanha a própria).

**Critério de aceite**: vendedor logado não enxerga carteira alheia (testado); transferência
em lote funciona; cada vendedor tem território próprio na recomendação; meta vs. realizado
correto no mês.

---

## Fase 4 — Dashboard + relatórios + alertas (2 sem)

Custo baixo, valor percebido alto. Dados já existem após Fases 1–3.

### 4.1 Dashboard home (`/`— Recommend vira `/prospeccao`)
- `GET /api/dashboard` (uma chamada, agregações SQL):
  - Funil por stage (contagem + soma valor_estimado).
  - Vendas do mês (pedidos faturados) vs. meta.
  - Comissões: previstas no mês, recebidas, divergentes.
  - Agenda de hoje (próximos compromissos).
  - **Alertas de inatividade**: clientes sem `data_contato`/activity há N dias (N configurável
    por org), negócios parados no mesmo stage há 30+ dias.
- Vendedor vê os próprios números; admin vê consolidado + ranking.

### 4.2 Relatórios
- `GET /api/reports/sales?group_by=vendedor|representada|mes` — vendas agregadas.
- Curva ABC de clientes (por faturamento 12 meses).
- **Mapa de cobertura**: clientes ativos vs. potencial RFB por município
  (`count(companies ativas no território) × count(clientes)`) — heat layer no Leaflet.
- Motivo de descarte: migration adiciona `motivo_descarte text` em `company_relationships`;
  modal pede motivo ao descartar; relatório de perdas por motivo.

### 4.3 Exportação
- Util genérico de export CSV no frontend (todas as listas: funil, pedidos, comissões,
  financeiro). Server-side só se volume exigir.

**Critério de aceite**: dashboard carrega < 1s; alertas apontam clientes reais sem contato;
export CSV abre no Excel com acentuação correta (BOM UTF-8).





---

## Fase 5 — Campo: check-in, rota da agenda, PWA (3 sem)

### 5.1 Check-in de visita
- **Migration**: `activities` ganha `checkin_lat`, `checkin_lon`, `checkin_at`,
  `relatorio jsonb` (resultado, proximo_passo, texto).
- `POST /api/activities/:id/checkin {lat, lon}` (geolocalização do navegador).
- `POST /api/activities/:id/report {resultado, proximo_passo, texto}` — formulário curto
  pós-visita; atualiza `data_contato` do relationship vinculado (alimenta alerta de
  inatividade da Fase 4).

### 5.2 Rota a partir da agenda
- Botão "Gerar rota do dia" na Agenda: coleta activities do dia com `company_id` →
  chama `/api/routes/optimize` existente → salva com nome "Rota DD/MM".
- Caminho inverso: ao salvar rota, opção "criar compromissos" (1 activity por parada com
  horário estimado pelos `leg_dur_min`).

### 5.3 Rotas recorrentes
- **Migration**: `routes` ganha `template bool`, `recorrencia text NULL`
  (ex.: 'semanal-seg', livre por enquanto). Botão "Reusar rota" gera nova a partir do template
  com re-otimização (empresas podem ter mudado).

### 5.4 PWA
- `vite-plugin-pwa`: manifest + service worker (cache de shell e assets).
- Offline mínimo viável: agenda do dia e rota ativa em cache; check-in e relatório entram em
  fila local (IndexedDB) e sincronizam ao reconectar. **Não** tentar offline do funil/pedidos
  nesta fase (complexidade de conflito não compensa).

**Critério de aceite**: vendedor abre agenda no celular sem rede (dados do dia), faz check-in
offline e o registro sincroniza ao voltar o sinal; rota do dia gerada da agenda em 1 clique.

---

## Fase 6 — Financeiro avançado + comunicação (2–3 sem)

### 6.1 Financeiro
- **Migration**: `finance_entries` ganha `route_id FK NULL`,
  `recorrencia text NULL` + `recorrencia_fim date NULL`, `user_id FK NULL` (despesa de quem).
- Despesa de viagem: ao salvar rota, opção "lançar custo" cria finance_entry
  (kind=pagar, categoria='viagem', valor=custo da rota, route_id, user_id).
- Recorrência: job no boot do servidor (ou cron diário) materializa lançamentos do mês
  a partir das recorrências ativas. Idempotente (UNIQUE org+origem+competencia).
- `GET /api/finance/cashflow?months=3` — fluxo projetado: vencimentos pendentes +
  comissões previstas, por semana.
- `GET /api/finance/dre?ano=` — DRE simplificado mensal: comissões recebidas − despesas
  por categoria.

### 6.2 Comunicação
- **WhatsApp click-to-chat**: link `wa.me/<telefone>` em contatos, cards do funil e paradas
  da rota (telefone já existe em `companies`/`contacts`). API oficial fica fora de escopo.
- **PDF de pedido/cotação**: geração server-side (ex. `pdfkit`) — papel timbrado da org,
  itens, condições; endpoint `GET /api/orders/:id/pdf`. Compartilhar via WhatsApp/e-mail
  manual do usuário.
- **Notificações in-app**: tabela `notifications (org_id, user_id, tipo, titulo, payload jsonb,
  lida bool, created_at)`. Geradas por: vencimento de conta (D-1), compromisso em 1h
  (computado no fetch, sem websocket nesta fase), comissão divergente, negócio parado.
  Sino no header com badge. E-mail/push ficam para fase posterior (exige SMTP/FCM).

**Critério de aceite**: PDF de cotação sai pronto para enviar; despesa de rota lançada em
1 clique; fluxo de caixa projetado confere com pendências + comissões; sino mostra
notificações relevantes.

---

## Backlog pós-roadmap (sem fase definida)

- RLS Postgres como segunda camada de isolamento (org_id + owner) — fazer quando houver
  mais de ~5 orgs pagantes.
- Convite de usuário por e-mail + reset de senha (exige SMTP).
- Importação XML NF-e completa.
- API pública/webhooks para representadas.
- WhatsApp Business API oficial.
- App nativo / push notifications.
- LGPD: exportação e anonimização de dados de contatos.
- Detecção de oportunidade cruzada entre representadas (cliente da A com fit na B).

---

## Convenções para todas as fases

1. **Migrations**: numeração sequencial contínua (próxima livre: 030), idempotentes,
   rodadas pelo runner existente (`scripts/migrate.ts`).
2. **Tenant**: toda tabela nova tem `org_id` + índice `(org_id, ...)`; toda query filtra org.
3. **Ownership**: toda entidade operacional nova tem `owner_user_id`/`user_id`.
4. **Auditoria**: todo PATCH/DELETE de entidade de negócio chama `audit()`.
5. **Testes**: endpoint novo = teste de fluxo + teste de isolamento (org e vendedor).
6. **Sem dependência nova sem justificativa** — manter filosofia do stack enxuto.
7. **Branchs**: `feature/<fase>-<tema>`; merge em `main` ao fim de cada item aceito.


Correções
Ajustar as contas que nao estão salvando a data de vencimento
Permitir editar vendedor, campo nome,pode ser direto na tabela da tela equipe
Todos os campos de envolvem cadastro de empresa, devem usar a base de cadastro de empresa para automatizar o cadastro, de transportadoras e etc