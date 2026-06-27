// Fase 2: comissionamento. Regras (CRUD, precedência produto > cliente >
// vendedor > geral, vigência), geração automática ao faturar (transição e
// import CSV), baixa com espelho no financeiro, conciliação em lote e
// isolamento de org. Cada cenário usa uma representada própria — regra de um
// teste não vaza para o outro.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { makeApp, register, bearer, mail, makeCompany, closeAll, type Session } from './helpers.ts';
import { one, query } from '../src/db.ts';

let app: FastifyInstance;
let a: Session;       // org A (admin)
let b: Session;       // org B (admin, tenta invadir)
let rep: Session;     // vendedor da org A
let prod1: number;    // catálogo A (preço 100)
let prod2: number;    // catálogo A (preço 50)
let prodB: number;    // catálogo da org B

const inj = (s: Session, method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: unknown):
  ReturnType<FastifyInstance['inject']> =>
  app.inject({ method, url, headers: bearer(s.token), payload });

const mesAtual = new Date().toISOString().slice(0, 7); // competência corrente

beforeAll(async () => {
  app = await makeApp();
  a = await register(app, 'comm.a');
  b = await register(app, 'comm.b');

  const email = mail('comm.rep');
  const created = await inj(a, 'POST', '/api/users', { nome: 'Vendedor', email, senha: 'provisoria1' });
  expect(created.statusCode).toBe(201);
  const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, senha: 'provisoria1' } });
  rep = login.json() as Session;

  prod1 = Number(((await inj(a, 'POST', '/api/catalog', { nome: 'Produto 1', preco: 100 })).json() as { item: { id: number } }).item.id);
  prod2 = Number(((await inj(a, 'POST', '/api/catalog', { nome: 'Produto 2', preco: 50 })).json() as { item: { id: number } }).item.id);
  prodB = Number(((await inj(b, 'POST', '/api/catalog', { nome: 'Produto B', preco: 5 })).json() as { item: { id: number } }).item.id);
});
afterAll(async () => { await closeAll(app); });

interface Rule { id: number; percent: string; vendedor_split_pct: string; ativo: boolean }
interface Entry {
  id: number; order_id: number; user_id: number | string | null; status: string;
  competencia: string; valor_previsto: string; valor_recebido: string | null;
  percent_aplicado: string; vendedor_split_pct: string; valor_vendedor: string;
  finance_entry_id: number | string | null; order_numero: number; recebida_em: string | null;
}
interface Order { id: number; numero: number; status: string; total: string }

const mkRepresented = async (nome: string): Promise<number> =>
  Number(((await inj(a, 'POST', '/api/represented', { nome })).json() as { empresa: { id: number } }).empresa.id);

const mkRule = async (representedId: number, extra: Record<string, unknown> = {}): Promise<Rule> => {
  const r = await inj(a, 'POST', '/api/commission-rules', {
    represented_id: representedId, percent: 5, vigencia_inicio: '2026-01-01', ...extra,
  });
  expect(r.statusCode).toBe(201);
  return (r.json() as { rule: Rule }).rule;
};

// Pedido criado e levado até 'faturado' (gera a comissão, se houver regra).
const mkFaturado = async (
  s: Session, representedId: number,
  items: Record<string, unknown>[],
  opts: { companyId?: number; nf?: string; frete?: number } = {},
): Promise<Order> => {
  const cid = opts.companyId ?? await makeCompany();
  const r = await inj(s, 'POST', '/api/orders', {
    company_id: cid, represented_id: representedId, frete: opts.frete ?? 0, items,
  });
  expect(r.statusCode).toBe(201);
  const order = (r.json() as { order: Order }).order;
  await inj(a, 'POST', `/api/orders/${order.id}/transition`, { status: 'enviado' });
  const fat = await inj(a, 'POST', `/api/orders/${order.id}/transition`, { status: 'faturado', nf_numero: opts.nf ?? null });
  expect(fat.statusCode).toBe(200);
  return order;
};

