# Praça — Estratégia de Marca

> ERP completo para escritórios de representação comercial.
> Documento de marca. Público primário: **escritório / equipe de representação**. Posição: **premium**.

---

## 1. O que o produto é (honesto, baseado no código)

Não é "um CRM de prospecção". É um **ERP de representação comercial** com todas as fases
construídas (ver `docs/PLANEJAMENTO.md` — Fases 0 a 6 concluídas):

- **Base nacional integrada** — **toda empresa do Brasil** está dentro do sistema: a base
  completa da Receita Federal (+60 milhões de CNPJs, +20 milhões ativas) com CNAE, porte,
  endereço e contato. É o grande diferencial — não é amostra, é o país inteiro.
- **Prospecção inteligente** — sobre essa base, recomenda quais empresas abordar por
  **CNAE-alvo + proximidade + porte**, dentro do
  território, com lista explicável e mapa.
- **Funil / CRM** — kanban, perfil-alvo, atividades, motivo de descarte.
- **Pedidos e cotações** — tabelas de preço por representada com vigência, máquina de
  status (cotação → pedido → faturado), impressão/PDF.
- **Comissionamento** — regras por precedência (produto > cliente > vendedor > geral),
  split do vendedor, conciliação por CSV, divergências.
- **Multi-vendedor** — carteira isolada por vendedor (RBAC), transferência de carteira,
  metas vs. realizado.
- **Dashboard e relatórios** — funil, vendas vs. meta, curva ABC, mapa de cobertura,
  alertas de inatividade/estagnação.
- **Campo** — check-in com geolocalização, rota do dia otimizada a partir da agenda,
  PWA com fila offline.
- **Financeiro** — fluxo de caixa projetado, DRE simplificado, recorrências, despesa de viagem.
- **Comunicação** — WhatsApp click-to-chat (wa.me), notificações in-app.

> Ainda **não** existe: WhatsApp Business API oficial, e-mail/SMTP (convite, reset),
> import XML NF-e, app nativo/push. Não prometer no marketing como recurso atual.

---

## 2. Nome

### Recomendado: **Praça**

"Praça" é o jargão do próprio representante: a **praça** é o mercado/território onde ele
vende ("abrir uma praça", "minha praça é o interior"). O produto inteiro gira em torno de
trabalhar a praça com inteligência — território, cobertura, mapa, carteira. Nome curto,
memorável, em português, com ressonância imediata no público. Premium sem ser pomposo.

- **Domínio sugerido:** `praca.com.br` (verificar; se ocupado → `usepraca.com.br`,
  `praca.app`, `pracaerp.com.br`).
- **Risco:** palavra comum (SEO genérico) — mitigado por marca forte + sempre usar
  "Praça" capitalizado e com a tagline de categoria.

### Alternativas avaliadas

| Nome | Significado | Prós | Contras | Domínio |
|------|-------------|------|---------|---------|
| **Praça** ✅ | Território/mercado de venda (jargão) | Ressoa no público, curto, BR, premium | Palavra comum p/ SEO | `praca.com.br` / `usepraca.com.br` |
| **Reppo** | "representação" abreviada | Curto, ownable, fácil .com | Soa startup-cute, menos premium | `reppo.com.br` |
| **Comissio** | Comissão (o coração do negócio) | Liga no diferencial financeiro | Estreita o produto à comissão | `comissio.com.br` |
| **Núcleo** | Núcleo de representação | Sólido, corporativo | Genérico, muitos homônimos | `nucleo.com.br` (provável ocupado) |
| **Prospecta** | Nome atual (README) | Já existe no projeto | Subdimensiona: virou ERP, não só prospecção | — |

> Se preferir outro, é só trocar: o nome aparece em `logo.svg`/`logo-mono.svg` (wordmark),
> `landing/index.html`, `planos.json` e nos criativos. Substituição mecânica.

---

## 3. Posicionamento

> **Para escritórios de representação comercial que perdem dinheiro com planilha, lista fria
> e comissão no escuro, a Praça é o ERP que conecta prospecção, pedidos, comissões e campo
> num só lugar — diferente de CRMs genéricos que não entendem representação e de planilhas
> que não escalam.**

Categoria que reivindicamos: **"ERP de representação comercial"** (não "CRM"). É a diferença
entre vender mais uma ferramenta e ser o sistema que roda o escritório.

---

## 4. Tagline

- **Principal:** *O ERP do escritório de representação.*
- Reserva 1: *Da prospecção à comissão, num só lugar.*
- Reserva 2: *Sua praça inteira sob controle.*

---

## 5. Proposta de valor e pilares

**Promessa central:** parar de perder pedido, comissão e cliente por falta de sistema feito
para representação.

Três pilares (ordem de impacto para o gestor):

1. **Comissão sob controle** — regras por precedência, split do vendedor, conciliação e
   divergência apontada. O escritório para de perder dinheiro no acerto com a representada.
2. **Prospecção quente, não fria** — recomendação por CNAE + proximidade + porte sobre a base
   da Receita, no mapa, dentro do território de cada vendedor. Carteira nova sem garimpo.
3. **O escritório inteiro num lugar** — pedidos, tabelas de preço, financeiro/DRE, metas,
   rota de campo com check-in. Sai da planilha, entra no controle.

---

## 6. Tom de voz

Três adjetivos: **direto · confiável · de quem é do ramo**.

Falamos como quem conhece representação — usamos "praça", "carteira", "representada",
"comissão divergente", "faturado". Sem buzzword de startup, sem prometer o que não existe.

| Fala assim ✅ | Não assim ❌ |
|--------------|-------------|
| "Veja a comissão de cada pedido antes de fechar o mês." | "Potencialize sua jornada de revenue com IA disruptiva." |
| "Recomenda as 20 empresas mais quentes da sua praça." | "Soluções 360º para alavancar resultados." |

---

## 7. Personas

### Persona 1 — Marcos, dono do escritório de representação (decisor / comprador)
- 48 anos, representa 5 indústrias, 6 vendedores na rua, ~R$ 4 mi/ano em pedidos.
- **Dores:** comissão batida na planilha (e erra), não sabe a cobertura de cada vendedor,
  fecha o mês no escuro, perde tempo conciliando o que a representada pagou.
- **Ganha com a Praça:** comissão conciliada e auditável, DRE do escritório, metas por
  vendedor, mapa de cobertura. Compra pelo **controle financeiro**.

### Persona 2 — Júlia, vendedora externa (usuária diária)
- 34 anos, roda 3 cidades, vive no carro e no celular.
- **Dores:** lista fria, decide visita por achismo, faz pedido no papel/WhatsApp, esquece
  follow-up.
- **Ganha com a Praça:** prospecção no mapa do território dela, rota do dia, check-in,
  pedido no celular (até offline), agenda com alerta. Adota pela **facilidade no campo**.

> Venda é assistida (premium): o **comprador é o dono (Marcos)**, mas a **adoção depende da
> vendedora (Júlia)**. Marketing fala com os dois — ROI/controle para o dono, facilidade
> para o vendedor.
