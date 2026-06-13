import type { FastifyInstance } from 'fastify';
import { one, query } from '../db.ts';
import { requireAuth, hashPassword, verifyPassword, signToken } from '../auth.ts';
import { geocodeAddr } from '../geocode.ts';

const ADDR_FIELDS = ['cep', 'logradouro', 'numero', 'complemento', 'bairro', 'cidade', 'uf'];

const ORG_COLS = 'id, nome, cnpj, telefone, cep, logradouro, numero, complemento, bairro, cidade, uf, inatividade_dias';
const ORG_FIELDS = ['nome', 'cnpj', 'telefone', 'cep', 'logradouro', 'numero', 'complemento', 'bairro', 'cidade', 'uf'] as const;

// Perfil do representante: dados da org (endereço/cnpj/telefone) + usuário (email) + senha.
export function accountRoutes(app: FastifyInstance): void {
  app.get('/api/account', { preHandler: requireAuth }, async (req) => {
    const orgId = req.auth!.orgId;
    const userId = req.auth!.userId;
    const org = await one(`SELECT ${ORG_COLS} FROM organizations WHERE id = $1`, [orgId]);
    const user = await one('SELECT id, email, role FROM users WHERE id = $1', [userId]);
    return { org, user };
  });

  app.patch('/api/account', {
    preHandler: requireAuth,
    schema: {
      body: {
        type: 'object',
        properties: {
          nome: { type: 'string', minLength: 1 },
          cnpj: { type: ['string', 'null'] },
          telefone: { type: ['string', 'null'] },
          cep: { type: ['string', 'null'] },
          logradouro: { type: ['string', 'null'] },
          numero: { type: ['string', 'null'] },
          complemento: { type: ['string', 'null'] },
          bairro: { type: ['string', 'null'] },
          cidade: { type: ['string', 'null'] },
          uf: { type: ['string', 'null'] },
          email: { type: 'string', minLength: 3 },
          inatividade_dias: { type: 'integer', minimum: 1, maximum: 365 },
        },
      },
    },
  }, async (req, reply) => {
    const orgId = req.auth!.orgId;
    const userId = req.auth!.userId;
    const b = req.body as Record<string, unknown>;

    // Config de alertas é política da org: só admin altera.
    if (b.inatividade_dias !== undefined) {
      if (req.auth!.role !== 'admin') return reply.code(403).send({ error: 'apenas administradores' });
      await query('UPDATE organizations SET inatividade_dias = $1 WHERE id = $2', [b.inatividade_dias, orgId]);
    }

    // email (login) — único
    if (typeof b.email === 'string') {
      const email = b.email.trim().toLowerCase();
      const dup = await one('SELECT id FROM users WHERE email = $1 AND id <> $2', [email, userId]);
      if (dup) return reply.code(409).send({ error: 'email já cadastrado' });
      await query('UPDATE users SET email = $1 WHERE id = $2', [email, userId]);
    }

    const sets: string[] = [];
    const params: unknown[] = [];
    for (const k of ORG_FIELDS) {
      if (k in b) { params.push(b[k]); sets.push(`${k} = $${params.length}`); }
    }
    if (sets.length > 0) {
      params.push(orgId);
      await query(`UPDATE organizations SET ${sets.join(', ')} WHERE id = $${params.length}`, params);
    }
    // endereço mudou -> invalida o geocode da origem (será refeito sob demanda)
    if (ADDR_FIELDS.some((k) => k in b)) {
      await query('UPDATE organizations SET origem_lat = NULL, origem_lon = NULL WHERE id = $1', [orgId]);
    }

    const org = await one(`SELECT ${ORG_COLS} FROM organizations WHERE id = $1`, [orgId]);
    const user = await one('SELECT id, email, role FROM users WHERE id = $1', [userId]);
    return { org, user };
  });

  // Origem das rotas = endereço da org (representante logado), geocodificado + cacheado.
  app.get('/api/account/origem', { preHandler: requireAuth }, async (req) => {
    const orgId = req.auth!.orgId;
    const org = await one<{
      logradouro: string | null; numero: string | null; bairro: string | null;
      cep: string | null; cidade: string | null; uf: string | null;
      origem_lat: number | null; origem_lon: number | null;
    }>(
      `SELECT logradouro, numero, bairro, cep, cidade, uf, origem_lat, origem_lon
       FROM organizations WHERE id = $1`, [orgId],
    );
    if (!org) return { origem: null };
    if (org.origem_lat != null && org.origem_lon != null) {
      return { origem: { lat: org.origem_lat, lon: org.origem_lon, cached: true } };
    }
    if (!org.logradouro && !org.cep && !org.cidade) return { origem: null }; // sem endereço cadastrado
    const g = await geocodeAddr(org);
    if (!g) return { origem: null };
    await query('UPDATE organizations SET origem_lat = $1, origem_lon = $2 WHERE id = $3', [g.lat, g.lon, orgId]);
    return { origem: { lat: g.lat, lon: g.lon, precisao: g.precisao, cached: false } };
  });

  app.post('/api/account/password', {
    preHandler: requireAuth,
    schema: {
      body: {
        type: 'object',
        required: ['senha_atual', 'nova_senha'],
        properties: {
          senha_atual: { type: 'string', minLength: 1 },
          nova_senha: { type: 'string', minLength: 6 },
        },
      },
    },
  }, async (req, reply) => {
    const userId = req.auth!.userId;
    const { senha_atual, nova_senha } = req.body as { senha_atual: string; nova_senha: string };
    const u = await one<{ senha_hash: string }>('SELECT senha_hash FROM users WHERE id = $1', [userId]);
    if (!u || !(await verifyPassword(senha_atual, u.senha_hash))) {
      return reply.code(400).send({ error: 'senha atual incorreta' });
    }
    // troca de senha também encerra o ciclo da senha provisória do primeiro login.
    // token_version++ derruba todos os tokens já emitidos (inclusive o desta
    // requisição) — por isso devolvemos um token novo para a sessão atual.
    const upd = await one<{ token_version: number }>(
      `UPDATE users SET senha_hash = $1, must_change_password = false, token_version = token_version + 1
       WHERE id = $2 RETURNING token_version`,
      [await hashPassword(nova_senha), userId],
    );
    const token = await signToken({
      userId, orgId: req.auth!.orgId, role: req.auth!.role, tokenVersion: upd!.token_version,
    });
    return { ok: true, token };
  });
}
