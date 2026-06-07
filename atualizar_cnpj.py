#!/usr/bin/env python3
"""Rotina ÚNICA de atualização da base CNPJ (Receita Federal) -> tabela companies.

Faz, em um só script:
  1. VALIDAÇÃO de atualização na fonte: monta um manifesto (mês mais recente +
     tamanho de cada .zip via WebDAV) e compara com o manifesto da última carga.
     Se nada mudou, encerra sem baixar nem mexer no banco.
  2. DOWNLOAD (retomável, com retry e checagem de integridade) + extração dos CSVs.
  3. UPSERT idempotente em companies (source='rfb'), por cnpj — atualiza os que já
     existem e insere os novos, SEM duplicar (ON CONFLICT (cnpj)). Inclui MEIs.
     Município RFB->IBGE resolvido por nome (de-para construído em memória).

Reimplementa a lógica do server/etl/etl.ts em Python (staging via COPY + UPSERT
fragmentado por grupo). Carrega o BRASIL todo num passe só.

Banco: usa $DATABASE_URL (padrão postgres://postgres:postgres@db:5432/rs). Como a
porta do Postgres não é publicada no host, rode o script DENTRO da rede do compose:

  docker run --rm --network representativeseller_default \
    -e DATABASE_URL=postgres://postgres:postgres@db:5432/rs \
    -v "$PWD:/work" -w /work python:3.12-slim \
    bash -lc 'pip install -q requests psycopg2-binary && python atualizar_cnpj.py'

Requer: requests, psycopg2-binary.
"""

import argparse
import csv
import datetime
import io
import json
import os
import re
import sys
import time
import unicodedata
import xml.etree.ElementTree as ET
import zipfile
from concurrent.futures import ThreadPoolExecutor, as_completed
from urllib.parse import unquote

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

import psycopg2

# ───────────────────────── fonte (WebDAV RFB) ─────────────────────────
HOST = "https://arquivos.receitafederal.gov.br"
WEBDAV = HOST + "/public.php/webdav/"
TOKEN = "YggdBLfdninEJX9"  # token do compartilhamento público da RFB
CHUNK = 1024 * 1024  # 1 MiB
TIMEOUT = (30, 300)  # (connect, read)

# ───────────────────────── mapeamentos ─────────────────────────
UF_REGIAO = {
    "AC": "N", "AP": "N", "AM": "N", "PA": "N", "RO": "N", "RR": "N", "TO": "N",
    "AL": "NE", "BA": "NE", "CE": "NE", "MA": "NE", "PB": "NE", "PE": "NE",
    "PI": "NE", "RN": "NE", "SE": "NE",
    "DF": "CO", "GO": "CO", "MT": "CO", "MS": "CO",
    "ES": "SE", "MG": "SE", "RJ": "SE", "SP": "SE",
    "PR": "S", "RS": "S", "SC": "S",
}
PORTE_MAP = {"00": "nao_informado", "01": "micro", "03": "pequeno", "05": "demais"}
NGRP = 25  # buckets do UPSERT (transações menores, idempotentes)

# de-para: grafias que divergem entre RFB e IBGE além de acento/ç (cod_rfb -> id_ibge)
OVERRIDES = {
    "4177": 3108909, "4457": 3122900, "5303": 3165206, "0529": 1506500,
    "2561": 2613107, "5875": 3303807, "1603": 2400208, "8845": 4317103,
    "3151": 2802601, "6423": 3516101,
}


# ═══════════════════════ WebDAV: sessão / listagem ═══════════════════════
def sessao():
    s = requests.Session()
    s.auth = (TOKEN, "")  # share público: usuário = token, senha vazia
    s.headers.update({"User-Agent": "Mozilla/5.0 (atualizar-cnpj)"})
    retry = Retry(total=6, connect=6, read=3, backoff_factor=2,
                  status_forcelist=(429, 500, 502, 503, 504), allowed_methods=False)
    s.mount("https://", HTTPAdapter(max_retries=retry))
    return s


def propfind(s, url, depth=1, tentativas=5):
    erro = None
    for t in range(1, tentativas + 1):
        try:
            r = s.request("PROPFIND", url, headers={"Depth": str(depth)}, timeout=TIMEOUT)
            r.raise_for_status()
            return r.text
        except requests.RequestException as e:
            erro = e
            print(f"[propfind] tentativa {t}/{tentativas}: {e}")
            time.sleep(min(60, 5 * 2 ** t))
    raise erro