const entryOf = async (s: Session, orderId: number): Promise<Entry | undefined> => {
  const r = await inj(s, 'GET', `/api/commissions?order_id=${orderId}`);
  expect(r.statusCode).toBe(200);
  return (r.json() as { entries: Entry[] }).entries[0];
};

describe('commission rules: CRUD + isolamento', () => {
  it('cria, lista, edita e exclui; só admin escreve', async () => {
    const repId = await mkRepresented('Regras CRUD');
    const rule = await mkRule(repId, { percent: 7.5, vendedor_split_pct: 60 });
    expect(Number(rule.percent)).toBe(7.5);
    expect(Number(rule.vendedor_split_pct)).toBe(60);

    const list = (await inj(a, 'GET', `/api/commission-rules?represented_id=${repId}`)).json() as { rules: Rule[] };
    expect(list.rules).toHaveLength(1);
    // vendedor lê, mas não escreve
    expect((await inj(rep, 'GET', '/api/commission-rules')).statusCode).toBe(200);
    expect((await inj(rep, 'POST', '/api/commission-rules', { represented_id: repId, percent: 1, vigencia_inicio: '2026-01-01' })).statusCode).toBe(403);
    expect((await inj(rep, 'PATCH', `/api/commission-rules/${rule.id}`, { percent: 1 })).statusCode).toBe(403);
    expect((await inj(rep, 'DELETE', `/api/commission-rules/${rule.id}`)).statusCode).toBe(403);

    const up = await inj(a, 'PATCH', `/api/commission-rules/${rule.id}`, { percent: 9, ativo: false });
    expect(up.statusCode).toBe(200);
    expect(Number((up.json() as { rule: Rule }).rule.percent)).toBe(9);
    expect((await inj(a, 'PATCH', `/api/commission-rules/${rule.id}`, {})).statusCode).toBe(400);

    expect((await inj(a, 'DELETE', `/api/commission-rules/${rule.id}`)).statusCode).toBe(200);
    expect((await inj(a, 'DELETE', `/api/commission-rules/${rule.id}`)).statusCode).toBe(404);
  });

  it('valida FKs: representada/catálogo/vendedor alheios e cliente inexistente -> 400; cross-org 404', async () => {
    const repId = await mkRepresented('Regras FK');
    const repB = Number(((await inj(b, 'POST', '/api/represented', { nome: 'Da B' })).json() as { empresa: { id: number } }).empresa.id);
    const post = (body: Record<string, unknown>): ReturnType<FastifyInstance['inject']> =>
      inj(a, 'POST', '/api/commission-rules', { represented_id: repId, percent: 5, vigencia_inicio: '2026-01-01', ...body });

    expect((await post({ represented_id: repB })).statusCode).toBe(400);
    expect((await post({ catalog_item_id: prodB })).statusCode).toBe(400);
    expect((await post({ user_id: Number(b.user.id) })).statusCode).toBe(400);
    expect((await post({ company_id: 999_999_999 })).statusCode).toBe(400);

    const rule = await mkRule(repId);
    expect((await inj(b, 'PATCH', `/api/commission-rules/${rule.id}`, { percent: 1 })).statusCode).toBe(404);
    expect((await inj(b, 'DELETE', `/api/commission-rules/${rule.id}`)).statusCode).toBe(404);
    const listB = (await inj(b, 'GET', '/api/commission-rules')).json() as { rules: Rule[] };
    expect(listB.rules.some((x) => Number(x.id) === Number(rule.id))).toBe(false);
  });
});

