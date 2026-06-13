// Transportadoras: CRUD org-scoped com soft delete + vínculo carrier_id no
// pedido (validação de FK por org, rótulo no SELECT, label sobrevive ao delete).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { makeApp, register, bearer, makeCompany, closeAll, type Session } from './helpers.ts';

let app: FastifyInstance;
let a: Session;
let b: Session;

const inj = (s: Session, method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: unknown):
  ReturnType<FastifyInstance['inject']> =>
  app.inject({ method, url, headers: bearer(s.token), payload });

beforeAll(async () => {
  app = await makeApp();
  a = await register(app, 'carriers.a');
  b = await register(app, 'carriers.b');
});
afterAll(async () => { await closeAll(app); });

interface Carrier { id: number; nome: string; ativo: boolean; cnpj: string | null }

const mkCarrier = async (s: Session, extra: Record<string, unknown> = {}): Promise<Carrier> => {
  const r = await inj(s, 'POST', '/api/carriers', { nome: 'Transportes Rápido', ...extra });
  expect(r.statusCode).toBe(201);
  return (r.json() as { carrier: Carrier }).carrier;
};

describe('carriers: CRUD + isolamento', () => {
  it('cria, lista, edita; 400 vazio; 404 cross-org', async () => {
    const c = await mkCarrier(a, { cnpj: '11222333000144', telefone: '11 99999-0000', contato: 'João' });
    expect(c.ativo).toBe(true);

    const list = (await inj(a, 'GET', '/api/carriers')).json() as { carriers: Carrier[] };
    expect(list.carriers.some((x) => Number(x.id) === Number(c.id))).toBe(true);
    const listB = (await inj(b, 'GET', '/api/carriers')).json() as { carriers: Carrier[] };
    expect(listB.carriers.some((x) => Number(x.id) === Number(c.id))).toBe(false);

    expect((await inj(a, 'PATCH', `/api/carriers/${c.id}`, {})).statusCode).toBe(400);
    expect((await inj(b, 'PATCH', `/api/carriers/${c.id}`, { nome: 'inv' })).statusCode).toBe(404);
    const up = await inj(a, 'PATCH', `/api/carriers/${c.id}`, { nome: 'Rápido Logística', email: 'x@y.z' });
    expect((up.json() as { carrier: Carrier }).carrier.nome).toBe('Rápido Logística');
  });

  it('DELETE é soft: linha continua com ativo=false; cross-org 404', async () => {
    const c = await mkCarrier(a);
    expect((await inj(b, 'DELETE', `/api/carriers/${c.id}`)).statusCode).toBe(404);
    expect((await inj(a, 'DELETE', `/api/carriers/${c.id}`)).statusCode).toBe(200);

    const list = (await inj(a, 'GET', '/api/carriers')).json() as { carriers: Carrier[] };
    const mine = list.carriers.find((x) => Number(x.id) === Number(c.id));
    expect(mine?.ativo).toBe(false); // soft delete preserva a linha
  });
});

describe('carriers: vínculo no pedido', () => {
  it('pedido aceita carrier_id da org, rejeita de outra; rótulo vem no SELECT e sobrevive ao soft delete', async () => {
    const carrier = await mkCarrier(a, { nome: 'Entrega Certa' });
    const carrierB = await mkCarrier(b, { nome: 'Da Org B' });
    const repA = ((await inj(a, 'POST', '/api/represented', { nome: 'Ind Carrier' })).json() as { empresa: { id: number } }).empresa;
    const cid = await makeCompany();

    const bad = await inj(a, 'POST', '/api/orders', {
      company_id: cid, represented_id: repA.id, carrier_id: Number(carrierB.id),
    });
    expect(bad.statusCode).toBe(400);
    expect((bad.json() as { error: string }).error).toContain('carrier_id');

    const ok = await inj(a, 'POST', '/api/orders', {
      company_id: cid, represented_id: repA.id, carrier_id: Number(carrier.id),
      items: [{ descricao: 'Item', qtd: 1, preco_unit: 10 }],
    });
    expect(ok.statusCode).toBe(201);
    const order = (ok.json() as { order: { id: number; carrier_id: number; carrier_nome: string } }).order;
    expect(order.carrier_nome).toBe('Entrega Certa');

    // troca via PATCH e remove o vínculo com null
    const other = await mkCarrier(a, { nome: 'Outra Transp' });
    const up = await inj(a, 'PATCH', `/api/orders/${order.id}`, { carrier_id: Number(other.id) });
    expect((up.json() as { order: { carrier_nome: string } }).order.carrier_nome).toBe('Outra Transp');
    const clear = await inj(a, 'PATCH', `/api/orders/${order.id}`, { carrier_id: null });
    expect((clear.json() as { order: { carrier_nome: string | null } }).order.carrier_nome).toBeNull();

    // soft delete da transportadora não apaga o rótulo do pedido
    await inj(a, 'PATCH', `/api/orders/${order.id}`, { carrier_id: Number(carrier.id) });
    await inj(a, 'DELETE', `/api/carriers/${carrier.id}`);
    const after = (await inj(a, 'GET', `/api/orders/${order.id}`)).json() as { order: { carrier_nome: string } };
    expect(after.order.carrier_nome).toBe('Entrega Certa');
  });
});
