// src/export/pending.js — dokumen "siap-diekspor" dari tab lain (PDF Tools, dsb).
// Alur: simpan markdown ke chrome.storage.local -> buka panel AI Agen
// (?page=ai) -> panel membaca + menghapus antrean, lalu menawarkan DOCX/PDF.
const KEY = 'tuton_export_pending';

export async function stageExport(payload) {
  const doc = {
    markdown: String(payload?.markdown || ''),
    course: payload?.course || '',
    title: payload?.title || '',
    at: Date.now(),
  };
  if (!doc.markdown.trim()) throw new Error('isi dokumen kosong');
  await chrome.storage.local.set({ [KEY]: doc });
  return doc;
}

export async function takeExport() {
  try {
    const r = await chrome.storage.local.get([KEY]);
    const doc = r[KEY];
    if (doc) await chrome.storage.local.remove([KEY]);
    return doc || null;
  } catch {
    return null;
  }
}

export async function peekExport() {
  try {
    return (await chrome.storage.local.get([KEY]))[KEY] || null;
  } catch {
    return null;
  }
}

export const EXPORT_PENDING_KEY = KEY;

// ---- Job cetak: dipakai saat PDF harus lewat tab siap-cetak (tanpa runtime).
// Halaman cetak adalah halaman extension sendiri (sidepanel/print.html) supaya
// bisa memuat KaTeX lokal tanpa perlu web_accessible_resources.
const PRINT_KEY = 'tuton_print_job';

export async function stagePrint(job) {
  await chrome.storage.local.set({ [PRINT_KEY]: { ...job, at: Date.now() } });
  return true;
}

export async function takePrint() {
  try {
    const r = await chrome.storage.local.get([PRINT_KEY]);
    const job = r[PRINT_KEY] || null;
    if (job) await chrome.storage.local.remove([PRINT_KEY]);
    return job;
  } catch {
    return null;
  }
}