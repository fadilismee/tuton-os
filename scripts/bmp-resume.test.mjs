// Uji perilaku mode Cepat rbv.js: halaman macet di tengah TIDAK mematikan
// modul (dilewati lalu disusulkan), dan sesi lanjutan tidak mengulang halaman
// yang sudah tersimpan. DOM viewer disimulasikan; tidak menyentuh jaringan.
import { fileURLToPath, pathToFileURL } from 'node:url';

// Jalankan: node scripts/bmp-resume.test.mjs
// Jalur rbv.js diturunkan dari lokasi skrip ini (bukan path absolut mesin).
const RBV = fileURLToPath(new URL('../src/bmp/rbv.js', import.meta.url));
const MODULE = 3;
const TOTAL = 41;
const PAGE_H = 700;

function makeEnv({ blocked = [], feedMs = 120 }) {
  const state = {
    totalPages: TOTAL,
    loaded: new Set(),
    blocked: new Set(blocked),
    requested: [],
    messages: [],
    feedMs,
  };
  const container = { clientHeight: PAGE_H, scrollHeight: PAGE_H * TOTAL, _v: 0 };
  Object.defineProperty(container, 'scrollTop', {
    get: () => container._v,
    set: (v) => {
      container._v = v;
      const page = Math.round(v / PAGE_H) + 1;
      if (page >= 1 && page <= TOTAL) {
        state.requested.push(page);
        if (!state.blocked.has(page)) setTimeout(() => state.loaded.add(page), state.feedMs);
      }
    },
  });
  const totalEl = {
    hasAttribute: (a) => a === 'data-total-pages',
    getAttribute: (a) => (a === 'data-total-pages' ? String(TOTAL) : null),
    textContent: String(TOTAL),
  };
  const imgFor = (page) => ({
    src: `https://pustaka.ut.ac.id/reader/services/view.php?doc=M${MODULE}&page=${page}`,
    complete: true,
    naturalWidth: 1000,
    naturalHeight: 1400,
    getAttribute: () => null,
  });
  globalThis.document = {
    body: { innerText: 'halaman reader normal' },
    querySelectorAll: (sel) => {
      if (sel === 'img') return [...state.loaded].sort((a, b) => a - b).map(imgFor);
      if (sel === '[data-total-pages],[data-page-count],[data-pages]') return [totalEl];
      if (String(sel).startsWith('[id^="pagesContainer"]')) return [container];
      return [];
    },
    querySelector: (sel) => (String(sel).startsWith('[id^="pagesContainer"]') ? container : null),
    getElementById: () => null,
    createElement: (tag) => (tag === 'canvas'
      ? {
        width: 0,
        height: 0,
        getContext: () => ({ drawImage: () => {} }),
        toDataURL: () => 'data:image/jpeg;base64,' + 'A'.repeat(2000),
      }
      : { style: {}, appendChild: () => {}, addEventListener: () => {} }),
  };
  globalThis.getComputedStyle = () => ({ display: 'block', visibility: 'visible', backgroundImage: 'none' });
  globalThis.window = globalThis;
  let listener = null;
  globalThis.chrome = {
    runtime: {
      onMessage: { addListener: (fn) => { listener = fn; }, removeListener: () => {} },
      sendMessage: async (msg) => { state.messages.push(msg); },
    },
  };
  return { state, getListener: () => listener };
}

function send(listener, msg) {
  return new Promise((resolve) => {
    const ret = listener(msg, {}, resolve);
    if (ret === undefined) resolve(undefined);
  });
}

function waitDone(state, runId, timeoutMs) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const tick = () => {
      const done = state.messages.find((m) => m.type === 'TUTON_BMP_MODULE_DONE' && m.runId === runId);
      if (done) return resolve(done);
      if (Date.now() - t0 > timeoutMs) return resolve(null);
      setTimeout(tick, 100);
    };
    tick();
  });
}

const results = [];
const log = (ok, msg) => { results.push({ ok, msg }); console.log(`${ok ? 'LULUS' : 'GAGAL'}  ${msg}`); };

