// src/lib/store.js — Satu pintu ke chrome.storage.local (dengan fallback memori
// agar lib tetap bisa diuji di node). Kunci:
//   tuton_grades   -> { semesters: [{id,label,courses[]}] }
//   tuton_profile  -> { prodi, targetIPK, targetSKS }
//   tuton_tracker  -> { streak, lastDay, xp, level, badges[], pomoWeek, pomoTotal }
//   tuton_qcache   -> { [paket]: ciphertextPkg }
//   tuton_ai       -> { provider, routerUrl, apiKey, model }
//   tuton_tasks    -> [{id, title, due, prio, done, createdAt}]
//   tuton_notes    -> [{id, title, body, updatedAt}]
//   tuton_summary  -> { "KODE:M1": { text, savedAt } } (ringkasan AI per modul)
//   tuton_genquiz  -> { "KODE:M1": { questions[], savedAt } } (soal AI per modul)
//   tuton_modtexts -> { "KODE:M1": { texts[], savedAt } } (teks OCR per modul)

const mem = new Map();
const hasChrome = typeof chrome !== 'undefined' && chrome.storage?.local;

export async function load(key, fallback) {
  if (hasChrome) {
    const r = await chrome.storage.local.get([key]);
    return r[key] !== undefined ? r[key] : fallback;
  }
  return mem.has(key) ? mem.get(key) : fallback;
}

export async function save(key, value) {
  if (hasChrome) await chrome.storage.local.set({ [key]: value });
  else mem.set(key, value);
}

export async function loadGrades() {
  return load('tuton_grades', { semesters: [] });
}

export async function saveGrades(data) {
  return save('tuton_grades', data);
}

export function uid(prefix = 'id') {
  return `${prefix}_${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
}
