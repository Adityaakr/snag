/**
 * Reads single entries of a remote zip archive with HTTP range requests, so a large archive (the PatchDiff Zenodo
 * record) never has to be downloaded whole. Supports stored and deflated entries; no zip64.
 */
import { crc32, deflateRawSync, inflateRawSync } from 'node:zlib';
import { ProviderError } from '../common/errors.js';
import type { HttpProvider } from './http.js';

export interface ZipEntry {
  name: string;
  method: number;
  compressedSize: number;
  size: number;
  localHeaderOffset: number;
}

const EOCD = 0x06054b50;
const CEN = 0x02014b50;
const LOC = 0x04034b50;

function bad(message: string): ProviderError {
  return new ProviderError('http', 'validation', `zip: ${message}`);
}

async function totalSize(http: HttpProvider, url: string): Promise<number> {
  const probe = await http.get(url, { range: { start: 0, end: 0 } });
  const m = /\/(\d+)$/.exec(probe.headers['content-range'] ?? '');
  if (!m) throw bad('the server does not support range requests');
  return Number(m[1]);
}

/** Lists the central directory. */
export async function listZip(http: HttpProvider, url: string): Promise<ZipEntry[]> {
  const size = await totalSize(http, url);
  const tailLen = Math.min(size, 65_557);
  const tail = (await http.get(url, { range: { start: size - tailLen, end: size - 1 } })).body;
  let eocd = -1;
  for (let i = tail.length - 22; i >= 0; i--)
    if (tail.readUInt32LE(i) === EOCD) {
      eocd = i;
      break;
    }
  if (eocd < 0) throw bad('no end-of-central-directory record');
  const cdSize = tail.readUInt32LE(eocd + 12);
  const cdOffset = tail.readUInt32LE(eocd + 16);
  if (cdOffset === 0xffffffff) throw bad('zip64 archives are not supported');
  const cd = (await http.get(url, { range: { start: cdOffset, end: cdOffset + cdSize - 1 } })).body;
  const entries: ZipEntry[] = [];
  for (let p = 0; p + 46 <= cd.length; ) {
    if (cd.readUInt32LE(p) !== CEN) throw bad('corrupt central directory');
    const nameLen = cd.readUInt16LE(p + 28);
    const extraLen = cd.readUInt16LE(p + 30);
    const commentLen = cd.readUInt16LE(p + 32);
    entries.push({
      method: cd.readUInt16LE(p + 10),
      compressedSize: cd.readUInt32LE(p + 20),
      size: cd.readUInt32LE(p + 24),
      localHeaderOffset: cd.readUInt32LE(p + 42),
      name: cd.subarray(p + 46, p + 46 + nameLen).toString('utf8'),
    });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

/** Fetches and inflates one entry. */
export async function readZipEntry(http: HttpProvider, url: string, entry: ZipEntry): Promise<Buffer> {
  const head = (
    await http.get(url, { range: { start: entry.localHeaderOffset, end: entry.localHeaderOffset + 29 } })
  ).body;
  if (head.readUInt32LE(0) !== LOC) throw bad(`corrupt local header for ${entry.name}`);
  const dataStart = entry.localHeaderOffset + 30 + head.readUInt16LE(26) + head.readUInt16LE(28);
  if (entry.compressedSize === 0) return Buffer.alloc(0);
  const data = (
    await http.get(url, { range: { start: dataStart, end: dataStart + entry.compressedSize - 1 } })
  ).body;
  if (entry.method === 0) return data;
  if (entry.method === 8) return inflateRawSync(data);
  throw bad(`unsupported compression method ${entry.method} for ${entry.name}`);
}

/** A minimal zip writer for fixtures and tests: stored or deflated entries, no zip64. */
export function buildZip(files: Record<string, string>, deflate = true): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const raw = Buffer.from(text);
    const data = deflate ? deflateRawSync(raw) : raw;
    const nameBuf = Buffer.from(name);
    const crc = crc32(raw);
    const loc = Buffer.alloc(30);
    loc.writeUInt32LE(0x04034b50, 0);
    loc.writeUInt16LE(deflate ? 8 : 0, 8);
    loc.writeUInt32LE(crc, 14);
    loc.writeUInt32LE(data.length, 18);
    loc.writeUInt32LE(raw.length, 22);
    loc.writeUInt16LE(nameBuf.length, 26);
    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0);
    cen.writeUInt16LE(deflate ? 8 : 0, 10);
    cen.writeUInt32LE(crc, 16);
    cen.writeUInt32LE(data.length, 20);
    cen.writeUInt32LE(raw.length, 24);
    cen.writeUInt16LE(nameBuf.length, 28);
    cen.writeUInt32LE(offset, 42);
    locals.push(loc, nameBuf, data);
    centrals.push(cen, nameBuf);
    offset += 30 + nameBuf.length + data.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(Object.keys(files).length, 8);
  eocd.writeUInt16LE(Object.keys(files).length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, eocd]);
}
