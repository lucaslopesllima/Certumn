// Fase 6: financeiro avançado (recorrência, fluxo de caixa, DRE, despesa de
// rota) + comunicação (HTML de impressão do pedido, notificações in-app).
// Fluxos felizes + isolamento de org.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { makeApp, register, bearer, makeCompany, closeAll, type Session } from './helpers.ts';

let app: FastifyInstance;
let a: Session;   // org A (admin)
let b: Session;   // org B (admin)

const inj = (s: Session, method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: unknown):
  ReturnType<FastifyInstance['inject']> =>
  app.inject({ method, url, headers: bearer(s.token), payload });

const iso = (d: Date): string => d.toISOString().slice(0, 10);
const shiftDays = (n: number): string => { const d = new Date(); d.setUTCDate(d.getUTCDate() + n); return iso(d); };
const shiftMonths = (n: number): string => { const d = new Date(); d.setUTCMonth(d.getUTCMonth() + n); return iso(d); };

beforeAll(async () => {
  app = await makeApp();
  a = await register(app, 'f6.a');
  b = await register(app, 'f6.b');
});
afterAll(async () => { await closeAll(app); });

describe('financeiro: recorrência mensal', () => {
  it('lançamento-modelo materializa um filho por mês decorrido', async () => {
    // modelo vence há 2 meses → filhos do mês-1 e do mês atual.
    const created = await inj(a, 'POST', '/api/finance', {
      kind: 'pagar', descricao: 'Aluguel', valor: 1000, vencimento: shiftMonths(-2),
      categoria: 'fixo', recorrencia: 'mensal',
    });
    expect(created.statusCode).toBe(200);
    const modelId = (created.json() as { entry: { id: number } }).entry.id;

    const list = await inj(a, 'GET', '/api/finance');
    const entries = (list.json() as { entries: { id: number; recorrencia_origem_id: number | null; descricao: string }[] }).entries;
    const filhos = entries.filter((e) => Number(e.recorrencia_origem_id) === Number(modelId));
    expect(filhos.length).toBe(2);
    expect(filhos.every((f) => f.descricao === 'Aluguel')).toBe(true);

    // idempotente: rodar o materializador de novo não duplica.
    const run = await inj(a, 'POST', '/api/finance/recurrences/run');
    expect(run.statusCode).toBe(200);
    expect((run.json() as { created: number }).created).toBe(0);
  });

  it('rodar recorrências exige admin', async () => {
    const email = `f6rep.${Date.now()}@teste.com`;
    await inj(a, 'POST', '/api/users', { nome: 'Rep', email, senha: 'provisoria1' });
    const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, senha: 'provisoria1' } });
    const rep = login.json() as Session;
    expect((await inj(rep, 'POST', '/api/finance/recurrences/run')).statusCode).toBe(403);
  });
});

describe('financeiro: fluxo de caixa', () => {
  it('agrupa vencimentos pendentes por semana com saldo', async () => {
    await inj(a, 'POST', '/api/finance', { kind: 'receber', descricao: 'Venda', valor: 800, vencimento: shiftDays(5) });
    await inj(a, 'POST', '/api/finance', { kind: 'pagar', descricao: 'Conta', valor: 300, vencimento: shiftDays(6) });

    const cf = await inj(a, 'GET', '/api/finance/cashflow?months=1');
    expect(cf.statusCode).toBe(200);
    const j = cf.json() as { months: number; semanas: { receber: number; pagar: number; comissao_prevista: number; saldo: number }[] };
    expect(j.months).toBe(1);
    const totReceber = j.semanas.reduce((s, w) => s + w.receber, 0);
    const totPagar = j.semanas.reduce((s, w) => s + w.pagar, 0);
    expect(totReceber).toBeGreaterThanOrEqual(800);
    expect(totPagar).toBeGreaterThanOrEqual(300);
    // saldo bate com a fórmula receber + comissão − pagar.
    for (const w of j.semanas) expect(w.saldo).toBeCloseTo(w.receber + w.comissao_prevista - w.pagar, 2);
  });

  it('org B não vê os lançamentos da org A', async () => {
    const cf = await inj(b, 'GET', '/api/finance/cashflow?months=1');
    const j = cf.json() as { semanas: { receber: number }[] };
    expect(j.semanas.reduce((s, w) => s + w.receber, 0)).toBe(0);
  });
});

