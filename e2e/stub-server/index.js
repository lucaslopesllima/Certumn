// Stub HTTP único para as dependências externas do server em e2e: Nominatim,
// BrasilAPI (geocode), OSRM (roteamento) e Evolution API (WhatsApp). Respostas
// determinísticas — sem rede real, sem rate-limit, sem depender de serviço
// público terceiro durante a suíte. Zero dependências (só node:http).
import { createServer } from 'node:http';

const PORT = 8099;

function send(res, status, body) {
  const json = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(json);
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => { data += c; });
    req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch { resolve({}); } });
  });
}

// Coordenada fixa (São Paulo) para qualquer geocode de endereço/CEP — os testes
// que dependem de geocode olham a origem/destino de forma relativa, não o ponto exato.
const FIXED = { lat: -23.5505, lon: -46.6333 };

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const path = url.pathname;
  const method = req.method ?? 'GET';

  // ── Nominatim (Nominatim /search, geocode.ts) ─────────────────────────
  if (path === '/search') {
    return send(res, 200, [{ lat: String(FIXED.lat), lon: String(FIXED.lon), addresstype: 'building', display_name: 'Endereço E2E, São Paulo, SP' }]);
  }

  // ── BrasilAPI CEP v2 ───────────────────────────────────────────────────
  if (path.startsWith('/api/cep/v2/')) {
    return send(res, 200, { location: { coordinates: { latitude: FIXED.lat, longitude: FIXED.lon } } });
  }

  // ── OSRM /trip/v1/driving/:coords ──────────────────────────────────────
  if (path.startsWith('/trip/v1/driving/')) {
    const coordStr = path.slice('/trip/v1/driving/'.length);
    const pts = coordStr.split(';').map((p) => p.split(',').map(Number));
    const n = pts.length;
    if (n < 2) return send(res, 200, { code: 'InvalidUrl' });
    // Identidade: nenhuma reordenação — determinístico e fácil de asserir nos testes.
    const legDist = 5000; // 5km por trecho
    const legDur = 600;   // 10min por trecho
    const legs = Array.from({ length: n - 1 }, () => ({ distance: legDist, duration: legDur }));
    const waypoints = pts.map((_, i) => ({ waypoint_index: i }));
    return send(res, 200, {
      code: 'Ok',
      waypoints,
      trips: [{
        distance: legDist * (n - 1),
        duration: legDur * (n - 1),
        geometry: { coordinates: pts },
        legs,
      }],
    });
  }

  // ── Evolution API (prefixo /evolution) ─────────────────────────────────
  if (path.startsWith('/evolution/')) {
    const sub = path.slice('/evolution'.length);
    await readBody(req);

    if (sub === '/instance/create' && method === 'POST') return send(res, 200, { instance: { instanceName: 'stub' } });
    if (sub.startsWith('/instance/connect/') && method === 'GET') {
      return send(res, 200, { base64: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', code: 'stub-qr-code', instance: { state: 'connecting' } });
    }
    if (sub.startsWith('/instance/connectionState/') && method === 'GET') return send(res, 200, { instance: { state: 'open' } });
    if (sub.startsWith('/instance/logout/') && method === 'DELETE') return send(res, 200, { ok: true });
    if (sub.startsWith('/message/sendText/') && method === 'POST') return send(res, 200, { key: { id: `stub-msg-${Date.now()}` } });
    if (sub.startsWith('/message/sendMedia/') && method === 'POST') return send(res, 200, { key: { id: `stub-media-${Date.now()}` } });
    if (sub.startsWith('/message/sendWhatsAppAudio/') && method === 'POST') return send(res, 200, { key: { id: `stub-audio-${Date.now()}` } });
    if (sub.startsWith('/chat/whatsappNumbers/') && method === 'POST') return send(res, 200, [{ exists: true, jid: '5511999999999@s.whatsapp.net', number: '5511999999999' }]);
    if (sub.startsWith('/chat/getBase64FromMediaMessage/') && method === 'POST') return send(res, 200, { base64: 'AAAA', mimetype: 'image/png', fileName: 'stub.png' });
    if (sub.startsWith('/chat/markMessageAsRead/') && method === 'POST') return send(res, 200, { ok: true });
    if (sub.startsWith('/chat/sendPresence/') && method === 'POST') return send(res, 200, { ok: true });
    if (sub.startsWith('/chat/fetchProfilePictureUrl/') && method === 'POST') return send(res, 200, { profilePictureUrl: null });
    if (sub.startsWith('/group/findGroupInfos/') && method === 'GET') return send(res, 200, { subject: 'Grupo E2E', desc: 'stub', size: 2, participants: [] });
    if (sub.startsWith('/group/fetchAllGroups/') && method === 'GET') return send(res, 200, []);
    return send(res, 404, { message: 'stub: rota evolution não implementada' });
  }

  return send(res, 404, { error: 'stub: rota não encontrada', path });
});

server.listen(PORT, () => console.log(`stub-server ouvindo em :${PORT}`));
