// Central config from env. No secrets hardcoded.

// work_mem é interpolado em SET LOCAL (não há bind param para SET) — valida o
// formato no boot para que nenhum valor fora de "NNNkB/MB/GB" chegue ao SQL.
export const workMem = (raw: string): string => {
  if (!/^\d+(?:kB|MB|GB)$/.test(raw)) {
    throw new Error(`RECOMMEND_WORK_MEM inválido: "${raw}" (esperado ex.: 64MB)`);
  }
  return raw;
};

export const INSECURE_JWT_DEFAULT = 'dev-insecure-secret-change-me';

// Em produção (Dockerfile seta NODE_ENV=production) abortar o boot se o
// JWT_SECRET estiver ausente ou no default inseguro. Esse segredo assina os JWT
// (auth.ts) E deriva a chave AES das senhas SMTP (crypto.ts) — cair no default
// permitiria forjar token de admin de qualquer org e decifrar credenciais.
export const requireSecret = (secret: string, nodeEnv: string | undefined): string => {
  if (nodeEnv === 'production' && secret === INSECURE_JWT_DEFAULT) {
    throw new Error('JWT_SECRET ausente ou inseguro em produção — defina um segredo forte antes do boot');
  }
  return secret;
};
const jwtSecretEnv = requireSecret(process.env.JWT_SECRET ?? INSECURE_JWT_DEFAULT, process.env.NODE_ENV);

export const config = {
  port: Number(process.env.PORT ?? 8080),
  host: process.env.HOST ?? '0.0.0.0',
  databaseUrl: process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/rs',
  jwtSecret: jwtSecretEnv,
  jwtTtlSeconds: Number(process.env.JWT_TTL_SECONDS ?? 60 * 60 * 24 * 7),
  // path to the built client (Dockerfile copies it here); empty disables static serving in dev.
  clientDir: process.env.CLIENT_DIR ?? '',
  // raised per-session for the recommendation query (large in-memory sort).
  recommendWorkMem: workMem(process.env.RECOMMEND_WORK_MEM ?? '64MB'),
  // rate limit dos endpoints de autenticação (por IP). Generoso o bastante para
  // uso real, apertado o bastante para inviabilizar brute force.
  authRateLimitMax: Number(process.env.AUTH_RATE_LIMIT_MAX ?? 10),
  authRateLimitWindow: process.env.AUTH_RATE_LIMIT_WINDOW ?? '1 minute',
};
