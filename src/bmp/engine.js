// src/bmp/engine.js — Mesin OCR + rakit PDF lokal. Berjalan di sidepanel.
//
// Diadaptasi dari extension/offscreen.js milik BMP Terbuka
// (https://github.com/mentaliss/bukabmp, lisensi GPL-3.0 — lihat THIRD_PARTY.md).
// Tesseract.js 6.0.1 (ind) + pdf-lib 1.17.1 dari src/bmp/vendor (lokal, SHA-pinned).
// Cache IndexedDB "tuton-bmp-cache", kunci "KODE:M{n}".

let worker = null;
let workerPromise = null;
let activeRunId = '';
let currentModuleKey = null;
let currentPdfRunId = '';
let currentPdf = null;
let progressCb = null;
// Teks OCR per halaman modul aktif: ["teks hal 1", ...] — dikumpulkan saat
// ocrPage sukses. Disimpan ke chrome.storage (tuton_modtexts) saat modul
// selesai agar ringkasan AI + generate soal bisa dipakai kapan saja.
let currentTexts = [];
let currentTextKey = null;
// Nomor halaman yang sudah masuk ke `currentPdf` sesi ini (OCR langsung atau
// hasil sambung dari simpanan bertahap) — mencegah halaman dobel.
let pagesInPdf = new Set();

function libs() {
  const T = globalThis.Tesseract;
  const P = globalThis.PDFLib;
  if (!T) throw new Error('Tesseract lokal tidak termuat (src/bmp/vendor).');
  if (!P) throw new Error('pdf-lib lokal tidak termuat (src/bmp/vendor).');
  return { T, P };
}

export function onOcrProgress(cb) { progressCb = cb; }

export async function ensureWorker() {
  const { T } = libs();
  if (worker) return worker;
  if (workerPromise) return workerPromise;
  workerPromise = T.createWorker('ind', 1, {
    workerPath: chrome.runtime.getURL('src/bmp/vendor/worker.min.js'),
    corePath: chrome.runtime.getURL('src/bmp/vendor/core'),
    langPath: chrome.runtime.getURL('src/bmp/vendor/lang'),
    workerBlobURL: false,
    gzip: true,
    logger: (m) => {
      try {
        progressCb?.({ status: m.status || '', progress: typeof m.progress === 'number' ? m.progress : null });
      } catch (_) {}
    },
  }).then((w) => { worker = w; workerPromise = null; return w; })
    .catch((e) => { workerPromise = null; throw e; });
  return workerPromise;
}

// ---------- IndexedDB cache ----------
function dbOpen() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('tuton-bmp-cache', 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains('pdfs')) req.result.createObjectStore('pdfs');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function dbPut(key, bytes) {
  const db = await dbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('pdfs', 'readwrite');
    tx.objectStore('pdfs').put(bytes, key);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { const e = tx.error; db.close(); reject(e); };
  });
}
async function dbGet(key) {
  const db = await dbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('pdfs', 'readonly');
    const req = tx.objectStore('pdfs').get(key);
    req.onsuccess = () => { const v = req.result; db.close(); resolve(v); };
    req.onerror = () => { const e = req.error; db.close(); reject(e); };
  });
}
async function dbDelete(key) {
  const db = await dbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('pdfs', 'readwrite');
    tx.objectStore('pdfs').delete(key);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { const e = tx.error; db.close(); reject(e); };
  });
}
export async function dbListModules(code) {
  const prefix = `${String(code).toUpperCase()}:M`;
  const db = await dbOpen();
  return new Promise((resolve, reject) => {
    const out = [];
    const tx = db.transaction('pdfs', 'readonly');
    tx.objectStore('pdfs').openKeyCursor().onsuccess = (ev) => {
      const cur = ev.target.result;
      if (!cur) return;
      const key = String(cur.key || '');
      if (key.startsWith(prefix)) {
        const n = Number.parseInt(key.slice(prefix.length), 10);
        if (Number.isInteger(n) && n >= 1 && n <= 99) out.push(n);
      }
      cur.continue();
    };
    tx.oncomplete = () => { db.close(); resolve([...new Set(out)].sort((a, b) => a - b)); };
    tx.onerror = () => { const e = tx.error; db.close(); reject(e); };
  });
}
export async function dbClearCode(code) {
  const c = `${String(code).toUpperCase()}:`;
  const db = await dbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('pdfs', 'readwrite');
    const store = tx.objectStore('pdfs');
    store.openCursor().onsuccess = (ev) => {
      const cur = ev.target.result;
      if (!cur) return;
      if (String(cur.key).startsWith(c)) cur.delete();
      cur.continue();
    };
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { const e = tx.error; db.close(); reject(e); };
  });
}