describe('geração ao faturar', () => {
  it('sem regra vigente não gera comissão', async () => {
    const repId = await mkRepresented('Sem regra');
    const o = await mkFaturado(a, repId, [{ catalog_item_id: prod1, qtd: 1 }]);
    expect(await entryOf(a, o.id)).toBeUndefined();
  });

  it('regra geral aplica sobre os itens (frete fora) e marca competência do faturamento', async () => {
    const repId = await mkRepresented('Regra geral');
    await mkRule(repId, { percent: 5 });
    const o = await mkFaturado(a, repId, [{ catalog_item_id: prod1, qtd: 2 }], { frete: 25 });
    const e = (await entryOf(a, o.id))!;
    expect(e.status).toBe('prevista');
    expect(Number(e.valor_previsto)).toBe(10);          // 200 × 5% — frete não comissiona
    expect(Number(e.percent_aplicado)).toBe(5);
    expect(Number(e.user_id)).toBe(Number(a.user.id));  // dono do pedido
    expect(e.competencia.slice(0, 7)).toBe(mesAtual);

    // extrato da competência encontra; competência futura não
    const mes = (await inj(a, 'GET', `/api/commissions?competencia=${mesAtual}&represented_id=${repId}`)).json() as { entries: Entry[] };
    expect(mes.entries.some((x) => Number(x.id) === Number(e.id))).toBe(true);
    const fut = (await inj(a, 'GET', `/api/commissions?competencia=2099-01&represented_id=${repId}`)).json() as { entries: Entry[] };
    expect(fut.entries).toHaveLength(0);
  });

  it('regra vencida ou inativa não aplica', async () => {
    const repId = await mkRepresented('Vigência');
    await mkRule(repId, { vigencia_inicio: '2025-01-01', vigencia_fim: '2025-12-31' });
    await mkRule(repId, { vigencia_inicio: '2026-01-01', ativo: false });
    const o = await mkFaturado(a, repId, [{ catalog_item_id: prod1, qtd: 1 }]);
    expect(await entryOf(a, o.id)).toBeUndefined();
  });

  it('import CSV de faturamento também gera comissão', async () => {
    const repId = await mkRepresented('Via import');
    await mkRule(repId, { percent: 10 });
    const cid = await makeCompany();
    const cnpj = (await one<{ cnpj: string }>('SELECT cnpj FROM companies WHERE id = $1', [cid]))!.cnpj;
    const r = await inj(a, 'POST', '/api/orders', {
      company_id: cid, represented_id: repId, items: [{ descricao: 'Item', qtd: 1, preco_unit: 500 }],
    });
    const order = (r.json() as { order: Order }).order;
    await inj(a, 'POST', `/api/orders/${order.id}/transition`, { status: 'enviado' });
    await inj(a, 'POST', '/api/orders/import', { csv: `nf,data,cnpj,valor\nNF-9,2026-06-05,${cnpj},500` });
    const e = (await entryOf(a, order.id))!;
    expect(Number(e.valor_previsto)).toBe(50);
    expect(e.competencia.slice(0, 7)).toBe('2026-06');
  });

  it('cancelar pedido faturado cancela a comissão prevista', async () => {
    const repId = await mkRepresented('Cancelamento');
    await mkRule(repId);
    const o = await mkFaturado(a, repId, [{ catalog_item_id: prod1, qtd: 1 }]);
    expect((await entryOf(a, o.id))!.status).toBe('prevista');
    await inj(a, 'POST', `/api/orders/${o.id}/transition`, { status: 'cancelado' });
    expect((await entryOf(a, o.id))!.status).toBe('cancelada');
  });
});

