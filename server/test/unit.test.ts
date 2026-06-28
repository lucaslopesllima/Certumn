// Unidades puras + módulos de apoio: fuel, recommend SQL builder, auth helpers,
// audit (incl. falha de insert), orgRefs e validação de config.
import { describe, it, expect, vi, afterAll } from 'vitest';
import { SignJWT } from 'jose';
import type { FastifyRequest } from 'fastify';
import { fuelEstimate } from '../src/fuel.ts';
import { buildRecommendQuery, type RecommendArgs } from '../src/sql/recommend.ts';
import {
  hashPassword, verifyPassword, verifyAgainstDummy, signToken, verifyToken,
} from '../src/auth.ts';
import { audit, pick } from '../src/audit.ts';
import { invalidOrgRef } from '../src/orgRefs.ts';
import { workMem, config, requireSecret, INSECURE_JWT_DEFAULT } from '../src/config.ts';
import { pool, query, one, withClient } from '../src/db.ts';
import { mail } from './helpers.ts';

afterAll(async () => { await pool.end(); });

describe('fuelEstimate', () => {
  it('calcula litros e custo', () => {
    expect(fuelEstimate({ distKm: 100, consumoKml: 10, precoLitro: 6 })).toEqual({ litros: 10, custo: 60 });
  });
  it('sem preço -> custo null', () => {
    expect(fuelEstimate({ distKm: 100, consumoKml: 10 })).toEqual({ litros: 10, custo: null });
  });
  it('preço <= 0 -> custo null', () => {
    expect(fuelEstimate({ distKm: 100, consumoKml: 10, precoLitro: 0 })?.custo).toBeNull();
  });
  it('sem consumo / consumo inválido / distância inválida -> null', () => {
    expect(fuelEstimate({ distKm: 100 })).toBeNull();
    expect(fuelEstimate({ distKm: 100, consumoKml: 0 })).toBeNull();
    expect(fuelEstimate({ distKm: NaN, consumoKml: 10 })).toBeNull();
  });
});

describe('buildRecommendQuery', () => {
  const base: RecommendArgs = {
    orgId: 1,
    profile: { cnaes_alvo: [4781400], territorio_municipios: [3550308], pesos: {} },
    limit: 20, offset: 0,
    divisoesAlvo: [47], secoesAlvo: ['G'], pruneDivisoes: [45, 46, 47],
  };

  it('modo município usa = ANY e pesos default', () => {
    const { text, params } = buildRecommendQuery(base);
    expect(text).toContain('c.municipio_id = ANY($2::int[])');
    expect(params[4]).toBe(0.5);  // wCnae default
    expect(params[3]).toBe(150_000); // norm default
  });

  it('a poda por divisões dos CNAEs-alvo entra como parâmetro (e não deixa $ órfão)', () => {
    const { text, params } = buildRecommendQuery(base);
    expect(text).toContain('c.cnae_divisao = ANY($15::smallint[])'); // $13/$14 = partida lat/lon
    expect(params[14]).toEqual(base.pruneDivisoes);
    // todo parâmetro precisa estar referenciado no SQL (42P18 se sobrar)
    for (let i = 1; i <= params.length; i++) expect(text).toContain(`$${i}`);
  });

  it('sem partida -> $13/$14 nulos e proximidade pelo centro do território', () => {
    const { params } = buildRecommendQuery(base);
    expect(params[12]).toBeNull();
    expect(params[13]).toBeNull();
  });

  it('partida define a origem da proximidade (lat/lon em $13/$14)', () => {
    const { text, params } = buildRecommendQuery({
      ...base,
      profile: { ...base.profile, partida: { lat: -26.9, lon: -49.1 } },
    });
    expect(params[12]).toBe(-26.9);
    expect(params[13]).toBe(-49.1);
    expect(text).toContain('ST_Distance(pt.g, origem.g, false)');
  });

  it('filtros uf/porte/q com dígitos geram predicados extras (incl. cnpj LIKE)', () => {
    const { text, params } = buildRecommendQuery({
      ...base, filters: { uf: ['SP', 'MG'], porte: 'pequeno', q: 'padaria 12' },
    });
    expect(text).toContain('c.uf = ANY(');
    expect(text).toContain('::porte_emp');
    expect(text).toContain('c.cnpj LIKE');
    expect(params).toContain('%padaria 12%');
    expect(params).toContain('12%');
  });

  it('q sem dígitos não usa LIKE de cnpj', () => {
    const { text } = buildRecommendQuery({ ...base, filters: { q: 'padaria' } });
    expect(text).not.toContain('c.cnpj LIKE');
    expect(text).toContain('razao_social ILIKE');
  });

  it('cnaes_alvo ausente vira array vazio', () => {
    const { params } = buildRecommendQuery({
      ...base,
      profile: { ...base.profile, cnaes_alvo: undefined as unknown as number[], territorio_municipios: undefined as unknown as number[] },
    });
    expect(params[0]).toEqual([]);
    expect(params[1]).toEqual([]);
  });
});

