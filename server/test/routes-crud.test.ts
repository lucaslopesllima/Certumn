// CRUDs org-scoped: stages, represented, catalog, vehicles, cadastros
// (brands/contacts/scenarios/actions). Cobre sucesso, 400 "nada para
// atualizar", 404 cross-org e validação de FK por org.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { makeApp, register, bearer, closeAll, type Session } from './helpers.ts';

let app: FastifyInstance;
let a: Session;       // org A (dona dos dados)
let b: Session;       // org B (tenta invadir)

beforeAll(async () => {
  app = await makeApp();
  a = await register(app, 'crud.a');
  b = await register(app, 'crud.b');
});
afterAll(async () => { await closeAll(app); });

const post = (s: Session, url: string, payload: unknown): ReturnType<FastifyInstance['inject']> =>
  app.inject({ method: 'POST', url, headers: bearer(s.token), payload });
const patch = (s: Session, url: string, payload: unknown): ReturnType<FastifyInstance['inject']> =>
  app.inject({ method: 'PATCH', url, headers: bearer(s.token), payload });
const get = (s: Session, url: string): ReturnType<FastifyInstance['inject']> =>
  app.inject({ method: 'GET', url, headers: bearer(s.token) });
const del = (s: Session, url: string): ReturnType<FastifyInstance['inject']> =>
  app.inject({ method: 'DELETE', url, headers: bearer(s.token) });

describe('stages', () => {
  it('CRUD completo + ordem default + 400/404', async () => {
    const list = await get(a, '/api/stages');
    const initial = (list.json() as { stages: { ordem: number }[] }).stages;
    expect(initial.length).toBe(7); // estágios default do register

    const created = await post(a, '/api/stages', { nome: 'Extra' });
    const st = (created.json() as { stage: { id: number; ordem: number } }).stage;
    expect(st.ordem).toBe(8); // MAX(ordem)+1

    const explicit = await post(a, '/api/stages', { nome: 'Pos', ordem: 42 });
    expect((explicit.json() as { stage: { ordem: number } }).stage.ordem).toBe(42);

    expect((await patch(a, `/api/stages/${st.id}`, {})).statusCode).toBe(400);
    const up = await patch(a, `/api/stages/${st.id}`, { nome: 'Extra 2', ordem: 9 });
    expect((up.json() as { stage: { nome: string } }).stage.nome).toBe('Extra 2');

    expect((await patch(b, `/api/stages/${st.id}`, { nome: 'inv' })).statusCode).toBe(404);
    expect((await del(b, `/api/stages/${st.id}`)).statusCode).toBe(404);
    expect((await del(a, `/api/stages/${st.id}`)).statusCode).toBe(200);
  });
});

describe('represented', () => {
  it('CRUD + isolamento', async () => {
    const created = await post(a, '/api/represented', { nome: 'Indústria X', cnpj: '11222333000144' });
    const emp = (created.json() as { empresa: { id: number } }).empresa;

    const list = await get(a, '/api/represented');
    expect((list.json() as { empresas: { id: number }[] }).empresas.some((e) => e.id === emp.id)).toBe(true);
    const listB = await get(b, '/api/represented');
    expect((listB.json() as { empresas: { id: number }[] }).empresas.some((e) => e.id === emp.id)).toBe(false);

    expect((await patch(a, `/api/represented/${emp.id}`, {})).statusCode).toBe(400);
    const up = await patch(a, `/api/represented/${emp.id}`, { ativo: false, segmento: 'metal' });
    expect((up.json() as { empresa: { ativo: boolean } }).empresa.ativo).toBe(false);
    expect((await patch(b, `/api/represented/${emp.id}`, { nome: 'inv' })).statusCode).toBe(404);

    expect((await del(b, `/api/represented/${emp.id}`)).statusCode).toBe(404);
    expect((await del(a, `/api/represented/${emp.id}`)).statusCode).toBe(200);
  });
});

describe('catalog', () => {
  it('CRUD + 400/404', async () => {
    const created = await post(a, '/api/catalog', { nome: 'Produto A', preco: 12.5 });
    expect(created.statusCode).toBe(201);
    const item = (created.json() as { item: { id: number } }).item;

    expect((await get(a, '/api/catalog')).statusCode).toBe(200);
    expect((await patch(a, `/api/catalog/${item.id}`, {})).statusCode).toBe(400);
    const up = await patch(a, `/api/catalog/${item.id}`, { ativo: false, codigo: 'SKU1' });
    expect((up.json() as { item: { ativo: boolean } }).item.ativo).toBe(false);
    expect((await patch(b, `/api/catalog/${item.id}`, { nome: 'inv' })).statusCode).toBe(404);
    expect((await del(b, `/api/catalog/${item.id}`)).statusCode).toBe(404);
    expect((await del(a, `/api/catalog/${item.id}`)).statusCode).toBe(200);
  });
});

