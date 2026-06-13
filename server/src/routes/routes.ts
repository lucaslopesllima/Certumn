import type { FastifyInstance } from 'fastify';
import { one, query, withClient } from '../db.ts';
import { requireAuth } from '../auth.ts';
import { geocodeAddr } from '../geocode.ts';
import { fuelEstimate } from '../fuel.ts';
import { scopeOwner, canWriteOwned } from '../scope.ts';

// Planejador de rota. Empresas selecionadas (do funil) -> melhor ordem de visita
// (TSP via OSRM /trip público) -> distância/duração ida-e-volta -> custo de combustível
// a partir do veículo cadastrado. POST /optimize só calcula (preview); POST / persiste.

const MAX_STOPS = 25;                 // limite do OSRM público (ida+volta = MAX_STOPS+1 pontos)
const OSRM = 'https://router.project-osrm.org';

type Geo = { lat: number; lon: number };

// Origem da rota = endereço da org (representante), geocodificado + cacheado.
// Mesma lógica de GET /api/account/origem, reaproveitada aqui.
async function resolveOrigem(orgId: number): Promise<Geo | null> {
  const org = await one<{
    logradouro: string | null; numero: string | null; bairro: string | null;
    cep: string | null; cidade: string | null; uf: string | null;
    origem_lat: number | null; origem_lon: number | null;
  }>(
    `SELECT logradouro, numero, bairro, cep, cidade, uf, origem_lat, origem_lon
     FROM organizations WHERE id = $1`, [orgId],
  );
  if (!org) return null;
  if (org.origem_lat != null && org.origem_lon != null) return { lat: org.origem_lat, lon: org.origem_lon };
  if (!org.logradouro && !org.cep && !org.cidade) return null;
  const g = await geocodeAddr(org);
  if (!g) return null;
  await query('UPDATE organizations SET origem_lat = $1, origem_lon = $2 WHERE id = $3', [g.lat, g.lon, orgId]);
  return { lat: g.lat, lon: g.lon };
}

// Geocode de uma empresa: cache -> geocodificação do endereço -> centroide do município.
async function geocodeCompany(id: number): Promise<Geo | null> {
  const cached = await one<Geo>('SELECT lat, lon FROM company_geocode WHERE company_id = $1', [id]);
  if (cached) return cached;

  const c = await one<{
    logradouro: string | null; numero: string | null; bairro: string | null;
    cep: string | null; cidade: string | null; uf: string | null; lat: number | null; lon: number | null;
  }>(
    `SELECT c.logradouro, c.numero, c.bairro, c.cep, m.nome AS cidade, c.uf,
            ST_Y(c.geom::geometry) AS lat, ST_X(c.geom::geometry) AS lon
     FROM companies c LEFT JOIN municipios m ON m.id = c.municipio_id
     WHERE c.id = $1`, [id],
  );
  if (!c) return null;

  const g = await geocodeAddr(c);
  if (g) {
    await query(
      `INSERT INTO company_geocode (company_id, lat, lon, precisao, fonte)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (company_id) DO UPDATE
         SET lat = EXCLUDED.lat, lon = EXCLUDED.lon, precisao = EXCLUDED.precisao,
             fonte = EXCLUDED.fonte, atualizado_em = now()`,
      [id, g.lat, g.lon, g.precisao, g.fonte],
    );
    return { lat: g.lat, lon: g.lon };
  }
  if (c.lat != null && c.lon != null) return { lat: c.lat, lon: c.lon }; // centroide do município
  return null;
}

interface OsrmTrip {
  distance: number; duration: number;
  geometry: { coordinates: [number, number][] };
  legs: { distance: number; duration: number }[];
}
interface OsrmResp {
  code: string;
  trips?: OsrmTrip[];
  waypoints?: { waypoint_index: number }[];
}

