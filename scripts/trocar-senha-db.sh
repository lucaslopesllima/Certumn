#!/usr/bin/env bash
# Troca a senha do usuário Postgres nos DOIS bancos de produção (app + evolution)
# via ALTER USER, sem recriar volume. Pede a senha nova (não ecoa) e roda o ALTER.
#
# NÃO mexe no .env — depois de rodar, você atualiza POSTGRES_PASSWORD no .env
# manualmente e recria os serviços que conectam:
#
#   ./scripts/trocar-senha-db.sh
#   # edite .env -> POSTGRES_PASSWORD=<a mesma senha>
#   docker compose -f docker-compose.prod.yml up -d web evolution
#
# Rode na VPS, dentro do diretório do projeto.
set -euo pipefail

cd "$(dirname "$0")/.."
COMPOSE=(docker compose -f docker-compose.prod.yml)

# Usuário do banco (mesmo dos dois containers). Segue o default do compose.
DB_USER="${POSTGRES_USER:-postgres}"

# --- lê a senha nova sem ecoar, com confirmação ---
read -r -s -p "Senha nova do Postgres: " NOVA_SENHA; echo
read -r -s -p "Confirme a senha:       " CONFIRMA;    echo

if [[ -z "$NOVA_SENHA" ]]; then
  echo "ERRO: senha vazia. Abortado." >&2
  exit 1
fi
if [[ "$NOVA_SENHA" != "$CONFIRMA" ]]; then
  echo "ERRO: as senhas não conferem. Abortado." >&2
  exit 1
fi

# ALTER USER via psql. O SQL vai por STDIN (não pela linha de comando), pra a
# senha não aparecer em `ps` dentro do container. Escapa aspas simples internas
# dobrando-as, caso a senha tenha uma.
SENHA_SQL="${NOVA_SENHA//\'/\'\'}"

trocar() {
  local svc="$1"
  echo ">> ${svc}: ALTER USER ${DB_USER}"
  printf "ALTER USER \"%s\" WITH PASSWORD '%s';\n" "$DB_USER" "$SENHA_SQL" \
    | "${COMPOSE[@]}" exec -T "$svc" psql -U "$DB_USER" -v ON_ERROR_STOP=1
}

trocar db
trocar evolution_db

echo
echo "OK — senha trocada nos dois bancos (db + evolution_db)."
echo
echo "PRÓXIMO PASSO (manual):"
echo "  1. Edite o .env:  POSTGRES_PASSWORD=<a senha que você acabou de digitar>"
echo "  2. Recrie os serviços que conectam:"
echo "       docker compose -f docker-compose.prod.yml up -d web evolution"
echo
echo "Enquanto o .env não bater, web/evolution vão falhar auth no Postgres."
