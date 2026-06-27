// URL do banco de TESTE: mesmo servidor do DATABASE_URL, banco rs_test.
// Garante que a suíte nunca toca o banco de desenvolvimento/produção.
export function testDatabaseUrl(): string {
  const base = process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/rs';
  const u = new URL(base);
  u.pathname = '/rs_test';
  return u.toString();
}
