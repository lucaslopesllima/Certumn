// Acesso direto ao Postgres pra: (1) pescar empresas do seed determinístico
// (e2e/seed/companies.sql) sem depender de /api/recommend, que exige território
// (`munis`) — não vale a pena montar isso só pra arranjar fixtures; (2) asserts
// que a UI não expõe diretamente (ex.: stage_id após um drag no kanban).
import pg from 'pg';
import 'dotenv/config';

const connectionString = process.env.E2E_DATABASE_URL ?? 'postgres://postgres:postgres@localhost:55432/rs_e2e';
export const pool = new pg.Pool({ connectionString, max: 5 });

export async function seedCompany(opts: { uf?: string; municipioId?: number; cluster?: boolean; semGeom?: boolean; baixada?: boolean } = {}): Promise<{
  id: number; razao_social: string; nome_fantasia: string | null;
}> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (opts.cluster) where.push(`nome_fantasia LIKE 'E2E Cluster %'`);
  else if (opts.semGeom) where.push(`nome_fantasia LIKE 'E2E SemGeo %'`);
  else if (opts.baixada) where.push(`nome_fantasia LIKE 'E2E Baixada %'`);
  else {
    where.push(`nome_fantasia LIKE 'E2E Fantasia %'`);
    // uf sozinho não é preciso: SP cobre tanto São Paulo (3550308) quanto
    // Campinas (3509502) no seed — quem precisa bater com um território
    // específico de /api/recommend (munis=X) deve passar municipioId.
    if (opts.municipioId) { params.push(opts.municipioId); where.push(`municipio_id = $${params.length}`); }
    else if (opts.uf) { params.push(opts.uf); where.push(`uf = $${params.length}`); }
  }
  const { rows } = await pool.query<{ id: string; razao_social: string; nome_fantasia: string | null }>(
    `SELECT id, razao_social, nome_fantasia FROM companies WHERE ${where.join(' AND ')} ORDER BY id LIMIT 1 OFFSET floor(random() * 20)`,
    params,
  );
  const row = rows[0];
  if (!row) throw new Error(`seedCompany: nenhuma empresa casou com ${JSON.stringify(opts)}`);
  return { id: Number(row.id), razao_social: row.razao_social, nome_fantasia: row.nome_fantasia };
}

export async function seedCompanies(opts: { cluster?: boolean } = {}, limit = 5): Promise<{ id: number }[]> {
  const where = opts.cluster ? `nome_fantasia LIKE 'E2E Cluster %'` : `nome_fantasia LIKE 'E2E Fantasia %'`;
  const { rows } = await pool.query<{ id: string }>(
    `SELECT id FROM companies WHERE ${where} ORDER BY id LIMIT $1`, [limit],
  );
  return rows.map((r) => ({ id: Number(r.id) }));
}

export async function relationshipStageId(relationshipId: number): Promise<number | null> {
  const { rows } = await pool.query<{ stage_id: string | null }>(
    'SELECT stage_id FROM company_relationships WHERE id = $1', [relationshipId],
  );
  return rows[0]?.stage_id != null ? Number(rows[0].stage_id) : null;
}