def _responses(xml):
    """[(href, tamanho|None)] de cada <d:response> da resposta PROPFIND."""
    root = ET.fromstring(xml)
    out = []
    for resp in root.iter("{DAV:}response"):
        href_el = resp.find("{DAV:}href")
        if href_el is None or not href_el.text:
            continue
        size_el = resp.find(".//{DAV:}getcontentlength")
        size = int(size_el.text) if (size_el is not None and size_el.text and size_el.text.isdigit()) else None
        out.append((unquote(href_el.text), size))
    return out


def listar_meses(s):
    meses = sorted({m.group(1) for h, _ in _responses(propfind(s, WEBDAV, 1))
                    if (m := re.search(r"/(\d{4}-\d{2})/?$", h))})
    if not meses:
        sys.exit("Nenhum diretório de mês no compartilhamento.")
    return meses


def listar_zips(s, mes):
    """{nome_zip: tamanho} do mês."""
    out = {}
    for h, size in _responses(propfind(s, WEBDAV + mes + "/", 1)):
        m = re.search(r"/([^/]+\.zip)$", h, re.I)
        if m:
            out[m.group(1)] = size
    return out


# ═══════════════════════ download / extração ═══════════════════════
def zip_ok(caminho):
    try:
        with zipfile.ZipFile(caminho) as z:
            return z.testzip() is None
    except (zipfile.BadZipFile, OSError):
        return False


def baixar(s, url, destino, total, tentativas=5):
    nome = os.path.basename(destino)
    for tentativa in range(1, tentativas + 1):
        ja = os.path.getsize(destino) if os.path.exists(destino) else 0
        if total and ja == total and zip_ok(destino):
            print(f"[ok]   {nome} (já completo)")
            return True
        headers = {"Range": f"bytes={ja}-"} if ja > 0 else {}
        try:
            with s.get(url, headers=headers, stream=True, timeout=TIMEOUT) as r:
                # modo decidido pela RESPOSTA: 206=append, 200=corpo inteiro (sobrescreve)
                if r.status_code == 206:
                    modo = "ab"
                elif r.status_code == 200:
                    modo = "wb"
                elif r.status_code == 416:
                    return True
                else:
                    r.raise_for_status(); modo = "wb"
                with open(destino, modo) as f:
                    for bloco in r.iter_content(CHUNK):
                        f.write(bloco)
            ja = os.path.getsize(destino)
            if (not total or ja >= total):
                if zip_ok(destino):
                    print(f"[ok]   {nome} ({ja/1e6:.1f} MB)")
                    return True
                print(f"[zip ruim] {nome} -> rebaixando do zero")
                os.remove(destino)
        except requests.RequestException as e:
            print(f"[erro] {nome} {tentativa}/{tentativas}: {e}")
            time.sleep(min(30, 2 ** tentativa))
    print(f"[falha] {nome}")
    return False


def baixar_todos(s, mes, zips, saida, workers):
    os.makedirs(saida, exist_ok=True)
    ok = 0
    with ThreadPoolExecutor(max_workers=workers) as ex:
        futs = {ex.submit(baixar, s, WEBDAV + mes + "/" + nome,
                          os.path.join(saida, nome), tam): nome
                for nome, tam in zips.items()}
        for fut in as_completed(futs):
            if fut.result():
                ok += 1
    print(f"Baixados: {ok}/{len(zips)}")
    if ok != len(zips):
        sys.exit("Download incompleto — abortando atualização.")


def extrair_todos(saida, zips):
    pasta = os.path.join(saida, "csv")
    os.makedirs(pasta, exist_ok=True)
    for nome in zips:
        cz = os.path.join(saida, nome)
        try:
            with zipfile.ZipFile(cz) as z:
                z.extractall(pasta)
        except zipfile.BadZipFile:
            sys.exit(f"[zip ruim] {nome} — abortando")
    print(f"CSVs em {pasta}")
    return pasta


# ═══════════════════════ manifesto (validação de atualização) ═══════════════════════
def manifesto_atual(mes, zips):
    return {"mes": mes, "arquivos": dict(sorted(zips.items()))}


def ler_manifesto(caminho):
    try:
        with open(caminho) as f:
            return json.load(f)
    except (OSError, json.JSONDecodeError):
        return None


