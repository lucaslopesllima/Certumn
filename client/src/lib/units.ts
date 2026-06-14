// Unidades de medida usadas no Brasil (base nos códigos de unidade comercial da NF-e).
// `value` = sigla gravada no produto (catalog_items.unidade_medida, texto livre).
// `label` = descrição exibida ao usuário. Lista é sugestão (datalist), não enum rígido.

export interface UnitOption { value: string; label: string }
export interface UnitGroup { grupo: string; itens: readonly UnitOption[] }

export const UNIDADES_MEDIDA: readonly UnitOption[] = [
  // Contagem / embalagem
  { value: 'UN', label: 'Unidade' },
  { value: 'PC', label: 'Peça' },
  { value: 'CX', label: 'Caixa' },
  { value: 'PCT', label: 'Pacote' },
  { value: 'FD', label: 'Fardo' },
  { value: 'SC', label: 'Saco' },
  { value: 'GL', label: 'Galão' },
  { value: 'RL', label: 'Rolo' },
  { value: 'KIT', label: 'Kit' },
  { value: 'JG', label: 'Jogo' },
  { value: 'DZ', label: 'Dúzia' },
  { value: 'PAR', label: 'Par' },
  { value: 'CENTO', label: 'Cento' },
  { value: 'MIL', label: 'Milheiro' },
  { value: 'AMP', label: 'Ampola' },
  { value: 'FR', label: 'Frasco' },
  { value: 'BL', label: 'Bloco' },
  { value: 'LATA', label: 'Lata' },
  { value: 'TB', label: 'Tubo' },
  { value: 'RESMA', label: 'Resma' },
  // Massa
  { value: 'KG', label: 'Quilograma' },
  { value: 'G', label: 'Grama' },
  { value: 'MG', label: 'Miligrama' },
  { value: 'TON', label: 'Tonelada' },
  // Volume
  { value: 'L', label: 'Litro' },
  { value: 'ML', label: 'Mililitro' },
  { value: 'M3', label: 'Metro cúbico' },
  // Comprimento
  { value: 'M', label: 'Metro' },
  { value: 'CM', label: 'Centímetro' },
  { value: 'MM', label: 'Milímetro' },
  { value: 'KM', label: 'Quilômetro' },
  // Área
  { value: 'M2', label: 'Metro quadrado' },
] as const;

// Mesma lista agrupada para uso em <select> com <optgroup>.
export const UNIDADES_MEDIDA_GRUPOS: readonly UnitGroup[] = [
  {
    grupo: 'Contagem / embalagem',
    itens: [
      { value: 'UN', label: 'Unidade' }, { value: 'PC', label: 'Peça' },
      { value: 'CX', label: 'Caixa' }, { value: 'PCT', label: 'Pacote' },
      { value: 'FD', label: 'Fardo' }, { value: 'SC', label: 'Saco' },
      { value: 'GL', label: 'Galão' }, { value: 'RL', label: 'Rolo' },
      { value: 'KIT', label: 'Kit' }, { value: 'JG', label: 'Jogo' },
      { value: 'DZ', label: 'Dúzia' }, { value: 'PAR', label: 'Par' },
      { value: 'CENTO', label: 'Cento' }, { value: 'MIL', label: 'Milheiro' },
      { value: 'AMP', label: 'Ampola' }, { value: 'FR', label: 'Frasco' },
      { value: 'BL', label: 'Bloco' }, { value: 'LATA', label: 'Lata' },
      { value: 'TB', label: 'Tubo' }, { value: 'RESMA', label: 'Resma' },
    ],
  },
  {
    grupo: 'Massa',
    itens: [
      { value: 'KG', label: 'Quilograma' }, { value: 'G', label: 'Grama' },
      { value: 'MG', label: 'Miligrama' }, { value: 'TON', label: 'Tonelada' },
    ],
  },
  {
    grupo: 'Volume',
    itens: [
      { value: 'L', label: 'Litro' }, { value: 'ML', label: 'Mililitro' },
      { value: 'M3', label: 'Metro cúbico' },
    ],
  },
  {
    grupo: 'Comprimento',
    itens: [
      { value: 'M', label: 'Metro' }, { value: 'CM', label: 'Centímetro' },
      { value: 'MM', label: 'Milímetro' }, { value: 'KM', label: 'Quilômetro' },
    ],
  },
  {
    grupo: 'Área',
    itens: [{ value: 'M2', label: 'Metro quadrado' }],
  },
] as const;
