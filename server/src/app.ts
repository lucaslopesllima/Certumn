import Fastify, { type FastifyInstance } from 'fastify';
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
import { userRoutes } from './routes/users.ts';
import { auditRoutes } from './routes/audit.ts';

// Monta a app com todas as rotas de API, sem listen e sem estáticos —
// index.ts (produção) adiciona o resto; os testes usam app.inject().
export function buildApp(opts: { logger?: boolean } = {}): FastifyInstance {
  const app = Fastify({ logger: opts.logger ?? true, trustProxy: true });

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
  userRoutes(app);
  auditRoutes(app);

  return app;
}
