import { one } from './db.ts';

// FKs de payload que apontam para tabelas TENANT precisam pertencer à org do
// token — sem isso um tenant referencia (e lê, via JOIN de rótulos) dados de
// outro. company_id fica de fora: companies é a base global, sem org.
const REF_TABLES = {
  owner_user_id: 'users',
  user_id: 'users',
  represented_id: 'represented_companies',
  activity_id: 'activities',
  marca_id: 'represented_brands',
  cenario_id: 'funnel_scenarios',
  acao_id: 'funnel_actions',
  relationship_id: 'company_relationships',
  price_table_id: 'price_tables',
  catalog_item_id: 'catalog_items',
  carrier_id: 'carriers',
} as const;

export type OrgRefField = keyof typeof REF_TABLES;

// Devolve o nome do primeiro campo presente no body cujo id NÃO é da org
// (null = tudo válido). Campos ausentes/null passam — FKs são opcionais.
export async function invalidOrgRef(
  orgId: number,
  body: Record<string, unknown>,
  fields: readonly OrgRefField[],
): Promise<OrgRefField | null> {
  for (const f of fields) {
    const v = body[f];
    if (v === undefined || v === null) continue;
    const row = await one(`SELECT 1 FROM ${REF_TABLES[f]} WHERE id = $1 AND org_id = $2`, [v, orgId]);
    if (!row) return f;
  }
  return null;
}