// Resolve o TSP ida-e-volta no OSRM. `pts[0]` é a origem (source=first).
// Retorna a ordem ótima das paradas (sem a origem) + métricas e geometria.
async function osrmTrip(pts: Geo[]): Promise<{
  order: number[];                 // índices em `pts` (>=1) na ordem de visita
  distKm: number; durMin: number;
  coords: [number, number][];      // [lat, lon] p/ Leaflet
  legByPt: Record<number, { distKm: number; durMin: number }>; // métrica do trecho até cada ponto
}> {
  const coordStr = pts.map((p) => `${p.lon},${p.lat}`).join(';');
  const url = `${OSRM}/trip/v1/driving/${coordStr}?source=first&roundtrip=true&geometries=geojson&overview=full`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`OSRM ${resp.status}`);
  const j = (await resp.json()) as OsrmResp;
  if (j.code !== 'Ok' || !j.trips?.length || !j.waypoints) throw new Error(`OSRM ${j.code}`);
  const trip = j.trips[0]!;

  // waypoints[i].waypoint_index = posição do ponto i na rota otimizada.
  // legs[k] liga a posição k à k+1 na ordem otimizada.
  const order: number[] = [];                          // por posição otimizada (1..N) -> índice do ponto
  const legByPt: Record<number, { distKm: number; durMin: number }> = {};
  j.waypoints.forEach((w, i) => {
    if (i === 0) return;                               // pula a origem
    order[w.waypoint_index] = i;
    const leg = trip.legs[w.waypoint_index - 1];       // trecho da posição anterior até esta
    if (leg) legByPt[i] = { distKm: leg.distance / 1000, durMin: leg.duration / 60 };
  });

  return {
    order: order.filter((x) => x !== undefined),
    distKm: trip.distance / 1000,
    durMin: trip.duration / 60,
    coords: trip.geometry.coordinates.map(([lon, lat]) => [lat, lon] as [number, number]),
    legByPt,
  };
}