def escrever_manifesto(caminho, man):
    with open(caminho, "w") as f:
        json.dump(man, f, indent=2, ensure_ascii=False)


# ═══════════════════════ de-para RFB -> IBGE (em memória) ═══════════════════════
def norm(s):
    s = unicodedata.normalize("NFKD", s)
    s = "".join(c for c in s if not unicodedata.combining(c))
    return re.sub(r"\s+", " ", re.sub(r"[^a-zA-Z0-9]+", " ", s).strip().lower())


STOP = {"de", "do", "da", "dos", "das", "d"}


def toks(s):
    return {t for t in norm(s).split() if t not in STOP}


def ler_ibge_seed(caminho):
    """uf -> [(id, nome)]."""
    pat = re.compile(r"\(\s*(\d+)\s*,\s*'((?:[^']|'')*)'\s*,\s*'([A-Z]{2})'")
    out = {}
    with open(caminho, encoding="utf-8") as f:
        for linha in f:
            m = pat.search(linha)
            if m:
                out.setdefault(m.group(3), []).append((int(m.group(1)), m.group(2).replace("''", "'")))
    return out


def ler_rfb_munic(caminho):
    d = {}
    with open(caminho, encoding="latin1", newline="") as f:
        for row in csv.reader(f, delimiter=";"):
            if len(row) >= 2 and row[0].strip():
                d[row[0].strip()] = row[1].strip()
    return d


def construir_depara(code_uf, rfb_nome, ibge):
    """code_uf: set{(cod,uf)} visto nos estabs -> dict{cod:int -> ibge:int}."""
    por_uf = {}
    for cod, uf in code_uf:
        por_uf.setdefault(uf, set()).add(cod)
    pares, sem = {}, 0
    for uf in sorted(por_uf):
        ibge_uf = ibge.get(uf, [])
        por_nome = {norm(n): i for i, n in ibge_uf}
        usados, pend = set(), []
        for cod in sorted(por_uf[uf]):
            nome = rfb_nome.get(cod)
            if nome is None:
                continue
            iid = por_nome.get(norm(nome))
            if iid is not None:
                pares[cod] = iid; usados.add(iid)
            else:
                pend.append((cod, nome))
        livres = [(i, n) for i, n in ibge_uf if i not in usados]
        for cod, nome in pend:
            tn = toks(nome)
            cand = [(i, n) for i, n in livres
                    if i not in usados and (tn <= toks(n) or toks(n) <= tn)]
            if len(cand) == 1:
                pares[cod] = cand[0][0]; usados.add(cand[0][0])
            else:
                sem += 1
    pares.update(OVERRIDES)  # grafias resolvidas à mão
    print(f"de-para: {len(pares)} códigos casados ({sem} sem match)")
    return pares


# ═══════════════════════ CSV helpers ═══════════════════════
def resolver(pasta, substr):
    n = substr.upper()
    return sorted(os.path.join(pasta, f) for f in os.listdir(pasta) if n in f.upper())


def ler_csv(caminho):
    with open(caminho, encoding="latin1", newline="") as f:
        for row in csv.reader(f, delimiter=";", quotechar='"'):
            yield row


def _linha_csv(campos):
    sio = io.StringIO()
    csv.writer(sio, lineterminator="\n").writerow(campos)
    return sio.getvalue()


def _data(s):
    """Data RFB (AAAAMMDD) -> 'AAAA-MM-DD' válida, ou '' (NULL no COPY)."""
    s = (s or "").strip()
    if len(s) != 8 or not s.isdigit() or s == "00000000":
        return ""
    try:
        datetime.date(int(s[:4]), int(s[4:6]), int(s[6:8]))
    except ValueError:
        return ""
    return f"{s[:4]}-{s[4:6]}-{s[6:8]}"


def _int(s):
    s = (s or "").strip()
    return s if s.lstrip("-").isdigit() else ""


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


def copy_into(cur, tabela, colunas, gerador_linhas):
    sql = f"COPY {tabela} ({','.join(colunas)}) FROM STDIN WITH (FORMAT csv)"
    cur.copy_expert(sql, IteradorArquivo(gerador_linhas))


