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

export interface AuthClaims {
  userId: number;
  orgId: number;
  role: string;
}

export async function signToken(claims: AuthClaims): Promise<string> {
  return new SignJWT({ org: claims.orgId, role: claims.role })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(String(claims.userId))
    .setIssuedAt()
    .setExpirationTime(`${config.jwtTtlSeconds}s`)
    .sign(secret);
}

export async function verifyToken(token: string): Promise<AuthClaims> {
  const { payload } = await jwtVerify(token, secret, { algorithms: ['HS256'] });
  return { userId: Number(payload.sub), orgId: Number(payload.org), role: String(payload.role) };
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
    req.auth = await verifyToken(header.slice(7));
  } catch {
    return reply.code(401).send({ error: 'invalid token' });
  }
  const u = await one<{ ativo: boolean }>('SELECT ativo FROM users WHERE id = $1', [req.auth.userId]);
  if (!u || !u.ativo) {
    req.auth = undefined;
    return reply.code(401).send({ error: 'usuário desativado' });
  }
}

// preHandler complementar (depois de requireAuth): só admin passa.
export async function requireAdmin(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (req.auth?.role !== 'admin') {
    return reply.code(403).send({ error: 'apenas administradores' });
  }
}

declare module 'fastify' {
  interface FastifyRequest {
    auth?: AuthClaims;
  }
}
