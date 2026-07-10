# Roadmap de features — gestão de representação

> Levantamento de 2026-07-09. Foco no domínio de representação comercial, não em
> infra/go-live (ver `GO_LIVE.md`) nem em IA (ver `ROADMAP_IA.md`).
>
> **Contexto:** o produto já é um ERP de representação quase completo —
> recomendação geo/CNAE, funil kanban, pedidos (cotação → faturado), comissões
> com regras/split/conciliação CSV, metas, financeiro com recorrência, catálogo,
> tabelas de preço, transportadoras, rotas de visita com check-in offline,
> amostras, relatórios, WhatsApp e e-mail agendado. As lacunas abaixo são o que
> falta no *domínio*, ordenadas por valor.

---

## 1. Fechamento do ciclo financeiro — maior lacuna

O ciclo hoje morre em "faturado" (`server/src/routes/orders.ts:37` — "sem voltar
de faturado"). Na operação real do representante o ciclo continua:

- **Importação XML NF-e** (já no backlog, `docs/PLANEJAMENTO.md:114`) — killer
  feature. Representada fatura, XML entra (upload ou e-mail dedicado), pedido
  concilia sozinho com o valor real, comissão gera automática. Hoje a
  conciliação é CSV manual (`server/src/routes/commissions.ts`).
- **Devolução / cancelamento de NF / faturamento parcial** — não existe nada
  (grep: zero hits para devolução/estorno no server). Devolução parcial precisa
  estornar comissão proporcionalmente.
- **Inadimplência do cliente → estorno de comissão** — Lei 4.886/65: a comissão
  só é devida quando o cliente paga a representada. Falta acompanhar
  duplicatas/títulos do pedido e estornar comissão de título não pago. Hoje
  `commission_entries` só tem previsto/recebido, sem vínculo com o pagamento do
  cliente.

## 2. Relacionamento com a representada

- **Contrato de representação** — o cadastro da representada não modela vigência
  do contrato, % base, exclusividade de território, anexos (contrato assinado)
  nem alerta de renovação (grep: "contrato" não existe no server).
- **Prestação de contas / extrato para a representada** — export mensal de
  pedidos + comissões por representada (PDF/CSV) para conferir contra o extrato
  que ela manda. Hoje a conferência é só do lado do escritório.
- **Envio do pedido para a representada** — falta e-mail automático com PDF do
  pedido ao emitir. Existe print view de cotação (`orders.ts:254`), mas não o
  fluxo de envio.

## 3. Inteligência de carteira — retenção, não só prospecção

O produto conquista cliente novo (recomendação) mas é fraco em **manter**:

- **Positivação / cliente inativo** — alerta "cliente sem pedido há 90 dias" e
  taxa de positivação da carteira por mês. Métrica nº 1 do representante.
- **Ciclo de recompra** — cliente que compra a cada ~45 dias e está há 60 sem
  pedir → sugerir na agenda/rota.
- **Curva ABC da carteira** — classificar clientes por faturamento e cruzar com
  frequência de visita (visita muito quem compra pouco?).
- **Última venda por item por cliente** — "última vez vendi o item X para esse
  cliente foi a R$ Y" na tela de novo pedido.
- **Cross-sell entre representadas** (já no backlog) — cliente compra da rep A e
  nunca da rep B com mix compatível.

## 4. Auto-atendimento do cliente final — meio-termo antes de e-commerce B2B

- **Catálogo compartilhável** — link público/PDF do catálogo com a tabela de
  preço daquele cliente; cliente monta carrinho → vira cotação no funil. O
  roadmap descartou e-commerce B2B completo (`docs/ROADMAP_IA.md:172`); isso é a
  versão barata com 80% do valor.

## 5. Alertas proativos

As notificações existem mas são passivas (`server/src/routes/notifications.ts`).
Regras que valem: cotação vencendo, pedido parado no funil há N dias, meta em
risco no dia 20, comissão prevista não recebida há X dias.

---

## Prioridade sugerida

**1 > 3 > 2 > 5 > 4**

- O **ciclo financeiro** (NF-e + estorno por devolução/inadimplência) é o que
  diferencia de um CRM genérico — é a dor específica de representante que
  Pipedrive/HubSpot não resolvem.
- **Inteligência de carteira** (positivação/recompra) é o que segura a
  assinatura depois do trial.
