#!/usr/bin/env python3
"""Geocodificação em massa das empresas via CNEFE (IBGE, Censo 2022).

O CNEFE tem ~111 milhões de endereços brasileiros com coordenada GPS coletada
pelo recenseador. Este script cruza esses endereços com a tabela companies e
preenche company_geocode em duas camadas, por UF:

  1. RUA  — match exato CEP + número (+ similaridade de logradouro) contra
            endereços CNEFE com coordenada nível 1 (no próprio endereço).
            precisao='rua', fonte='cnefe'.
  2. CEP  — mediana das coordenadas de todos os endereços do CEP (nível de
            quadra/trecho de rua). precisao='cep', fonte='cnefe'.

Nunca rebaixa precisão existente: 'rua' já gravado (ex.: nominatim) é mantido;
camada CEP só preenche quem não tem nada. O restante continua caindo no
centroide do município em tempo de consulta (comportamento atual do server).

Fluxo por UF: download do zip (retomável) -> COPY streaming pro staging
UNLOGGED (só colunas úteis, já normalizadas) -> agrega cnefe_cep_geo ->
match camada RUA -> trunca staging. Camada CEP roda uma vez no final.
Progresso fica em cnefe_progresso: re-execução pula UF já concluída.

Banco: usa $DATABASE_URL (padrão postgres://postgres:postgres@db:5432/rs).
Como a porta do Postgres não é publicada no host, rode DENTRO da rede do compose:

  docker run --rm --network representativeseller_default \
    -e DATABASE_URL=postgres://postgres:postgres@db:5432/rs \
    -v "$PWD:/work" -w /work python:3.12-slim \
    bash -lc 'pip install -q requests psycopg2-binary && python geocodificar_cnefe.py'

Requer: requests, psycopg2-binary. Downloads ficam em dados_cnefe/ (~4 GB).
"""

import argparse
import csv
import io
import os
import re
import sys
import time
import unicodedata
import zipfile

import requests

import psycopg2

BASE = ("https://ftp.ibge.gov.br/Cadastro_Nacional_de_Enderecos_para_Fins_Estatisticos/"
        "Censo_Demografico_2022/Arquivos_CNEFE/CSV/UF/")
UFS = ["11_RO", "12_AC", "13_AM", "14_RR", "15_PA", "16_AP", "17_TO",
       "21_MA", "22_PI", "23_CE", "24_RN", "25_PB", "26_PE", "27_AL", "28_SE", "29_BA",
       "31_MG", "32_ES", "33_RJ", "35_SP",
       "41_PR", "42_SC", "43_RS",
       "50_MS", "51_MT", "52_GO", "53_DF"]
DIR = "dados_cnefe"
CHUNK = 1024 * 1024
TIMEOUT = (30, 300)

# Colunas do CSV CNEFE (0-based): 8 CEP, 10 NOM_TIPO_SEGLOGR, 11 NOM_TITULO_SEGLOGR,
# 12 NOM_SEGLOGR, 13 NUM_ENDERECO, 25 LATITUDE, 26 LONGITUDE, 27 NV_GEO_COORD.
# NV_GEO_COORD: 1 = coordenada no próprio endereço (GPS), níveis maiores são
# aproximações progressivas (face de quadra, localidade, setor…).

DDL = """
CREATE UNLOGGED TABLE IF NOT EXISTS cnefe_staging (
  cep char(8) NOT NULL,
  logradouro text NOT NULL,      -- tipo + título + nome, sem acento, maiúsculo
  numero text NOT NULL,          -- só dígitos ('' = S/N)
  lat float8 NOT NULL,
  lon float8 NOT NULL,
  nv smallint NOT NULL
);
CREATE TABLE IF NOT EXISTS cnefe_cep_geo (
  cep char(8) PRIMARY KEY,
  lat float8 NOT NULL,
  lon float8 NOT NULL,
  n integer NOT NULL,            -- endereços usados na mediana
  nv smallint NOT NULL           -- melhor nível de coordenada do CEP
);
CREATE TABLE IF NOT EXISTS cnefe_progresso (
  uf text PRIMARY KEY,
  concluido_em timestamptz NOT NULL DEFAULT now()
);
"""