# ═══════════════════════ staging ═══════════════════════
DDL = """
DROP TABLE IF EXISTS stg_emp_raw, stg_emp, stg_est, stg_simples_raw, stg_simples, stg_mun;
CREATE UNLOGGED TABLE stg_emp_raw (cnpj_base char(8), razao_social text,
  capital_social numeric(16,2), porte porte_emp,
  natureza_juridica int, qualificacao_responsavel smallint, ente_federativo text);
CREATE UNLOGGED TABLE stg_est (cnpj char(14), cnpj_base char(8), nome_fantasia text,
  cnae_principal int, cnae_secundarios int[], municipio_rfb int, uf char(2), grp smallint,
  logradouro text, numero text, complemento text, bairro text, cep char(8),
  telefone1 text, telefone2 text, email text,
  data_inicio_atividade date, matriz_filial smallint, motivo_situacao smallint,
  data_situacao_cadastral date, situacao_especial text, data_situacao_especial date,
  nome_cidade_exterior text, pais int, fax text);
CREATE UNLOGGED TABLE stg_simples_raw (cnpj_base char(8),
  opcao_simples char(1), data_opcao_simples date, data_exclusao_simples date,
  opcao_mei char(1), data_opcao_mei date, data_exclusao_mei date);
CREATE UNLOGGED TABLE stg_mun (rfb int PRIMARY KEY, ibge int);
"""


def gen_empresas(arquivos):
    """EMPRESAS: c0 base, c1 razao, c2 natureza, c3 qualif_resp, c4 capital, c5 porte, c6 ente."""
    for f in arquivos:
        print(f"empresas: {f}")
        for c in ler_csv(f):
            base = (c[0] if c else "").zfill(8)
            if len(base) != 8:
                continue

            def g(i):
                return c[i].strip() if i < len(c) else ""
            capital = g(4).replace(".", "").replace(",", ".")
            try:
                capital = float(capital or 0)
            except ValueError:
                capital = 0
            porte = PORTE_MAP.get(g(5) or "00", "nao_informado")
            yield _linha_csv([base, g(1), f"{capital:.2f}", porte,
                              _int(g(2)), _int(g(3)), g(6)])


def gen_simples(arquivos):
    """SIMPLES: c0 base, c1 opcao_simples, c2 data_opc, c3 data_exc,
    c4 opcao_mei, c5 data_opc_mei, c6 data_exc_mei."""
    for f in arquivos:
        print(f"simples: {f}")
        for c in ler_csv(f):
            base = (c[0] if c else "").zfill(8)
            if len(base) != 8:
                continue

            def g(i):
                return c[i].strip().upper() if i < len(c) else ""
            os_, om = g(1), g(4)
            yield _linha_csv([base,
                              os_ if os_ in ("S", "N") else "", _data(g(2)), _data(g(3)),
                              om if om in ("S", "N") else "", _data(g(5)), _data(g(6))])


def gen_socios(arquivos):
    """SOCIOCSV: c0 base, c1 ident, c2 nome, c3 cnpj_cpf, c4 qualif, c5 data_entrada,
    c6 pais, c7 rep_legal, c8 nome_rep, c9 qualif_rep, c10 faixa_etaria. + source='rfb'."""
    for f in arquivos:
        print(f"socios: {f}")
        for c in ler_csv(f):
            base = (c[0] if c else "").zfill(8)
            if len(base) != 8:
                continue

            def g(i):
                return c[i].strip() if i < len(c) else ""
            yield _linha_csv([base, _int(g(1)), g(2), g(3), _int(g(4)), _data(g(5)),
                              _int(g(6)), g(7), g(8), _int(g(9)), _int(g(10)), "rfb"])


def gen_ref(arquivo):
    """Auxiliar RFB (codigo;descricao) -> linhas COPY, dedup por código."""
    visto = set()
    for c in ler_csv(arquivo):
        if len(c) >= 2 and _int(c[0].strip()) and c[0].strip() not in visto:
            visto.add(c[0].strip())
            yield _linha_csv([c[0].strip(), c[1].strip()])


