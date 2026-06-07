import type { FastifyInstance } from 'fastify';
import { one, query } from '../db.ts';
import { requireAuth } from '../auth.ts';

// Read-only lookup into the global companies pool (mesma fonte do recommend/funil).
// Retorna TODOS os campos da empresa (com códigos RFB decodificados) + quadro societário.
export function companyRoutes(app: FastifyInstance): void {
  app.get('/api/companies/:id', {
    preHandler: requireAuth,
    schema: { params: { type: 'object', required: ['id'], properties: { id: { type: 'integer' } } } },
  }, async (req, reply) => {
    const { id } = req.params as { id: number };
    const company = await one(
      `SELECT c.id, c.cnpj, c.razao_social, c.nome_fantasia,
              c.cnae_principal, cr.descricao AS cnae_descricao, c.cnae_secundarios,
              c.uf, c.municipio_id, m.nome AS cidade, c.regiao,
              c.porte, c.capital_social, c.situacao_cadastral, c.source,
              c.logradouro, c.numero, c.complemento, c.bairro, c.cep,
              c.telefone1, c.telefone2, c.email, c.fax,
              c.data_inicio_atividade, c.matriz_filial,
              c.natureza_juridica, rn.descricao AS natureza_descricao,
              c.qualificacao_responsavel, rq.descricao AS qualificacao_descricao,
              c.ente_federativo,
              c.motivo_situacao, rmo.descricao AS motivo_descricao,
              c.data_situacao_cadastral, c.situacao_especial, c.data_situacao_especial,
              c.nome_cidade_exterior, c.pais, rp.descricao AS pais_nome,
              c.opcao_simples, c.data_opcao_simples, c.data_exclusao_simples,
              c.opcao_mei, c.data_opcao_mei, c.data_exclusao_mei,
              ST_Y(c.geom::geometry) AS lat, ST_X(c.geom::geometry) AS lon,
              c.raw_data
       FROM companies c
       LEFT JOIN municipios m ON m.id = c.municipio_id
       LEFT JOIN cnae_reference cr ON cr.codigo = c.cnae_principal
       LEFT JOIN rfb_natureza rn ON rn.codigo = c.natureza_juridica
       LEFT JOIN rfb_qualificacao rq ON rq.codigo = c.qualificacao_responsavel
       LEFT JOIN rfb_motivo rmo ON rmo.codigo = c.motivo_situacao
       LEFT JOIN rfb_pais rp ON rp.codigo = c.pais
       WHERE c.id = $1`,
      [id],
    );
    if (!company) return reply.code(404).send({ error: 'empresa não encontrada' });

    // quadro societário (ligado pelo cnpj_base = 8 primeiros dígitos do CNPJ)
    const socios = await query(
      `SELECT s.identificador, s.nome, s.cnpj_cpf,
              s.qualificacao, q.descricao AS qualificacao_descricao,
              s.data_entrada, s.faixa_etaria,
              s.nome_representante, s.representante_legal
       FROM socios s
       LEFT JOIN rfb_qualificacao q ON q.codigo = s.qualificacao
       WHERE s.cnpj_base = left((SELECT cnpj FROM companies WHERE id = $1), 8)
       ORDER BY s.nome`,
      [id],
    );
    return { company, socios };
  });
}
