# Rovva — Checklist de lançamento

> Baseado em `docs/GO_LIVE.md` (auditoria jul/2026) + a definição comercial deste kit.
> Separado com honestidade: **PRONTO** (existe no código) vs **FALTA CONSTRUIR**.

---

## ✅ Pronto (já existe no produto)

- Núcleo funcional: recomendação geo/CNAE (lista + mapa), funil kanban, agenda,
  clientes/carteiras, pedidos, tabelas de preço, catálogo, comissões (regras/split/
  conciliação CSV), amostras, transportadoras, rotas com check-in, financeiro,
  dashboard/relatórios, WhatsApp integrado, e-mail agendado.
- Multi-tenant isolado por org, RBAC fino por grupos, auditoria, senhas com scrypt.
- Deploy via Docker (`docker-compose.prod.yml`, `deploy.sh`), migrations no boot.
- ETL da Receita Federal para popular `companies`.

---

## 🔨 Falta construir (bloqueadores de go-live)

### 1. Unificar a marca em "Rovva"
Os assets em `marca/` já estão em Rovva (logo, favicon, social, capas). Falta o **código**:
- `client/index.html` (título, favicon, manifest) → Rovva + `marca/favicon.svg`.
- `nginx/templates/certumn.conf.template` → `rovva.conf.template` + domínio.
- Cor primária nos tokens Tailwind (ver `IDENTIDADE.md`).
- **Exportar PNGs** dos SVGs sociais (não há renderer no ambiente). Ex.:
  `rsvg-convert -w 1080 -h 1080 marca/rovva-profile.svg -o marca/rovva-profile-1080.png`
  (idem `rovva-icon.svg` → 512, `rovva-logo-dark.svg`, `rovva-cover-name.svg`).

### 2. Billing e limites por plano — **não existe**
Sem isso não dá para cobrar:
- Gateway de pagamento BR (**Pagar.me** ou **Stripe BR**) com assinatura recorrente.
- Enforcement de plano: nº de assentos, nº de territórios, teto de empresas no funil.
- Trial de 14 dias com expiração + tela de upgrade.
- Faturamento por assento (pró-rata em upgrade/downgrade).

### 3. TLS / proxy reverso / domínio — **não existe**
- App hoje sobe em HTTP puro (`docker-compose.prod.yml`). Login/JWT em texto claro.
- Fazer: Caddy/Traefik/nginx+certbot no compose, variável de domínio, cert automático,
  depois bind do app em `127.0.0.1`.
- Registrar `rovva.com.br` (+ `.app` reserva) e e-mail profissional.

### 4. E-mail de plataforma — **não existe**
- Só há SMTP por-org (prospecção). Falta provedor transacional (SES/Resend/Postmark) +
  3 fluxos: verificação de e-mail no signup, "esqueci senha" por token, convite de usuário.

### 5. LGPD — lacuna grande
- Exclusão/anonimização de tenant e titular, exportação de dados, política de retenção
  (audit_log e mídia crescem sem limite).
- Páginas legais reais: **/termos** e **/privacidade** (na landing os links já apontam
  para esses caminhos — criar as páginas).
- Atenção: a base tem sócios PF da Receita (dado pessoal de terceiros) — ponto sensível.
- Banner de cookies + canal DPO.

### 6. Landing no ar
- `marca/landing/index.html` já está pronta, **sem CDN** (autossuficiente), com a
  identidade Rovva. Plugar onde a app já serve estáticos (Fastify) ou hospedar
  separado (Vercel/Netlify).
- Ligar os CTAs `#cadastro`/`Criar conta grátis` ao fluxo real de signup.
- Publicar `og-image.svg` (converter para PNG 1200×630 para melhor suporte em redes).

### 7. Analytics
- Plausible/GA4 na landing + eventos de signup e início de trial.

---

## Ordem sugerida
1. Unificar marca (rápido, destrava tudo).  2. TLS + domínio + e-mail de plataforma.
3. Landing no ar + analytics.  4. Billing + limites por plano.  5. LGPD (paralelo, antes
de campanha paga).  6. Só então tráfego pago (ver `criativos/ads.md`).
