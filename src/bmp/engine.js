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
  const text = String(res?.data?.text || '').trim();
  if (currentTextKey === key) currentTexts[pageNo - 1] = text;
  return text;
}

export async function finishModule(code, moduleNo, pages, runId) {
  const key = `${code}:M${moduleNo}`;
  if (!ownsActivePdf(runId, key)) throw new Error('Finalisasi dari proses lama.');
  const pdf = currentPdf;
  if (pdf.getPageCount() !== Number(pages)) {
    throw new Error(`Halaman OCR (${pdf.getPageCount()}) tidak cocok dengan yang diunduh (${pages}). PDF tidak disimpan agar tidak terpotong.`);
  }
  const bytes = await pdf.save();
  await dbPut(key, bytes);
  // Simpan teks OCR ke storage agar ringkasan/soal AI bisa dipakai kapan saja
  // (tanpa re-OCR, tanpa harus mengulang job).
  try {
    const all = (await chrome.storage.local.get(['tuton_modtexts'])).tuton_modtexts || {};
    all[key] = { texts: currentTexts.filter(Boolean), savedAt: Date.now() };
    await chrome.storage.local.set({ tuton_modtexts: all });
  } catch { /* teks best-effort; PDF tetap tersimpan */ }
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
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