// ---------- Penyimpanan halaman bertahap ----------
// Panen bisa terputus (sesi reset, sidepanel ditutup, modul belum tuntas).
// Tiap halaman yang berhasil di-OCR langsung disimpan sebagai PDF satu
// halaman, sehingga pekerjaan tidak pernah hilang dan panen bisa dilanjutkan
// kapan saja. Kunci diawali `staged:` supaya tidak bentrok dengan kunci modul
// (`CODE:M3`) yang dipakai dbListModules.
function stagedPrefix(code, moduleNo) {
  return `staged:${String(code).toUpperCase()}:M${Number(moduleNo)}:`;
}
// Teks OCR per halaman disimpan terpisah (prefix `stagedtext:`) supaya sesi
// LANJUTAN tetap punya teks lengkap: halaman yang di-OCR di sesi sebelumnya
// tidak diulang, jadi teksnya harus bisa diambil dari simpanan — kalau tidak,
// ringkasan/soal AI hanya berisi halaman yang di-OCR di sesi terakhir.
function stagedTextPrefix(code, moduleNo) {
  return `stagedtext:${String(code).toUpperCase()}:M${Number(moduleNo)}:`;
}
function stagedKey(code, moduleNo, pageNo) {
  return `${stagedPrefix(code, moduleNo)}${Number(pageNo)}`;
}
function stagedTextKey(code, moduleNo, pageNo) {
  return `${stagedTextPrefix(code, moduleNo)}${Number(pageNo)}`;
}
async function dbKeysWithPrefix(prefix) {
  const db = await dbOpen();
  return new Promise((resolve, reject) => {
    const out = [];
    const tx = db.transaction('pdfs', 'readonly');
    tx.objectStore('pdfs').openKeyCursor().onsuccess = (ev) => {
      const cur = ev.target.result;
      if (!cur) return;
      const k = String(cur.key || '');
      if (k.startsWith(prefix)) out.push(k);
      cur.continue();
    };
    tx.oncomplete = () => { db.close(); resolve(out); };
    tx.onerror = () => { const e = tx.error; db.close(); reject(e); };
  });
}
export async function stagedPages(code, moduleNo) {
  const keys = await dbKeysWithPrefix(stagedPrefix(code, moduleNo));
  return keys.map((k) => Number.parseInt(k.slice(stagedPrefix(code, moduleNo).length), 10))
    .filter((n) => Number.isInteger(n) && n > 0).sort((a, b) => a - b);
}
export async function clearStaged(code, moduleNo) {
  const keys = [
    ...(await dbKeysWithPrefix(stagedPrefix(code, moduleNo))),
    ...(await dbKeysWithPrefix(stagedTextPrefix(code, moduleNo))),
  ];
  const db = await dbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('pdfs', 'readwrite');
    const store = tx.objectStore('pdfs');
    for (const k of keys) store.delete(k);
    tx.oncomplete = () => { db.close(); resolve(keys.length); };
    tx.onerror = () => { const e = tx.error; db.close(); reject(e); };
  });
}
// Rakit PDF URUT NOMOR HALAMAN dari simpanan bertahap (kunci per halaman:
// `staged:CODE:M3:12`). Urutan jadi pasti — ini penting untuk sesi LANJUTAN:
// halaman yang baru diunduh (mis. 32, 33, …) masuk lebih dulu daripada
// halaman lama (1–31) yang sudah tersimpan, jadi urutan kedatangan ≠ urutan
// halaman. Tanpa rakit ulang, PDF hasil lanjutan akan teracak.
async function buildFromStaged(code, moduleNo, pages) {
  const { P } = libs();
  const out = await P.PDFDocument.create();
  out.setTitle(`${code} M${moduleNo} Searchable OCR`);
  out.setCreator('Tuton OS BMP Studio');
  let added = 0;
  for (const p of pages) {
    const bytes = await dbGet(stagedKey(code, moduleNo, p));
    if (!bytes) continue;
    const doc = await P.PDFDocument.load(new Uint8Array(bytes));
    const copied = await out.copyPages(doc, doc.getPageIndices());
    copied.forEach((pg) => out.addPage(pg));
    added++;
  }
  return { pdf: out, pages: added };
}

// Rakit PDF PARSIAL (modul belum lengkap karena jaringan) tanpa mengotori
// cache modul: hasilnya disimpan di kunci `partial:CODE:M{n}`, dan halaman
// bertahap DIBIARKAN supaya sisanya bisa disusulkan nanti tanpa OCR ulang.
export async function assembleStaged(code, moduleNo) {
  const C = String(code).toUpperCase();
  const have = await stagedPages(C, moduleNo);
  if (!have.length) throw new Error(`Belum ada halaman tersimpan untuk Modul ${moduleNo}.`);
  const { pdf, pages } = await buildFromStaged(C, moduleNo, have);
  const bytes = await pdf.save();
  await dbPut(`partial:${C}:M${moduleNo}`, bytes);
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
  return { blobUrl: url, bytes: bytes.length, pages, have };
}

