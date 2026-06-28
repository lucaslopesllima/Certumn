// Geocodificação sob demanda do endereço de uma empresa -> lat/lon.
// 1) Nominatim (OSM) com busca estruturada (rua + número + cidade + UF + CEP) -> nível de rua.
// 2) fallback BrasilAPI CEP v2 -> coordenada do CEP (nível de quadra), quando o CEP tem geo.
// Nominatim exige User-Agent e no máx ~1 req/s: throttle global simples.

export interface GeoResult { lat: number; lon: number; precisao: string; fonte: string; }

export interface Addr {
  logradouro?: string | null; numero?: string | null; bairro?: string | null;
  cep?: string | null; cidade?: string | null; uf?: string | null;
}

let lastNominatim = 0;
async function throttleNominatim(): Promise<void> {
  const wait = Math.max(0, lastNominatim + 1100 - Date.now());
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastNominatim = Date.now();
}

async function nominatim(a: Addr): Promise<GeoResult | null> {
  const street = [a.numero, a.logradouro].filter(Boolean).join(' ').trim();
  if (!street && !a.cep) return null;
  const params = new URLSearchParams({ format: 'jsonv2', limit: '1', countrycodes: 'br' });
  if (street) params.set('street', street);
  if (a.cidade) params.set('city', a.cidade);
  if (a.uf) params.set('state', a.uf);
  if (a.cep) params.set('postalcode', a.cep);
  try {
    await throttleNominatim();
    const resp = await fetch(`https://nominatim.openstreetmap.org/search?${params.toString()}`, {
      headers: { 'User-Agent': 'RepresentativeSeller/1.0 (geocode sob demanda)', 'Accept-Language': 'pt-BR' },
    });
    if (!resp.ok) return null;
    const arr = await resp.json() as { lat: string; lon: string; addresstype?: string }[];
    if (!arr.length) return null;
    const r = arr[0]!;
    const precisao = (street && (r.addresstype === 'building' || r.addresstype === 'house')) ? 'rua' : street ? 'rua_aprox' : 'cep';
    return { lat: Number(r.lat), lon: Number(r.lon), precisao, fonte: 'nominatim' };
  } catch {
    return null;
  }
}

async function brasilapiCep(cep?: string | null): Promise<GeoResult | null> {
  const c = (cep ?? '').replace(/\D/g, '');
  if (c.length !== 8) return null;
  try {
    const resp = await fetch(`https://brasilapi.com.br/api/cep/v2/${c}`);
    if (!resp.ok) return null;
    const j = await resp.json() as { location?: { coordinates?: { latitude?: string | number; longitude?: string | number } } };
    const co = j.location?.coordinates;
    if (co?.latitude != null && co?.longitude != null) {
      return { lat: Number(co.latitude), lon: Number(co.longitude), precisao: 'cep', fonte: 'brasilapi' };
    }
  } catch { /* ignore */ }
  return null;
}

export async function geocodeAddr(a: Addr): Promise<GeoResult | null> {
  return (await nominatim(a)) ?? (await brasilapiCep(a.cep));
}

// Geocodificação de endereço em texto livre (ex.: "Av. Paulista 1000, São Paulo")
// -> lat/lon + rótulo normalizado. Usado pela origem de partida das rotas, que o
// usuário digita à mão nos filtros. Mesmo throttle/User-Agent do Nominatim.
export async function geocodeText(q: string): Promise<(GeoResult & { label: string }) | null> {
  const term = q.trim();
  if (term.length < 3) return null;
  const params = new URLSearchParams({ format: 'jsonv2', limit: '1', countrycodes: 'br', q: term });
  try {
    await throttleNominatim();
    const resp = await fetch(`https://nominatim.openstreetmap.org/search?${params.toString()}`, {
      headers: { 'User-Agent': 'RepresentativeSeller/1.0 (geocode sob demanda)', 'Accept-Language': 'pt-BR' },
    });
    if (!resp.ok) return null;
    const arr = await resp.json() as { lat: string; lon: string; display_name?: string }[];
    if (!arr.length) return null;
    const r = arr[0]!;
    return { lat: Number(r.lat), lon: Number(r.lon), precisao: 'texto', fonte: 'nominatim', label: r.display_name ?? term };
  } catch {
    return null;
  }
}
