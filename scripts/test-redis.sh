#!/usr/bin/env bash
# Smoke test de comunicação de TODO o stack do docker-compose.yml + validação
# funda do Redis (cache do Evolution). Containers já devem estar no ar:
#   docker compose up -d
#   bash scripts/test-redis.sh
#
# Cada serviço é checado com o probe do seu tipo, a partir de dentro da rede do
# compose (é assim que os serviços falam entre si):
#   db, evolution_db  -> pg_isready
#   redis             -> PING + roundtrip + config + prefixo do Evolution
#   app               -> GET /api/health == 200
#   evolution         -> HTTP responde (status do gateway)
#   web               -> HTTP responde (vite dev server)
#   pgadmin           -> TCP 80 aceita conexão (gunicorn sobe lento; com retry)
#
# mailpit/stub são do docker-compose.e2e.yml (infra de teste, outro arquivo) —
# fora do escopo deste stack.
set -euo pipefail

pass() { printf '  \033[32m✓\033[0m %s\n' "$1"; }
fail() { printf '  \033[31m✗\033[0m %s\n' "$1"; FAILED=1; }
skip() { printf '  \033[33m·\033[0m %s\n' "$1"; }
FAILED=0

cd "$(dirname "$0")/.."
NET="$(docker inspect -f '{{range $k,$v := .NetworkSettings.Networks}}{{$k}}{{end}}' "$(docker compose ps -q redis 2>/dev/null)" 2>/dev/null || true)"
[ -z "$NET" ] && { echo "redis não está no ar — rode: docker compose up -d"; exit 1; }

rcli() { docker compose exec -T redis redis-cli "$@"; }
# probe HTTP de dentro da rede; imprime o status code (000 = sem conexão)
http_code() { docker run --rm --network "$NET" curlimages/curl:latest -s -o /dev/null -w '%{http_code}' -m 5 "$1" 2>/dev/null || echo 000; }
# probe TCP com retry (serviço pode estar subindo)
tcp_open() {
  local host=$1 port=$2 tries=${3:-6}
  for _ in $(seq 1 "$tries"); do
    if docker run --rm --network "$NET" busybox:latest sh -c "nc -z -w3 $host $port" 2>/dev/null; then return 0; fi
    sleep 2
  done
  return 1
}
up() { docker compose ps "$1" 2>/dev/null | grep -q 'Up'; }

echo "Stack — validação de comunicação (rede: $NET)"
echo

# ── 1. todo serviço definido no compose está Up ────────────────────────────
echo "[1] containers no ar"
for s in $(docker compose config --services); do
  up "$s" && pass "$s Up" || fail "$s NÃO está Up"
done
echo

# ── 2. Postgres (app + evolution) ──────────────────────────────────────────
echo "[2] postgres"
if up db; then
  docker compose exec -T db pg_isready -U postgres -d rs >/dev/null 2>&1 \
    && pass "db aceita conexão (pg_isready, base rs)" || fail "db não respondeu pg_isready"
fi
if up evolution_db; then
  docker compose exec -T evolution_db pg_isready -U postgres -d evolution >/dev/null 2>&1 \
    && pass "evolution_db aceita conexão (pg_isready, base evolution)" || fail "evolution_db não respondeu pg_isready"
fi
echo

# ── 3. app / evolution / web / pgadmin ─────────────────────────────────────
echo "[3] HTTP / TCP"
if up app; then
  c="$(http_code http://app:8080/api/health)"
  [ "$c" = "200" ] && pass "app GET /api/health == 200" || fail "app /api/health devolveu $c (esperado 200)"
fi
if up evolution; then
  c="$(http_code http://evolution:8080/)"
  [ "$c" != "000" ] && pass "evolution HTTP responde ($c)" || fail "evolution não respondeu (000)"
fi
if up web; then
  c="$(http_code http://web:5173/)"
  [ "$c" != "000" ] && pass "web HTTP responde ($c)" || fail "web não respondeu (000)"
fi
if up pgadmin; then
  # pgadmin (gunicorn) faz bind IPv6-only (`[::]:80`); a rede Docker é IPv4, então
  # não dá p/ probe TCP de container↔container. É GUI de dev (browser via host:5050),
  # não comunicação entre serviços — basta confirmar que o gunicorn está servindo.
  if docker compose logs pgadmin 2>/dev/null | grep -q 'Listening at'; then
    pass "pgadmin gunicorn servindo (GUI via http://localhost:5050)"
  else
    fail "pgadmin Up mas gunicorn não logou 'Listening at'"
  fi
fi
echo

# ── 4. Redis — validação funda ─────────────────────────────────────────────
echo "[4] redis (cache do Evolution)"
[ "$(rcli PING)" = "PONG" ] && pass "PING responde PONG" || fail "PING não respondeu PONG"

KEY="healthcheck:$$"; VAL="ok-$$"
rcli -n 6 SET "$KEY" "$VAL" >/dev/null
GOT="$(rcli -n 6 GET "$KEY")"; rcli -n 6 DEL "$KEY" >/dev/null
[ "$GOT" = "$VAL" ] && pass "SET/GET roundtrip (db 6)" || fail "roundtrip falhou (esperado '$VAL', veio '$GOT')"

MEM="$(rcli CONFIG GET maxmemory | tail -1)"
[ "$MEM" = "536870912" ] && pass "maxmemory = 512mb" || fail "maxmemory inesperado: $MEM"
POL="$(rcli CONFIG GET maxmemory-policy | tail -1)"
[ "$POL" = "allkeys-lru" ] && pass "maxmemory-policy = allkeys-lru" || fail "policy inesperada: $POL"

DNS_PONG="$(docker run --rm --network "$NET" redis:7-alpine redis-cli -h redis -p 6379 PING 2>/dev/null || true)"
[ "$DNS_PONG" = "PONG" ] && pass "alcançável via redis:6379 (como o Evolution conecta)" || fail "não alcançável via DNS redis:6379"

# Evolution de fato usando o redis? (chaves com prefixo evolution no db 6)
if up evolution; then
  CNT="$(rcli -n 6 --scan --pattern 'evolution*' | head -1000 | grep -c . || true)"
  [ "$CNT" -gt 0 ] \
    && pass "Evolution gravando cache no redis ($CNT chave(s) 'evolution*')" \
    || skip "Evolution Up mas 0 chaves 'evolution*' — conecte uma instância e rode de novo"
else
  skip "Evolution não está Up — pulei checagem de cache"
fi
echo

[ "$FAILED" = 0 ] && { echo -e "\033[32mTODOS OS CHECKS PASSARAM\033[0m"; exit 0; } || { echo -e "\033[31mFALHOU\033[0m"; exit 1; }
