// Jalankan: node scripts/bmp-flipbook.test.mjs
//
// Uji viewer FLIPBOOK (kasus EKMA4316 dkk): halaman dirender sebagai
// background-image pada div#pageContainer_N_documentViewer, containernya TIDAK
// bisa di-scroll, dan tidak ada <img> halaman. rbv.js harus memajukan viewer
// lewat tombol next miliknya satu halaman per satu waktu sambil memanen gambar,
// tanpa pernah meminta halaman sendiri ke server (itu memicu blokir WAF).
import { pathToFileURL } from 'node:url';
import { fileURLToPath } from 'node:url';

const RBV = fileURLToPath(new URL('../src/bmp/rbv.js', import.meta.url));
const MODULE = 1;
const TOTAL = 37;
const PER_FLIP = 2;          // satu maju menampilkan 2 halaman (bentangan buku)

const results = [];
const log = (ok, msg) => { results.push({ ok, msg }); console.log(`${ok ? 'LULUS' : 'GAGAL'}  ${msg}`); };

// ---- DOM flipbook tiruan ----
const state = { revealed: 0, clicks: 0, messages: [], directRequests: 0, cachedReads: 0 };

function makePageDiv(page) {
  const el = {
    tagName: 'DIV',
    id: `pageContainer_${page - 1}_documentViewer`,
    className: '',
    offsetWidth: 392, offsetHeight: 557, offsetParent: {},
    children: [], style: {},
    // dinamis: halaman punya background hanya kalau sudah dimuat viewer
    get _bg() {
      return page <= state.revealed ? `url("/reader/services/view.php?doc=M${MODULE}&format=jpg&subfolder=EKMA4316%2F&page=${page}")` : 'none';
    },
    hasAttribute: () => false, getAttribute: () => null, querySelectorAll: () => [],
  };
  return el;
}

const pageDivs = Array.from({ length: TOTAL }, (_, i) => makePageDiv(i + 1));
const scrollContainer = { tagName: 'DIV', id: 'pagesContainer_documentViewer', offsetWidth: 800, offsetHeight: 557, scrollHeight: 557, clientHeight: 557, children: [], style: {}, hasAttribute: () => false, getAttribute: () => null, querySelectorAll: () => [] };
const nextBtn = {
  tagName: 'DIV', id: '', className: 'flowpaper_bttnPrevNext flowpaper_tbbutton flowpaper_next',
  offsetWidth: 21, offsetHeight: 21, offsetParent: {}, style: {}, children: [],
  hasAttribute: () => false, getAttribute: () => null, querySelectorAll: () => [],
  click: () => { state.clicks++; state.revealed = Math.min(TOTAL, state.revealed + PER_FLIP); },
};
const totalEl = {
  hasAttribute: (a) => a === 'data-total-pages',
  getAttribute: (a) => (a === 'data-total-pages' ? String(TOTAL) : null),
  textContent: String(TOTAL),
};
const inlineScript = { textContent: `var config = { numPages: ${TOTAL} };`, hasAttribute: () => false, getAttribute: () => null };

globalThis.document = {
  body: { innerText: 'halaman reader normal' },
  querySelectorAll: (sel) => {
    const s = String(sel);
    if (s === 'input[type="password"]') return [];
    if (s === 'img') return [];                                  // flipbook: tidak ada <img> halaman
    if (s === 'div,span,section') return [...pageDivs, scrollContainer];
    if (s === '[data-total-pages],[data-page-count],[data-pages]') return [totalEl];
    if (s === 'script:not([src])') return [inlineScript];
    if (s === '[id^="pagesContainer"]') return [scrollContainer];
    if (s === '[class*="flowpaper_next"],[class*="bttnNextPage"]') return [nextBtn];
    return [];
  },
  querySelector: (sel) => {
    const r = document.querySelectorAll(sel);
    return r.length ? r[0] : null;
  },
  getElementById: (id) => pageDivs.find((d) => d.id === id) || null,
  createElement: (tag) => (tag === 'canvas'
    ? { width: 0, height: 0, getContext: () => ({ drawImage: () => {} }), toDataURL: () => 'data:image/jpeg;base64,' + 'A'.repeat(2500) }
    : { style: {}, appendChild: () => {}, addEventListener: () => {} }),
};
globalThis.getComputedStyle = (el) => ({ display: 'block', visibility: 'visible', backgroundImage: el._bg || 'none' });
globalThis.window = globalThis;

