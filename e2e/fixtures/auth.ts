// Auth programático: cria uma org nova por teste via /api/auth/register e injeta
// o token no localStorage (mesma chave que client/src/lib/api.ts usa: rs_token)
// antes de qualquer navegação — evita passar pela UI de login em cada teste.
// Só e2e/tests/01-auth/*.spec.ts deve exercitar o form de login/cadastro de verdade.
import { test as base, type APIRequestContext, type Page } from '@playwright/test';
import { pool } from './db.ts';

export interface SessionUser {
  id: number; email: string; role: string; org_id: number; org_nome: string;
  tipo_conta: 'escritorio' | 'individual'; is_admin: boolean; permissions: string[];
  must_change_password?: boolean;
}
export interface Session { token: string; user: SessionUser }

let seq = 0;
const run = Date.now();
export const uniqTag = (tag: string): string => `${tag}-${run}-${++seq}`;
export const uniqEmail = (tag: string): string => `e2e.${uniqTag(tag)}@teste.com`;

const DEFAULT_PASSWORD = 'senha123';

export async function registerOrg(
  request: APIRequestContext,
  tag: string,
  opts: { tipoConta?: 'escritorio' | 'individual'; orgNome?: string } = {},
): Promise<Session> {
  const email = uniqEmail(tag);
  const res = await request.post('/api/auth/register', {
    data: {
      org_nome: opts.orgNome ?? `Org ${tag}`,
      email,
      senha: DEFAULT_PASSWORD,
      tipo_conta: opts.tipoConta ?? 'escritorio',
    },
  });
  if (res.status() !== 201) {
    throw new Error(`register falhou (${res.status()}): ${await res.text()}`);
  }
  return (await res.json()) as Session;
}

export async function login(request: APIRequestContext, email: string, senha = DEFAULT_PASSWORD): Promise<Session> {
  const res = await request.post('/api/auth/login', { data: { email, senha } });
  if (res.status() !== 200) throw new Error(`login falhou (${res.status()}): ${await res.text()}`);
  return (await res.json()) as Session;
}

// Injeta o token no localStorage ANTES do primeiro script da página rodar —
// precisa vir antes de page.goto() pra auth.tsx já achar o token no boot.
export async function setSession(page: Page, session: Session): Promise<void> {
  await page.addInitScript((token) => { window.localStorage.setItem('rs_token', token); }, session.token);
}

// Cria a org + já injeta a sessão na page. Uso comum: `const s = await loginAs(page, request, 'clientes')`.
export async function loginAs(
  page: Page,
  request: APIRequestContext,
  tag: string,
  opts: { tipoConta?: 'escritorio' | 'individual' } = {},
): Promise<Session> {
  const session = await registerOrg(request, tag, opts);
  await setSession(page, session);
  return session;
}

// Cria um usuário adicional (role 'rep') numa org existente e faz login real —
// necessário pra RBAC granular: register só cria o admin (bypassa tudo).
export async function createMember(
  request: APIRequestContext,
  admin: Session,
  tag: string,
  opts: { groupId?: number | null; role?: 'admin' | 'rep' } = {},
): Promise<Session> {
  const email = uniqEmail(tag);
  const res = await request.post('/api/users', {
    headers: { authorization: `Bearer ${admin.token}` },
    data: { nome: `Membro ${tag}`, email, senha: DEFAULT_PASSWORD, role: opts.role ?? 'rep', group_id: opts.groupId },
  });
  if (res.status() !== 201) throw new Error(`criar usuário falhou (${res.status()}): ${await res.text()}`);
  // Usuário criado via /api/users nasce com must_change_password=true (senha
  // provisória) — RequireAuth redirecionaria toda navegação pra /trocar-senha
  // antes mesmo do RequirePermission entrar em jogo. O fluxo de troca forçada
  // já tem cobertura dedicada em 01-auth/trocar-senha.spec.ts; aqui o objetivo
  // é testar RBAC/carteira, não a senha provisória — libera direto no banco.
  await pool.query('UPDATE users SET must_change_password = false WHERE email = $1', [email.toLowerCase()]);
  return login(request, email, DEFAULT_PASSWORD);
}

// Busca o catálogo completo de permissões (público a qualquer logado).
async function fullCatalog(request: APIRequestContext, admin: Session): Promise<string[]> {
  const res = await request.get('/api/permissions/catalog', { headers: { authorization: `Bearer ${admin.token}` } });
  const body = (await res.json()) as { permissions: { code: string }[] };
  return body.permissions.map((p) => p.code);
}

// Cria um grupo com TODAS as permissões exceto `missingCode`, um usuário nesse
// grupo, e retorna a sessão dele — usado pela matriz RBAC (19-rbac/matrix.spec.ts)
// pra provar que a ausência de UMA permissão bloqueia menu + rota + API.
export async function loginWithoutPermission(
  page: Page,
  request: APIRequestContext,
  admin: Session,
  missingCode: string,
): Promise<Session> {
  const all = await fullCatalog(request, admin);
  const perms = all.filter((c) => c !== missingCode);
  const tag = uniqTag('rbac');
  const groupRes = await request.post('/api/groups', {
    headers: { authorization: `Bearer ${admin.token}` },
    data: { nome: `Sem ${missingCode} ${tag}`, permissions: perms },
  });
  if (groupRes.status() !== 201) throw new Error(`criar grupo falhou: ${await groupRes.text()}`);
  const group = (await groupRes.json()) as { group: { id: number } };
  const session = await createMember(request, admin, tag, { groupId: group.group.id });
  await setSession(page, session);
  return session;
}

// Fixtures do Playwright: `loginAs` (função pronta pra usar dentro do teste) e
// `session` (org escritório já criada e injetada, atalho pro caso comum).
export const test = base.extend<{
  loginAs: (tag: string, opts?: { tipoConta?: 'escritorio' | 'individual' }) => Promise<Session>;
  session: Session;
}>({
  loginAs: async ({ page, request }, use) => {
    await use((tag, opts) => loginAs(page, request, tag, opts));
  },
  session: async ({ page, request }, use) => {
    await use(await loginAs(page, request, 'default'));
  },
});
