import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { config } from './config.ts';
import { buildApp } from './app.ts';
import { materializeRecurrences } from './recurrence.ts';

const app = await buildApp();

// Materializa lançamentos financeiros recorrentes decorridos (Fase 6.1). Roda
// no boot; idempotente, então deploys repetidos não duplicam. Falha aqui não
// derruba o servidor — só registra.
materializeRecurrences().then(
  (n) => { if (n > 0) app.log.info(`recorrências financeiras: ${n} lançamento(s) materializado(s)`); },
  (e) => app.log.error({ err: e }, 'falha ao materializar recorrências'),
);

// Serve the built React app (Dockerfile sets CLIENT_DIR). SPA fallback for client routes.
if (config.clientDir && existsSync(config.clientDir)) {
  await app.register(fastifyStatic, { root: config.clientDir, wildcard: false });
  app.setNotFoundHandler((req, reply) => {
    if (req.raw.url && req.raw.url.startsWith('/api')) {
      return reply.code(404).send({ error: 'not found' });
    }
    return reply.sendFile('index.html');
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
