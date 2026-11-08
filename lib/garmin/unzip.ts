/**
 * Minimal zip reader for Garmin's activity download (one .fit inside a zip).
 * No dependency: reads the central directory and inflates with node:zlib.
 * Handles stored (0) and deflate (8) entries; anything else throws.
 */

import { inflateRawSync } from 'node:zlib';

export interface ZipEntry {
  name: string;
  data: Buffer;
}

const EOCD_SIG = 0x06054b50;
const CENTRAL_SIG = 0x02014b50;
const LOCAL_SIG = 0x04034b50;

export function unzip(buf: Buffer): ZipEntry[] {
  // End-of-central-directory record: last 22 bytes, plus up to 64 KB comment.
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('not a zip file (no end-of-central-directory record)');

  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out: ZipEntry[] = [];
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== CENTRAL_SIG) throw new Error('corrupt zip central directory');
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    p += 46 + nameLen + extraLen + commentLen;

    if (buf.readUInt32LE(localOffset) !== LOCAL_SIG) throw new Error(`corrupt zip local header for ${name}`);
    const start = localOffset + 30 + buf.readUInt16LE(localOffset + 26) + buf.readUInt16LE(localOffset + 28);
    const raw = buf.subarray(start, start + compSize);
    if (method === 0) out.push({ name, data: Buffer.from(raw) });
    else if (method === 8) out.push({ name, data: inflateRawSync(raw) });
    else throw new Error(`unsupported zip compression method ${method} for ${name}`);
  }
  return out;
}

/** Garmin's download: the .fit inside the zip, or the buffer itself if it is already a FIT file. */
export function fitFromGarminDownload(buf: Buffer): Buffer {
  if (buf.length >= 12 && buf.toString('ascii', 8, 12) === '.FIT') return buf;
  const fit = unzip(buf).find((e) => /\.fit$/i.test(e.name));
  if (!fit) throw new Error('Garmin download held no .fit file');
  return fit.data;
}