// ---------- Skenario A: halaman 32 macet total ----------
{
  const { state, getListener } = makeEnv({ blocked: [32] });
  await import(pathToFileURL(RBV).href + '?a=' + Date.now());
  const listener = getListener();
  const runId = 'tA' + Date.now();
  await send(listener, {
    type: 'TUTON_BMP_START_MODULE', runId, code: 'STMA4224', module: MODULE,
    maxPages: 500, speed: 'cepat', autoScroll: true,
  });
  const t0 = Date.now();
  const done = await waitDone(state, runId, 120000);
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  const pages = state.messages.filter((m) => m.type === 'TUTON_BMP_PAGE').map((m) => m.page);
  const stalls = state.messages.filter((m) => m.type === 'TUTON_BMP_STALL');
  console.log(`\n--- Skenario A (halaman 32 macet) — selesai dalam ${secs}s ---`);
  console.log(`hasil: ${done?.result} | tersimpan ${done?.pages}/${done?.totalPages} | bolong: ${JSON.stringify(done?.missing)}`);
  console.log(`halaman terkirim: ${pages.length} (unik ${new Set(pages).size}) | dilewati: ${JSON.stringify(stalls.map((s) => s.page))}`);
  log(done?.result === 'incomplete', `tidak gagal total — hasil "incomplete" (dapat: ${done?.result})`);
  log(done?.pages === TOTAL - 1, `halaman lain tetap tersimpan: ${done?.pages} = ${TOTAL - 1}`);
  log(Array.isArray(done?.missing) && done.missing.length === 1 && done.missing[0] === 32, `halaman bolong dilaporkan tepat: ${JSON.stringify(done?.missing)}`);
  log(stalls.length >= 1 && stalls.some((s) => s.page === 32), `ada laporan "dilewati" untuk halaman 32 (${stalls.length} pesan)`);
  log(pages.includes(33) && pages.includes(41), 'unduhan lanjut ke halaman 33–41 setelah 32 dilewati');
  log(!pages.includes(32), 'halaman 32 tidak ikut dikirim (memang tidak termuat)');
}

// ---------- Skenario B: lanjutan, 32 sudah bisa dimuat ----------
{
  const have = [];
  for (let p = 1; p <= TOTAL; p++) if (p !== 32) have.push(p);
  const { state, getListener } = makeEnv({ feedMs: 60 });
  await import(pathToFileURL(RBV).href + '?b=' + Date.now());
  const listener = getListener();
  const runId = 'tB' + Date.now();
  await send(listener, {
    type: 'TUTON_BMP_START_MODULE', runId, code: 'STMA4224', module: MODULE,
    maxPages: 500, speed: 'cepat', autoScroll: true, have,
  });
  const done = await waitDone(state, runId, 60000);
  const sent = state.messages.filter((m) => m.type === 'TUTON_BMP_PAGE').map((m) => m.page);
  const progress = state.messages.filter((m) => m.type === 'TUTON_BMP_PROGRESS').map((m) => m.page);
  console.log('\n--- Skenario B (lanjutan: 40 halaman sudah ada) ---');
  console.log(`hasil: ${done?.result} | tersimpan ${done?.pages}/${done?.totalPages} | bolong: ${JSON.stringify(done?.missing || [])}`);
  console.log(`halaman diunduh ulang: ${JSON.stringify(sent)} | target: ${JSON.stringify(progress)}`);
  log(done?.result === 'complete', `selesai lengkap setelah lanjutan (dapat: ${done?.result})`);
  log(done?.pages === TOTAL, `total halaman utuh ${done?.pages}/${TOTAL}`);
  log(sent.length === 1 && sent[0] === 32, `hanya halaman bolong (32) yang diunduh ulang — bukan ${sent.length} halaman`);
  log(progress.length === 1 && progress[0] === 32, `tidak mengejar ulang halaman yang sudah tersimpan (target: ${JSON.stringify(progress)})`);
}
// ---------- Skenario C: jaringan putus (4 halaman beruntun macet) ----------
{
  const blocked = [32, 33, 34, 35, 36, 37, 38, 39, 40, 41];
  const { state, getListener } = makeEnv({ blocked });
  await import(pathToFileURL(RBV).href + '?c=' + Date.now());
  const listener = getListener();
  const runId = 'tC' + Date.now();
  await send(listener, {
    type: 'TUTON_BMP_START_MODULE', runId, code: 'STMA4224', module: MODULE,
    maxPages: 500, speed: 'cepat', autoScroll: true,
  });
  const t0 = Date.now();
  const done = await waitDone(state, runId, 180000);
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  const stalls = state.messages.filter((m) => m.type === 'TUTON_BMP_STALL');
  console.log('\n--- Skenario C (jaringan putus: 32–41 macet) ---');
  console.log(`hasil: ${done?.result} | tersimpan ${done?.pages}/${done?.totalPages} | bolong: ${JSON.stringify((done?.missing || []).slice(0, 12))}`);
  console.log(`berhenti setelah ${secs}s | pesan dilewati: ${stalls.length} | tanda jaringan putus: ${stalls.some((s) => s.networkDead) ? 'ya' : 'tidak'}`);
  log(done?.result === 'incomplete', `berhenti rapi (bukan crash): ${done?.result}`);
  log(done?.pages === 31, `halaman 1–31 tetap tersimpan: ${done?.pages}`);
  log(stalls.some((s) => s.networkDead), 'jaringan putus dikenali (unduhan tidak menunggu 15s × 10 halaman)');
  log(Number(secs) < 90, `berhenti cepat: ${secs}s (< 90s, bukan menggantung per halaman)`);
}

const failed = results.filter((r) => !r.ok).length;
console.log('\nRingkasan: ' + (results.length - failed) + ' lulus, ' + failed + ' gagal\n');
process.exit(failed ? 1 : 0);
