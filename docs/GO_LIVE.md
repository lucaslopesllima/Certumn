# Go-Live — o que falta para pôr em produção e vender o SaaS

> Levantamento de 2026-07-09, baseado em auditoria de 4 frentes: infra/deploy,
> backend, frontend/go-to-market e docs/segurança.
>
> **Fora de escopo deste doc (já mapeado à parte):** planos de preço e gateway
> de pagamento.

---

## Bloqueadores (sem isso não põe no ar)

### 1. TLS / proxy reverso / domínio — não existe nada
- `docker-compose.prod.yml:66` publica o app direto em HTTP puro na porta 8080.
  Login, senha e JWT trafegariam em texto claro.
- O código já espera proxy (HSTS liga em prod em `server/src/app.ts:76`,
  `trustProxyHops` em `server/src/config.ts:43`), mas o proxy não está no repo.
- **Fazer:** serviço Caddy/Traefik/nginx+certbot no `docker-compose.prod.yml`,
  variável de domínio no `.env`, renovação automática de certificado e, depois,
  bind do app em `127.0.0.1`.

### 2. E-mail de plataforma — não existe
- O nodemailer existente é só SMTP **por-org** (cliente configura o dele, para
  e-mails de prospecção — `server/src/smtp.ts`, `server/src/email.ts`). Não há
  SMTP do sistema.
- Consequências em cascata:
  - Signup sem verificação de e-mail — qualquer e-mail vira tenant ativo
    (`server/src/routes/auth.ts:19`).
  - Sem "esqueci minha senha" — admin único que perde a senha fica trancado
    para sempre (só existe reset por admin em `server/src/routes/users.ts:164`).
  - Convite de usuário sem e-mail — senha provisória passada "por fora"
    (`server/src/routes/users.ts:34`).
- **Fazer:** provedor transacional (SES/Resend/Postmark) + 3 fluxos:
  verificação de e-mail, reset por token, convite de usuário.

### 3. LGPD — lacuna grande
- Não existe: exclusão de conta/tenant (`DELETE FROM organizations` não existe
  em lugar nenhum, só desativação), exportação de dados, anonimização,
  política de retenção (audit_log e mídia crescem indefinidamente).
- Páginas legais (Termos de Uso, Política de Privacidade, aviso de cookies)
  não existem — os links no footer da landing são `href="#"`
  (`Marketing/landing/index.html:472`).
- Agravante: a base contém dados de sócios PF da Receita Federal
  (`server/migrations/014_socios.sql`) — dado pessoal de terceiros, ponto
  sensível de compliance.
- **Fazer:** exclusão/anonimização de tenant e titular, endpoint de exportação,
  páginas `/termos` e `/privacidade`, banner de cookies, canal DPO.

### 4. Marca — 3 nomes diferentes
- App chama **"Certumn"** (`client/index.html:7`), landing chama **"Certum"**
  (`Marketing/landing/index.html`), docs de marketing chamam **"Vértice"**
  (`Marketing/MARCA.md`, `PLANOS.md`, `IDENTIDADE.md`).
- Logo, favicon, manifest e domínio todos divergem.
- **Fazer:** escolher um nome e unificar app + landing + kit de marketing antes
  de qualquer coisa.

### 5. Landing page morta
- Existe (`Marketing/landing/index.html`) mas:
  - Todos os CTAs são `href="#"` — nenhum leva ao cadastro real.
  - Usa Tailwind via CDN (`cdn.tailwindcss.com`) — proibido em produção.
  - Não está hospedada nem servida pelo Fastify.
- **Fazer:** apontar CTAs para o registro real, compilar o CSS, hospedar
  (avulsa ou servida pelo app), tag de analytics.

---

## Importante (primeiras semanas de operação)

### 6. Observabilidade — quase zero
- Só Pino + `GET /api/health`. Sem Sentry, sem métricas, sem uptime monitor
  externo, sem alertas.
- `disableRequestLogging: true` em prod (`server/src/app.ts:53`) = zero log de
  requisição para investigar incidente.
- **Fazer:** error tracking (Sentry), monitor externo batendo em `/api/health`
  com alerta, e reavaliar o request logging em prod.

### 7. ETL da Receita 100% manual
- `atualizar.sh`, `atualizar_cnpj.py` e `geocodificar_cnefe.py` rodam na mão.
  Nenhum cron/timer no repo.
- A base atualizada É o produto; a Receita atualiza mensalmente. Hoje depende
  de alguém lembrar.
- **Fazer:** cron/systemd timer com alerta de falha.

### 8. Onboarding inexistente
- Registro público existe (`client/src/pages/Login.tsx`, toggle
  login/registro), mas depois do cadastro o usuário cai no Dashboard vazio sem
  guia.