describe('financeiro: DRE', () => {
  it('receita de comissão recebida menos despesas por categoria', async () => {
    const repId = Number(((await inj(a, 'POST', '/api/represented', { nome: 'DRE Repr' })).json() as { empresa: { id: number } }).empresa.id);
    await inj(a, 'POST', '/api/commission-rules', { represented_id: repId, percent: 10, vigencia_inicio: '2026-01-01' });
    const cid = await makeCompany();
    const prod = Number(((await inj(a, 'POST', '/api/catalog', { nome: 'DRE Prod', preco: 100 })).json() as { item: { id: number } }).item.id);
    const order = (await inj(a, 'POST', '/api/orders', { company_id: cid, represented_id: repId, items: [{ catalog_item_id: prod, qtd: 1 }] })).json() as { order: { id: number } };
    await inj(a, 'POST', `/api/orders/${order.order.id}/transition`, { status: 'enviado' });
    await inj(a, 'POST', `/api/orders/${order.order.id}/transition`, { status: 'faturado', nf_numero: 'NF1' });
    const entry = (await inj(a, 'GET', `/api/commissions?order_id=${order.order.id}`)).json() as { entries: { id: number; valor_previsto: string }[] };
    const ce = entry.entries[0]!;
    await inj(a, 'PATCH', `/api/commissions/${ce.id}/settle`, { valor_recebido: Number(ce.valor_previsto), recebida_em: iso(new Date()) });

    // despesa liquidada deste mês.
    await inj(a, 'POST', '/api/finance', { kind: 'pagar', descricao: 'Combustível', valor: 40, vencimento: iso(new Date()), status: 'liquidado', liquidacao_data: iso(new Date()), categoria: 'viagem' });

    const year = new Date().getFullYear();
    const mes = new Date().getMonth(); // 0-based → índice no array
    const dre = await inj(a, 'GET', `/api/finance/dre?ano=${year}`);
    expect(dre.statusCode).toBe(200);
    const meses = (dre.json() as { meses: { mes: number; receita: number; despesa: number; resultado: number; despesas_por_categoria: Record<string, number> }[] }).meses;
    const m = meses[mes]!;
    expect(m.receita).toBeGreaterThanOrEqual(10);
    expect(m.despesas_por_categoria.viagem).toBeGreaterThanOrEqual(40);
    expect(m.resultado).toBeCloseTo(m.receita - m.despesa, 2);
  });
});

describe('categorias financeiras', () => {
  it('CRUD + isolamento + nome duplicado 409', async () => {
    const created = await inj(a, 'POST', '/api/finance/categories', { nome: 'Aluguel', grupo_dre: 'Despesas Operacionais', kind: 'pagar' });
    expect(created.statusCode).toBe(201);
    const cat = (created.json() as { category: { id: number; nome: string; grupo_dre: string } }).category;
    expect(cat.grupo_dre).toBe('Despesas Operacionais');

    const list = await inj(a, 'GET', '/api/finance/categories');
    expect((list.json() as { categories: { id: number }[] }).categories.some((c) => Number(c.id) === Number(cat.id))).toBe(true);

    // nome duplicado (case-insensitive) → 409
    expect((await inj(a, 'POST', '/api/finance/categories', { nome: 'aluguel' })).statusCode).toBe(409);

    // edita grupo
    const up = await inj(a, 'PATCH', `/api/finance/categories/${cat.id}`, { grupo_dre: 'Administrativa' });
    expect((up.json() as { category: { grupo_dre: string } }).category.grupo_dre).toBe('Administrativa');

    // org B não enxerga nem edita
    expect((list.json() as { categories: { id: number }[] }).categories.length).toBeGreaterThan(0);
    const listB = await inj(b, 'GET', '/api/finance/categories');
    expect((listB.json() as { categories: { id: number }[] }).categories.some((c) => Number(c.id) === Number(cat.id))).toBe(false);
    expect((await inj(b, 'PATCH', `/api/finance/categories/${cat.id}`, { grupo_dre: 'x' })).statusCode).toBe(404);
    expect((await inj(b, 'DELETE', `/api/finance/categories/${cat.id}`)).statusCode).toBe(404);
  });

  it('DRE agrupa despesa pelo grupo_dre da categoria vinculada', async () => {
    const cat = (await inj(a, 'POST', '/api/finance/categories', { nome: 'Pró-labore', grupo_dre: 'Pessoal', kind: 'pagar' })).json() as { category: { id: number } };
    await inj(a, 'POST', '/api/finance', {
      kind: 'pagar', descricao: 'Salário', valor: 60, vencimento: iso(new Date()),
      status: 'liquidado', liquidacao_data: iso(new Date()), categoria_id: cat.category.id,
    });
    const year = new Date().getFullYear();
    const mes = new Date().getMonth();
    const dre = (await inj(a, 'GET', `/api/finance/dre?ano=${year}`)).json() as { meses: { despesas_por_categoria: Record<string, number> }[] };
    expect(dre.meses[mes]!.despesas_por_categoria.Pessoal).toBeGreaterThanOrEqual(60);
  });

  it('categoria_id de outra org no lançamento → 400', async () => {
    const catB = (await inj(b, 'POST', '/api/finance/categories', { nome: 'Da B' })).json() as { category: { id: number } };
    const r = await inj(a, 'POST', '/api/finance', { kind: 'pagar', descricao: 'x', valor: 10, vencimento: iso(new Date()), categoria_id: catB.category.id });
    expect(r.statusCode).toBe(400);
  });
});

