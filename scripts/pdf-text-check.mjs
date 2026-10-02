// scripts/pdf-text-check.mjs — baca teks PDF hasil ekspor (buktikan kop label ada).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const pdfjs = require('pdfjs-dist/legacy/build/pdf.js');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const file = process.argv[2] || path.join(root, 'out-export', 'jawaban tugas 1 sesi 3 - bahasa indonesia.pdf');
const doc = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(file)), disableWorker: true }).promise;
let all = '';
for (let i = 1; i <= doc.numPages; i++) {
  const page = await doc.getPage(i);
  const tc = await page.getTextContent();
  all += tc.items.map((it) => it.str).join(' ') + '\n';
}
console.log('file   :', path.basename(file), '| halaman:', doc.numPages);
console.log('teks   :', all.replace(/\s+/g, ' ').trim().slice(0, 300));
for (const t of ['Tugas 1', 'Sesi 3', 'Bahasa Indonesia', 'Fatahillah', '055752694', 'deduktif']) {
  console.log(`  memuat "${t}":`, all.includes(t) ? 'YA' : 'TIDAK');
}
