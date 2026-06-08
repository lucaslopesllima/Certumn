// Estimativa de combustível de uma rota. Lógica pura (sem I/O), fácil de testar.
//   litros = distância_km / consumo_kml
//   custo  = litros * preço_litro
// Retorna null quando faltam dados (sem veículo, consumo inválido ou sem preço).
export interface FuelInput {
  distKm: number;
  consumoKml?: number | null;   // km por litro
  precoLitro?: number | null;   // R$ por litro
}

export interface FuelEstimate {
  litros: number;
  custo: number | null;         // null quando não há preço do litro
}

export function fuelEstimate({ distKm, consumoKml, precoLitro }: FuelInput): FuelEstimate | null {
  if (!consumoKml || consumoKml <= 0 || !(distKm >= 0)) return null;
  const litros = distKm / consumoKml;
  const custo = precoLitro && precoLitro > 0 ? litros * precoLitro : null;
  return { litros, custo };
}