describe('auth helpers', () => {
  it('hash/verify roundtrip + senha errada + hash malformado', async () => {
    const h = await hashPassword('segredo1');
    expect(await verifyPassword('segredo1', h)).toBe(true);
    expect(await verifyPassword('errada', h)).toBe(false);
    expect(await verifyPassword('x', 'sem-formato')).toBe(false);
  });

  it('signToken/verifyToken carregam claims + token_version', async () => {
    const t = await signToken({ userId: 7, orgId: 3, role: 'rep', tokenVersion: 2 });
    expect(await verifyToken(t)).toEqual({ userId: 7, orgId: 3, role: 'rep', tokenVersion: 2 });
  });

  it('token sem claim ver assume versão 0 (tokens antigos)', async () => {
    const secret = new TextEncoder().encode(config.jwtSecret);
    const legacy = await new SignJWT({ org: 1, role: 'admin' })
      .setProtectedHeader({ alg: 'HS256' }).setSubject('1').setExpirationTime('60s').sign(secret);
    expect((await verifyToken(legacy)).tokenVersion).toBe(0);
  });

  it('verifyAgainstDummy roda sem lançar (custo constante p/ email inexistente)', async () => {
    await expect(verifyAgainstDummy('qualquer')).resolves.toBeUndefined();
  });
});

describe('audit', () => {
  const fakeReq = (orgId: number | null): FastifyRequest => ({
    auth: orgId == null ? undefined : { userId: 1, orgId, role: 'admin', tokenVersion: 0 },
    log: { error: vi.fn() },
  } as unknown as FastifyRequest);

  it('pick recorta só as chaves da allow-list', () => {
    expect(pick({ a: 1, b: 2, senha: 'x' }, ['a', 'c'])).toEqual({ a: 1 });
  });

  it('sem auth não grava nada', async () => {
    await expect(audit(fakeReq(null), 'x', 1, 'create')).resolves.toBeUndefined();
  });

  it('falha de insert não derruba a requisição (org inexistente)', async () => {
    const req = fakeReq(999_999_999);
    await audit(req, 'x', 1, 'create', { a: 1 });
    expect((req.log.error as ReturnType<typeof vi.fn>)).toHaveBeenCalled();
  });
});

describe('invalidOrgRef', () => {
  it('valida posse por org e ignora null/ausente', async () => {
    const org = await one<{ id: number }>(
      "INSERT INTO organizations (nome) VALUES ('Org Refs') RETURNING id");
    const user = await one<{ id: number }>(
      `INSERT INTO users (org_id, email, senha_hash, role) VALUES ($1,$2,'h','rep') RETURNING id`,
      [org!.id, mail('refs')]);

    expect(await invalidOrgRef(org!.id, { owner_user_id: user!.id }, ['owner_user_id'])).toBeNull();
    expect(await invalidOrgRef(org!.id, { owner_user_id: null, represented_id: undefined },
      ['owner_user_id', 'represented_id'])).toBeNull();
    expect(await invalidOrgRef(org!.id + 1, { owner_user_id: user!.id }, ['owner_user_id']))
      .toBe('owner_user_id');
  });
});

describe('config', () => {
  it('workMem aceita formato NNNkB/MB/GB e rejeita o resto', () => {
    expect(workMem('64MB')).toBe('64MB');
    expect(workMem('512kB')).toBe('512kB');
    expect(workMem('2GB')).toBe('2GB');
    expect(() => workMem('64 MB')).toThrow(/inválido/);
    expect(() => workMem("64MB'; DROP TABLE x; --")).toThrow(/inválido/);
  });

  it('config exporta defaults coerentes', () => {
    expect(config.recommendWorkMem).toMatch(/^\d+(?:kB|MB|GB)$/);
    expect(config.authRateLimitMax).toBeGreaterThan(0);
  });

  it('requireSecret aborta em produção com o default inseguro', () => {
    expect(() => requireSecret(INSECURE_JWT_DEFAULT, 'production')).toThrow(/inseguro em produção/);
    // segredo forte em produção passa; default fora de produção também (dev/test).
    expect(requireSecret('um-segredo-forte', 'production')).toBe('um-segredo-forte');
    expect(requireSecret(INSECURE_JWT_DEFAULT, 'development')).toBe(INSECURE_JWT_DEFAULT);
    expect(requireSecret(INSECURE_JWT_DEFAULT, undefined)).toBe(INSECURE_JWT_DEFAULT);
  });
});

describe('db', () => {
  it('one devolve null sem linhas; withClient repassa o resultado', async () => {
    expect(await one('SELECT 1 AS x WHERE false')).toBeNull();
    const rows = await query<{ x: number }>('SELECT 41 + 1 AS x');
    expect(rows[0]!.x).toBe(42);
    expect(await withClient(async (c) => (await c.query('SELECT 7 AS x')).rows[0].x)).toBe(7);
  });
});