def normalizar(s):
    """maiúsculo, sem acento, espaços colapsados — mesmo formato dos dois lados."""
    s = unicodedata.normalize("NFD", s or "")
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    return re.sub(r"\s+", " ", s.upper()).strip()


def _linha_csv(campos):
    buf = io.StringIO()
    csv.writer(buf, lineterminator="\n").writerow(campos)
    return buf.getvalue()


class IteradorArquivo:
    """Adapta um gerador de linhas CSV a um objeto file-like para COPY (read/readline)."""
    def __init__(self, it):
        self._it = it
        self._buf = ""

    def _encher(self, n):
        while n < 0 or len(self._buf) < n:
            try:
                self._buf += next(self._it)
            except StopIteration:
                break

    def read(self, n=-1):
        self._encher(n)
        if n < 0:
            r, self._buf = self._buf, ""
            return r
        r, self._buf = self._buf[:n], self._buf[n:]
        return r

    def readline(self, n=-1):
        while "\n" not in self._buf:
            try:
                self._buf += next(self._it)
            except StopIteration:
                break
        nl = self._buf.find("\n")
        if nl < 0:
            r, self._buf = self._buf, ""
            return r
        r, self._buf = self._buf[:nl + 1], self._buf[nl + 1:]
        return r


def baixar(uf):
    """Download retomável do zip da UF. Devolve o caminho local."""
    os.makedirs(DIR, exist_ok=True)
    dest = os.path.join(DIR, f"{uf}.zip")
    url = f"{BASE}{uf}.zip"
    # FTP do IBGE derruba conexões após muitos downloads seguidos: backoff longo
    # (até ~25 min somados) em vez de desistir rápido.
    for tentativa in range(10):
        try:
            total = int(requests.head(url, timeout=TIMEOUT).headers["Content-Length"])
            if os.path.exists(dest) and os.path.getsize(dest) == total:
                print(f"  download: {uf}.zip já completo ({total/1e6:.0f} MB)", flush=True)
                return dest
            pos = os.path.getsize(dest) if os.path.exists(dest) else 0
            headers = {"Range": f"bytes={pos}-"} if pos else {}
            modo = "ab" if pos else "wb"
            with requests.get(url, headers=headers, stream=True, timeout=TIMEOUT) as r:
                r.raise_for_status()
                with open(dest, modo) as f:
                    for parte in r.iter_content(CHUNK):
                        f.write(parte)
                        pos += len(parte)
            if os.path.getsize(dest) == total:
                print(f"  download: {uf}.zip ok ({total/1e6:.0f} MB)", flush=True)
                return dest
        except requests.RequestException as e:
            espera = min(300, 10 * 2 ** tentativa)
            print(f"  download: {uf}.zip falhou ({e}), tentativa {tentativa+1}/10, "
                  f"aguardando {espera}s", flush=True)
            time.sleep(espera)
    raise RuntimeError(f"download de {uf}.zip falhou após 10 tentativas")


def gen_staging(caminho_zip):
    """Streama o CSV de dentro do zip -> linhas COPY do staging (sem extrair pro disco)."""
    n = 0
    with zipfile.ZipFile(caminho_zip) as z:
        nome = next(m for m in z.namelist() if m.lower().endswith(".csv"))
        with z.open(nome) as raw:
            texto = io.TextIOWrapper(raw, encoding="utf-8", errors="replace", newline="")
            leitor = csv.reader(texto, delimiter=";")
            next(leitor, None)  # cabeçalho
            for c in leitor:
                if len(c) < 28:
                    continue
                cep = c[8].strip()
                if len(cep) != 8 or not cep.isdigit():
                    continue
                try:
                    lat, lon = float(c[25]), float(c[26])
                except ValueError:
                    continue
                if not (-35.0 <= lat <= 6.0 and -75.0 <= lon <= -32.0):  # bbox Brasil
                    continue
                logr = normalizar(" ".join(x for x in (c[10], c[11], c[12]) if x.strip()))
                numero = re.sub(r"\D", "", c[13] or "")
                nv = c[27].strip()
                nv = int(nv) if nv.isdigit() else 9
                n += 1
                if n % 2_000_000 == 0:
                    print(f"  staging: {n/1e6:.0f}M linhas…", flush=True)
                yield _linha_csv([cep, logr, numero, repr(lat), repr(lon), nv])
    print(f"  staging: {n} linhas no total", flush=True)