// ---------- Job lifecycle ----------
function ownsActivePdf(runId, key = currentModuleKey) {
  return Boolean(runId && runId === activeRunId && runId === currentPdfRunId && currentPdf && currentModuleKey === key);
}
function clearPdfOwnedBy(runId) {
  if (!runId || currentPdfRunId !== runId) return;
  currentModuleKey = null;
  currentPdfRunId = '';
  currentPdf = null;
}

export async function prepareJob(runId) {
  libs();
  activeRunId = runId;
  currentModuleKey = null;
  currentPdfRunId = '';
  currentPdf = null;
  currentTexts = [];
  currentTextKey = null;
  pagesInPdf = new Set();
  await ensureWorker();
}
export function cancelJob(runId) {
  if (runId && activeRunId === runId) {
    activeRunId = '';
    clearPdfOwnedBy(runId);
  }
}

async function ensureModulePdf(code, moduleNo, runId) {
  const { P } = libs();
  const key = `${code}:M${moduleNo}`;
  if (ownsActivePdf(runId, key)) return currentPdf;
  if (!runId || runId !== activeRunId) throw new Error('Request dari proses lama.');
  const pdf = await P.PDFDocument.create();
  if (runId !== activeRunId) throw new Error('Dibatalkan sebelum state PDF dibuat.');
  pdf.setTitle(`${code} M${moduleNo} Searchable OCR`);
  pdf.setCreator('Tuton OS BMP Studio');
  currentModuleKey = key;
  currentPdfRunId = runId;
  currentPdf = pdf;
  currentTexts = [];
  currentTextKey = key;
  return pdf;
}

export async function ocrPage(code, moduleNo, pageNo, dataUrl, runId) {
  const { P } = libs();
  if (!runId || runId !== activeRunId) throw new Error('Request dari proses lama.');
  const key = `${code}:M${moduleNo}`;
  const pdf = await ensureModulePdf(code, moduleNo, runId);
  const w = await ensureWorker();
  if (!ownsActivePdf(runId, key) || currentPdf !== pdf) throw new Error('Dibatalkan sebelum recognition.');
  const res = await w.recognize(dataUrl, { pdfTitle: `${code} M${moduleNo} Page ${pageNo}` }, { pdf: true });
  if (!ownsActivePdf(runId, key) || currentPdf !== pdf) throw new Error('Dibatalkan saat recognition.');
  if (!res?.data?.pdf) throw new Error(`OCR gagal untuk Modul ${moduleNo} halaman ${pageNo}.`);
  const pagePdf = await P.PDFDocument.load(new Uint8Array(res.data.pdf));
  const copied = await pdf.copyPages(pagePdf, pagePdf.getPageIndices());
  copied.forEach((p) => pdf.addPage(p));
  pagesInPdf.add(Number(pageNo));
  // Simpan halaman ini SEKARANG juga (PDF 1 halaman). Kalau sesi terputus di
  // tengah jalan, halaman yang sudah selesai tidak perlu di-OCR ulang.
  try { await dbPut(stagedKey(code, moduleNo, pageNo), res.data.pdf); } catch (_) {}
  const text = String(res?.data?.text || '').trim();
  if (currentTextKey === key) currentTexts[pageNo - 1] = text;
  // Teks per halaman ikut disimpan supaya sesi lanjutan tetap punya teks utuh.
  if (text) { try { await dbPut(stagedTextKey(code, moduleNo, pageNo), text); } catch (_) {} }
  return text;
}

