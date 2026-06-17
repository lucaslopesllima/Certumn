# Praça — Checklist de Lançamento

Passos concretos para por a empresa no ar. Separado em **marca/marketing** (pronto aqui),
**operacional** (configurar) e **falta construir no produto** (engenharia antes de cobrar).

---

## ✅ Pronto neste pacote (`marca/`)
- Nome, posicionamento, tom de voz, personas — `MARCA.md`.
- Logo (`logo.svg`, `logo-mono.svg`, `favicon.svg`) + guia visual — `IDENTIDADE.md`.
- Planos e oferta — `PLANOS.md`, `planos.json`.
- Landing page — `landing/index.html`.
- Criativos (social, ads, e-mail, pitch, og-image) — `criativos/`.

---

## 🔧 Operacional — colocar no ar (sem código novo)

### 1. Domínio + e-mail
- Registrar `praca.com.br` (registro.br). Conferir disponibilidade; fallback `usepraca.com.br`.
- E-mail profissional `ola@praca.com.br`, `vendas@`, `suporte@` (Google Workspace / Zoho).
- Configurar SPF/DKIM/DMARC desde o início (entregabilidade dos e-mails de trial).

### 2. Publicar a landing
- A landing é estática (`marca/landing/index.html`). Opções:
  - **Hospedar avulsa** (recomendado p/ velocidade de marketing): Vercel/Netlify/Cloudflare
    Pages, apontando `praca.com.br` → app em `app.praca.com.br`.
  - **Servir pelo próprio app:** o Fastify já serve estáticos (ver README). Dá para colocar a
    landing como home pública e o sistema atrás de login — mas exige separar rota pública de
    rota autenticada. Mais acoplado; deixar para depois.
- Substituir os `href="#"` dos CTAs pelo destino real (cadastro/trial) e os links de Termos/
  Privacidade.

### 3. Analytics + conversão
- Plausible (LGPD-friendly, sem cookie) ou GA4. Marcar eventos: clique em CTA, início de
  trial, escolha de plano.
- Pixel da Meta + tag do Google Ads se for rodar mídia paga (ver `criativos/ads.md`).

### 4. Jurídico / LGPD
- Termos de Uso e Política de Privacidade (a base é dado público da Receita + dados de cliente
  do tenant — descrever tratamento, base legal, retenção).
- Aviso de cookies/analytics. Canal do titular (DPO/e-mail). Mencionar no rodapé (já há link).
- Contrato de assinatura (SaaS) para os planos pagos.

### 5. Suporte e vendas
- Canal de suporte (e-mail + WhatsApp Business para tier Escritório).
- Roteiro de demo/onboarding assistido (premium é venda assistida — ver personas em `MARCA.md`).

---

## 🚧 Falta construir no PRODUTO antes de cobrar (engenharia)

> Honestidade: o sistema está funcional (Fases 0–6 concluídas), mas **não tem como cobrar nem
> limitar plano hoje**. Sem isto, não há negócio pago.

1. **Billing / assinatura (bloqueante).**
   - Integrar gateway BR: **Stripe** (cartão recorrente, bom DX) ou **Pagar.me/Iugu/Asaas**
     (boleto/Pix nativo, NF-e). Para anual com boleto/Pix, um gateway BR ajuda.
   - Modelo: assinatura por `org`, com quantidade de assentos. Webhooks → estado da org
     (ativa/inadimplente/trial).
   - Tabela `subscriptions` (org_id, plano, status, assentos, ciclo, trial_fim, gateway_id).

2. **Enforcement de limites por plano (bloqueante).**
   - Gating dos recursos conforme `planos.json`: nº de assentos (vendedores), nº de
     representadas (Solo = 2), e features por tier (multi-vendedor, comissão completa,
     financeiro/DRE, relatórios) liberadas só em Equipe/Escritório.
   - Middleware de plano: barrar criação de usuário acima do limite, esconder/bloquear rotas
     de feature fora do tier. Hoje todas as rotas estão liberadas para qualquer org.

3. **Trial real.**
   - Marcar `trial_fim` no cadastro, banner de dias restantes, bloqueio gracioso ao expirar
     (read-only + CTA de plano). Liga com os e-mails em `criativos/email.md`.

4. **Onboarding self-service do tenant.**
   - O registro já cria org + admin + etapas do kanban (README). Falta: wizard de primeiro uso
     (definir CNAE-alvo + território → primeira recomendação) para o "aha" do trial.

5. **SMTP / e-mail transacional.**
   - Sem isto, não há e-mail de trial, convite de usuário nem reset de senha (são backlog no
     `PLANEJAMENTO.md`). Provedor: Resend/SES/Postmark. Desbloqueia `criativos/email.md` e o
     convite de vendedor por e-mail.

6. **Cobrança de NF-e da assinatura.**
   - Emissão de nota fiscal da mensalidade (via gateway com emissão, ou integração à parte).

### Ordem sugerida
SMTP (rápido, destrava trial/convite) → trial real → billing → enforcement de limites →
wizard de onboarding → NF-e. Só anuncie preço público depois de billing + enforcement.

---

## Resumo de prontidão
- **Marca e marketing:** prontos para ir ao ar hoje (este pacote).
- **Produto:** pronto para **piloto/beta gratuito** (rodar com 1–3 escritórios reais, manual,
  sem cobrança) — ótimo para gerar os depoimentos reais que a landing ainda usa como placeholder.
- **Cobrança:** depende dos itens bloqueantes acima. Não vender plano pago antes deles.