- **Fazer:** wizard de primeiro uso — definir CNAE-alvo + território → primeira
  recomendação (o "aha" do trial). Sem isso, trial não converte.

### 9. Sem quotas por tenant
- Nenhum limite de assentos, usuários, empresas, storage de mídia.
- Rate-limit só por IP e só em auth/webhook. A query de recomendação é pesada
  (`work_mem` elevado) — um tenant pode monopolizar o pool.
- Quando plugar os planos, quota vira pré-requisito de qualquer forma.
- **Fazer:** limites por org (seats, volume) + rate-limit por org nas rotas
  pesadas.

### 10. Healthcheck do `app` em prod
- `db` tem healthcheck, `app` não (`docker-compose.prod.yml`). App
  travado-mas-vivo nunca reinicia; `restart: unless-stopped` só reage a crash.
- **Fazer:** `healthcheck:` no serviço `app` reusando `/api/health`.

### 11. Sessões fracas para SaaS pago
- JWT único de 7 dias, sem refresh token, sem logout/revogação de sessão
  individual (só troca de senha derruba tudo via `token_version`).
- Token em `localStorage` (`client/src/lib/api.ts:5`) — item deferido da
  auditoria de segurança de 2026-07-03, exploitável via XSS.
- **Fazer:** access token curto + refresh token httpOnly, endpoint de logout,
  lista de sessões.

---

## Pode esperar (documentar e seguir)

| Item | Situação | Referência |
|---|---|---|
| RLS Postgres (2ª camada de isolamento) | Tudo app-level; query sem `org_id` vaza tenant. Backlog diz "quando >5 orgs pagantes" | `docs/PLANEJAMENTO.md:349` |
| Limites de recurso nos containers | Sem `mem_limit`/`cpus`; pico pode OOM-killar o Postgres | `docker-compose.prod.yml` |
| Zero-downtime deploy | Cada deploy derruba a instância única; aceitável no começo, documentar janela | `deploy.sh:38` |
| Schedulers in-process | `setInterval` sem leader-election; quebra com 2+ instâncias. Sem retry/backoff (falha = `status='erro'` e fim) | `server/src/index.ts:16` |
| Backup — não existe backup automático | O container `backup` foi removido. Nada é dumpado sozinho: nem o `rs`, nem as sessões do WhatsApp (`evolution_pgdata`), nem a mídia (`wa_media`). README traz um `pg_dump` por crontab manual do `rs` como alternativa. **Definir estratégia de backup (dump + offsite + teste de restore) antes do go-live.** | `README.md`, `deploy.sh` |
| Analytics/telemetria | Zero no app e na landing. Plausible/GA4 + eventos de conversão (CTA, trial, escolha de plano) | `Marketing/LANCAMENTO.md:34` |
| Página 404 real | Hoje redireciona silenciosamente para o Dashboard | `client/src/App.tsx:456` |
| Ícones PWA raster/maskable | Só `icon.svg`; iOS home-screen quebra | `client/vite.config.ts:30` |
| UX de sessão expirada | 401 = hard-redirect abrupto para `/login`, sem aviso | `client/src/lib/api.ts:39` |
| README desatualizado | Ainda diz que WhatsApp é fase 2 (já implementado) | `README.md:8` |
| Firewall na VPS | Nenhuma config/doc (ufw/security group) no repo | — |

---

## O que já está sólido (não mexer)

- Migrations idempotentes com advisory lock, transação por arquivo e checksum,
  rodando no boot (`server/scripts/migrate-lib.ts`).
- Segredos fora do git, com validação no boot (`server/src/config.ts:18`) e no
  deploy (`deploy.sh:23`).
- Auth: scrypt timing-safe com anti-enumeração, `token_version`, WS e mídia
  autenticados com `authorizeToken` (item deferido da auditoria já resolvido).
- RBAC fino por grupos de permissão (server + client), ~217 testes.
- Headers de segurança: helmet, CSP, HSTS; `statement_timeout` no pool;
  rate-limit no auth; Postgres não exposto.
- Estados vazios consistentes em todas as telas (`client/src/lib/ui.tsx:121`);
  error boundary global; PWA com fila offline para agenda de campo
  (`client/src/lib/offline.ts`).

---

## Ordem sugerida de ataque

1. Marca única (Certumn vs Certum vs Vértice)
2. TLS/proxy reverso + domínio
3. E-mail transacional de plataforma (verificação, reset, convite)
4. Páginas legais + exclusão de conta (LGPD)
5. Landing com CTA real, sem CDN
6. Wizard de onboarding (CNAE-alvo + território → 1ª recomendação)
7. Sentry + uptime monitor + healthcheck do app
8. Cron do ETL da Receita com alerta

Isso, junto com **planos + gateway de pagamento** (mapeados à parte), fecha o
mínimo vendável.
