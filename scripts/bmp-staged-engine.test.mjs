// Jalankan: node scripts/bmp-staged-engine.test.mjs
// Uji mesin rakit (src/bmp/engine.js) dengan pdf-lib ASLI dari vendor dan
// IndexedDB tiruan: memastikan lanjutan menghasilkan PDF dengan URUTAN halaman
// benar, dan modul yang belum lengkap TIDAK pernah disimpan sebagai utuh.
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';

// ---- pdf-lib asli dari vendor ----
const vendor = readFileSync(fileURLToPath(new URL('../src/bmp/vendor/pdf-lib.min.js', import.meta.url)), 'utf8');
const mod = { exports: {} };
new Function('module', 'exports', 'globalThis', vendor)(mod, mod.exports, globalThis);
globalThis.PDFLib = mod.exports;
const { PDFDocument } = globalThis.PDFLib;

// ---- chrome tiruan ----
const storage = {};
globalThis.chrome = {
  runtime: { getURL: (p) => 'chrome-extension://x/' + p },
  storage: {
    local: {
      get: async (keys) => {
        const out = {};
        for (const k of (Array.isArray(keys) ? keys : [keys])) if (k in storage) out[k] = storage[k];
        return out;
      },
      set: async (obj) => { Object.assign(storage, obj); },
    },
  },
};

// ---- IndexedDB tiruan (Map + microtask) ----
const IDB = new Map();
{
  const micro = (fn) => queueMicrotask(fn);
  let tx = null;
  const walk = (onCur, done) => {
    const keys = [...IDB.keys()].sort();
    let i = 0;
    const step = () => {
      const key = keys[i++];
      const cur = key === undefined ? null : {
        key,
        value: IDB.get(key),
        continue: () => micro(step),
        delete: () => IDB.delete(key),
      };
      onCur(cur);
      if (cur === null) micro(done);
    };
    return step;
  };
  const cursorReq = () => {
    const r = { onsuccess: null, onerror: null, result: undefined };
    const step = walk(
      (cur) => { r.result = cur; try { r.onsuccess?.({ target: r }); } catch (e) { r.onerror?.(e); } },
      () => tx?.oncomplete?.(),
    );
    micro(step);
    return r;
  };
  const store = {
    put: (value, key) => { IDB.set(String(key), value); micro(() => tx?.oncomplete?.()); return { onsuccess: null, onerror: null }; },
    get: (key) => {
      const r = { onsuccess: null, onerror: null, result: undefined };
      micro(() => { r.result = IDB.get(String(key)); r.onsuccess?.({ target: r }); });
      return r;
    },
    delete: (key) => { IDB.delete(String(key)); micro(() => tx?.oncomplete?.()); return { onsuccess: null, onerror: null }; },
    openKeyCursor: cursorReq,
    openCursor: cursorReq,
  };
  globalThis.indexedDB = {
    open: () => {
      const r = { onsuccess: null, onerror: null, onupgradeneeded: null, result: null };
      micro(() => {
        r.result = {
          objectStoreNames: { contains: () => true },
          createObjectStore: () => {},
          transaction: () => { tx = { objectStore: () => store, oncomplete: null, onerror: null, error: null }; return tx; },
          close: () => {},
        };
        r.onupgradeneeded?.();
        r.onsuccess?.({ target: r });
      });
      return r;
    },
  };
}

// ---- Tesseract tiruan: 1 halaman PDF dengan LEBAR = 300 + nomor halaman ----
const tesseractCalls = [];
globalThis.Tesseract = {
  createWorker: async () => ({
    recognize: async (dataUrl) => {
      const page = Number(String(dataUrl).split(':')[1]);
      tesseractCalls.push(page);
      const d = await PDFDocument.create();
      d.addPage([300 + page, 400]);
      return { data: { pdf: await d.save(), text: `teks halaman ${page}` } };
    },
  }),
};

const engine = await import(pathToFileURL(fileURLToPath(new URL('../src/bmp/engine.js', import.meta.url))).href);
const CODE = 'STMA4224';
const M = 3;
const TOTAL = 41;
let pass = 0;
let fail = 0;
const log = (ok, msg) => { ok ? pass++ : fail++; console.log(`${ok ? 'LULUS' : 'GAGAL'}  ${msg}`); };
const pageWidths = async (bytes) => {
  const doc = await PDFDocument.load(new Uint8Array(bytes));
  return doc.getPages().map((p) => Math.round(p.getWidth()));
};
const keysWith = (prefix) => [...IDB.keys()].filter((k) => k.startsWith(prefix)).sort();

console.log('--- Sesi 1: jaringan putus setelah halaman 31 (32–41 tetap masuk) ---');
await engine.prepareJob('r1');
for (let p = 32; p <= TOTAL; p++) await engine.ocrPage(CODE, M, p, `page:${p}`, 'r1');
const part = await engine.assembleStaged(CODE, M);
const partBytes = IDB.get(`partial:${CODE}:M${M}`);
console.log(`parsial: ${part.pages} halaman | lebar: ${JSON.stringify(await pageWidths(partBytes))}`);
log(part.pages === 10, `PDF parsial berisi 10 halaman (dapat ${part.pages})`);
log(JSON.stringify(await pageWidths(partBytes)) === JSON.stringify([332, 333, 334, 335, 336, 337, 338, 339, 340, 341]), 'parsial urut halaman 32–41');
log(keysWith(`partial:${CODE}:M${M}`).length === 1, 'parsial disimpan di kunci `partial:` (tidak mengotori cache modul)');
log(keysWith(`${CODE}:M`).length === 0, 'cache modul tidak ditandai selesai saat masih parsial');

console.log('\n--- Modul belum lengkap tidak boleh disimpan sebagai utuh ---');
let refused = false;
try { await engine.finishModule(CODE, M, TOTAL, 'r1'); } catch (e) { refused = true; console.log('ditolak:', e.message.slice(0, 90)); }
log(refused, 'finishModule menolak (10 hal ≠ 41 hal) — PDF tidak terpotong');

console.log('\n--- Sesi 2 (lanjutan): hanya halaman 1–31 yang diunduh & di-OCR ulang ---');
await engine.prepareJob('r2');
const before = tesseractCalls.length;
for (let p = 1; p <= 31; p++) await engine.ocrPage(CODE, M, p, `page:${p}`, 'r2');
const fin = await engine.finishModule(CODE, M, TOTAL, 'r2');
const w = await pageWidths(IDB.get(`${CODE}:M${M}`));
console.log(`final: ${w.length} halaman | ${(fin.bytes / 1024).toFixed(0)} KB | lebar: ${w[0]}…${w[w.length - 1]}`);
log(tesseractCalls.length - before === 31, `OCR hanya 31 halaman baru (dapat ${tesseractCalls.length - before})`);
log(w.length === TOTAL, `PDF final berisi ${w.length} halaman (harus ${TOTAL})`);
log(w.join(',') === Array.from({ length: TOTAL }, (_, i) => 300 + i + 1).join(','), 'URUTAN halaman benar 1…41 walau 32–41 diproses lebih dulu');
log(keysWith(`staged:${CODE}:M${M}`).length === 0, 'simpanan bertahap dibersihkan setelah modul lengkap');
log(keysWith(`partial:${CODE}:M${M}`).length === 0, 'PDF parsial basi dihapus setelah modul lengkap');
log(JSON.stringify(storage[`tuton_modtexts`]?.[`${CODE}:M${M}`]?.texts?.length) === '41', 'teks OCR 41 halaman tersimpan untuk AI');

console.log(`\nRingkasan: ${pass} lulus, ${fail} gagal\n`);
process.exit(fail ? 1 : 0);
