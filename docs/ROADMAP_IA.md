# Roadmap IA — Prospecta

Funcionalidades de IA a agregar ao Prospecta, inspiradas no **Mercos IA** e adaptadas à
base real do produto (prospecção RFB + geo/CNAE + funil + pedidos + rotas).

> **Contexto do produto:** SaaS de prospecção para representantes comerciais.
> Base Receita Federal, recomendação geo/CNAE, funil de vendas, pedidos, rotas,
> comissões e financeiro. **Hoje: zero integração de IA/LLM.**

> **Stack:** Fastify 5 + PostgreSQL (pg) + React 19 / Vite / Tailwind 4 / React Router 7 +
> Leaflet. Multi-tenant por `org_id`. Auth JWT (jose). Email via Nodemailer.

> **LLM sugerido:** Claude (Opus 4.8 / Sonnet 4.6) — input multimodal nativo
> (imagem/PDF) + structured output. Migrar `recommend.ts` (SQL puro) para
> enriquecimento com LLM onde fizer sentido.

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

## Prioridade de implementação

Ordem por **razão valor/esforço** — começa pelo que reusa dado existente.

### 1. Resumo inteligente de cliente/prospect ⭐ (começar aqui)

**Por quê primeiro:** menor superfície, usa só dados que já existem, prova valor da IA rápido.

- **Dados:** `companies` (RFB, CNAE, sócios), `company_relationships`, `activities`, `orders` (histórico).
- **Fluxo:** SQL agrega (ticket médio, ciclo de compra, último pedido, frequência) → LLM redige resumo + "por que abordar agora".
- **UI:** tela Cliente / Buscar Empresas — card de resumo.
- **Custo:** baixo. SQL já faz agregação; LLM só redige texto curto.
- **Risco:** baixo. Read-only, não muda máquina de estado.

### 2. Automação de pedido multimodal ⭐ (maior diferencial)

**Por quê:** maior ganho operacional; reusa toda máquina de `orders` que já existe.

- **Dados:** `orders`, `order_items`, `catalog_items`, `price_tables`.
- **Fluxo:** rep envia foto/áudio/PDF do pedido → LLM (input multimodal) extrai itens → casa com `catalog_items` (fuzzy match descrição) → gera rascunho com snapshot de preço/desconto/IPI/ST.
- **Reuso:** máquina de status existente (`cotacao → rascunho → enviado → ...`).
- **Cuidado:** match item↔catálogo precisa revisão humana antes de confirmar. Gerar **rascunho**, nunca pedido faturado direto.
- **Stack:** Claude structured output (JSON schema dos itens) → validação → insert em `order_items`.

### 3. Sugestão de produto complementar (cross-sell)

- **Dados:** `order_items` (histórico).
- **Versão 1 (barata):** SQL market-basket — itens comprados juntos. Sem LLM. Estende `recommend.ts`.
- **Versão 2:** LLM reordena/explica sugestão por contexto do cliente.
- **UI:** ao montar pedido (rascunho), mostrar sugestões.

### 4. Geração de e-mail de prospecção

- **Dados:** dados do prospect + `email_schedules` + Nodemailer (já existe).
- **Fluxo:** LLM redige e-mail personalizado por CNAE / porte / sócio. Plugar **antes** do envio agendado.
- **Cuidado:** preview/edição humana antes de agendar envio em massa.

### 5. Assistente de busca em linguagem natural

- **Fluxo:** "metalurgia em Joinville sem pedido há 90 dias" → LLM traduz para filtro SQL na Buscar Empresas.
- **Não precisa WhatsApp** — barra de busca na própria UI.
- **Cuidado:** LLM gera **filtros estruturados** (não SQL cru) → evita injection. Whitelist de campos/operadores.

---

## Fora de escopo / adiar

| Item | Motivo |
|---|---|
| **WhatsApp bot** | Infra nova (Twilio/Meta API), custo alto. App web já é o canal. Adiar. |
| **E-commerce B2B** | Prospecta é field force, não loja. Fora do escopo. |
| **Reposição automática** | Precisa modelo de estoque/recompra recorrente — não existe hoje. |

---

## Diferencial vs Mercos

Mercos IA = assistente de **pedido/CRM** (etapa pós-cliente).
Prospecta ataca **antes**: achar cliente novo (RFB + geo/CNAE + rotas) — Mercos não tem isso.
IA aqui reforça o **pós-prospecção** (hoje lado fraco): resumo, pedido, e-mail, cross-sell.

---

## Notas técnicas transversais

- **Multi-tenant:** todo prompt/contexto de LLM deve respeitar `org_id`. Nunca vazar dado entre orgs.
- **Custo:** cachear resumos (invalidar em nova activity/pedido). Não chamar LLM a cada render.
- **Structured output:** usar JSON schema para extração de pedido e filtros de busca — validar antes de gravar.
- **Humano no loop:** pedido e e-mail em massa sempre passam por revisão antes de ação irreversível.
- **bigint do pg vem string** (ver memória `pg-bigint-ids-as-strings`) — atenção ao casar ids em matches.
