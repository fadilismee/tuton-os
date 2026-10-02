// src/export/zip.js — ZIP baca/tulis tanpa dependensi.
// Baca: central directory + DecompressionStream('deflate-raw') (Chrome/Node 18+).
// Tulis: entri DEFLATE (CompressionStream) + CRC32 sendiri.
// Dipakai untuk: (a) membongkar template/template.docx, (b) menyusun .docx hasil.

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const te = new TextEncoder();
const td = new TextDecoder('utf-8');

async function inflateRaw(bytes) {
  if (typeof DecompressionStream !== 'function') throw new Error('DecompressionStream tidak tersedia di lingkungan ini');
  const ds = new DecompressionStream('deflate-raw');
  const out = new Response(new Blob([bytes]).stream().pipeThrough(ds)).arrayBuffer();
  return new Uint8Array(await out);
}

async function deflateRaw(bytes) {
  if (typeof CompressionStream !== 'function') throw new Error('CompressionStream tidak tersedia di lingkungan ini');
  const cs = new CompressionStream('deflate-raw');
  const out = new Response(new Blob([bytes]).stream().pipeThrough(cs)).arrayBuffer();
  return new Uint8Array(await out);
}

const u16 = (dv, p) => dv.getUint16(p, true);
const u32 = (dv, p) => dv.getUint32(p, true);

/** Baca ZIP -> Map<nama, Uint8Array> (semua entri, isi sudah didekompresi). */
export async function unzip(buf) {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // Cari End Of Central Directory (0x06054b50) dari belakang.
  let eocd = -1;
  for (let i = bytes.length - 22; i >= 0 && i >= bytes.length - 22 - 65558; i--) {
    if (u32(dv, i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('bukan file ZIP/DOCX yang valid (EOCD tidak ketemu)');
  const count = u16(dv, eocd + 10);
  let p = u32(dv, eocd + 16);
  const out = new Map();
  for (let i = 0; i < count; i++) {
    if (u32(dv, p) !== 0x02014b50) throw new Error('central directory rusak pada entri ' + i);
    const method = u16(dv, p + 10);
    const compSize = u32(dv, p + 20);
    const nameLen = u16(dv, p + 28);
    const extraLen = u16(dv, p + 30);
    const cmtLen = u16(dv, p + 32);
    const localOff = u32(dv, p + 42);
    const name = td.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    // Local header -> awal data.
    if (u32(dv, localOff) !== 0x04034b50) throw new Error('local header rusak: ' + name);
    const lNameLen = u16(dv, localOff + 26);
    const lExtraLen = u16(dv, localOff + 28);
    const dataStart = localOff + 30 + lNameLen + lExtraLen;
    const raw = bytes.subarray(dataStart, dataStart + compSize);
    out.set(name, method === 0 ? raw.slice() : await inflateRaw(raw));
    p += 46 + nameLen + extraLen + cmtLen;
  }
  return out;
}

/** Tulis ZIP (deflate). files: Array<[nama, Uint8Array|string]>. */
export async function zip(files) {
  const entries = [];
  for (const [name, data] of files) {
    const raw = typeof data === 'string' ? te.encode(data) : data instanceof Uint8Array ? data : new Uint8Array(data);
    const comp = await deflateRaw(raw);
    entries.push({ name: te.encode(name), crc: crc32(raw), rawSize: raw.length, comp });
  }
  let size = 0;
  for (const e of entries) size += 30 + e.name.length + e.comp.length + 46 + e.name.length + 22;
  const out = new Uint8Array(size);
  const dv = new DataView(out.buffer);
  let off = 0;
  const central = [];
  for (const e of entries) {
    const localOff = off;
    dv.setUint32(off, 0x04034b50, true); off += 4;
    dv.setUint16(off, 20, true); off += 2;      // version needed
    dv.setUint16(off, 0x0800, true); off += 2;  // flag: nama UTF-8
    dv.setUint16(off, 8, true); off += 2;       // method: deflate
    dv.setUint16(off, 0, true); off += 2;       // time
    dv.setUint16(off, 0x21, true); off += 2;    // date (1980-01-01)
    dv.setUint32(off, e.crc, true); off += 4;
    dv.setUint32(off, e.comp.length, true); off += 4;
    dv.setUint32(off, e.rawSize, true); off += 4;
    dv.setUint16(off, e.name.length, true); off += 2;
    dv.setUint16(off, 0, true); off += 2;       // extra len
    out.set(e.name, off); off += e.name.length;
    out.set(e.comp, off); off += e.comp.length;
    central.push({ ...e, localOff });
  }
  const cdStart = off;
  for (const e of central) {
    dv.setUint32(off, 0x02014b50, true); off += 4;
    dv.setUint16(off, 20, true); off += 2;      // version made by
    dv.setUint16(off, 20, true); off += 2;      // version needed
    dv.setUint16(off, 0x0800, true); off += 2;
    dv.setUint16(off, 8, true); off += 2;
    dv.setUint16(off, 0, true); off += 2;
    dv.setUint16(off, 0x21, true); off += 2;
    dv.setUint32(off, e.crc, true); off += 4;
    dv.setUint32(off, e.comp.length, true); off += 4;
    dv.setUint32(off, e.rawSize, true); off += 4;
    dv.setUint16(off, e.name.length, true); off += 2;
    dv.setUint16(off, 0, true); off += 2;
    dv.setUint16(off, 0, true); off += 2;       // comment
    dv.setUint16(off, 0, true); off += 2;       // disk
    dv.setUint16(off, 0, true); off += 2;       // internal attrs
    dv.setUint32(off, 0, true); off += 4;       // external attrs
    dv.setUint32(off, e.localOff, true); off += 4;
    out.set(e.name, off); off += e.name.length;
  }
  const cdSize = off - cdStart;
  dv.setUint32(off, 0x06054b50, true); off += 4;
  dv.setUint16(off, 0, true); off += 2;                  // nomor disk
  dv.setUint16(off, 0, true); off += 2;                  // disk berisi CD
  dv.setUint16(off, central.length, true); off += 2;     // entri di disk ini
  dv.setUint16(off, central.length, true); off += 2;     // total entri
  dv.setUint32(off, cdSize, true); off += 4;             // ukuran CD
  dv.setUint32(off, cdStart, true); off += 4;            // offset CD
  dv.setUint16(off, 0, true); off += 2;                  // panjang komentar
  return out.subarray(0, off);
}