def gen_estab(arquivos, code_uf):
    """Streama estabs ativos (situação '02'), coleta (cod,uf) e gera linhas COPY.

    Campos do ESTABELE: c3 matriz_filial, c6 data_situacao, c7 motivo,
    c8 cidade_exterior, c9 pais, c10 data_inicio, c13 tipo_logr, c14 logr,
    c15 num, c16 compl, c17 bairro, c18 cep, c21-24 telefones, c25/26 fax,
    c27 email, c28 situacao_especial, c29 data_situacao_especial.
    """
    for f in arquivos:
        print(f"estabelecimentos: {f}")
        for c in ler_csv(f):
            if len(c) < 21:
                continue
            uf = c[19].upper()
            if uf not in UF_REGIAO:
                continue
            if c[5] != "02":  # só ATIVA
                continue
            base = c[0].zfill(8)
            cnpj = base + c[1].zfill(4) + c[2].zfill(2)
            if len(cnpj) != 14:
                continue
            try:
                cnae_p = int(c[11])
            except ValueError:
                continue
            sec = [int(x) for x in c[12].split(",") if x.strip().isdigit()]
            arr = "{" + ",".join(map(str, sec)) + "}"
            mun = c[20].strip()
            code_uf.add((mun, uf))
            mun_i = mun if mun.isdigit() else ""
            grp = int(base[:2] or 0) % NGRP

            def g(i):
                return c[i].strip() if i < len(c) else ""
            logr = (g(13) + " " + g(14)).strip()
            cep = g(18)
            cep = cep if (len(cep) == 8 and cep.isdigit()) else ""
            tel1 = (g(21) + g(22)) if g(22) else ""
            tel2 = (g(23) + g(24)) if g(24) else ""
            fax = (g(25) + g(26)) if g(26) else ""
            email = g(27).lower()

            yield _linha_csv([cnpj, base, c[4] or "", cnae_p, arr, mun_i, uf, grp,
                              logr, g(15), g(16), g(17), cep, tel1, tel2, email,
                              _data(g(10)), _int(g(3)), _int(g(7)), _data(g(6)),
                              g(28), _data(g(29)), g(8), _int(g(9)), fax])


# ═══════════════════════ referências RFB ═══════════════════════
# (substr do arquivo auxiliar -> tabela de referência codigo;descricao)
REFS = [("NATJU", "rfb_natureza"), ("QUALS", "rfb_qualificacao"),
        ("MOTI", "rfb_motivo"), ("PAIS", "rfb_pais")]


def carregar_referencias(cur, csv_dir):
    for substr, tabela in REFS:
        arqs = resolver(csv_dir, substr)
        if not arqs:
            print(f"[ref] {substr} não encontrado — pulado")
            continue
        cur.execute(f"TRUNCATE {tabela}")
        copy_into(cur, tabela, ["codigo", "descricao"], gen_ref(arqs[0]))
        cur.execute(f"SELECT count(*) FROM {tabela}")
        print(f"ref {tabela}: {cur.fetchone()[0]}")
    carregar_cnae_ref(cur, csv_dir)


def carregar_cnae_ref(cur, csv_dir):
    """Popula cnae_reference (descrição de TODOS os CNAEs) a partir do CNAECSV da RFB.
    divisão = codigo/100000; seção via cnae_divisao_secao. UPSERT (não perde sinônimos)."""
    arqs = resolver(csv_dir, "CNAECSV")
    if not arqs:
        print("[ref] CNAECSV não encontrado — pulado")
        return
    cur.execute("DROP TABLE IF EXISTS stg_cnae; CREATE UNLOGGED TABLE stg_cnae (codigo int, descricao text);")
    copy_into(cur, "stg_cnae", ["codigo", "descricao"], gen_ref(arqs[0]))
    cur.execute("""
      INSERT INTO cnae_reference (codigo, descricao, secao, divisao)
      SELECT s.codigo, s.descricao, COALESCE(ds.secao, 'Z'), (s.codigo / 100000)::smallint
      FROM (SELECT DISTINCT ON (codigo) codigo, descricao FROM stg_cnae ORDER BY codigo) s
      LEFT JOIN cnae_divisao_secao ds ON ds.divisao = (s.codigo / 100000)
      ON CONFLICT (codigo) DO UPDATE
        SET descricao = EXCLUDED.descricao, secao = EXCLUDED.secao, divisao = EXCLUDED.divisao
    """)
    cur.execute("DROP TABLE stg_cnae")
    cur.execute("SELECT count(*) FROM cnae_reference")
    print(f"ref cnae_reference: {cur.fetchone()[0]}")


