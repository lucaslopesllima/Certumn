// ETL CLI — load Receita Federal open data into the GLOBAL companies pool.
// Idempotent: UPSERT by cnpj with source='rfb'. The ONLY writer of rfb companies.
//
// ⚠️ LEGADO / parcial. O carregador canônico é o ../../atualizar_cnpj.py, que
// popula TODOS os campos (endereço/contato, datas, natureza, Simples), carrega
// sócios + tabelas de referência e inclui MEI. Este etl.ts ainda EXCLUI MEI e NÃO
// preenche os campos das migrations 012/013 nem socios/refs. Use-o só p/ bootstrap
// rápido de uma UF; para produção/atualização use atualizar_cnpj.py.
//
// --uf SP loads one state; --uf BR loads ALL of Brazil in a single pass (no UF
// filter; região derived per-row from the estab UF; todas as 27 enabled_regions).
//
// Usage:
//   node etl/etl.ts --uf SP --in /data/rfb \
//       --estab "ESTABELE*.csv" --empresas "EMPRE*.csv" \
//       [--simples "SIMPLES*.csv"] [--municipio-map depara.csv] [--batch 5000]
//   node etl/etl.ts --uf BR --in /data --estab ESTABELE --empresas EMPRE \
//       --simples SIMPLES --municipio-map depara_br.csv
//
// RFB files: latin1, ';'-delimited, no header, fields optionally quoted with ".
// estabelecimentos carry UF + município (RFB code); empresas carry razão/capital/porte (by CNPJ base).
// MEI exclusion needs the Simples file (OPCAO_MEI='S'); without it MEI is NOT excluded (documented).
// município geom requires an RFB->IBGE de-para map (--municipio-map); without it municipio_id/geom stay null.

import { createReadStream } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { join } from 'node:path';
import pg from 'pg';
import { config } from '../src/config.ts';

interface Args {
  uf: string; inDir: string; estab: string; empresas: string;
  simples?: string; municipioMap?: string; batch: number;
}

function parseArgs(argv: string[]): Args {
  const m = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a && a.startsWith('--')) { m.set(a.slice(2), argv[i + 1] ?? ''); i++; }
  }
  const uf = (m.get('uf') ?? '').toUpperCase();
  if (!uf || uf.length !== 2) throw new Error('--uf <UF> obrigatório (ex: SP)');
  return {
    uf,
    inDir: m.get('in') ?? '.',
    estab: m.get('estab') ?? 'ESTABELE',
    empresas: m.get('empresas') ?? 'EMPRE',
    simples: m.get('simples'),
    municipioMap: m.get('municipio-map'),
    batch: Number(m.get('batch') ?? 5000),
  };
}