// Image() dipakai rbv.js untuk MEMBACA gambar yang sudah dimuat viewer
// (jalur background-image) — itu wajar dan biasanya dilayani cache. Yang HARUS
// tidak terjadi: meminta halaman yang belum pernah dimuat viewer.
globalThis.Image = class {
  constructor() { this.naturalWidth = 0; this.naturalHeight = 0; }
  set src(v) {
    this._src = v;
    const m = String(v).match(/[?&]page=(\d+)/);
    const page = m ? Number(m[1]) : 0;
    setTimeout(() => {
      if (page >= 1 && page <= state.revealed) {
        state.cachedReads++;
        this.naturalWidth = 1200;
        this.naturalHeight = 1704;
        this.onload && this.onload();
      } else {
        state.directRequests++;          // halaman belum dimuat viewer = terlarang
        this.onerror && this.onerror();
      }
    }, 1);
  }
  get src() { return this._src || ''; }
};

let listener = null;
globalThis.chrome = {
  runtime: {
    onMessage: { addListener: (fn) => { listener = fn; }, removeListener: () => {} },
    sendMessage: async (m) => { state.messages.push(m); },
  },
};

const waitDone = (runId, timeoutMs) => new Promise((resolve) => {
  const t0 = Date.now();
  const tick = () => {
    const d = state.messages.find((m) => m.type === 'TUTON_BMP_MODULE_DONE' && m.runId === runId);
    if (d) return resolve(d);
    if (Date.now() - t0 > timeoutMs) return resolve(null);
    setTimeout(tick, 100);
  };
  tick();
});

await import(pathToFileURL(RBV).href + '?flip=' + Date.now());
const runId = 'flip' + Date.now();
// mulai dengan 4 halaman sudah tampil (seperti saat viewer baru dibuka)
state.revealed = 4;
const t0 = Date.now();
await new Promise((res) => { const r = listener({ type: 'TUTON_BMP_START_MODULE', runId, code: 'EKMA4316', module: MODULE, maxPages: 500, speed: 'cepat', autoScroll: true }, {}, res); if (r === undefined) res(); });
const done = await waitDone(runId, 240000);
const secs = ((Date.now() - t0) / 1000).toFixed(1);
const pages = state.messages.filter((m) => m.type === 'TUTON_BMP_PAGE').map((m) => m.page);
const flipMsg = state.messages.filter((m) => m.type === 'TUTON_BMP_FLIP').length;

console.log(`\n--- FLIPBOOK EKMA4316 M${MODULE} (${TOTAL} hal, ${PER_FLIP}/maju) ---`);
console.log(`hasil=${done?.result} | halaman=${done?.pages}/${done?.totalPages} | bolong=${JSON.stringify(done?.missing || [])}`);
console.log(`maju viewer=${state.clicks}x | pesan flip=${flipMsg} | halaman terkirim=${pages.length} | waktu=${secs}s`);

log(done?.result === 'complete', `modul selesai lengkap (dapat: ${done?.result})`);
log(done?.pages === TOTAL, `semua ${TOTAL} halaman terpanen (dapat ${done?.pages})`);
log(Array.isArray(done?.missing) && done.missing.length === 0, `tidak ada halaman bolong (${JSON.stringify(done?.missing)})`);
log(new Set(pages).size === TOTAL, `${TOTAL} halaman unik terkirim (dapat ${new Set(pages).size})`);
log(state.clicks > 0 && state.clicks <= Math.ceil(TOTAL / PER_FLIP) + 6, `viewer dimajukan ${state.clicks}x (wajar: ~${Math.ceil(TOTAL / PER_FLIP)}x)`);
log(flipMsg >= 1, 'sidepanel diberi tahu mode flipbook (TUTON_BMP_FLIP)');
log(state.directRequests === 0, `TIDAK ada permintaan halaman yang belum dimuat viewer (${state.directRequests}) — syarat agar WAF tidak memblokir`);
log(state.cachedReads > 0, `pembacaan gambar memakai URL milik viewer: ${state.cachedReads}x`);

const failed = results.filter((r) => !r.ok).length;
console.log('\nRingkasan: ' + (results.length - failed) + ' lulus, ' + failed + ' gagal\n');
process.exit(failed ? 1 : 0);