describe('despesa de rota', () => {
  const mkRoute = async (s: Session): Promise<number> => {
    const cid = await makeCompany({ lat: -23.5, lon: -46.6 });
    const r = await inj(s, 'POST', '/api/routes', {
      nome: 'Rota teste', origem_lat: -23.5, origem_lon: -46.6, custo_total: 75,
      stops: [{ company_id: cid, seq: 0, lat: -23.5, lon: -46.6 }],
    });
    expect(r.statusCode).toBe(201);
    return Number((r.json() as { route: { id: number } }).route.id);
  };

  it('lança finance pagar/viagem com o custo da rota; idempotente', async () => {
    const routeId = await mkRoute(a);
    const exp = await inj(a, 'POST', `/api/routes/${routeId}/expense`, {});
    expect(exp.statusCode).toBe(201);
    const finId = (exp.json() as { finance_id: number }).finance_id;

    const list = await inj(a, 'GET', '/api/finance?kind=pagar');
    const fin = (list.json() as { entries: { id: number; categoria: string; route_id: number | null; valor: string; route_nome: string | null }[] }).entries.find((e) => Number(e.id) === finId);
    expect(fin).toBeDefined();
    expect(fin!.categoria).toBe('viagem');
    expect(Number(fin!.route_id)).toBe(routeId);
    expect(Number(fin!.valor)).toBe(75);
    expect(fin!.route_nome).toBe('Rota teste');

    // segunda chamada não duplica.
    const dup = await inj(a, 'POST', `/api/routes/${routeId}/expense`, {});
    expect(dup.statusCode).toBe(409);
  });

  it('rota sem custo exige valor explícito; org alheia 404', async () => {
    const cid = await makeCompany({ lat: -22, lon: -43 });
    const r = await inj(a, 'POST', '/api/routes', {
      nome: 'Sem custo', origem_lat: -22, origem_lon: -43,
      stops: [{ company_id: cid, seq: 0, lat: -22, lon: -43 }],
    });
    const routeId = (r.json() as { route: { id: number } }).route.id;
    expect((await inj(a, 'POST', `/api/routes/${routeId}/expense`, {})).statusCode).toBe(400);
    expect((await inj(a, 'POST', `/api/routes/${routeId}/expense`, { valor: 120 })).statusCode).toBe(201);
    // org B não enxerga a rota
    expect((await inj(b, 'POST', `/api/routes/${routeId}/expense`, { valor: 1 })).statusCode).toBe(404);
  });
});

describe('impressão de pedido (HTML)', () => {
  it('gera HTML com cabeçalho da org, número e itens; alheio 404', async () => {
    const repId = Number(((await inj(a, 'POST', '/api/represented', { nome: 'Print Repr' })).json() as { empresa: { id: number } }).empresa.id);
    const cid = await makeCompany({ razao: 'Cliente Print' });
    const order = (await inj(a, 'POST', '/api/orders', {
      company_id: cid, represented_id: repId, status: 'cotacao', validade: '2026-12-31',
      items: [{ descricao: 'Item avulso', qtd: 2, preco_unit: 30 }],
    })).json() as { order: { id: number; numero: number } };

    const print = await inj(a, 'GET', `/api/orders/${order.order.id}/print`);
    expect(print.statusCode).toBe(200);
    const html = (print.json() as { html: string }).html;
    expect(html).toContain('Cotação');
    expect(html).toContain(`Nº ${order.order.numero}`);
    expect(html).toContain('Item avulso');
    expect(html).toContain('Cliente Print');

    expect((await inj(b, 'GET', `/api/orders/${order.order.id}/print`)).statusCode).toBe(404);
  });
});

describe('notificações in-app', () => {
  it('compromisso na próxima hora e conta a vencer viram aviso; marcar lido persiste', async () => {
    const start = new Date(); start.setMinutes(start.getMinutes() + 30);
    await inj(a, 'POST', '/api/activities', { titulo: 'Reunião urgente', start_at: start.toISOString() });
    await inj(a, 'POST', '/api/finance', { kind: 'receber', descricao: 'A vencer', valor: 200, vencimento: shiftDays(1) });

    const r = await inj(a, 'GET', '/api/notifications');
    expect(r.statusCode).toBe(200);
    const j = r.json() as { notifications: { id: number; tipo: string; lida: boolean; titulo: string }[]; nao_lidas: number };
    expect(j.nao_lidas).toBeGreaterThanOrEqual(2);
    const agenda = j.notifications.find((n) => n.tipo === 'agenda');
    expect(agenda).toBeDefined();
    expect(j.notifications.some((n) => n.tipo === 'vencimento')).toBe(true);

    const before = j.nao_lidas;
    expect((await inj(a, 'PATCH', `/api/notifications/${agenda!.id}/read`)).statusCode).toBe(200);
    const after = (await inj(a, 'GET', '/api/notifications')).json() as { nao_lidas: number };
    expect(after.nao_lidas).toBe(before - 1);
  });

  it('isolamento: org B não vê notificações da org A; read alheio 404', async () => {
    const aNotifs = (await inj(a, 'GET', '/api/notifications')).json() as { notifications: { id: number }[] };
    const someId = aNotifs.notifications[0]!.id;
    const bNotifs = (await inj(b, 'GET', '/api/notifications')).json() as { notifications: { id: number }[] };
    expect(bNotifs.notifications.some((n) => n.id === someId)).toBe(false);
    expect((await inj(b, 'PATCH', `/api/notifications/${someId}/read`)).statusCode).toBe(404);
  });
});