describe('vehicles', () => {
  it('CRUD + delete é soft (ativo=false)', async () => {
    const created = await post(a, '/api/vehicles', { nome: 'Fiorino', consumo_kml: 11.5, preco_litro: 6.1 });
    const v = (created.json() as { vehicle: { id: number } }).vehicle;

    expect((await patch(a, `/api/vehicles/${v.id}`, {})).statusCode).toBe(400);
    const up = await patch(a, `/api/vehicles/${v.id}`, { placa: 'ABC1D23', combustivel: 'flex' });
    expect((up.json() as { vehicle: { placa: string } }).vehicle.placa).toBe('ABC1D23');
    expect((await patch(b, `/api/vehicles/${v.id}`, { nome: 'inv' })).statusCode).toBe(404);

    expect((await del(b, `/api/vehicles/${v.id}`)).statusCode).toBe(404);
    expect((await del(a, `/api/vehicles/${v.id}`)).statusCode).toBe(200);
    const after = await get(a, '/api/vehicles');
    const mine = (after.json() as { vehicles: { id: number; ativo: boolean }[] }).vehicles.find((x) => x.id === v.id);
    expect(mine?.ativo).toBe(false); // soft delete preserva a linha
  });
});

describe('cadastros: brands', () => {
  it('exige representada da própria org', async () => {
    const rep = (await post(a, '/api/represented', { nome: 'Marca Holder' })).json() as { empresa: { id: number } };

    const okBrand = await post(a, '/api/brands', { represented_id: rep.empresa.id, nome: 'Marca 1' });
    expect(okBrand.statusCode).toBe(201);
    const brand = (okBrand.json() as { brand: { id: number } }).brand;

    // org B não usa a representada da org A
    expect((await post(b, '/api/brands', { represented_id: rep.empresa.id, nome: 'inv' })).statusCode).toBe(400);

    const list = await get(a, `/api/brands?represented_id=${rep.empresa.id}`);
    expect((list.json() as { brands: unknown[] }).brands).toHaveLength(1);
    expect((await get(a, '/api/brands')).statusCode).toBe(200);

    expect((await del(b, `/api/brands/${brand.id}`)).statusCode).toBe(404);
    expect((await del(a, `/api/brands/${brand.id}`)).statusCode).toBe(200);
  });
});

describe('cadastros: contacts', () => {
  it('CRUD + represented_id de outra org -> 400', async () => {
    const repA = (await post(a, '/api/represented', { nome: 'Rep Contato' })).json() as { empresa: { id: number } };

    const created = await post(a, '/api/contacts', { nome: 'Carlos', cargo: 'Comprador', represented_id: repA.empresa.id });
    expect(created.statusCode).toBe(201);
    const ct = (created.json() as { contact: { id: number } }).contact;

    // org B não cria contato apontando para a representada da org A
    expect((await post(b, '/api/contacts', { nome: 'Inv', represented_id: repA.empresa.id })).statusCode).toBe(400);
    // nem move o próprio contato para lá
    const ctB = (await post(b, '/api/contacts', { nome: 'De B' })).json() as { contact: { id: number } };
    expect((await patch(b, `/api/contacts/${ctB.contact.id}`, { represented_id: repA.empresa.id })).statusCode).toBe(400);

    const list = await get(a, `/api/contacts?represented_id=${repA.empresa.id}`);
    expect((list.json() as { contacts: unknown[] }).contacts).toHaveLength(1);
    expect((await get(a, '/api/contacts?company_id=1')).statusCode).toBe(200);

    expect((await patch(a, `/api/contacts/${ct.id}`, {})).statusCode).toBe(400);
    const up = await patch(a, `/api/contacts/${ct.id}`, { email: 'c@x.com' });
    expect((up.json() as { contact: { email: string } }).contact.email).toBe('c@x.com');
    expect((await patch(b, `/api/contacts/${ct.id}`, { nome: 'inv' })).statusCode).toBe(404);

    expect((await del(b, `/api/contacts/${ct.id}`)).statusCode).toBe(404);
    expect((await del(a, `/api/contacts/${ct.id}`)).statusCode).toBe(200);
  });
});

describe('cadastros: scenarios e actions (listas simples)', () => {
  for (const path of ['scenarios', 'actions'] as const) {
    it(`${path}: CRUD + 404 cross-org`, async () => {
      const created = await post(a, `/api/${path}`, { nome: 'Item 1' });
      expect(created.statusCode).toBe(201);
      const item = (created.json() as { item: { id: number } }).item;

      const list = await get(a, `/api/${path}`);
      expect((list.json() as { items: { id: number }[] }).items.some((i) => i.id === item.id)).toBe(true);

      const up = await patch(a, `/api/${path}/${item.id}`, { nome: 'Item 2' });
      expect((up.json() as { item: { nome: string } }).item.nome).toBe('Item 2');
      expect((await patch(b, `/api/${path}/${item.id}`, { nome: 'inv' })).statusCode).toBe(404);

      expect((await del(b, `/api/${path}/${item.id}`)).statusCode).toBe(404);
      expect((await del(a, `/api/${path}/${item.id}`)).statusCode).toBe(200);
    });
  }
});