export async function finishModule(code, moduleNo, pages, runId, keepStaged = false) {
  const key = `${code}:M${moduleNo}`;
  if (!ownsActivePdf(runId, key)) throw new Error('Finalisasi dari proses lama.');
  // Halaman bertahap: rakit ulang dari simpanan (urut nomor halaman) supaya
  // sesi lanjutan — yang hanya mengejar halaman bolong — tetap menghasilkan
  // PDF dengan urutan benar dan jumlah halaman utuh.
  const staged = await stagedPages(code, moduleNo);
  let finalPdf = currentPdf;
  if (staged.length) {
    const built = await buildFromStaged(code, moduleNo, staged);
    if (built.pages) finalPdf = built.pdf;
  }
  if (finalPdf.getPageCount() !== Number(pages)) {
    throw new Error(`Halaman OCR (${finalPdf.getPageCount()}) tidak cocok dengan yang diunduh (${pages}). PDF tidak disimpan agar tidak terpotong.`);
  }
  const bytes = await finalPdf.save();
  await dbPut(key, bytes);
  // Modul sudah utuh: PDF parsial dari percobaan sebelumnya tidak diperlukan lagi.
  try { await dbDelete(`partial:${String(code).toUpperCase()}:M${moduleNo}`); } catch (_) {}
  // Simpan teks OCR ke storage agar ringkasan/soal AI bisa dipakai kapan saja
  // (tanpa re-OCR, tanpa harus mengulang job). Teks diambil dari simpanan
  // per halaman supaya sesi lanjutan tetap lengkap 1..N, bukan cuma halaman
  // yang kebetulan di-OCR di sesi terakhir.
  try {
    let texts = currentTexts;
    const tkeys = await dbKeysWithPrefix(stagedTextPrefix(code, moduleNo));
    if (tkeys.length) {
      const arr = [];
      for (const k of tkeys) {
        const p = Number.parseInt(k.slice(stagedTextPrefix(code, moduleNo).length), 10);
        if (!Number.isInteger(p) || p < 1) continue;
        const t = await dbGet(k);
        if (typeof t === 'string' && t.trim()) arr[p - 1] = t;
      }
      if (arr.some(Boolean)) texts = arr;
    }
    currentTexts = texts;
    const all = (await chrome.storage.local.get(['tuton_modtexts'])).tuton_modtexts || {};
    all[key] = { texts: texts.filter(Boolean), savedAt: Date.now() };
    await chrome.storage.local.set({ tuton_modtexts: all });
  } catch { /* teks best-effort; PDF tetap tersimpan */ }
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
  // Modul tuntas -> simpanan bertahap tidak diperlukan lagi. Bila belum
  // lengkap (keepStaged), biarkan agar bisa dilanjutkan tanpa OCR ulang.
  if (!keepStaged) { try { await clearStaged(code, moduleNo); } catch (_) {} }
  clearPdfOwnedBy(runId);
  return { blobUrl: url, bytes: bytes.length };
}

export async function exportCachedModule(code, moduleNo) {
  const bytes = await dbGet(`${String(code).toUpperCase()}:M${moduleNo}`);
  if (!bytes) throw new Error(`Modul ${moduleNo} belum ada di cache lokal.`);
  return URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
}

export async function buildRange(code, firstModule, lastModule) {
  const { P } = libs();
  const C = String(code).toUpperCase();
  const out = await P.PDFDocument.create();
  out.setTitle(firstModule === 1 ? `${C} Searchable OCR` : `${C} M${firstModule}-M${lastModule} Searchable OCR`);
  out.setCreator('Tuton OS BMP Studio');
  for (let m = firstModule; m <= lastModule; m++) {
    const bytes = await dbGet(`${C}:M${m}`);
    if (!bytes) throw new Error(`Modul ${m} belum ada di cache lokal.`);
    const src = await P.PDFDocument.load(bytes);
    (await out.copyPages(src, src.getPageIndices())).forEach((p) => out.addPage(p));
  }
  const bytes = await out.save();
  return URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
}

// ---------- Teks modul untuk AI (ringkas + generate soal) ----------
// Sumber: memori job aktif ATAU simpanan tuton_modtexts (ditulis finishModule).
// Modul LAMA (diproses sebelum fitur ini ada) tidak punya teks tersimpan —
// user cukup proses ulang modul itu sekali. TIDAK ada ekstraksi text-layer
// PDF (stream pdf-lib terkompresi FlateDecode — parse mentah tidak reliabel).
// Kembalikan { pages, chars, text } — text dibatasi maxChars.
export function peekModuleTexts() {
  if (!currentTextKey) return null;
  return { key: currentTextKey, texts: [...currentTexts] };
}

export async function getModuleText(code, moduleNo, maxChars = 12000) {
  const key = `${String(code).toUpperCase()}:M${moduleNo}`;
  let texts = null;
  if (currentTextKey === key && currentTexts.some(Boolean)) {
    texts = currentTexts;
  } else {
    try {
      const all = (await chrome.storage.local.get(['tuton_modtexts'])).tuton_modtexts || {};
      if (all[key]?.texts?.some(Boolean)) texts = all[key].texts;
    } catch { /* storage tak tersedia */ }
  }
  if (!texts) throw new Error(`Teks Modul ${moduleNo} belum tersimpan — proses (ulang) modul ini sekali via RBV Reader, lalu coba lagi.`);
  const joined = texts.map((t, i) => `\n\n--- hal ${i + 1} ---\n${t || ''}`).join('');
  const clean = joined.replace(/\n{3,}/g, '\n\n').trim();
  return { pages: texts.filter(Boolean).length, chars: clean.length, text: clean.slice(0, maxChars) };
}