# mediana componente a componente (robusta a outlier, barata) por grupo
MEDIANA = "percentile_cont(0.5) WITHIN GROUP (ORDER BY {col})"

SQL_CEP_GEO = f"""
INSERT INTO cnefe_cep_geo (cep, lat, lon, n, nv)
SELECT s.cep, {MEDIANA.format(col='s.lat')}, {MEDIANA.format(col='s.lon')}, count(*), min(s.nv)::smallint
FROM cnefe_staging s
JOIN (SELECT cep, min(nv) AS mnv FROM cnefe_staging GROUP BY cep) m
  ON m.cep = s.cep AND s.nv = m.mnv          -- só o melhor nível de coordenada do CEP
GROUP BY s.cep
ON CONFLICT (cep) DO UPDATE
  SET lat = EXCLUDED.lat, lon = EXCLUDED.lon, n = EXCLUDED.n, nv = EXCLUDED.nv
"""

# Camada RUA: CEP + número idênticos, logradouro parecido (trigram, tolera
# abreviação/erro de grafia). Só coordenada nível 1 (GPS no endereço).
# Mediana resolve número repetido no mesmo CEP (ex.: casa e fundos).
SQL_RUA = f"""
INSERT INTO company_geocode (company_id, lat, lon, precisao, fonte)
SELECT c.id, {MEDIANA.format(col='s.lat')}, {MEDIANA.format(col='s.lon')}, 'rua', 'cnefe'
FROM companies c
JOIN cnefe_staging s
  ON s.cep = c.cep
 AND s.numero <> ''
 AND s.numero = regexp_replace(coalesce(c.numero, ''), '\\D', '', 'g')
WHERE c.uf = %(uf)s
  AND c.situacao_cadastral = 'ativa'
  AND c.cep IS NOT NULL
  AND s.nv = 1
  AND similarity(s.logradouro, unaccent(upper(coalesce(c.logradouro, '')))) > 0.45
GROUP BY c.id
ON CONFLICT (company_id) DO UPDATE
  SET lat = EXCLUDED.lat, lon = EXCLUDED.lon, precisao = 'rua',
      fonte = 'cnefe', atualizado_em = now()
  WHERE company_geocode.precisao <> 'rua'    -- nunca rebaixa rua já existente
"""

# Camada CEP (final, Brasil todo): preenche só quem ainda não tem geocode.
SQL_CEP = """
INSERT INTO company_geocode (company_id, lat, lon, precisao, fonte)
SELECT c.id, g.lat, g.lon, 'cep', 'cnefe'
FROM companies c
JOIN cnefe_cep_geo g ON g.cep = c.cep
WHERE c.situacao_cadastral = 'ativa'
ON CONFLICT (company_id) DO NOTHING
"""


