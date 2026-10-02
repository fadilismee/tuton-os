// src/export/index.js — API export tingkat tinggi untuk panel Tuton OS.
//   exportDocx({markdown, doc})  -> .docx (persamaan Word asli/OMML), langsung unduh
//   exportPdf({markdown, doc})   -> .pdf  (via runtime/Word bila ada; kalau tidak,
//                                   buka tab cetak siap-print)
//   exportPdfDirect(...)         -> PDF murni dibuat di panel (pdf-lib), tanpa runtime
// Nol jaringan keluar: template dibaca dari dalam extension, rumus dikonversi lokal.
import { buildDocx } from './docx.js';
import { parseBlocks, blocksToText, guessTitle } from './mdblocks.js';
import { stagePrint } from './pending.js';

const TEMPLATE_URL = 'template/template.docx';

let _tpl = null;
async function loadTemplateBytes() {
  if (_tpl) return _tpl;
  const url = chrome.runtime.getURL(TEMPLATE_URL);
  const r = await fetch(url);
  if (!r.ok) throw new Error(`template.docx tidak terbaca (${r.status}) — cek folder template/.`);
  _tpl = new Uint8Array(await r.arrayBuffer());
  return _tpl;
}

async function profileDoc() {
  try {
    const p = (await chrome.storage.local.get(['tuton_profile'])).tuton_profile || {};
    return {
      nama: p.nama || '', nim: p.nim || '',
      matkul: p.matkul || '', course: p.matkul || '',
      tugas: p.tugas || '', sesi: p.sesi || '',
    };
  } catch { return {}; }
}

function safeName(s) {
  return String(s || 'jawaban').replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim().slice(0, 70) || 'jawaban';
}

/**
 * Label dokumen ala tugas tutor: "Tugas 1 Sesi 3 - Bahasa Indonesia".
 * Dipakai untuk kop Word ("JAWABAN ...") DAN nama file, supaya rapi & konsisten.
 * "Tugas"/"Sesi" ditambahkan otomatis kalau user hanya menulis angkanya.
 */
export function docLabel(doc = {}) {
  const norm = (v, word) => {
    const t = String(v || '').trim();
    if (!t) return '';
    return new RegExp('^' + word, 'i').test(t) ? t : `${word} ${t}`;
  };
  const head = [norm(doc.tugas, 'Tugas'), norm(doc.sesi, 'Sesi')].filter(Boolean).join(' ');
  const matkul = String(doc.matkul || doc.course || '').trim();
  const parts = [head, matkul].filter(Boolean);
  if (parts.length) return parts.join(' - ');
  return String(doc.title || '').trim();
}

/** Nama file: "jawaban tugas 1 sesi 3 - bahasa indonesia.docx" (tanpa tanggal). */
export function docName(doc, ext) {
  const label = docLabel(doc) || doc?.title || doc?.course || 'jawaban';
  // Awalan "jawaban " ala kebiasaan tugas tutor (tidak digandakan kalau sudah ada).
  const base = /^jawaban\b/i.test(label.trim()) ? label.trim() : `jawaban ${label}`;
  return `${safeName(base).toLowerCase()}.${ext}`;
}

/** Unduh bytes dari panel: blob URL + chrome.downloads (fallback <a>). */
export async function saveBytes(bytes, filename, mime) {
  const blobUrl = URL.createObjectURL(new Blob([bytes], { type: mime }));
  try {
    await chrome.downloads.download({ url: blobUrl, filename, conflictAction: 'uniquify', saveAs: false });
  } catch {
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = filename;
    a.click();
  }
  setTimeout(() => { try { URL.revokeObjectURL(blobUrl); } catch { /* abaikan */ } }, 120000);
  return filename;
}

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const b64 = (bytes) => {
  let s = '';
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) s += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
  return btoa(s);
};

/** DOCX: bangun + langsung unduh. mode:'base64' untuk dipakai runtime. */
export async function exportDocx({ markdown, doc = {}, mode = 'download' }) {
  const templateBytes = await loadTemplateBytes();
  const merged = { ...(await profileDoc()), ...doc };
  if (!merged.label) merged.label = docLabel(merged);
  const bytes = await buildDocx({ markdown, doc: merged, templateBytes });
  if (mode === 'base64') return { bytes, b64: b64(bytes) };
  const name = docName(merged, 'docx');
  await saveBytes(bytes, name, DOCX_MIME);
  return { name, bytes: bytes.length };
}

