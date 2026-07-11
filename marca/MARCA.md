# Rovva — Estratégia de marca

> Plataforma de prospecção e gestão comercial para representantes. Buscando nas
> empresas de todo o Brasil, mostra **quais empresas abordar** no território e leva o
> cliente do primeiro contato até o **pedido pago**.

---

## Nome

**Rovva** — nome inventado (coined), sem tradução de dicionário. O significado é
construído pela marca:

- Ecoa **rover / rove** (percorrer, vaguear por um território) — o representante que
  roda a praça atrás do cliente certo.
- Sonoridade curta, 2 sílabas, duplo-V terminando em vogal — som de SaaS moderno,
  fácil de lembrar e de falar ("chiclete").
- Verificado sem colisão de marca em CRM / vendas / prospecção (jul/2026).

**Domínio-alvo:** `rovva.com.br` (registrar) + `rovva.app` como reserva.
Se `.com.br` estiver ocupado, usar `userovva.com` / `rovva.app`.

> ⚠️ Os artefatos de marca (`marca/`) já estão unificados em Rovva. A base de **código**
> ainda tem resíduos do nome anterior "Certumn" (`client/index.html`,
> `nginx/templates/certumn.conf.template`). Antes do go-live, unificar tudo em Rovva
> (ver `LANCAMENTO.md`).

---

## Posicionamento

> Para o **representante comercial e o escritório de representação** que perdem tempo
> com lista comprada, Google Maps e achismo, o **Rovva** é a plataforma que **mostra
> quais empresas abordar no território** — pelo ramo que você vende, pela distância e
> pelo tamanho — e acompanha o cliente **até o pedido pago e a comissão**. Diferente do
> sistema genérico, que só guarda contato, o Rovva já entrega a lista quente pronta e
> explica *por que* cada empresa está ali.

**Categoria:** prospecção + gestão comercial para representação (Brasil).

---

## Proposta de valor

**Pare de prospectar no escuro.** O Rovva procura nas empresas de todo o Brasil e te
diz quem abordar primeiro no seu território — com a lista e o mapa prontos — e leva
esse cliente do funil ao pedido faturado, sem planilha paralela.

### 3 pilares

1. **Lista quente, não fria.** Em vez de comprar cadastro e ligar no escuro, você recebe
   empresas reais e ativas, escolhidas para o que você vende.
2. **Você sabe o porquê.** Cada empresa vem com o *motivo*: vende o que você oferece,
   fica perto de você e é do tamanho que você atende.
3. **Do território ao pedido.** Lista → funil → agenda → pedido → comissão, no mesmo
   lugar. O ciclo comercial inteiro, não só o contato.

---

## Tagline

- **Principal:** *Do território ao pedido pago.*
- Reserva 1: *Pare de prospectar no escuro.*
- Reserva 2: *O sistema que já sabe quem você deve vender.*

---

## Tom de voz

Três adjetivos: **direto, prático, confiante** (sem arrogância de guru).

Fala como um gerente comercial experiente que respeita o tempo do representante.
Frases curtas. Verbo no imperativo quando chama pra ação. Zero buzzword vazio.

| Fala assim ✅ | Não assim ❌ |
|---|---|
| "Saiba quem abordar hoje no seu território." | "Alavanque sinergias na sua jornada de prospecção." |
| "A lista já vem pronta e priorizada." | "Solução 360° end-to-end data-driven omnichannel." |

---

## Personas

### 1. Rafael — representante autônomo
- 38 anos, representa 4 indústrias, cobre 3 cidades no interior de SP.
- **Dor:** gasta a manhã decidindo *para onde ir* e mistura tudo em planilha + WhatsApp.
- **Ganho com o Rovva:** abre o app, vê as 20 empresas quentes do dia no mapa, marca
  visita na agenda e registra o pedido na hora. Plano **Solo**.

### 2. Cláudia — gestora de escritório de representação
- 45 anos, toca um escritório com 6 representantes e 9 representadas.
- **Dor:** não enxerga o funil da equipe, comissão vira dor de cabeça no fim do mês,
  cada vendedor tem seu método.
- **Ganho com o Rovva:** funil compartilhado, metas por vendedor, pedidos e comissões
  centralizados, territórios distribuídos sem sobreposição. Plano **Equipe/Escritório**.

---

## O que o produto É hoje (não prometer além disto)

Confirmado no código (`README.md`, `client/src/pages/`, `docs/ROADMAP_FEATURES.md`):

- Recomendação explicável (CNAE + geo + porte) com lista e **mapa Leaflet**.
- Funil kanban, agenda, clientes/carteiras, multi-vendedor com metas.
- Pedidos (cotação → faturado), tabelas de preço, catálogo, comissões (regras/split/
  conciliação CSV), amostras, transportadoras, rotas de visita com check-in.
- Financeiro (contas, categorias, recorrência), dashboard e relatórios.
- **WhatsApp integrado** (chat espelhado em tempo real, mídia, agendamentos) e
  **e-mail agendado** por org. — já existe, pode comunicar.
- Multi-tenant isolado por org, RBAC fino por grupos, auditoria.

**Ainda NÃO existe (não vender como pronto):** billing/cobrança e limites por plano,
verificação de e-mail / "esqueci senha" de plataforma, importação de XML NF-e,
páginas legais (termos/privacidade). Ver `LANCAMENTO.md`.