describe('precedência: produto > cliente > vendedor > geral', () => {
  let repId: number;
  let clienteId: number;

  beforeAll(async () => {
    repId = await mkRepresented('Precedência');
    clienteId = await makeCompany();
    await mkRule(repId, { percent: 5 });                                         // geral
    await mkRule(repId, { percent: 6, user_id: Number(rep.user.id) });           // vendedor
    await mkRule(repId, { percent: 7, company_id: clienteId });                  // cliente
    await mkRule(repId, { percent: 8, catalog_item_id: prod1 });                 // produto
  });

  it('resolve por item: produto vence cliente, que vence vendedor', async () => {
    // pedido do vendedor para o cliente com prod1 (100) e prod2 (50):
    // prod1 → regra de produto 8% = 8,00; prod2 → regra de cliente 7% = 3,50
    const o = await mkFaturado(rep, repId,
      [{ catalog_item_id: prod1, qtd: 1 }, { catalog_item_id: prod2, qtd: 1 }],
      { companyId: clienteId });
    const e = (await entryOf(a, o.id))!;
    expect(Number(e.valor_previsto)).toBe(11.5);
    expect(Number(e.percent_aplicado)).toBeCloseTo(7.67, 2); // 11.5/150 ponderado
  });

  it('sem regra de produto/cliente cai na regra do vendedor; pedido de outro dono cai na geral', async () => {
    const doVendedor = await mkFaturado(rep, repId, [{ catalog_item_id: prod2, qtd: 1 }]);
    expect(Number((await entryOf(a, doVendedor.id))!.valor_previsto)).toBe(3); // 50 × 6%

    const doAdmin = await mkFaturado(a, repId, [{ catalog_item_id: prod2, qtd: 1 }]);
    expect(Number((await entryOf(a, doAdmin.id))!.valor_previsto)).toBe(2.5); // 50 × 5%
  });

  it('split do vendedor vira valor_vendedor no extrato', async () => {
    const repSplit = await mkRepresented('Split');
    await mkRule(repSplit, { percent: 10, vendedor_split_pct: 40 });
    const o = await mkFaturado(a, repSplit, [{ catalog_item_id: prod1, qtd: 1 }]);
    const e = (await entryOf(a, o.id))!;
    expect(Number(e.valor_previsto)).toBe(10);
    expect(Number(e.vendedor_split_pct)).toBe(40);
    expect(Number(e.valor_vendedor)).toBe(4);
  });
});

describe('baixa (settle) + espelho no financeiro', () => {
  let repId: number;

  beforeAll(async () => {
    repId = await mkRepresented('Baixa');
    await mkRule(repId, { percent: 10 });
  });

  const novaEntry = async (): Promise<Entry> => {
    const o = await mkFaturado(a, repId, [{ catalog_item_id: prod1, qtd: 1 }]); // previsto 10
    return (await entryOf(a, o.id))!;
  };

  it('valor exato marca recebida e cria finance_entry liquidado (categoria comissao)', async () => {
    const e = await novaEntry();
    const r = await inj(a, 'PATCH', `/api/commissions/${e.id}/settle`, { valor_recebido: 10, recebida_em: '2026-06-10' });
    expect(r.statusCode).toBe(200);
    const upd = (r.json() as { entry: Entry }).entry;
    expect(upd.status).toBe('recebida');
    expect(Number(upd.valor_recebido)).toBe(10);
    expect(upd.finance_entry_id).not.toBeNull();

    const fin = await one<{ kind: string; categoria: string; status: string; valor: string; liquidacao_data: Date }>(
      'SELECT kind, categoria, status, valor, liquidacao_data FROM finance_entries WHERE id = $1',
      [Number(upd.finance_entry_id)],
    );
    expect(fin!.kind).toBe('receber');
    expect(fin!.categoria).toBe('comissao');
    expect(fin!.status).toBe('liquidado');
    expect(Number(fin!.valor)).toBe(10);
  });

  it('fora da tolerância marca divergente; re-baixa corrige sem duplicar lançamento', async () => {
    const e = await novaEntry();
    const r1 = await inj(a, 'PATCH', `/api/commissions/${e.id}/settle`, { valor_recebido: 8, recebida_em: '2026-06-10' });
    const d = (r1.json() as { entry: Entry }).entry;
    expect(d.status).toBe('divergente');
    const finId = Number(d.finance_entry_id);

    const r2 = await inj(a, 'PATCH', `/api/commissions/${e.id}/settle`, { valor_recebido: 10, recebida_em: '2026-06-12' });
    const ok = (r2.json() as { entry: Entry }).entry;
    expect(ok.status).toBe('recebida');
    expect(Number(ok.finance_entry_id)).toBe(finId); // mesmo espelho, atualizado
    const fin = await one<{ valor: string }>('SELECT valor FROM finance_entries WHERE id = $1', [finId]);
    expect(Number(fin!.valor)).toBe(10);

    // tolerância explícita aceita a diferença
    const e2 = await novaEntry();
    const r3 = await inj(a, 'PATCH', `/api/commissions/${e2.id}/settle`, { valor_recebido: 9.5, recebida_em: '2026-06-10', tolerancia: 1 });
    expect((r3.json() as { entry: Entry }).entry.status).toBe('recebida');
  });

  it('permissões: vendedor 403, cross-org 404, cancelada 409', async () => {
    const e = await novaEntry();
    expect((await inj(rep, 'PATCH', `/api/commissions/${e.id}/settle`, { valor_recebido: 10, recebida_em: '2026-06-10' })).statusCode).toBe(403);
    expect((await inj(b, 'PATCH', `/api/commissions/${e.id}/settle`, { valor_recebido: 10, recebida_em: '2026-06-10' })).statusCode).toBe(404);

    await query("UPDATE commission_entries SET status = 'cancelada' WHERE id = $1", [Number(e.id)]);
    expect((await inj(a, 'PATCH', `/api/commissions/${e.id}/settle`, { valor_recebido: 10, recebida_em: '2026-06-10' })).statusCode).toBe(409);
  });

  it('org B não enxerga extrato da org A', async () => {
    const e = await novaEntry();
    const listB = (await inj(b, 'GET', '/api/commissions')).json() as { entries: Entry[] };
    expect(listB.entries.some((x) => Number(x.id) === Number(e.id))).toBe(false);
    const byOrder = (await inj(b, 'GET', `/api/commissions?order_id=${e.order_id}`)).json() as { entries: Entry[] };
    expect(byOrder.entries).toHaveLength(0);
  });
});