# ═══════════════════════ UPSERT ═══════════════════════
def carregar_banco(dburl, csv_dir, seed, desativar=True):
    conn = psycopg2.connect(dburl)
    conn.autocommit = False
    try:
        cur = conn.cursor()
        print("staging (DDL)…")
        cur.execute(DDL)
        conn.commit()

        # 1) empresas -> stg_emp (dedup por cnpj_base)
        emp = resolver(csv_dir, "EMPRE")
        if not emp:
            sys.exit("nenhum arquivo de empresas (EMPRE) no csv/")
        copy_into(cur, "stg_emp_raw",
                  ["cnpj_base", "razao_social", "capital_social", "porte",
                   "natureza_juridica", "qualificacao_responsavel", "ente_federativo"],
                  gen_empresas(emp))
        cur.execute("""CREATE UNLOGGED TABLE stg_emp AS
                       SELECT DISTINCT ON (cnpj_base) cnpj_base, razao_social, capital_social, porte,
                              natureza_juridica, qualificacao_responsavel, ente_federativo
                       FROM stg_emp_raw ORDER BY cnpj_base;
                       ALTER TABLE stg_emp ADD PRIMARY KEY (cnpj_base);
                       DROP TABLE stg_emp_raw;""")
        cur.execute("SELECT count(*) FROM stg_emp"); print(f"empresas: {cur.fetchone()[0]}")
        conn.commit()

        # 2) simples -> stg_simples (dedup por cnpj_base; traz flags Simples/MEI)
        sim = resolver(csv_dir, "SIMPLES")
        if sim:
            copy_into(cur, "stg_simples_raw",
                      ["cnpj_base", "opcao_simples", "data_opcao_simples", "data_exclusao_simples",
                       "opcao_mei", "data_opcao_mei", "data_exclusao_mei"],
                      gen_simples(sim))
        cur.execute("""CREATE UNLOGGED TABLE stg_simples AS
                       SELECT DISTINCT ON (cnpj_base) * FROM stg_simples_raw ORDER BY cnpj_base;
                       ALTER TABLE stg_simples ADD PRIMARY KEY (cnpj_base);
                       DROP TABLE stg_simples_raw;""")
        conn.commit()

        # 3) estabelecimentos ativos -> stg_est (coleta code_uf p/ de-para)
        est = resolver(csv_dir, "ESTABELE")
        if not est:
            sys.exit("nenhum arquivo de estabelecimentos (ESTABELE) no csv/")
        code_uf = set()
        copy_into(cur, "stg_est",
                  ["cnpj", "cnpj_base", "nome_fantasia", "cnae_principal",
                   "cnae_secundarios", "municipio_rfb", "uf", "grp",
                   "logradouro", "numero", "complemento", "bairro", "cep",
                   "telefone1", "telefone2", "email",
                   "data_inicio_atividade", "matriz_filial", "motivo_situacao",
                   "data_situacao_cadastral", "situacao_especial", "data_situacao_especial",
                   "nome_cidade_exterior", "pais", "fax"],
                  gen_estab(est, code_uf))
        cur.execute("SELECT count(*) FROM stg_est"); print(f"estabelecimentos ativos: {cur.fetchone()[0]}")
        conn.commit()

        # 3b) tabelas de referência RFB (decodificam códigos)
        carregar_referencias(cur, csv_dir)
        conn.commit()

        # 4) de-para -> stg_mun
        munic = resolver(csv_dir, "MUNICCSV")
        if not munic:
            sys.exit("MUNICCSV não encontrado no csv/")
        depara = construir_depara(code_uf, ler_rfb_munic(munic[0]), ler_ibge_seed(seed))
        copy_into(cur, "stg_mun", ["rfb", "ibge"],
                  (_linha_csv([cod, iid]) for cod, iid in depara.items()))
        conn.commit()

        cur.execute("CREATE INDEX ON stg_est (cnpj_base); CREATE INDEX ON stg_est (grp); CREATE INDEX ON stg_est (cnpj);")
        cur.execute("ANALYZE stg_emp; ANALYZE stg_est; ANALYZE stg_simples; ANALYZE stg_mun;")
        conn.commit()

        # 5) UPSERT por grupo (commit a cada grupo)
        n = 0
        for g in range(NGRP):
            cur.execute(_UPSERT_SQL.format(grp=g))
            n += cur.rowcount
            print(f"  grupo {g+1}/{NGRP}: +{cur.rowcount} (acum {n})")
            conn.commit()
        print(f"companies upsert: {n}")

        # 5b) snapshot completo: quem saiu do conjunto ativo do mês é DESATIVADO
        # (marcado 'baixada'), não deletado. Só vira quem ainda consta 'ativa'.
        if desativar:
            # "ainda ativa" = consta no snapshot ativo (stg_est). Inclui MEI.
            cur.execute("""
              UPDATE companies c
                 SET situacao_cadastral = 'baixada'
               WHERE c.source = 'rfb'
                 AND c.situacao_cadastral = 'ativa'
                 AND NOT EXISTS (SELECT 1 FROM stg_est e WHERE e.cnpj = c.cnpj)
            """)
            print(f"empresas desativadas (fora do snapshot): {cur.rowcount}")
            conn.commit()

        # 5c) sócios (quadro societário) -> tabela socios. Snapshot completo:
        # troca atômica (apaga os 'rfb' e recarrega) numa transação só.
        soc = resolver(csv_dir, "SOCIO")
        if soc:
            cur.execute("DELETE FROM socios WHERE source='rfb'")
            copy_into(cur, "socios",
                      ["cnpj_base", "identificador", "nome", "cnpj_cpf", "qualificacao",
                       "data_entrada", "pais", "representante_legal", "nome_representante",
                       "qualificacao_representante", "faixa_etaria", "source"],
                      gen_socios(soc))
            cur.execute("SELECT count(*) FROM socios WHERE source='rfb'")
            print(f"socios carregados: {cur.fetchone()[0]}")
            conn.commit()

        # 6) habilita as 27 UFs
        for u, r in UF_REGIAO.items():
            cur.execute("""INSERT INTO enabled_regions (uf, regiao) VALUES (%s,%s)
                           ON CONFLICT (uf) DO UPDATE SET regiao=EXCLUDED.regiao""", (u, r))
        cur.execute("DROP TABLE IF EXISTS stg_emp, stg_est, stg_simples, stg_mun;")
        conn.commit()
        print("Atualização concluída.")
    finally:
        conn.close()


