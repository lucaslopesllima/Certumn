// Factories via API — regra de ouro do plano (docs/E2E-PLAYWRIGHT.md): arrange
// por API, act/assert pela UI. Espelha server/test/helpers.ts, mas em cima do
// APIRequestContext do Playwright (HTTP real contra a stack em docker, não
// fastify.inject()).
import type { APIRequestContext } from '@playwright/test';
import type { Session } from './auth.ts';

export class ApiClient {
  constructor(private request: APIRequestContext, private session: Session) {}

  private h(): Record<string, string> {
    return { authorization: `Bearer ${this.session.token}` };
  }

  async post<T>(path: string, data?: unknown): Promise<T> {
    const res = await this.request.post(path, { headers: this.h(), data });
    if (!res.ok()) throw new Error(`POST ${path} -> ${res.status()}: ${await res.text()}`);
    return (await res.json()) as T;
  }
  async patch<T>(path: string, data?: unknown): Promise<T> {
    const res = await this.request.patch(path, { headers: this.h(), data });
    if (!res.ok()) throw new Error(`PATCH ${path} -> ${res.status()}: ${await res.text()}`);
    return (await res.json()) as T;
  }
  async get<T>(path: string): Promise<T> {
    const res = await this.request.get(path, { headers: this.h() });
    if (!res.ok()) throw new Error(`GET ${path} -> ${res.status()}: ${await res.text()}`);
    return (await res.json()) as T;
  }
  async del<T>(path: string): Promise<T> {
    const res = await this.request.delete(path, { headers: this.h() });
    if (!res.ok()) throw new Error(`DELETE ${path} -> ${res.status()}: ${await res.text()}`);
    return (await res.json()) as T;
  }

  // ── Funil / Clientes ─────────────────────────────────────────────────────
  async createRelationship(companyId: number, opts: Record<string, unknown> = {}): Promise<{ id: number }> {
    const r = await this.post<{ relationship: { id: number } }>('/api/relationships', { company_id: companyId, ...opts });
    return r.relationship;
  }
  async stages(): Promise<{ id: number; nome: string; ordem: number }[]> {
    const r = await this.get<{ stages: { id: number; nome: string; ordem: number }[] }>('/api/stages');
    return r.stages;
  }

  // ── Cadastros de apoio ───────────────────────────────────────────────────
  async createRepresented(nome: string): Promise<{ id: number }> {
    const r = await this.post<{ empresa: { id: number } }>('/api/represented', { nome });
    return r.empresa;
  }
  async createCatalogItem(opts: { nome: string; preco?: number; represented_id?: number }): Promise<{ id: number }> {
    const r = await this.post<{ item: { id: number } }>('/api/catalog', opts);
    return r.item;
  }
  async createCarrier(nome: string): Promise<{ id: number }> {
    const r = await this.post<{ carrier: { id: number } }>('/api/carriers', { nome });
    return r.carrier;
  }
  async createPriceTable(opts: {
    represented_id: number; nome: string; vigencia_inicio: string; vigencia_fim?: string | null;
    items?: { catalog_item_id: number; preco: number; desconto_max_pct?: number | null }[];
  }): Promise<{ id: number }> {
    const r = await this.post<{ table: { id: number } }>('/api/price-tables', { ativo: true, ...opts });
    return r.table;
  }

  // ── Pedidos ──────────────────────────────────────────────────────────────
  async createOrder(opts: {
    company_id: number; represented_id: number; status?: 'cotacao' | 'rascunho';
    items?: Record<string, unknown>[];
  }): Promise<{ id: number; numero: number; status: string }> {
    const r = await this.post<{ order: { id: number; numero: number; status: string } }>('/api/orders', {
      status: 'rascunho',
      items: [{ descricao: 'Item e2e', qtd: 1, preco_unit: 100 }],
      ...opts,
    });
    return r.order;
  }
  async transitionOrder(id: number, status: string, nfNumero?: string): Promise<void> {
    await this.post(`/api/orders/${id}/transition`, { status, nf_numero: nfNumero });
  }

  // ── Agenda ───────────────────────────────────────────────────────────────
  async createActivity(opts: { titulo: string; start_at: string; tipo?: string; company_id?: number }): Promise<{ id: number }> {
    const r = await this.post<{ activity: { id: number } }>('/api/activities', opts);
    return r.activity;
  }

  // ── Financeiro ───────────────────────────────────────────────────────────
  async createFinanceEntry(opts: {
    kind: 'pagar' | 'receber'; descricao: string; valor: number; vencimento: string; categoria?: string;
  }): Promise<{ id: number }> {
    const r = await this.post<{ entry: { id: number } }>('/api/finance', opts);
    return r.entry;
  }

  // ── Comissões ────────────────────────────────────────────────────────────
  async createCommissionRule(opts: {
    represented_id: number; percent: number; vigencia_inicio: string; vendedor_split_pct?: number;
  }): Promise<{ id: number }> {
    const r = await this.post<{ rule: { id: number } }>('/api/commission-rules', opts);
    return r.rule;
  }

  // ── Equipe / Grupos ──────────────────────────────────────────────────────
  async createUser(opts: { nome: string; email: string; senha?: string; role?: string; group_id?: number | null }): Promise<{ id: number }> {
    const r = await this.post<{ user: { id: number } }>('/api/users', { senha: 'senha123', ...opts });
    return r.user;
  }
  async createGroup(nome: string, permissions: string[]): Promise<{ id: number }> {
    const r = await this.post<{ group: { id: number } }>('/api/groups', { nome, permissions });
    return r.group;
  }
  async permissionCatalog(): Promise<string[]> {
    const r = await this.get<{ permissions: { code: string }[] }>('/api/permissions/catalog');
    return r.permissions.map((p) => p.code);
  }

  // ── E-mail ───────────────────────────────────────────────────────────────
  async createEmailTemplate(opts: { nome: string; assunto: string; corpo: string }): Promise<{ id: number }> {
    const r = await this.post<{ template: { id: number } }>('/api/email-templates', opts);
    return r.template;
  }
}