describe('conciliação CSV em lote', () => {
  it('match por pedido e por nf; divergência apontada; linha ruim e sem comissão viram motivo', async () => {
    const repId = await mkRepresented('Conciliação');
    await mkRule(repId, { percent: 10 });
    const o1 = await mkFaturado(a, repId, [{ catalog_item_id: prod1, qtd: 1 }]);              // previsto 10
    const o2 = await mkFaturado(a, repId, [{ catalog_item_id: prod2, qtd: 2 }], { nf: 'NF-C2' }); // previsto 10

    const csv = [
      'pedido;nf;valor;data',
      `${o1.numero};;10,00;05/06/2026`,   // exato → recebida
      `;NF-C2;7,00;2026-06-06`,           // por NF, divergente
      ';;5,00;',                          // sem referência
      `999999;;1,00;`,                    // pedido inexistente
    ].join('\n');
    const r = await inj(a, 'POST', '/api/commissions/reconcile', { csv });
    expect(r.statusCode).toBe(200);
    const res = r.json() as {
      processadas: number; baixadas: number; divergentes: number;
      results: { commission_id: number | null; status?: string; motivo?: string }[];
    };
    expect(res.processadas).toBe(4);
    expect(res.baixadas).toBe(2);
    expect(res.divergentes).toBe(1);
    expect(res.results[0]!.status).toBe('recebida');
    expect(res.results[1]!.status).toBe('divergente');
    expect(res.results[2]!.motivo).toBe('linha inválida');
    expect(res.results[3]!.motivo).toContain('sem comissão');

    const e1 = (await entryOf(a, o1.id))!;
    expect(e1.status).toBe('recebida');
    expect(e1.recebida_em).toContain('2026-06-05');
    const e2 = (await entryOf(a, o2.id))!;
    expect(e2.status).toBe('divergente');
    expect(Number(e2.valor_recebido)).toBe(7);

    expect((await inj(rep, 'POST', '/api/commissions/reconcile', { csv })).statusCode).toBe(403);
    expect((await inj(a, 'POST', '/api/commissions/reconcile', { csv: 'foo;bar\n1;2' })).statusCode).toBe(400);
  });
});