# UPSERT como template (região fallback fixo p/ legibilidade)
_FALLBACK = ("CASE e.uf " + " ".join(
    f"WHEN '{u}' THEN '{r}'::regiao_br" for u, r in UF_REGIAO.items()) + " ELSE 'SE'::regiao_br END")
_UPSERT_SQL = f"""
  INSERT INTO companies
    (cnpj, razao_social, nome_fantasia, cnae_principal, cnae_secundarios,
     municipio_id, uf, regiao, geom, porte, capital_social, situacao_cadastral, source, raw_data,
     logradouro, numero, complemento, bairro, cep, telefone1, telefone2, email,
     data_inicio_atividade, matriz_filial, natureza_juridica, qualificacao_responsavel,
     ente_federativo, motivo_situacao, data_situacao_cadastral, situacao_especial,
     data_situacao_especial, nome_cidade_exterior, pais, fax,
     opcao_simples, data_opcao_simples, data_exclusao_simples,
     opcao_mei, data_opcao_mei, data_exclusao_mei)
  SELECT e.cnpj, COALESCE(emp.razao_social,''), e.nome_fantasia,
         e.cnae_principal, e.cnae_secundarios, m.id, e.uf,
         COALESCE(m.regiao, {_FALLBACK}), m.geom,
         COALESCE(emp.porte,'nao_informado'), COALESCE(emp.capital_social,0),
         'ativa','rfb',NULL,
         e.logradouro, e.numero, e.complemento, e.bairro, e.cep,
         e.telefone1, e.telefone2, e.email,
         e.data_inicio_atividade, e.matriz_filial, emp.natureza_juridica,
         emp.qualificacao_responsavel, emp.ente_federativo, e.motivo_situacao,
         e.data_situacao_cadastral, e.situacao_especial, e.data_situacao_especial,
         e.nome_cidade_exterior, e.pais, e.fax,
         si.opcao_simples, si.data_opcao_simples, si.data_exclusao_simples,
         si.opcao_mei, si.data_opcao_mei, si.data_exclusao_mei
  FROM stg_est e
  LEFT JOIN stg_emp emp ON emp.cnpj_base = e.cnpj_base
  LEFT JOIN stg_simples si ON si.cnpj_base = e.cnpj_base
  LEFT JOIN stg_mun map ON map.rfb = e.municipio_rfb
  LEFT JOIN municipios m ON m.id = COALESCE(map.ibge, e.municipio_rfb)
  WHERE e.grp = {{grp}}
  ON CONFLICT (cnpj) DO UPDATE SET
    razao_social=EXCLUDED.razao_social, nome_fantasia=EXCLUDED.nome_fantasia,
    cnae_principal=EXCLUDED.cnae_principal, cnae_secundarios=EXCLUDED.cnae_secundarios,
    municipio_id=EXCLUDED.municipio_id, uf=EXCLUDED.uf, regiao=EXCLUDED.regiao,
    geom=EXCLUDED.geom, porte=EXCLUDED.porte, capital_social=EXCLUDED.capital_social,
    situacao_cadastral='ativa', source='rfb',
    logradouro=EXCLUDED.logradouro, numero=EXCLUDED.numero, complemento=EXCLUDED.complemento,
    bairro=EXCLUDED.bairro, cep=EXCLUDED.cep,
    telefone1=EXCLUDED.telefone1, telefone2=EXCLUDED.telefone2, email=EXCLUDED.email,
    data_inicio_atividade=EXCLUDED.data_inicio_atividade, matriz_filial=EXCLUDED.matriz_filial,
    natureza_juridica=EXCLUDED.natureza_juridica,
    qualificacao_responsavel=EXCLUDED.qualificacao_responsavel,
    ente_federativo=EXCLUDED.ente_federativo, motivo_situacao=EXCLUDED.motivo_situacao,
    data_situacao_cadastral=EXCLUDED.data_situacao_cadastral,
    situacao_especial=EXCLUDED.situacao_especial,
    data_situacao_especial=EXCLUDED.data_situacao_especial,
    nome_cidade_exterior=EXCLUDED.nome_cidade_exterior, pais=EXCLUDED.pais, fax=EXCLUDED.fax,
    opcao_simples=EXCLUDED.opcao_simples, data_opcao_simples=EXCLUDED.data_opcao_simples,
    data_exclusao_simples=EXCLUDED.data_exclusao_simples,
    opcao_mei=EXCLUDED.opcao_mei, data_opcao_mei=EXCLUDED.data_opcao_mei,
    data_exclusao_mei=EXCLUDED.data_exclusao_mei
  WHERE companies.source='rfb'
"""


