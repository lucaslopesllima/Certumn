import type { FastifyRequest } from 'fastify';

// RBAC por carteira (Fase 3): rep enxerga só registros com owner_user_id
// próprio; admin vê tudo e pode filtrar por vendedor via querystring.
//
// scopeOwner injeta a cláusula no WHERE dinâmico (mesmo padrão where[]/params[]
// usado em todas as rotas). `requested` é o filtro opcional do admin — para o
// rep ele é ignorado: o escopo do token sempre vence o querystring.
//
// `nullVisible` (routes/vehicles): owner NULL = recurso compartilhado da org,
// visível para todos — sem isso os dados criados antes da Fase 3 sumiriam
// para os vendedores.
export function scopeOwner(
  req: FastifyRequest,
  where: string[],
  params: unknown[],
  col: string,
  requested?: number,
  opts: { nullVisible?: boolean } = {},
): void {
  if (req.auth!.role === 'admin') {
    if (requested !== undefined) {
      params.push(requested);
      where.push(`${col} = $${params.length}`);
    }
    return;
  }
  params.push(req.auth!.userId);
  where.push(opts.nullVisible
    ? `(${col} = $${params.length} OR ${col} IS NULL)`
    : `${col} = $${params.length}`);
}

// Regra de escrita: rep só mexe no registro próprio (ou sem dono, quando o
// recurso aceita compartilhado); admin em qualquer um.
export function canWriteOwned(
  req: FastifyRequest,
  ownerUserId: number | null,
  opts: { nullWritable?: boolean } = {},
): boolean {
  if (req.auth!.role === 'admin') return true;
  if (ownerUserId === null) return opts.nullWritable ?? false;
  return ownerUserId === req.auth!.userId;
}

// Rep não pode atribuir registro a outro vendedor (POST/PATCH com
// owner_user_id alheio). Admin pode. Retorna true quando o body é inválido.
export function invalidOwnerAssignment(req: FastifyRequest, body: Record<string, unknown>): boolean {
  if (req.auth!.role === 'admin') return false;
  const v = body.owner_user_id;
  return v !== undefined && v !== null && Number(v) !== req.auth!.userId;
}
