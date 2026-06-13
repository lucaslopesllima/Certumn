import Fastify, { type FastifyInstance } from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { pool } from './db.ts';
import { config } from './config.ts';
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
import { priceTableRoutes } from './routes/priceTables.ts';
import { orderRoutes } from './routes/orders.ts';
import { carrierRoutes } from './routes/carriers.ts';
import { commissionRoutes } from './routes/commissions.ts';

// Monta a app com todas as rotas de API, sem listen e sem estáticos —
// index.ts (produção) adiciona o resto; os testes usam app.inject().
// Async porque o plugin de rate limit precisa estar registrado ANTES das rotas
// que o referenciam via config.rateLimit.
export async function buildApp(opts: { logger?: boolean; authRateLimitMax?: number } = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: opts.logger ?? true, trustProxy: true });

  // global:false — só as rotas que declaram config.rateLimit (autenticação) limitam.
  await app.register(rateLimit, { global: false });
  app.decorate('authRateLimitMax', opts.authRateLimitMax ?? config.authRateLimitMax);

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
  priceTableRoutes(app);
  orderRoutes(app);
  carrierRoutes(app);
  commissionRoutes(app);

  return app;
}

declare module 'fastify' {
  interface FastifyInstance {
    authRateLimitMax: number;
  }
}
