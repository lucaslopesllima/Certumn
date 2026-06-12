import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { config } from './config.ts';
import { pool } from './db.ts';
import { authRoutes } from './routes/auth.ts';
import { profileRoutes } from './routes/profile.ts';
import { recommendRoutes } from './routes/recommend.ts';
import { cnaeRoutes } from './routes/cnae.ts';
import { relationshipRoutes } from './routes/relationships.ts';
import { stageRoutes } from './routes/stages.ts';
import { activityRoutes } from './routes/activities.ts';
import { representedRoutes } from './routes/represented.ts';
import { cadastroRoutes } from './routes/cadastros.ts';
import { companyRoutes } from './routes/companies.ts';
import { catalogRoutes } from './routes/catalog.ts';
import { accountRoutes } from './routes/account.ts';
import { financeRoutes } from './routes/finance.ts';
import { vehicleRoutes } from './routes/vehicles.ts';
import { routePlanRoutes } from './routes/routes.ts';

const app = Fastify({ logger: true, trustProxy: true });

app.get('/api/health', async () => {
  await pool.query('SELECT 1');
  return { ok: true };
});

authRoutes(app);
profileRoutes(app);
recommendRoutes(app);
cnaeRoutes(app);
relationshipRoutes(app);
stageRoutes(app);
activityRoutes(app);
representedRoutes(app);
cadastroRoutes(app);
companyRoutes(app);
catalogRoutes(app);
accountRoutes(app);
financeRoutes(app);
vehicleRoutes(app);
routePlanRoutes(app);

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