def processar_uf(conn, uf):
    sigla = uf.split("_")[1]
    caminho = baixar(uf)
    with conn.cursor() as cur:
        t0 = time.time()
        cur.execute("TRUNCATE cnefe_staging")
        sql = "COPY cnefe_staging (cep, logradouro, numero, lat, lon, nv) FROM STDIN WITH (FORMAT csv)"
        cur.copy_expert(sql, IteradorArquivo(gen_staging(caminho)))
        print(f"  copy: {time.time()-t0:.0f}s", flush=True)

        t0 = time.time()
        cur.execute("CREATE INDEX IF NOT EXISTS cnefe_staging_cep_num_idx ON cnefe_staging (cep, numero)")
        cur.execute("ANALYZE cnefe_staging")
        print(f"  índice: {time.time()-t0:.0f}s", flush=True)

        t0 = time.time()
        cur.execute(SQL_CEP_GEO)
        print(f"  cep_geo: +{cur.rowcount} CEPs ({time.time()-t0:.0f}s)", flush=True)

        t0 = time.time()
        cur.execute(SQL_RUA, {"uf": sigla})
        print(f"  camada rua: {cur.rowcount} empresas ({time.time()-t0:.0f}s)", flush=True)

        cur.execute("DROP INDEX IF EXISTS cnefe_staging_cep_num_idx")
        cur.execute("TRUNCATE cnefe_staging")
        cur.execute("INSERT INTO cnefe_progresso (uf) VALUES (%s) ON CONFLICT (uf) DO NOTHING", (uf,))
    conn.commit()


def main():
    ap = argparse.ArgumentParser(description="Geocodifica companies via CNEFE/IBGE")
    ap.add_argument("--ufs", help="lista de UFs (ex.: 12_AC,35_SP); padrão: todas", default=None)
    ap.add_argument("--refazer", action="store_true", help="reprocessa UFs já concluídas")
    args = ap.parse_args()

    ufs = args.ufs.split(",") if args.ufs else UFS
    for u in ufs:
        if u not in UFS:
            sys.exit(f"UF desconhecida: {u}")

    dsn = os.environ.get("DATABASE_URL", "postgres://postgres:postgres@db:5432/rs")
    conn = psycopg2.connect(dsn)
    conn.autocommit = False
    with conn.cursor() as cur:
        cur.execute(DDL)
    conn.commit()

    with conn.cursor() as cur:
        cur.execute("SELECT uf FROM cnefe_progresso")
        feitas = {r[0] for r in cur.fetchall()}

    # duas passadas: UF que falhar (FTP do IBGE fora do ar etc.) não derruba o
    # resto — fica pra segunda rodada. Progresso já feito nunca se perde.
    pendentes = [u for u in ufs if u not in feitas or args.refazer]
    for u in ufs:
        if u not in pendentes:
            print(f"{u}: já concluída — pulando", flush=True)
    for rodada in (1, 2):
        falhas = []
        for uf in pendentes:
            print(f"{uf}:", flush=True)
            try:
                processar_uf(conn, uf)
            except Exception as e:
                conn.rollback()
                print(f"{uf}: FALHOU ({e}) — segue pra próxima", flush=True)
                falhas.append(uf)
        pendentes = falhas
        if not pendentes:
            break
        if rodada == 1:
            print(f"\nsegunda rodada pras que falharam: {','.join(pendentes)}", flush=True)
            time.sleep(60)
    if pendentes:
        sys.exit(f"UFs não concluídas: {','.join(pendentes)} — re-execute o script (retoma de onde parou)")

    # camada CEP: uma vez, Brasil todo (idempotente, só preenche quem falta)
    with conn.cursor() as cur:
        cur.execute("SELECT uf FROM cnefe_progresso")
        feitas = {r[0] for r in cur.fetchall()}
    if all(u in feitas for u in UFS):
        with conn.cursor() as cur:
            t0 = time.time()
            cur.execute(SQL_CEP)
            print(f"camada cep: {cur.rowcount} empresas ({time.time()-t0:.0f}s)", flush=True)
            cur.execute("ANALYZE company_geocode")
        conn.commit()
    else:
        print("camada cep: adiada (rode com todas as UFs concluídas)", flush=True)

    with conn.cursor() as cur:
        cur.execute("SELECT precisao, fonte, count(*) FROM company_geocode GROUP BY 1, 2 ORDER BY 3 DESC")
        print("\nresumo company_geocode:", flush=True)
        for p, f, n in cur.fetchall():
            print(f"  {p:10s} {f:10s} {n:>10}", flush=True)
    conn.close()


if __name__ == "__main__":
    main()
