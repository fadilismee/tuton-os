// scripts/export-label-sim.mjs — ekspor nyata dengan label ala tugas tutor,
// lalu cetak nama file + kop dokumen dari DOCX yang dihasilkan.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { unzip } from '../src/export/zip.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// tiruan chrome.* (sama seperti export-extension-sim.mjs)
const store = {};
globalThis.chrome = {
  runtime: { getURL: (p) => 'file:///' + path.join(root, p).replace(/\\/g, '/') },
  storage: { local: { get: async (k) => (typeof k === 'string' ? { [k]: store[k] } : store), set: async (o) => Object.assign(store, o) } },
  downloads: { download: async ({ filename }) => { globalThis.__lastName = filename; return 1; } },
  tabs: { create: async ({ url }) => { globalThis.__printUrl = url; return { id: 99 }; } },
  windows: { create: async ({ url }) => { globalThis.__printUrl = url; return { id: 98 }; } },
};
const realFetch = globalThis.fetch;              // fetch asli untuk http:// (runtime)
globalThis.fetch = async (url, opts) => {
  const u = String(url);
  if (u.startsWith('http')) return realFetch(u, opts);   // runtime/Word sungguhan
  const p = u.replace('file:///', '');
  if (!fs.existsSync(p)) return { ok: false, status: 404 };
  const b = fs.readFileSync(p);
  return { ok: true, status: 200, arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) };
};
globalThis.URL.createObjectURL = () => 'blob:x';
globalThis.URL.revokeObjectURL = () => {};

const { docLabel, docName } = await import('../src/export/index.js');
const { buildDocx } = await import('../src/export/docx.js');

const doc = { tugas: '1', sesi: '3', matkul: 'Bahasa Indonesia', nama: 'Fatahillah Mirza Achmadil', nim: '055752694' };
doc.label = docLabel(doc);
console.log('label dokumen :', doc.label);
console.log('nama file docx:', docName(doc, 'docx'));
console.log('nama file pdf :', docName(doc, 'pdf'));

const md = '## Soal 1\n\nJelaskan pengertian paragraf deduktif.\n\n## Jawaban\n\nParagraf deduktif adalah paragraf yang gagasannya terletak pada awal paragraf.\n';
const tpl = new Uint8Array(fs.readFileSync(path.join(root, 'template/template.docx')));
const bytes = await buildDocx({ markdown: md, doc, templateBytes: tpl });
const fileName = docName(doc, 'docx');
const out = path.join(root, 'out-export', fileName);
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, bytes);
console.log('hasil export  :', fileName, `(${(bytes.length / 1024).toFixed(0)} KB)`);
const parts = await unzip(new Uint8Array(fs.readFileSync(out)));
const xml = new TextDecoder().decode(parts.get('word/document.xml'));
const texts = [...xml.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((m) => m[1]);
console.log('kop DOCX      :', JSON.stringify(texts.slice(0, 5)));
console.log('file ada      :', fs.existsSync(out), '| ukuran:', fs.statSync(out).size, 'byte');

// --- jalur PDF (runtime + Word) : nama file harus ikut label juga ---
try {
  const { exportPdf } = await import('../src/export/index.js');
  const rp = await exportPdf({ markdown: md, doc });
  console.log('PDF mode      :', rp.mode, '| nama:', rp.name || '(tab cetak)', '| engine:', rp.engine || '-');
  if (rp.name) {
    const fp = path.join(root, 'out-export', String(rp.name));
    console.log('PDF ada       :', fs.existsSync(fp), fs.existsSync(fp) ? `| ukuran: ${fs.statSync(fp).size} byte` : '');
  }
} catch (e) { console.log('PDF gagal     :', e.message); }

// --- Bukti PDF nyata dari Word: build DOCX -> POST runtime -> simpan & cek header ---
try {
  const b64 = Buffer.from(bytes).toString('base64');
  const res = await realFetch('http://127.0.0.1:3721/api/export/pdf', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dataBase64: b64 }),
  });
  const j = await res.json();
  const pdfBytes = Buffer.from(j.pdfBase64 || '', 'base64');
  const pdfPath = path.join(root, 'out-export', fileName.replace(/\.docx$/, '.pdf'));
  fs.writeFileSync(pdfPath, pdfBytes);
  const head = pdfBytes.slice(0, 5).toString('latin1');
  const pages = (pdfBytes.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;
  console.log('PDF runtime   : HTTP', res.status, '| engine:', j.engine, '| header:', JSON.stringify(head), '| halaman:', pages, '| ukuran:', pdfBytes.length, 'byte');
  // teks di PDF memuat label?
  const txt = pdfBytes.toString('latin1');
  console.log('PDF memuat    : "Tugas 1" ->', txt.includes('Tugas 1'), '| "Bahasa Indonesia" ->', txt.includes('Bahasa Indonesia'), '| NIM ->', txt.includes('055752694'));
} catch (e) { console.log('PDF langsung gagal:', e.message); }
