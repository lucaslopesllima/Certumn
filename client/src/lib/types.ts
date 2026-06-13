export interface Recommendation {
  id: string;
  cnpj: string;
  razao_social: string;
  nome_fantasia: string | null;
  cnae_principal: number;
  municipio_id: number;
  uf: string;
  porte: string;
  capital_social: string;
  lat: number;
  lon: number;
  score: number;
  reason: {
    cnae_match: 'classe' | 'divisao' | 'secao' | 'nenhum';
    cnae_principal: number;
    distancia_km: number;
    porte: string;
    capital_social: number;
    componentes: { cnae: number; proximidade: number; porte: number };
  };
}

export interface Profile {
  org_id: string;
  user_id: number | null;
  cnaes_alvo: number[];
  territorio_municipios: number[];
  territorio_raio_km: number | null;
  pesos: { cnae: number; proximidade: number; porte: number };
  origem_endereco: string | null;
  origem_lat: number | null;
  origem_lon: number | null;
}

export interface Municipio { id: number; nome: string; uf: string; regiao: string }

export interface CnaeItem { codigo: number; descricao: string; secao: string; divisao: number }
export interface CnaeGrupo { divisao: number; secao: string; itens: CnaeItem[] }

export interface Stage { id: number; nome: string; ordem: number }

export interface RepresentedCompany {
  id: number; nome: string; cnpj: string | null; segmento: string | null;
  site: string | null; contato: string | null; notas: string | null; ativo: boolean;
}
export interface KanbanCard {
  id: number; company_id: number; stage_id: number | null; status: string;
  owner_user_id: number | null;
  valor_estimado: string | null; notas: string | null; razao_social: string; nome_fantasia: string | null;
  uf: string; municipio_id: number; cidade: string | null;
  cnpj: string; cnae_principal: number; porte: string; capital_social: string;
  // FKs into the prospecção cadastros + their joined labels.
  represented_id: number | null; representada: string | null;
  marca_id: number | null; marca: string | null;
  contatos: { id: number; nome: string; cargo: string | null }[];
  catalogo: { id: number; nome: string; codigo: string | null; preco: string | null }[];
  cenario_id: number | null; cenario: string | null;
  acao_id: number | null; acao: string | null;
  data_contato: string | null; previsao_data: string | null;
  motivo_descarte: string | null;
}

export interface Socio {
  identificador: number | null; nome: string | null; cnpj_cpf: string | null;
  qualificacao: number | null; qualificacao_descricao: string | null;
  data_entrada: string | null; faixa_etaria: number | null;
  nome_representante: string | null; representante_legal: string | null;
}

export interface CompanyDetail {
  id: number; cnpj: string; razao_social: string; nome_fantasia: string | null;
  cnae_principal: number; cnae_descricao: string | null; cnae_secundarios: number[];
  uf: string; municipio_id: number | null; cidade: string | null; regiao: string;
  porte: string; capital_social: string; situacao_cadastral: string; source: string;
  logradouro: string | null; numero: string | null; complemento: string | null;
  bairro: string | null; cep: string | null;
  telefone1: string | null; telefone2: string | null; email: string | null; fax: string | null;
  data_inicio_atividade: string | null; matriz_filial: number | null;
  natureza_juridica: number | null; natureza_descricao: string | null;
  qualificacao_responsavel: number | null; qualificacao_descricao: string | null;
  ente_federativo: string | null;
  motivo_situacao: number | null; motivo_descricao: string | null;
  data_situacao_cadastral: string | null; situacao_especial: string | null;
  data_situacao_especial: string | null;
  nome_cidade_exterior: string | null; pais: number | null; pais_nome: string | null;
  opcao_simples: string | null; data_opcao_simples: string | null; data_exclusao_simples: string | null;
  opcao_mei: string | null; data_opcao_mei: string | null; data_exclusao_mei: string | null;
  lat: number | null; lon: number | null; raw_data: Record<string, unknown> | null;
  geo_lat: number | null; geo_lon: number | null; geo_precisao: string | null;
}

export interface GeocodeResult {
  lat: number; lon: number; precisao: string; fonte: string; cached: boolean;
}

export interface CatalogItem {
  id: number; nome: string; codigo: string | null; descricao: string | null;
  preco: string | null; represented_id: number | null; ativo: boolean;
}

export interface Brand { id: number; represented_id: number; nome: string }
export interface Contact {
  id: number; nome: string; cargo: string | null; email: string | null; telefone: string | null;
  company_id: number | null; represented_id: number | null;
}
export interface NamedItem { id: number; nome: string }

export interface AccountOrg {
  id: number; nome: string; cnpj: string | null; telefone: string | null;
  cep: string | null; logradouro: string | null; numero: string | null; complemento: string | null;
  bairro: string | null; cidade: string | null; uf: string | null;
}
export interface AccountUser { id: number; email: string; role: string }

export interface Relationship {
  id: number; company_id: number; stage_id: number | null; status: string;
  valor_estimado: string | null; notas: string | null; razao_social: string;
}

export interface VisitReport { resultado: string; proximo_passo: string | null; texto: string | null }
export interface Activity {
  id: number; tipo: string; titulo: string; start_at: string; end_at: string | null;
  company_id: number | null; status: string; razao_social: string | null;
  checkin_lat?: number | null; checkin_lon?: number | null; checkin_at?: string | null;
  relatorio?: VisitReport | null;
}

