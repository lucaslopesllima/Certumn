# Roadmap IA — Certumn

Funcionalidades de IA a agregar ao Certumn, inspiradas no **Mercos IA** e adaptadas à
base real do produto (prospecção RFB + geo/CNAE + funil + pedidos + rotas).

> **Contexto do produto:** SaaS de prospecção para representantes comerciais.
> Base Receita Federal, recomendação geo/CNAE, funil de vendas, pedidos, rotas,
> comissões e financeiro. **Hoje: zero integração de IA/LLM.**

> **Stack:** Fastify 5 + PostgreSQL (pg) + React 19 / Vite / Tailwind 4 / React Router 7 +
> Leaflet. Multi-tenant por `org_id`. Auth JWT (jose). Email via Nodemailer.

> **LLM escolhida:** **Qwen (Alibaba DashScope)** — melhor custo. SDK OpenAI-compatible, 1 chave.
> - **`qwen-turbo`** → extração de dados + resumos (texto). ~$0.033/M in · ~$0.13/M out. Mais barato do mercado.
> - **`qwen-vl-plus`** → fallback só p/ PDF escaneado/foto (visão). ~$0.21/M in · ~$0.63/M out.
> - Free tier ~70M tokens/90 dias (endpoint Singapore) p/ testar.
>
> **Decisão de custo (cascata barata→cara) na importação de pedido:**
> 1. PDF com camada de texto → extrai local (`pdf-parse`, grátis) → `qwen-turbo`.
> 2. PDF escaneado → OCR local (Tesseract, grátis) → `qwen-turbo`.
> 3. OCR ruim → fallback `qwen-vl-plus` (visão).
>
> **Saída sempre JSON estruturado** validado antes de gravar no sistema (ver feature #2).
>
> **LGPD:** dado vai p/ servidor na China. No resumo, mandar só números agregados (sem PII).
> Em pedido, evitar enviar sócios/dados pessoais — só linhas de item. Avisar cliente / usar endpoint Singapore.

---

## Referência — Mercos IA (o que eles oferecem)

| Feature Mercos | Descrição |
|---|---|
| Automação de pedidos | Lê texto/áudio/PDF/foto/Excel → gera lista de produtos. Até -90% tempo de emissão. |
| Sugestão de produtos | Cross-sell de itens comprados juntos. Até +40% ticket médio. |
| Análise de clientes | Busca por nome/CNPJ → resumo (ticket médio, ciclo, último pedido, histórico). |
| Assistente WhatsApp | Consulta conversacional da operação, rankings, indicadores em tempo real. |
| Automação operacional | Lembretes, sugestão de política comercial, reposição, tabela de preço/limite. |

Fontes: https://mercos.com/recursos/mercos-ia/ · https://mercos.com/integracao-erp/ · https://blog.mercos.com/ia-b2b/

---

## Pré-requisito: infra de LLM (fazer 1x antes de tudo)

Padrões reais do repo a reusar em todas as features:
- Rotas: `server/src/routes/*.ts`, export `function xRoutes(app: FastifyInstance)`, registrada em `server/src/app.ts`.
- DB: helpers `query<T>`, `one<T>`, `withClient` de `server/src/db.ts`. SQL puro, params `$1` sempre. Sem ORM.
- Auth: `preHandler: requireAuth` → `req.auth!.orgId` / `req.auth!.userId` / `req.auth!.role`.
- Validação: Fastify JSON schema nativo (não Zod).
- Migrations: SQL puro numerado em `server/migrations/NNN_*.sql`, roda via `npm run migrate`.
- Env: central em `server/src/config.ts` + `server/.env.example`.
- Front: client `api` de `client/src/lib/api.ts`; páginas lazy em `client/src/pages/*.tsx`; toast `client/src/lib/toast.tsx`.

**Passos:**
1. `npm i openai` no `server/` (SDK OpenAI-compatible aponta pra DashScope).
2. `server/.env.example`: add
   - `DASHSCOPE_API_KEY=`
   - `LLM_BASE_URL=https://dashscope-intl.aliyuncs.com/compatible-mode/v1` (endpoint Singapore)
   - `LLM_MODEL_TEXT=qwen-turbo` (extração + resumo)
   - `LLM_MODEL_VISION=qwen-vl-plus` (fallback visão PDF escaneado)
3. `server/src/config.ts`: ler essas vars; no boot em produção, warn se chave ausente (feature degrada, não derruba app).
4. Criar `server/src/llm.ts`: client singleton (`new OpenAI({ apiKey, baseURL })`) + helper `llmJSON<T>({ model, system, input, schema })` que usa `response_format: { type: 'json_object' }`, **valida o JSON contra o schema antes de retornar** (rejeita/retry se inválido). Centraliza retry, timeout, e log de custo (tokens).
5. Dependências de extração: `npm i pdf-parse` (texto de PDF) + `tesseract.js` (OCR local, só se for tratar escaneado).
6. Multi-tenant: todo prompt monta contexto só com dado do `orgId` do request. Nunca cruzar org.
7. Custo: cachear resultado em coluna/tabela e invalidar em evento (nova activity, novo pedido). Não chamar LLM por render.

> IDs `bigint` do pg vêm como **string** (ver memória `pg-bigint-ids-as-strings`) — coage com `Number()` ao casar id↔catálogo/empresa.

---

## Prioridade de implementação

Ordem por **razão valor/esforço** — começa pelo que reusa dado existente.

### 1. Resumo inteligente de cliente/prospect ⭐ (começar aqui)

**Por quê primeiro:** menor superfície, usa só dados que já existem, prova valor da IA rápido.

- **Dados:** `companies` (RFB, CNAE, sócios), `company_relationships`, `activities`, `orders` (histórico).
- **Modelo:** `qwen-turbo` (texto). Input só números agregados → custo ínfimo.
- **Fluxo:** SQL agrega (ticket médio, ciclo de compra, último pedido, frequência) → `qwen-turbo` redige resumo + "por que abordar agora".
- **UI:** tela Cliente / Buscar Empresas — card de resumo.
- **Custo:** baixo. SQL já faz agregação; LLM só redige texto curto.
- **Risco:** baixo. Read-only, não muda máquina de estado.

**Como implementar:**
1. **Migration** `NNN_company_ai_summary.sql`: tabela `company_ai_summaries (id, org_id, company_id, summary text, signals jsonb, model, generated_at, UNIQUE(org_id, company_id))`. Cache.
2. **Agregação SQL** (sem LLM ainda): em `server/src/sql/`, query que junta `orders` (count, avg valor, max data → ticket médio, último pedido, intervalo médio = ciclo), `activities` (última interação) e `companies` (CNAE, porte, sócios) por `company_id` + `org_id`.
3. **Rota** `server/src/routes/companySummary.ts` → `GET /api/companies/:id/summary`:
   - `preHandler: requireAuth`; valida `:id` (integer).
   - Lê cache `company_ai_summaries`; se fresco (ex: < 7 dias e sem activity nova), retorna.
   - Senão: roda agregação → monta prompt com os números → `llmJSON({ schema: { resumo, motivo_abordar, alertas[] } })` → grava cache → retorna.
   - Registra em `app.ts` como `companySummaryRoutes(app)`.
4. **Front:** em `client/src/pages/Clientes.tsx` (e detalhe de empresa em Recommend), card "Resumo IA" → `api.get('/api/companies/${id}/summary')`. Botão "Atualizar" força regen (`?refresh=1`).
5. **Cuidado:** prompt recebe só números agregados, não dump bruto → barato e sem vazar PII além do necessário.

### 2. Automação de pedido multimodal ⭐ (maior diferencial)

**Por quê:** maior ganho operacional; reusa toda máquina de `orders` que já existe.

- **Dados:** `orders`, `order_items`, `catalog_items`, `price_tables`.
- **Modelo:** `qwen-turbo` (texto) na maioria dos casos; `qwen-vl-plus` só fallback escaneado.
- **Fluxo:** rep envia PDF/foto do pedido → texto extraído (cascata barata) → `qwen-turbo` devolve **JSON estruturado** de itens → casa com `catalog_items` → gera rascunho com snapshot de preço/desconto/IPI/ST.
- **Reuso:** máquina de status existente (`cotacao → rascunho → enviado → ...`).
- **Cuidado:** match item↔catálogo precisa revisão humana antes de confirmar. Gerar **rascunho**, nunca pedido faturado direto.

**Como implementar:**
1. **Upload:** rota `POST /api/orders/parse` (`requireAuth`, multipart). Aceita PDF/imagem.
2. **Extração de texto (cascata barata→cara):**
   - PDF com texto → `pdf-parse` (grátis, local).
   - PDF escaneado/imagem → Tesseract OCR (grátis, local).
   - OCR ruim/baixa confiança → fallback `qwen-vl-plus` (manda imagem base64; caro, só aqui).
   - Áudio **não é nativo** no qwen-turbo → usar `qwen3-omni`/`qwen-audio` OU transcrever antes; documentar como dependência separada.
3. **Extração estruturada (JSON p/ input do sistema):** `llmJSON({ model: qwen-turbo, response_format: json_object, input: textoDoPedido })`.
   - **Schema de saída** (contrato que entra no sistema):
     ```json
     {
       "cliente": { "nome": "string|null", "cnpj": "string|null" },
       "itens": [
         { "descricao_bruta": "string", "quantidade": number, "unidade": "string|null", "obs": "string|null" }
       ],
       "observacoes": "string|null"
     }
     ```
   - Prompt: "extraia os itens do pedido neste texto. Devolva SÓ JSON no schema. NÃO invente preço nem itens que não estão no texto. `quantidade` numérica; se ausente, null."
   - `llm.ts` valida o JSON contra o schema **antes** de seguir (campo faltando/tipo errado → retry 1x, depois erro tratado).
4. **Match catálogo:** p/ cada `descricao_bruta`, casar com `catalog_items` do `org_id`. `ILIKE`/`pg_trgm` (similarity) → candidatos com score; baixa confiança = marcar pra revisão. Coage ids com `Number()` (bigint vem string).
5. **Montagem:** item casado → preço de `price_tables` (vigência + representada/cliente) + alíquotas padrão de `catalog_items` → `order_items` com snapshot (mesma lógica de `routes/orders.ts`). Preço **vem do sistema**, nunca da LLM.
6. **Persistência:** `order` status `rascunho` via `withClient` (transação) — order + items juntos. Nunca `faturado` direto.
7. **Front:** tela "Novo pedido por PDF/foto" → upload → tabela de itens extraídos com match editável (dropdown candidatos) + qtd editável → confirma → vira rascunho na tela Pedidos.
8. **Habilitar pg_trgm:** migration `CREATE EXTENSION IF NOT EXISTS pg_trgm;` + índice gin em `catalog_items(descricao)`.

### 3. Sugestão de produto complementar (cross-sell)

- **Dados:** `order_items` (histórico).
- **Versão 1 (barata):** SQL market-basket — itens comprados juntos. Sem LLM. Estende `recommend.ts`.
- **Versão 2:** LLM reordena/explica sugestão por contexto do cliente.
- **UI:** ao montar pedido (rascunho), mostrar sugestões.

**Como implementar:**
1. **SQL market-basket (V1, sem IA):** `server/src/sql/crosssell.ts` → buildQuery que, dado conjunto de `catalog_item_id` no carrinho, faz self-join de `order_items` por `order_id` (mesmo `org_id`): conta co-ocorrência de outros itens, ordena por frequência. Filtra itens já no carrinho.
2. **Rota** `GET /api/orders/suggestions?items=1,2,3` (`requireAuth`) → roda query → top N. Indexar `order_items(order_id)` e `order_items(catalog_item_id)`.
3. **Front:** no editor de pedido, painel "Sugeridos" → `api.get('/api/orders/suggestions?items=...')` → botão "adicionar".
4. **V2 (IA opcional):** passar candidatos + contexto do cliente (segmento/histórico) ao `llmJSON` → reordena e gera 1 frase de justificativa por item. Só após V1 provar uso.

### 4. Geração de e-mail de prospecção

- **Dados:** dados do prospect + `email_schedules` + Nodemailer (já existe).
- **Fluxo:** LLM redige e-mail personalizado por CNAE / porte / sócio. Plugar **antes** do envio agendado.
- **Cuidado:** preview/edição humana antes de agendar envio em massa.

**Como implementar:**
1. **Rota** `POST /api/email/draft` (`requireAuth`): body `{ company_id, objetivo, tom }`. Monta contexto do prospect (`companies` + `company_relationships`) → `llmJSON({ schema: { assunto, corpo } })`. Não envia — só devolve rascunho.
2. **Front:** ao criar `email_schedule`, botão "Gerar com IA" preenche assunto/corpo → usuário **edita** → salva. Reusa fluxo Nodemailer existente (`server/src/email.ts`).
3. **Cuidado:** nunca auto-enviar gerado direto. Envio em massa: gerar 1 base + variáveis por destinatário, com preview obrigatório. Respeitar opt-out/LGPD.

### 5. Assistente de busca em linguagem natural

- **Fluxo:** "metalurgia em Joinville sem pedido há 90 dias" → LLM traduz para filtro SQL na Buscar Empresas.
- **Não precisa WhatsApp** — barra de busca na própria UI.
- **Cuidado:** LLM gera **filtros estruturados** (não SQL cru) → evita injection. Whitelist de campos/operadores.

**Como implementar:**
1. **Rota** `POST /api/recommend/nl-query` (`requireAuth`): body `{ q: string }`. `llmJSON` com schema **fixo** de filtros permitidos: `{ cnae?, uf?, municipio?, porte?, sem_pedido_dias?, texto? }`. LLM só preenche esse objeto — nunca gera SQL.
2. **Reuso:** alimentar o objeto no `buildRecommendQuery` existente (`server/src/sql/recommend.ts`), que já parametriza tudo com `$n`. Campo novo (ex: `sem_pedido_dias`) vira mais um WHERE parametrizado.
3. **Front:** barra de busca em linguagem natural na página Recommend → `api.post('/api/recommend/nl-query', { q })` → aplica filtros nos controles existentes (transparente: usuário vê os filtros que a IA escolheu e pode ajustar).
4. **Segurança:** whitelist rígida de campos/operadores; qualquer coisa fora do schema é ignorada. Sem string interpolation no SQL.

---

## Fora de escopo / adiar

| Item | Motivo |
|---|---|
| **WhatsApp bot** | Infra nova (Twilio/Meta API), custo alto. App web já é o canal. Adiar. |
| **E-commerce B2B** | Certumn é field force, não loja. Fora do escopo. |
| **Reposição automática** | Precisa modelo de estoque/recompra recorrente — não existe hoje. |

---

## Diferencial vs Mercos

Mercos IA = assistente de **pedido/CRM** (etapa pós-cliente).
Certumn ataca **antes**: achar cliente novo (RFB + geo/CNAE + rotas) — Mercos não tem isso.
IA aqui reforça o **pós-prospecção** (hoje lado fraco): resumo, pedido, e-mail, cross-sell.

---

## Notas técnicas transversais

- **Multi-tenant:** todo prompt/contexto de LLM deve respeitar `org_id`. Nunca vazar dado entre orgs.
- **Custo:** cachear resumos (invalidar em nova activity/pedido). Não chamar LLM a cada render.
- **Structured output:** usar JSON schema para extração de pedido e filtros de busca — validar antes de gravar.
- **Humano no loop:** pedido e e-mail em massa sempre passam por revisão antes de ação irreversível.
- **bigint do pg vem string** (ver memória `pg-bigint-ids-as-strings`) — atenção ao casar ids em matches.
