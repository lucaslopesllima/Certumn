// Cobertura de src/mediaStore.ts (gravação/leitura de mídia em disco, escolha de
// extensão, defesa contra path traversal) e src/ws.ts (registro de conexões e
// broadcast por org). Sem app/DB — fs real num diretório temporário + sockets fake.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { config } from '../src/config.ts';
import { mediaEnabled, saveMedia, readMedia, mediaStream } from '../src/mediaStore.ts';
import { addConn, removeConn, broadcast } from '../src/ws.ts';

let dir = '';
let dir0 = config.whatsappMediaDir;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'wa-media-'));
  dir0 = config.whatsappMediaDir;
  config.whatsappMediaDir = dir;
});
afterAll(async () => {
  config.whatsappMediaDir = dir0;
  await rm(dir, { recursive: true, force: true });
});

const b64 = Buffer.from('conteudo-binario').toString('base64');

describe('mediaStore', () => {
  it('mediaEnabled reflete config', () => {
    expect(mediaEnabled()).toBe(true);
    config.whatsappMediaDir = '';
    expect(mediaEnabled()).toBe(false);
    config.whatsappMediaDir = dir;
  });

  it('saveMedia escolhe extensão pelo mime conhecido', async () => {
    const rel = await saveMedia(1, '10', b64, 'image/png', null);
    expect(rel).toBe('1/10.png');
    expect(await readFile(join(dir, rel))).toEqual(Buffer.from('conteudo-binario'));
  });

  it('saveMedia deriva extensão do subtype quando mime desconhecido', async () => {
    const rel = await saveMedia(1, '11', b64, 'application/x-custom', null);
    expect(rel).toBe('1/11.xcustom');
  });

  it('saveMedia cai no fileName quando sem mime', async () => {
    const rel = await saveMedia(1, '12', b64, null, 'contrato.PDF');
    expect(rel).toBe('1/12.pdf');
  });

  it('saveMedia cai em bin sem mime/fileName úteis', async () => {
    // fileName sem ponto e >8 chars: pop() falha o regex de extensão → bin.
    const rel = await saveMedia(1, '13', b64, null, 'arquivosemextensao');
    expect(rel).toBe('1/13.bin');
  });

  it('readMedia devolve o buffer gravado', async () => {
    await saveMedia(2, '20', b64, 'image/jpeg', null);
    expect(await readMedia('2/20.jpg')).toEqual(Buffer.from('conteudo-binario'));
  });

  it('mediaStream devolve stream + tamanho', async () => {
    await saveMedia(3, '30', b64, 'image/webp', null);
    const { stream, size } = await mediaStream('3/30.webp');
    expect(size).toBe(Buffer.from('conteudo-binario').length);
    const chunks: Buffer[] = [];
    for await (const c of stream) chunks.push(c as Buffer);
    expect(Buffer.concat(chunks)).toEqual(Buffer.from('conteudo-binario'));
  });

  it('rejeita path traversal', async () => {
    await expect(readMedia('../../etc/passwd')).rejects.toThrow('caminho de mídia inválido');
  });
});

describe('ws — broadcast', () => {
  const mkSock = (readyState = 1) => {
    const sent: string[] = [];
    return { readyState, send: (m: string) => sent.push(m), sent } as unknown as
      import('ws').WebSocket & { sent: string[] };
  };

  it('broadcast sem conexões não faz nada', () => {
    expect(() => broadcast(9999, 'x', {})).not.toThrow();
  });

  it('entrega só a sockets abertos da org', () => {
    const a = mkSock(1); const b = mkSock(1); const closed = mkSock(3);
    addConn(100, a); addConn(100, closed); addConn(200, b);
    broadcast(100, 'message', { n: 1 });
    expect((a as unknown as { sent: string[] }).sent).toEqual([JSON.stringify({ event: 'message', data: { n: 1 } })]);
    expect((closed as unknown as { sent: string[] }).sent).toEqual([]); // readyState != 1
    expect((b as unknown as { sent: string[] }).sent).toEqual([]);      // outra org
  });

  it('socket que lança no send é ignorado (best-effort)', () => {
    const bad = { readyState: 1, send: () => { throw new Error('quebrado'); } } as unknown as import('ws').WebSocket;
    addConn(300, bad);
    expect(() => broadcast(300, 'x', {})).not.toThrow();
  });

  it('removeConn limpa a org quando esvazia', () => {
    const s = mkSock(1);
    addConn(400, s);
    removeConn(400, s);
    const s2 = mkSock(1);
    broadcast(400, 'x', {}); // set removido: no-op
    expect((s2 as unknown as { sent: string[] }).sent).toEqual([]);
    removeConn(500, s2); // org inexistente: no-op
    expect(() => removeConn(400, s)).not.toThrow();
  });
});