export interface Vehicle {
  id: number; nome: string; placa: string | null;
  combustivel: 'gasolina' | 'etanol' | 'diesel' | 'flex';
  consumo_kml: string; tanque_litros: string | null; preco_litro: string | null; ativo: boolean;
}

// Empresa do funil selecionável para montar a rota (subset de GET /api/relationships).
export interface FunnelCompany {
  id: number; company_id: number; razao_social: string; nome_fantasia: string | null;
  uf: string; municipio_id: number; lat: number | null; lon: number | null;
}

export interface RouteStop {
  seq: number; company_id: number; razao_social: string; nome_fantasia: string | null;
  uf: string; cidade: string | null; lat: number; lon: number;
  leg_dist_km: number | null; leg_dur_min: number | null;
}

export interface OptimizeResult {
  origem: { lat: number; lon: number };
  stops: RouteStop[];
  dist_km: number; dur_min: number;
  preco_litro: number | null; litros: number | null; custo_total: number | null;
  geometry: { coordinates: [number, number][] };
  skipped: number[];
}

export interface SavedRoute {
  id: number; nome: string; vehicle_id: number | null; veiculo: string | null;
  dist_km: string | null; dur_min: string | null; litros: string | null;
  custo_total: string | null; template?: boolean; recorrencia?: string | null;
  created_at: string; paradas: string;
}

export interface PriceTableItem {
  id: number; catalog_item_id: number; preco: string; desconto_max_pct: string | null;
  catalog_nome: string; codigo: string | null;
}
export interface PriceTable {
  id: number; represented_id: number; nome: string;
  vigencia_inicio: string; vigencia_fim: string | null; ativo: boolean;
  created_at: string; represented_nome: string; itens: number;
  items?: PriceTableItem[];
}

export interface Carrier {
  id: number; nome: string; cnpj: string | null; telefone: string | null;
  email: string | null; contato: string | null; observacoes: string | null; ativo: boolean;
}

export type OrderStatus = 'cotacao' | 'rascunho' | 'enviado' | 'faturado' | 'entregue' | 'cancelado';
export interface OrderItem {
  id: number; catalog_item_id: number | null; descricao_snapshot: string;
  qtd: string; preco_unit: string; desconto_pct: string; ipi_pct: string; st_pct: string; total: string;
}
export interface Order {
  id: number; numero: number; relationship_id: number | null; company_id: number;
  represented_id: number; owner_user_id: number | null; price_table_id: number | null;
  status: OrderStatus; validade: string | null;
  condicao_pagamento: string | null; transportadora: string | null;
  carrier_id: number | null; carrier_nome: string | null;
  frete: string; observacoes: string | null; total: string;
  nf_numero: string | null; emitido_em: string | null; faturado_em: string | null;
  created_at: string; updated_at: string;
  company_nome: string; company_cnpj: string; represented_nome: string;
  owner_email: string | null; owner_nome: string | null;
  items?: OrderItem[];
}

export type CommissionStatus = 'prevista' | 'recebida' | 'divergente' | 'cancelada';
export interface CommissionEntry {
  id: number; order_id: number; user_id: number | null; represented_id: number;
  competencia: string; valor_previsto: string; valor_recebido: string | null;
  percent_aplicado: string; vendedor_split_pct: string;
  status: CommissionStatus; recebida_em: string | null; observacao: string | null;
  finance_entry_id: number | null; created_at: string;
  order_numero: number; nf_numero: string | null; order_total: string;
  company_nome: string; represented_nome: string;
  vendedor_nome: string | null; vendedor_email: string | null;
  valor_vendedor: string;
}

export interface CommissionRule {
  id: number; represented_id: number; catalog_item_id: number | null;
  company_id: number | null; user_id: number | null;
  percent: string; vendedor_split_pct: string;
  vigencia_inicio: string; vigencia_fim: string | null; ativo: boolean; created_at: string;
  represented_nome: string; catalog_nome: string | null; company_nome: string | null;
  user_nome: string | null; user_email: string | null;
}

export interface OrgUser {
  id: number; nome: string | null; email: string; role: string; ativo: boolean;
  must_change_password?: boolean;
}

export interface Goal {
  id: number; user_id: number; represented_id: number | null;
  competencia: string; valor_meta: string; created_at: string;
  vendedor_nome: string | null; vendedor_email: string | null; represented_nome: string | null;
}

export interface GoalProgress {
  id: number; user_id: number; represented_id: number | null; competencia: string;
  valor_meta: string; realizado: number; pct: number | null;
  vendedor_nome: string | null; vendedor_email: string | null; represented_nome: string | null;
}

export interface FinanceEntry {
  id: number;
  kind: 'pagar' | 'receber';
  descricao: string;
  valor: string;
  vencimento: string;
  liquidacao_data: string | null;
  status: 'pendente' | 'liquidado' | 'cancelado';
  categoria: string | null;
  notas: string | null;
  company_id: number | null;
  represented_id: number | null;
  activity_id: number | null;
  owner_user_id: number | null;
  created_at: string;
  company_nome: string | null;
  represented_nome: string | null;
  activity_titulo: string | null;
}
