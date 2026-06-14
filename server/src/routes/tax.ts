import type { FastifyInstance } from 'fastify';
import { one, query } from '../db.ts';
import { requireAuth } from '../auth.ts';

// Alíquotas default da org (uma linha por org). Buscadas como base na criação
// do pedido; cada item guarda a cópia (ver orders.ts / migration 037).
// Configurar é política da org → só admin altera (igual inatividade_dias).

export const TAX_FIELDS = ['icms_pct', 'ipi_pct', 'st_pct', 'pis_pct', 'cofins_pct', 'iss_pct'] as const;
const ZERO: Record<string, number> = Object.fromEntries(TAX_FIELDS.map((k) => [k, 0]));

const PROPS = Object.fromEntries(
  TAX_FIELDS.map((k) => [k, { type: 'number', minimum: 0, maximum: 100 }]),
);

// Default vigente da org como números (0 quando ainda não configurado). Usado
// pelo pedido pra preencher alíquota ausente. numeric vem como string do pg.
export async function orgTaxDefaults(orgId: number): Promise<Record<string, number>> {
  const row = await one<Record<string, string>>(
    `SELECT ${TAX_FIELDS.join(', ')} FROM org_tax_defaults WHERE org_id = $1`, [orgId],
  );
  if (!row) return { ...ZERO };
  return Object.fromEntries(TAX_FIELDS.map((k) => [k, Number(row[k])]));
}

export function taxRoutes(app: FastifyInstance): void {
  app.get('/api/tax-defaults', { preHandler: requireAuth }, async (req) => {
    return { tax: await orgTaxDefaults(req.auth!.orgId) };
  });

  app.patch('/api/tax-defaults', {
    preHandler: requireAuth,
    schema: { body: { type: 'object', properties: PROPS } },
  }, async (req, reply) => {
    if (req.auth!.role !== 'admin') return reply.code(403).send({ error: 'apenas administradores' });
    const orgId = req.auth!.orgId;
    const b = req.body as Record<string, number>;
    // upsert: cria a linha da org no primeiro save, atualiza só os campos enviados.
    const cols = TAX_FIELDS.filter((k) => b[k] !== undefined);
    const insertCols = ['org_id', ...cols];
    const values = [orgId, ...cols.map((k) => b[k])];
    const placeholders = insertCols.map((_, i) => `$${i + 1}`).join(', ');
    const updates = cols.length > 0
      ? cols.map((k) => `${k} = EXCLUDED.${k}`).concat('updated_at = now()').join(', ')
      : 'updated_at = now()';
    await query(
      `INSERT INTO org_tax_defaults (${insertCols.join(', ')}) VALUES (${placeholders})
       ON CONFLICT (org_id) DO UPDATE SET ${updates}`,
      values,
    );
    return { tax: await orgTaxDefaults(orgId) };
  });
}