/** Runtime Tuton: URL + token (dipakai /health & /api/export/pdf). */
export async function runtimeInfo() {
  let cfg = {};
  try { cfg = (await chrome.storage.local.get(['tuton_ai'])).tuton_ai || {}; } catch { /* abaikan */ }
  return { url: String(cfg.routerUrl || 'http://127.0.0.1:3721').replace(/\/+$/, ''), token: cfg.runtimeToken || '' };
}

const rtHeaders = (token) => Object.assign({ 'Content-Type': 'application/json' }, token ? { Authorization: 'Bearer ' + token } : {});

/** Cek runtime: hidup? bisa DOCX->PDF? */
export async function runtimeCapability() {
  const { url, token } = await runtimeInfo();
  try {
    const r = await fetch(`${url}/health`, { headers: rtHeaders(token), signal: AbortSignal.timeout(4000) });
    if (!r.ok) return { ok: false, url, reason: `HTTP ${r.status}` };
    const j = await r.json();
    return { ok: true, url, token, engine: j?.export?.docxToPdf || 'none' };
  } catch (e) {
    return { ok: false, url, reason: e.message };
  }
}

/**
 * PDF via runtime (Word/LibreOffice) — persamaan tetap asli, hasil paling rapi.
 * @returns {{ok:boolean, name?:string, engine?:string, error?:string}}
 */
export async function exportPdfViaRuntime({ markdown, doc = {} }) {
  const cap = await runtimeCapability();
  if (!cap.ok) return { ok: false, error: `runtime mati di ${cap.url} (${cap.reason})` };
  if (cap.engine === 'none') return { ok: false, error: 'runtime hidup tapi tidak ada Word/LibreOffice di mesin ini' };
  const { bytes, b64: docxB64 } = await exportDocx({ markdown, doc, mode: 'base64' });
  if (!bytes?.length) return { ok: false, error: 'DOCX gagal dibangun' };
  const r = await fetch(`${cap.url}/api/export/pdf`, {
    method: 'POST', headers: rtHeaders(cap.token), body: JSON.stringify({ dataBase64: docxB64 }),
    signal: AbortSignal.timeout(180000),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.pdfBase64) return { ok: false, error: j.error || `runtime HTTP ${r.status}` };
  const raw = atob(j.pdfBase64);
  const pdfBytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) pdfBytes[i] = raw.charCodeAt(i);
  const merged = { ...(await profileDoc()), ...doc };
  if (!merged.label) merged.label = docLabel(merged);
  const name = docName(merged, 'pdf');
  await saveBytes(pdfBytes, name, 'application/pdf');
  return { ok: true, name, engine: j.engine || cap.engine, bytes: pdfBytes.length };
}

/** Fallback tanpa runtime: buka halaman cetak extension (Ctrl+P -> Simpan PDF). */
export async function openPrintTab({ markdown, doc = {} }) {
  const merged = { ...(await profileDoc()), ...doc };
  if (!merged.label) merged.label = docLabel(merged);
  const title = merged.label || merged.title || guessTitle(markdown, 'Jawaban');
  await stagePrint({ markdown, doc: merged, title, at: Date.now() });
  const url = chrome.runtime.getURL('sidepanel/print.html');
  try {
    const tab = await chrome.tabs.create({ url, active: true });
    return { ok: true, tabId: tab?.id };
  } catch (e) {
    // Fallback terakhir: tab biasa (butuh host permission) — biasanya tidak perlu.
    const win = await chrome.windows.create({ url, type: 'popup', width: 900, height: 1100 });
    return { ok: true, windowId: win?.id };
  }
}

const escapeHtml = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * Alur PDF utama yang dipakai UI:
 *  1) runtime/Word (persamaan asli, langsung unduh)
 *  2) fallback: tab siap-cetak (Ctrl+P) — selalu berhasil, tanpa dependensi
 */
export async function exportPdf({ markdown, doc = {} }) {
  try {
    const r = await exportPdfViaRuntime({ markdown, doc });
    if (r.ok) return { ok: true, mode: 'runtime', engine: r.engine, name: r.name };
    const p = await openPrintTab({ markdown, doc });
    return { ok: true, mode: 'print', tabId: p.tabId, note: r.error };
  } catch (e) {
    const p = await openPrintTab({ markdown, doc });
    return { ok: true, mode: 'print', tabId: p.tabId, note: e.message };
  }
}

export { parseBlocks, blocksToText, guessTitle };
