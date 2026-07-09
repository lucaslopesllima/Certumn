import { scrypt, randomBytes, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { SignJWT, jwtVerify } from 'jose';
import { config } from './config.ts';
import { one } from './db.ts';
import type { FastifyReply, FastifyRequest } from 'fastify';

const scryptAsync = promisify(scrypt);
const SCRYPT_KEYLEN = 64;
const secret = new TextEncoder().encode(config.jwtSecret);

export async function hashPassword(plain: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = (await scryptAsync(plain, salt, SCRYPT_KEYLEN)) as Buffer;
  return `${salt.toString('hex')}:${derived.toString('hex')}`;
}

export async function verifyPassword(plain: string, stored: string): Promise<boolean> {
  const [saltHex, hashHex] = stored.split(':');
  if (!saltHex || !hashHex) return false;
  const salt = Buffer.from(saltHex, 'hex');
  const expected = Buffer.from(hashHex, 'hex');
  const derived = (await scryptAsync(plain, salt, SCRYPT_KEYLEN)) as Buffer;
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}

// Hash de senha inexistente: quando o e-mail não está cadastrado, o login roda
// scrypt contra este hash para igualar o tempo de resposta — sem isso dá para
// enumerar e-mails válidos medindo a latência.
const dummyHashPromise = hashPassword(randomBytes(32).toString('hex'));
export async function verifyAgainstDummy(plain: string): Promise<void> {
  await verifyPassword(plain, await dummyHashPromise);
}

export interface AuthClaims {
  userId: number;
  orgId: number;
  role: string;
  // versão de sessão: incrementada na troca/reset de senha, invalida tokens antigos.
  tokenVersion: number;
  // RBAC fino: carregados do grupo do usuário a cada request (não vão no JWT,
  // mudam em runtime). isAdmin = bypass total. Preenchidos por requireAuth.
  permissions: Set<string>;
  isAdmin: boolean;
}

// Só os campos que vão (e voltam) no JWT — permissions/isAdmin são carregados
// do banco em requireAuth, não trafegam no token.
export type TokenClaims = Pick<AuthClaims, 'userId' | 'orgId' | 'role' | 'tokenVersion'>;

export async function signToken(claims: TokenClaims): Promise<string> {
  return new SignJWT({ org: claims.orgId, role: claims.role, ver: claims.tokenVersion })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(String(claims.userId))
    .setIssuedAt()
    .setExpirationTime(`${config.jwtTtlSeconds}s`)
    .sign(secret);
}

export async function verifyToken(token: string): Promise<TokenClaims> {
  const { payload } = await jwtVerify(token, secret, { algorithms: ['HS256'] });
  return {
    userId: Number(payload.sub),
    orgId: Number(payload.org),
    role: String(payload.role),
    tokenVersion: Number(payload.ver ?? 0),
  };
}

// Erro de autorização (usuário desativado, sessão expirada, sem permissão) — o
// token pode ser válido criptograficamente mas não autoriza. Separado dos erros do
// jose (assinatura/expiração) para o caller mapear o status HTTP.
export class AuthError extends Error {}

// Autoriza um token e devolve as claims completas (permissões carregadas do banco).
// Usado tanto pelo preHandler requireAuth quanto por fluxos onde o token não vem no
// header Authorization (WebSocket do browser, URL de mídia com ?token=) — que ANTES
// só faziam verifyToken e por isso ignoravam ativo/token_version/permissão. Lança:
// erro do jose (token inválido/expirado) ou AuthError (desativado/sessão/permissão).
export async function authorizeToken(token: string, requiredPerm?: string): Promise<AuthClaims> {
  const claims = await verifyToken(token); // lança se assinatura/expiração inválidas
  // Mesma ida ao banco que valida ativo/token_version já traz o grupo do usuário
  // (LEFT JOIN, sem N+1). group_id NULL → sem permissões (admin ainda passa via role).
  const u = await one<{
    ativo: boolean; token_version: number; is_admin: boolean | null; permissions: string[] | null;
  }>(
    `SELECT u.ativo, u.token_version, g.is_admin, g.permissions
       FROM users u LEFT JOIN permission_groups g ON g.id = u.group_id
      WHERE u.id = $1`,
    [claims.userId],
  );
  if (!u || !u.ativo) throw new AuthError('usuário desativado');
  // Token de versão antiga (senha trocada/resetada depois da emissão) não vale mais.
  if (u.token_version !== claims.tokenVersion) throw new AuthError('sessão expirada');
  const isAdmin = claims.role === 'admin' || u.is_admin === true;
  const permissions = new Set(u.permissions ?? []);
  if (requiredPerm && !isAdmin && !permissions.has(requiredPerm)) throw new AuthError('sem permissão');
  return { ...claims, permissions, isAdmin };
}

// Fastify preHandler: require a valid Bearer token, attach claims to request.auth.
// Também derruba usuário desativado na hora — sem isso o JWT (TTL 7d) seguiria
// válido muito depois do admin desligar o vendedor.
export async function requireAuth(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return reply.code(401).send({ error: 'missing token' });
  }
  try {
    req.auth = await authorizeToken(header.slice(7));
  } catch (e) {
    return reply.code(401).send({ error: e instanceof AuthError ? e.message : 'invalid token' });
  }
}

// preHandler complementar (depois de requireAuth): só admin passa.
export async function requireAdmin(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!req.auth?.isAdmin) {
    return reply.code(403).send({ error: 'apenas administradores' });
  }
}

// Factory de preHandler: exige um código de permissão. Admin (is_admin/role)
// faz bypass. Empilhar depois de requireAuth: preHandler: [requireAuth, requirePermission('orders.create')].
export function requirePermission(code: string) {
  return async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (req.auth?.isAdmin) return;
    if (!req.auth?.permissions.has(code)) {
      return reply.code(403).send({ error: 'sem permissão' });
    }
  };
}

declare module 'fastify' {
  interface FastifyRequest {
    auth?: AuthClaims;
  }
}
