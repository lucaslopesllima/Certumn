import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { sep } from 'node:path';
import { config } from './config.ts';
import { buildApp } from './app.ts';
import { materializeRecurrences } from './recurrence.ts';
import { processDueEmails } from './email.ts';
import { processDueWhatsapp } from './whatsappScheduler.ts';
import { seedAllOrgs } from './seedGroups.ts';

const app = await buildApp();

// RBAC: garante os grupos padrão em toda org e filia usuários ainda sem grupo
// (admin → Administrador, demais → Vendedor). Idempotente; roda no boot, depois
// das migrações. Falha aqui não derruba o servidor — só registra.
seedAllOrgs().then(
  () => app.log.info('grupos de permissão semeados'),
  (e) => app.log.error({ err: e }, 'falha ao semear grupos de permissão'),
);

// Materializa lançamentos financeiros recorrentes decorridos (Fase 6.1). Roda
// no boot; idempotente, então deploys repetidos não duplicam. Falha aqui não
// derruba o servidor — só registra.
materializeRecurrences().then(
  (n) => { if (n > 0) app.log.info(`recorrências financeiras: ${n} lançamento(s) materializado(s)`); },
  (e) => app.log.error({ err: e }, 'falha ao materializar recorrências'),
);

// Processador de e-mails agendados (scaffold, envio stub). Varre os pendentes
// vencidos no boot e a cada minuto. Idempotente (UPDATE condiciona em pendente);
// falha não derruba o servidor. unref() para não segurar o processo no exit.
const runDueEmails = (): void => {
  processDueEmails().then(
    (n) => { if (n > 0) app.log.info(`e-mails agendados: ${n} processado(s)`); },
    (e) => app.log.error({ err: e }, 'falha ao processar e-mails agendados'),
  );
};
runDueEmails();
setInterval(runDueEmails, 60_000).unref();

// Processador de mensagens WhatsApp agendadas (Fase 2). Mesmo padrão dos e-mails.
const runDueWhatsapp = (): void => {
  processDueWhatsapp().then(
    (n) => { if (n > 0) app.log.info(`whatsapp agendados: ${n} enviado(s)`); },
    (e) => app.log.error({ err: e }, 'falha ao processar whatsapp agendados'),
  );
};
runDueWhatsapp();
setInterval(runDueWhatsapp, 60_000).unref();

// Serve the built React app (Dockerfile sets CLIENT_DIR). SPA fallback for client routes.
if (config.clientDir && existsSync(config.clientDir)) {
  await app.register(fastifyStatic, {
    root: config.clientDir,
    wildcard: false,
    // preCompressed serve os .br/.gz gerados no build do client, se existirem.
    preCompressed: true,
    // Cache-control por arquivo via setHeaders (cacheControl:false evita que o
    // header global do plugin sobreponha): assets com hash no nome (/assets/*)
    // podem ser cacheados "para sempre" (1 ano, immutable); o resto (index.html,
    // favicon…) precisa revalidar a cada deploy — index.html NUNCA em cache longo.
    cacheControl: false,
    setHeaders: (res, filePath) => {
      if (filePath.includes(`${sep}assets${sep}`)) {
        res.setHeader('cache-control', 'public, max-age=31536000, immutable');
      } else {
        res.setHeader('cache-control', 'no-cache');
      }
    },
  });
  app.setNotFoundHandler((req, reply) => {
    if (req.raw.url && req.raw.url.startsWith('/api')) {
      return reply.code(404).send({ error: 'not found' });
    }
    // SPA fallback: sempre revalidar — um index.html velho apontaria pra assets
    // que já não existem após um deploy.
    return reply.header('cache-control', 'no-cache').sendFile('index.html');
  });
}

const start = async (): Promise<void> => {
  try {
    await app.listen({ port: config.port, host: config.host });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
};

void start();
