// scripts/export-extension-sim.mjs — jalankan kode export EXTENSION yang asli di Node
// dengan tiruan chrome.* (runtime.getURL/fetch/storage/downloads/tabs) supaya
// jalur yang dipakai panel (exportDocx/exportPdf/print-fallback) terbukti jalan
// dan file hasilnya bisa diperiksa.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const outDir = path.resolve(root, process.argv[2] || 'out-export');
const RUNTIME_URL = process.argv[3] || '';       // mis. http://127.0.0.1:3721
fs.mkdirSync(outDir, { recursive: true });

// ---------- vendor (persis <script> di panel) ----------
function loadScript(file) {
  const ctx = {};
  ctx.self = ctx; ctx.window = ctx; ctx.globalThis = ctx;
  ctx.module = { exports: {} }; ctx.exports = ctx.module.exports;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(file, 'utf8'), ctx);
  return ctx;
}
const kctx = loadScript(path.join(root, 'src/bmp/vendor/katex/katex.min.js'));
globalThis.katex = kctx.katex || kctx.module.exports;
globalThis.mml2ommlPkg = loadScript(path.join(root, 'src/export/vendor/mathml2omml.min.js')).mml2ommlPkg;

// ---------- tiruan chrome.* ----------
const store = { tuton_profile: { nama: 'Fatahillah Mirza Achmadil', nim: '055752694', matkul: 'EKMA5102 Statistika (Tuton 3)' } };
if (RUNTIME_URL) store.tuton_ai = { routerUrl: RUNTIME_URL, runtimeToken: '' };
const downloads = [];
const tabsOpened = [];
globalThis.chrome = {
  runtime: { getURL: (rel) => 'file:///' + path.join(root, rel).replace(/\\/g, '/') },
  storage: {
    local: {
      get: async (keys) => {
        const out = {};
        for (const k of [].concat(keys)) if (k in store) out[k] = store[k];
        return out;
      },
      set: async (obj) => { Object.assign(store, obj); },
      remove: async (keys) => { for (const k of [].concat(keys)) delete store[k]; },
    },
  },
  downloads: {
    download: async ({ url, filename }) => {
      // url = blob:... tidak bisa dibaca dari Node -> panel memakai Blob;
      // di sini kita menangkap lewat patched Blob di bawah.
      downloads.push({ url, filename });
      const blob = lastBlobs.get(url);
      if (blob) fs.writeFileSync(path.join(outDir, filename), Buffer.from(await blob.arrayBuffer()));
      return downloads.length;
    },
  },
  tabs: { create: async ({ url }) => { tabsOpened.push(url); return { id: 999 }; } },
  windows: { create: async () => ({ id: 1 }) },
};
const lastBlobs = new Map();
const RealBlob = globalThis.Blob;
globalThis.Blob = class extends RealBlob {
  constructor(parts, opts) { super(parts, opts); lastBlobs.set('pending', this); this.__parts = parts; }
};
globalThis.URL.createObjectURL = (blob) => {
  const id = 'blob:sim/' + Math.random().toString(36).slice(2);
  lastBlobs.set(id, blob);
  return id;
};
globalThis.URL.revokeObjectURL = () => {};
// fetch file:// untuk template
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts) => {
  if (typeof url === 'string' && url.startsWith('file:///')) {
    const p = decodeURIComponent(url.replace('file:///', ''));
    if (!fs.existsSync(p)) return { ok: false, status: 404 };
    const buf = fs.readFileSync(p);
    return { ok: true, status: 200, arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) };
  }
  return realFetch(url, opts);
};
globalThis.btoa = (s) => Buffer.from(s, 'binary').toString('base64');
globalThis.atob = (s) => Buffer.from(s, 'base64').toString('binary');

// ---------- import modul extension (kode asli) ----------
const mod = await import(pathToFileURL(path.join(root, 'src/export/index.js')).href);
const pending = await import(pathToFileURL(path.join(root, 'src/export/pending.js')).href);

const SAMPLE = `## Soal 1

Rata-rata $\\bar{x}=\\frac{\\sum x_i}{n}$ dan varians:

$$s^2=\\frac{1}{n-1}\\sum_{i=1}^{n}(x_i-\\bar{x})^2$$

| Simbol | Arti |
|---|---|
| $\\bar{x}$ | rata-rata |

*Kesimpulan:* tolak $H_0$ bila $|t|>t_{\\alpha/2,n-1}$.
`;

console.log('=== 1) exportDocx (kode extension asli) ===');
const t0 = Date.now();
const r1 = await mod.exportDocx({ markdown: SAMPLE, doc: { course: 'EKMA5102 Statistika (Uji)' } });
console.log('nama:', r1.name, '| byte:', r1.bytes, '|', Date.now() - t0, 'ms');
console.log('unduhan tercatat:', downloads.length, downloads.map((d) => d.filename).join(', '));

console.log('=== 2) exportPdf (runtime + fallback cetak) ===');
const r2 = await mod.exportPdf({ markdown: SAMPLE, doc: { course: 'EKMA5102 Statistika (Uji)' } });
console.log('hasil:', JSON.stringify({ mode: r2.mode, engine: r2.engine, name: r2.name, note: r2.note || null }));
if (r2.mode === 'print') {
  const job = await pending.takePrint();
  console.log('print-job tersimpan:', job ? `${job.markdown.length} char, judul "${job.title}"` : 'TIDAK ADA');
  console.log('tab dibuka:', tabsOpened.join(', '));
}
console.log('file di', outDir, ':', fs.readdirSync(outDir).join(', '));

console.log('=== 3) stageExport -> takeExport (titipan antar halaman) ===');
await pending.stageExport({ markdown: SAMPLE, course: 'Titipan' });
const taken = await pending.takeExport();
console.log('titipan terbaca:', Boolean(taken), '| sisa:', (await pending.peekExport()) === null ? 'kosong (baik)' : 'masih ada');

console.log('=== 4) runtimeCapability ===');
console.log(JSON.stringify(await mod.runtimeCapability()));