# ═══════════════════════ main ═══════════════════════
def main():
    ap = argparse.ArgumentParser(description="Atualiza a base CNPJ (download + UPSERT) só se a fonte mudou.")
    ap.add_argument("--saida", default="dados_cnpj", help="pasta dos zips/csv (padrão ./dados_cnpj)")
    ap.add_argument("--mes", help="mês AAAA-MM (padrão: mais recente)")
    ap.add_argument("--workers", type=int, default=3, help="downloads paralelos (padrão 3)")
    ap.add_argument("--seed", default="server/migrations/seeds/002_municipios.sql",
                    help="seed IBGE p/ de-para")
    ap.add_argument("--db", default=os.environ.get("DATABASE_URL", "postgres://postgres:postgres@db:5432/rs"))
    ap.add_argument("--force", action="store_true", help="ignora o manifesto e atualiza mesmo sem mudança")
    ap.add_argument("--so-checar", action="store_true", help="só verifica se há atualização e sai")
    ap.add_argument("--sem-desativar", action="store_true",
                    help="não marca como 'baixada' as empresas que saíram do snapshot")
    args = ap.parse_args()

    s = sessao()
    meses = listar_meses(s)
    mes = (args.mes.strip() if args.mes else meses[-1])
    if mes not in meses:
        sys.exit(f"Mês {mes} indisponível. Disponíveis: {', '.join(meses)}")

    zips = listar_zips(s, mes)
    if not zips:
        sys.exit(f"Nenhum .zip em {mes}.")

    man_path = os.path.join(args.saida, ".manifesto_update.json")
    atual = manifesto_atual(mes, zips)
    salvo = ler_manifesto(man_path)

    if salvo == atual and not args.force:
        print(f"Fonte sem atualização (mês {mes}, {len(zips)} arquivos iguais). Nada a fazer.")
        return
    print(f"Atualização detectada: mês {mes} ({len(zips)} arquivos).")
    if args.so_checar:
        return

    os.makedirs(args.saida, exist_ok=True)
    baixar_todos(s, mes, zips, args.saida, args.workers)
    csv_dir = extrair_todos(args.saida, zips)

    carregar_banco(args.db, csv_dir, args.seed, desativar=not args.sem_desativar)

    escrever_manifesto(man_path, atual)
    print(f"Manifesto salvo: {man_path}")


if __name__ == "__main__":
    main()
