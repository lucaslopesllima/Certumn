# Praça — Sequência de e-mails do trial

3 e-mails: boas-vindas → ativação → conversão. Remetente: Praça <ola@praca.com.br>.
Tom direto, 1 CTA por e-mail. (Depende de SMTP — ver `LANCAMENTO.md`.)

---

## E-mail 1 — Boas-vindas (envio: no cadastro)

**Assunto:** Sua praça já está no mapa 🗺️
**Pré-cabeçalho:** Comece pelo seu território — leva 2 minutos.

> Olá, {{nome}}!
>
> Bem-vindo à Praça. Você tem 14 dias com tudo liberado.
>
> O primeiro passo que mais dá retorno: **definir seu alvo**. Diga o ramo (CNAE), o porte e
> o território — a Praça cruza com toda empresa do Brasil (base completa da Receita) e devolve
> sua primeira lista quente, no mapa.
>
> 👉 **[Definir meu alvo e ver a lista]**
>
> Qualquer dúvida, é só responder este e-mail.
>
> — Equipe Praça

---

## E-mail 2 — Ativação (envio: D+2, se ainda não fez 1º pedido)

**Assunto:** Falta o passo que mostra o valor da Praça
**Pré-cabeçalho:** Transforme uma visita em pedido — e veja a comissão.

> {{nome}}, viu sua lista de prospecção? Ótimo. Agora o pulo do gato:
>
> Crie um **pedido** (ou cotação) para um cliente. A Praça aplica a tabela de preço da
> representada, calcula o total e já mostra a **comissão prevista** — com o split do vendedor.
>
> É aqui que o escritório sai da planilha.
>
> 👉 **[Criar meu primeiro pedido]**
>
> Está na rua? A Praça funciona no celular, até offline.
>
> — Equipe Praça

---

## E-mail 3 — Conversão (envio: D+11, 3 dias antes de acabar)

**Assunto:** Seu trial termina em 3 dias — não perca seus dados
**Pré-cabeçalho:** Escolha um plano e siga com a praça sob controle.

> {{nome}}, seu teste da Praça termina em **3 dias**.
>
> Nesses dias você já {{#se_prospectou}}prospectou no mapa{{/se}}, {{#se_pedido}}fez pedido com
> comissão calculada{{/se}} e viu o escritório num lugar só. Para não perder nada, é só escolher
> um plano:
>
> - **Equipe** — até 5 vendedores, comissão completa, financeiro e relatórios. O mais escolhido.
> - **Solo** — para representante autônomo.
>
> Anual sai com **2 meses grátis**.
>
> 👉 **[Escolher meu plano]**
>
> Quer ajuda para decidir ou migrar a planilha? Responda aqui que a gente te liga.
>
> — Equipe Praça

---

## Notas
- `{{nome}}`, `{{#se_...}}` são placeholders de personalização — preencher conforme o uso
  real do trial.
- Sem SMTP hoje: para disparar, configurar provedor (ex. Resend/SES) — ver `LANCAMENTO.md`.
- Não prometer recurso de fase 2 (WhatsApp API, push) nestes e-mails.