export function routePlanRoutes(app: FastifyInstance): void {
  // Calcula a melhor rota para as empresas selecionadas (preview, não persiste).
  app.post('/api/routes/optimize', {
    preHandler: requireAuth,
    schema: {
      body: {
        type: 'object',
        required: ['company_ids'],
        properties: {
          company_ids: { type: 'array', items: { type: 'integer' }, minItems: 1, maxItems: MAX_STOPS },
          vehicle_id: { type: ['integer', 'null'] },
          preco_litro: { type: ['number', 'null'] },
        },
      },
    },
  }, async (req, reply) => {
    const orgId = req.auth!.orgId;
    const { company_ids, vehicle_id, preco_litro } = req.body as {
      company_ids: number[]; vehicle_id?: number | null; preco_litro?: number | null;
    };
    const ids = [...new Set(company_ids)];

    const origem = await resolveOrigem(orgId);
    if (!origem) return reply.code(400).send({ error: 'Cadastre o endereço da sua conta para definir a origem da rota.' });

    // veículo (consumo/preço) — opcional. Validado por org.
    let consumoKml: number | null = null;
    let preco = preco_litro ?? null;
    if (vehicle_id != null) {
      const v = await one<{ consumo_kml: number; preco_litro: number | null }>(
        'SELECT consumo_kml, preco_litro FROM vehicles WHERE id = $1 AND org_id = $2', [vehicle_id, orgId],
      );
      if (!v) return reply.code(404).send({ error: 'veículo não encontrado' });
      consumoKml = Number(v.consumo_kml);
      if (preco == null) preco = v.preco_litro != null ? Number(v.preco_litro) : null;
    }

    // geocoda cada empresa (sequencial: respeita o throttle do Nominatim em geocode.ts)
    const geo: Record<number, Geo> = {};
    for (const id of ids) {
      const g = await geocodeCompany(id);
      if (g) geo[id] = g;
    }
    const located = ids.filter((id) => geo[id]);
    if (located.length === 0) return reply.code(400).send({ error: 'Nenhuma empresa selecionada tem localização.' });

    // metadados das empresas p/ exibir na lista de paradas
    const meta = await query<{ id: string; razao_social: string; nome_fantasia: string | null; uf: string; cidade: string | null }>(
      `SELECT c.id, c.razao_social, c.nome_fantasia, c.uf, m.nome AS cidade
       FROM companies c LEFT JOIN municipios m ON m.id = c.municipio_id
       WHERE c.id = ANY($1::bigint[])`, [located],
    );
    const metaById = new Map(meta.map((m) => [String(m.id), m]));

    const pts: Geo[] = [origem, ...located.map((id) => geo[id]!)];

    let trip: Awaited<ReturnType<typeof osrmTrip>>;
    try {
      trip = await osrmTrip(pts);
    } catch (e) {
      req.log.error({ err: e }, 'OSRM trip falhou');
      return reply.code(502).send({ error: 'Não foi possível calcular a rota (serviço de roteamento indisponível).' });
    }

    // pts index (>=1) -> company_id
    const idByPt = new Map<number, number>(located.map((id, i) => [i + 1, id]));
    const stops = trip.order.map((ptIdx, seq) => {
      const cid = idByPt.get(ptIdx)!;
      const m = metaById.get(String(cid));
      const leg = trip.legByPt[ptIdx];
      return {
        seq,
        company_id: cid,
        razao_social: m?.razao_social ?? '',
        nome_fantasia: m?.nome_fantasia ?? null,
        uf: m?.uf ?? '', cidade: m?.cidade ?? null,
        lat: geo[cid]!.lat, lon: geo[cid]!.lon,
        leg_dist_km: leg ? Number(leg.distKm.toFixed(2)) : null,
        leg_dur_min: leg ? Number(leg.durMin.toFixed(1)) : null,
      };
    });

    const fuel = fuelEstimate({ distKm: trip.distKm, consumoKml, precoLitro: preco });
    const skipped = ids.filter((id) => !geo[id]);

    return {
      origem,
      stops,
      dist_km: Number(trip.distKm.toFixed(2)),
      dur_min: Number(trip.durMin.toFixed(1)),
      preco_litro: preco,
      litros: fuel ? Number(fuel.litros.toFixed(2)) : null,
      custo_total: fuel?.custo != null ? Number(fuel.custo.toFixed(2)) : null,
      geometry: { coordinates: trip.coords },
      skipped, // empresas sem localização (ignoradas no cálculo)
    };
  });

  // Persiste uma rota já otimizada (resultado de /optimize).
  app.post('/api/routes', {
    preHandler: requireAuth,
    schema: {
      body: {
        type: 'object',
        required: ['nome', 'origem_lat', 'origem_lon', 'stops'],
        properties: {
          nome: { type: 'string', minLength: 1 },
          vehicle_id: { type: ['integer', 'null'] },
          origem_lat: { type: 'number' },
          origem_lon: { type: 'number' },
          dist_km: { type: ['number', 'null'] },
          dur_min: { type: ['number', 'null'] },
          preco_litro: { type: ['number', 'null'] },
          litros: { type: ['number', 'null'] },
          custo_total: { type: ['number', 'null'] },
          geometry: {},
          stops: {
            type: 'array', minItems: 1,
            items: {
              type: 'object',
              required: ['company_id', 'seq', 'lat', 'lon'],
              properties: {
                company_id: { type: 'integer' },
                seq: { type: 'integer' },
                lat: { type: 'number' }, lon: { type: 'number' },
                leg_dist_km: { type: ['number', 'null'] },
                leg_dur_min: { type: ['number', 'null'] },
              },
            },
          },
        },
      },
    },
  }, async (req, reply) => {
    const orgId = req.auth!.orgId;
    const b = req.body as {
      nome: string; vehicle_id?: number | null; origem_lat: number; origem_lon: number;
      dist_km?: number | null; dur_min?: number | null; preco_litro?: number | null;
      litros?: number | null; custo_total?: number | null; geometry?: unknown;
      stops: { company_id: number; seq: number; lat: number; lon: number; leg_dist_km?: number | null; leg_dur_min?: number | null }[];
    };

    // valida o veículo (se houver) pela org
    if (b.vehicle_id != null) {
      const v = await one('SELECT id FROM vehicles WHERE id = $1 AND org_id = $2', [b.vehicle_id, orgId]);
      if (!v) return reply.code(404).send({ error: 'veículo não encontrado' });
    }

    const route = await withClient(async (c) => {
      await c.query('BEGIN');
      try {
        const r = await c.query(
          `INSERT INTO routes (org_id, owner_user_id, vehicle_id, nome, origem_lat, origem_lon, dist_km, dur_min, preco_litro, litros, custo_total, geometry)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
          [orgId, req.auth!.userId, b.vehicle_id ?? null, b.nome, b.origem_lat, b.origem_lon,
            b.dist_km ?? null, b.dur_min ?? null, b.preco_litro ?? null, b.litros ?? null, b.custo_total ?? null,
            b.geometry != null ? JSON.stringify(b.geometry) : null],
        );
        const routeId = r.rows[0]!.id as number;
        for (const s of b.stops) {
          await c.query(
            `INSERT INTO route_stops (route_id, company_id, seq, lat, lon, leg_dist_km, leg_dur_min)
             VALUES ($1,$2,$3,$4,$5,$6,$7)`,
            [routeId, s.company_id, s.seq, s.lat, s.lon, s.leg_dist_km ?? null, s.leg_dur_min ?? null],
          );
        }
        await c.query('COMMIT');
        return { id: routeId };
      } catch (e) {
        await c.query('ROLLBACK');
        throw e;
      }
    });
    return reply.code(201).send({ route });
  });

  // Lista as rotas salvas da org. Rep vê as próprias + as compartilhadas
  // (owner NULL, criadas antes da Fase 3); admin tudo + filtro por vendedor.
  app.get('/api/routes', {
    preHandler: requireAuth,
    schema: { querystring: { type: 'object', properties: { owner_user_id: { type: 'integer' } } } },
  }, async (req) => {
    const orgId = req.auth!.orgId;
    const { owner_user_id } = req.query as { owner_user_id?: number };
    const where: string[] = ['r.org_id = $1'];
    const params: unknown[] = [orgId];
    scopeOwner(req, where, params, 'r.owner_user_id', owner_user_id, { nullVisible: true });
    const routes = await query(
      `SELECT r.id, r.nome, r.owner_user_id, r.vehicle_id, v.nome AS veiculo, r.dist_km, r.dur_min,
              r.litros, r.custo_total, r.created_at,
              (SELECT count(*) FROM route_stops s WHERE s.route_id = r.id) AS paradas
       FROM routes r LEFT JOIN vehicles v ON v.id = r.vehicle_id
       WHERE ${where.join(' AND ')} ORDER BY r.created_at DESC`, params,
    );
    return { routes };
  });

  // Detalhe de uma rota + paradas ordenadas.
  app.get('/api/routes/:id', {
    preHandler: requireAuth,
    schema: { params: { type: 'object', required: ['id'], properties: { id: { type: 'integer' } } } },
  }, async (req, reply) => {
    const orgId = req.auth!.orgId;
    const { id } = req.params as { id: number };
    const route = await one<Record<string, unknown> & { owner_user_id: string | null }>(
      `SELECT r.id, r.nome, r.owner_user_id, r.vehicle_id, v.nome AS veiculo, r.origem_lat, r.origem_lon,
              r.dist_km, r.dur_min, r.preco_litro, r.litros, r.custo_total, r.geometry, r.created_at
       FROM routes r LEFT JOIN vehicles v ON v.id = r.vehicle_id
       WHERE r.id = $1 AND r.org_id = $2`, [id, orgId],
    );
    if (!route) return reply.code(404).send({ error: 'rota não encontrada' });
    if (!canWriteOwned(req, route.owner_user_id === null ? null : Number(route.owner_user_id), { nullWritable: true })) {
      return reply.code(404).send({ error: 'rota não encontrada' });
    }
    const stops = await query(
      `SELECT s.seq, s.company_id, s.lat, s.lon, s.leg_dist_km, s.leg_dur_min,
              c.razao_social, c.nome_fantasia, c.uf, m.nome AS cidade
       FROM route_stops s
       JOIN companies c ON c.id = s.company_id
       LEFT JOIN municipios m ON m.id = c.municipio_id
       WHERE s.route_id = $1 ORDER BY s.seq`, [id],
    );
    return { route, stops };
  });

  app.delete('/api/routes/:id', {
    preHandler: requireAuth,
    schema: { params: { type: 'object', required: ['id'], properties: { id: { type: 'integer' } } } },
  }, async (req, reply) => {
    const orgId = req.auth!.orgId;
    const { id } = req.params as { id: number };
    const route = await one<{ owner_user_id: string | null }>(
      'SELECT owner_user_id FROM routes WHERE id = $1 AND org_id = $2', [id, orgId],
    );
    if (!route) return reply.code(404).send({ error: 'não encontrado' });
    if (!canWriteOwned(req, route.owner_user_id === null ? null : Number(route.owner_user_id), { nullWritable: true })) {
      return reply.code(403).send({ error: 'rota de outro vendedor' });
    }
    const rows = await query('DELETE FROM routes WHERE id = $1 AND org_id = $2 RETURNING id', [id, orgId]);
    if (rows.length === 0) return reply.code(404).send({ error: 'não encontrado' });
    return { deleted: true };
  });
}