// Minimal RFB CSV field splitter: ';' separated, fields may be wrapped in double quotes.
function splitCsv(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else inQ = false; }
      else cur += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ';') { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

async function resolveFiles(dir: string, pattern: string): Promise<string[]> {
  const entries = await readdir(dir);
  const needle = pattern.replace(/\*/g, '').toUpperCase();
  const matched = entries.filter((f) => f.toUpperCase().includes(needle)).sort();
  return matched.map((f) => join(dir, f));
}

// Stream a CSV file, calling onRow(fields) per line. Latin1 decoding is native.
async function streamCsv(file: string, onRow: (fields: string[]) => Promise<void> | void): Promise<void> {
  const rl = createInterface({ input: createReadStream(file, { encoding: 'latin1' }), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line) continue;
    await onRow(splitCsv(line));
  }
}

// Batched multi-row INSERT (bounded memory; no COPY dependency).
class Batcher {
  private rows: unknown[][] = [];
  private client: pg.Client;
  private table: string;
  private cols: string[];
  private size: number;
  private conflict: string;
  constructor(client: pg.Client, table: string, cols: string[], size: number, conflict = '') {
    this.client = client;
    this.table = table;
    this.cols = cols;
    this.size = size;
    this.conflict = conflict;
  }
  async push(values: unknown[]): Promise<void> {
    this.rows.push(values);
    if (this.rows.length >= this.size) await this.flush();
  }
  async flush(): Promise<void> {
    if (this.rows.length === 0) return;
    const ncol = this.cols.length;
    const params: unknown[] = [];
    const tuples = this.rows.map((r, ri) => {
      const ph = r.map((_, ci) => `$${ri * ncol + ci + 1}`);
      params.push(...r);
      return `(${ph.join(',')})`;
    });
    await this.client.query(
      `INSERT INTO ${this.table} (${this.cols.join(',')}) VALUES ${tuples.join(',')} ${this.conflict}`,
      params,
    );
    this.rows = [];
  }
}

const porteMap: Record<string, string> = { '00': 'nao_informado', '01': 'micro', '03': 'pequeno', '05': 'demais' };

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const allBr = args.uf === 'BR' || args.uf === 'ALL';
  console.log(`ETL uf=${args.uf}${allBr ? ' (Brasil todo)' : ''} in=${args.inDir} batch=${args.batch}`);
  const client = new pg.Client({ connectionString: config.databaseUrl });
  await client.connect();

  try {
    // staging (UNLOGGED, per-run)
    await client.query(`
      DROP TABLE IF EXISTS stg_emp; DROP TABLE IF EXISTS stg_est;
      DROP TABLE IF EXISTS stg_mei; DROP TABLE IF EXISTS stg_mun;
      CREATE UNLOGGED TABLE stg_emp (cnpj_base char(8) PRIMARY KEY, razao_social text,
        capital_social numeric(16,2), porte porte_emp);
      CREATE UNLOGGED TABLE stg_est (cnpj char(14), cnpj_base char(8), nome_fantasia text,
        cnae_principal int, cnae_secundarios int[], municipio_rfb int, uf char(2), grp smallint,
        logradouro text, numero text, complemento text, bairro text, cep char(8),
        telefone1 text, telefone2 text, email text);
      CREATE UNLOGGED TABLE stg_mei (cnpj_base char(8) PRIMARY KEY);
      CREATE UNLOGGED TABLE stg_mun (rfb int PRIMARY KEY, ibge int);
    `);

    // 1) empresas -> stg_emp
    const empFiles = await resolveFiles(args.inDir, args.empresas);
    if (empFiles.length === 0) throw new Error(`nenhum arquivo de empresas (${args.empresas}) em ${args.inDir}`);
    let empCount = 0;
    const empB = new Batcher(client, 'stg_emp', ['cnpj_base', 'razao_social', 'capital_social', 'porte'],
      args.batch, 'ON CONFLICT (cnpj_base) DO NOTHING');
    for (const f of empFiles) {
      console.log(`empresas: ${f}`);
      await streamCsv(f, async (c) => {
        const base = (c[0] ?? '').padStart(8, '0');
        if (base.length !== 8) return;
        const capital = Number((c[4] ?? '0').replace(/\./g, '').replace(',', '.')) || 0;
        const porte = porteMap[c[5] ?? '00'] ?? 'nao_informado';
        await empB.push([base, c[1] ?? '', capital, porte]);
        empCount++;
      });
    }
    await empB.flush();
    console.log(`empresas carregadas: ${empCount}`);

    // 2) simples (opcional) -> stg_mei (apenas MEI='S')
    if (args.simples) {
      const meiFiles = await resolveFiles(args.inDir, args.simples);
      const meiB = new Batcher(client, 'stg_mei', ['cnpj_base'], args.batch, 'ON CONFLICT (cnpj_base) DO NOTHING');
      for (const f of meiFiles) {
        console.log(`simples: ${f}`);
        await streamCsv(f, async (c) => {
          if ((c[4] ?? '').toUpperCase() === 'S') await meiB.push([(c[0] ?? '').padStart(8, '0')]);
        });
      }
      await meiB.flush();
    }

    // 3) municipio de-para (opcional) -> stg_mun
    if (args.municipioMap) {
      const munB = new Batcher(client, 'stg_mun', ['rfb', 'ibge'], args.batch, 'ON CONFLICT (rfb) DO NOTHING');
      console.log(`municipio-map: ${args.municipioMap}`);
      await streamCsv(join(args.inDir, args.municipioMap), async (c) => {
        const rfb = parseInt(c[0] ?? '', 10); const ibge = parseInt(c[1] ?? '', 10);
        if (Number.isFinite(rfb) && Number.isFinite(ibge)) await munB.push([rfb, ibge]);
      });
      await munB.flush();
    }

    // 4) estabelecimentos (filtra UF + situação ativa) -> stg_est
    const estFiles = await resolveFiles(args.inDir, args.estab);
    if (estFiles.length === 0) throw new Error(`nenhum arquivo de estabelecimentos (${args.estab}) em ${args.inDir}`);
    let estCount = 0;
    const NGRP = 25;  // buckets para fragmentar o UPSERT final (UPSERT por grupo)
    const estB = new Batcher(client, 'stg_est',
      ['cnpj', 'cnpj_base', 'nome_fantasia', 'cnae_principal', 'cnae_secundarios', 'municipio_rfb', 'uf', 'grp',
        'logradouro', 'numero', 'complemento', 'bairro', 'cep', 'telefone1', 'telefone2', 'email'], args.batch);
    for (const f of estFiles) {
      console.log(`estabelecimentos: ${f}`);
      await streamCsv(f, async (c) => {
        const ufRow = (c[19] ?? '').toUpperCase();
        if (!allBr && ufRow !== args.uf) return;                 // UF filter (skip no modo Brasil)
        if ((c[5] ?? '') !== '02') return;                       // só situação ATIVA
        if (allBr && !UF_REGIAO[ufRow]) return;                  // descarta UF inválida/exterior
        const base = (c[0] ?? '').padStart(8, '0');
        const cnpj = base + (c[1] ?? '').padStart(4, '0') + (c[2] ?? '').padStart(2, '0');
        if (cnpj.length !== 14) return;
        const cnaeP = parseInt(c[11] ?? '', 10);
        if (!Number.isFinite(cnaeP)) return;
        const cnaeSec = (c[12] ?? '').split(',').map((s) => parseInt(s, 10)).filter(Number.isFinite);
        const munRfb = parseInt(c[20] ?? '', 10);
        const grp = (Number(base.slice(0, 2)) || 0) % NGRP;
        // endereço/contato (ESTABELE): c13 tipo_logr, c14 logr, c15 num, c16 compl,
        // c17 bairro, c18 cep, c21 ddd1, c22 tel1, c23 ddd2, c24 tel2, c27 email
        const g = (i: number): string => (c[i] ?? '').trim();
        const logr = `${g(13)} ${g(14)}`.trim();
        const cep = /^\d{8}$/.test(g(18)) ? g(18) : null;
        const tel1 = g(22) ? g(21) + g(22) : null;
        const tel2 = g(24) ? g(23) + g(24) : null;
        const email = g(27).toLowerCase() || null;
        await estB.push([cnpj, base, c[4] || null, cnaeP, cnaeSec,
          Number.isFinite(munRfb) ? munRfb : null, allBr ? ufRow : args.uf, grp,
          logr || null, g(15) || null, g(16) || null, g(17) || null, cep, tel1, tel2, email]);
        estCount++;
      });
    }
    await estB.flush();
    console.log(`estabelecimentos ativos (${allBr ? 'Brasil' : 'UF ' + args.uf}): ${estCount}`);

    await client.query('CREATE INDEX ON stg_est (cnpj_base)');
    await client.query('CREATE INDEX ON stg_est (grp)');
    await client.query('ANALYZE stg_emp; ANALYZE stg_est; ANALYZE stg_mei; ANALYZE stg_mun;');

    // 5) UPSERT into the global companies pool (join estab+empresas, map município->IBGE->geom, drop MEI)
    // Região: do município IBGE quando casado; senão, derivada da UF do estab (cobre o modo Brasil).
    const regiaoFallback = 'CASE e.uf '
      + Object.entries(UF_REGIAO).map(([u, r]) => `WHEN '${u}' THEN '${r}'::regiao_br`).join(' ')
      + " ELSE 'SE'::regiao_br END";
    // UPSERT fragmentado por grupo: transações menores, memória limitada e
    // resumível (cada grupo já confirmado persiste — UPSERT é idempotente).
    let upserted = 0;
    for (let g = 0; g < NGRP; g++) {
      const r = await client.query(`
        INSERT INTO companies
          (cnpj, razao_social, nome_fantasia, cnae_principal, cnae_secundarios,
           municipio_id, uf, regiao, geom, porte, capital_social, situacao_cadastral, source, raw_data,
           logradouro, numero, complemento, bairro, cep, telefone1, telefone2, email)
        SELECT
          e.cnpj,
          COALESCE(emp.razao_social, ''),
          e.nome_fantasia,
          e.cnae_principal,
          e.cnae_secundarios,
          m.id,
          e.uf,
          COALESCE(m.regiao, ${regiaoFallback}),
          m.geom,
          COALESCE(emp.porte, 'nao_informado'),
          COALESCE(emp.capital_social, 0),
          'ativa',
          'rfb',
          NULL,
          e.logradouro, e.numero, e.complemento, e.bairro, e.cep,
          e.telefone1, e.telefone2, e.email
        FROM stg_est e
        LEFT JOIN stg_emp emp ON emp.cnpj_base = e.cnpj_base
        LEFT JOIN stg_mun map ON map.rfb = e.municipio_rfb
        LEFT JOIN municipios m ON m.id = COALESCE(map.ibge, e.municipio_rfb)
        WHERE e.grp = $1
          AND NOT EXISTS (SELECT 1 FROM stg_mei x WHERE x.cnpj_base = e.cnpj_base)
        ON CONFLICT (cnpj) DO UPDATE SET
          razao_social = EXCLUDED.razao_social,
          nome_fantasia = EXCLUDED.nome_fantasia,
          cnae_principal = EXCLUDED.cnae_principal,
          cnae_secundarios = EXCLUDED.cnae_secundarios,
          municipio_id = EXCLUDED.municipio_id,
          uf = EXCLUDED.uf,
          regiao = EXCLUDED.regiao,
          geom = EXCLUDED.geom,
          porte = EXCLUDED.porte,
          capital_social = EXCLUDED.capital_social,
          situacao_cadastral = 'ativa',
          source = 'rfb',
          logradouro = EXCLUDED.logradouro,
          numero = EXCLUDED.numero,
          complemento = EXCLUDED.complemento,
          bairro = EXCLUDED.bairro,
          cep = EXCLUDED.cep,
          telefone1 = EXCLUDED.telefone1,
          telefone2 = EXCLUDED.telefone2,
          email = EXCLUDED.email
        WHERE companies.source = 'rfb'
      `, [g]);
      upserted += r.rowCount ?? 0;
      console.log(`  grupo ${g + 1}/${NGRP}: +${r.rowCount} (acum ${upserted})`);
    }
    console.log(`companies upsert: ${upserted}`);

    // 6) mark region(s) enabled
    const ufsToEnable = allBr ? Object.keys(UF_REGIAO) : [args.uf];
    for (const u of ufsToEnable) {
      await client.query(
        `INSERT INTO enabled_regions (uf, regiao) VALUES ($1,$2)
         ON CONFLICT (uf) DO UPDATE SET regiao = EXCLUDED.regiao`,
        [u, regiaoFromUf(u)],
      );
    }
    await client.query('DROP TABLE IF EXISTS stg_emp; DROP TABLE IF EXISTS stg_est; DROP TABLE IF EXISTS stg_mei; DROP TABLE IF EXISTS stg_mun;');
    console.log(`ETL concluído. enabled_regions += ${args.uf}.`);
  } finally {
    await client.end();
  }
}

const UF_REGIAO: Record<string, string> = {
  AC: 'N', AP: 'N', AM: 'N', PA: 'N', RO: 'N', RR: 'N', TO: 'N',
  AL: 'NE', BA: 'NE', CE: 'NE', MA: 'NE', PB: 'NE', PE: 'NE', PI: 'NE', RN: 'NE', SE: 'NE',
  DF: 'CO', GO: 'CO', MT: 'CO', MS: 'CO',
  ES: 'SE', MG: 'SE', RJ: 'SE', SP: 'SE',
  PR: 'S', RS: 'S', SC: 'S',
};
function regiaoFromUf(uf: string): string { return UF_REGIAO[uf] ?? 'SE'; }

main().catch((e) => { console.error('ETL falhou:', e); process.exit(1); });
