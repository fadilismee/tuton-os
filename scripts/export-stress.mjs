// scripts/export-stress.mjs — uji dokumen panjang + karakter sulit (&, <, >, ", emoji,
// garis miring) supaya DOCX tidak pernah korup dan Word tetap bisa membukanya.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const outDir = path.resolve(root, 'out-export');
fs.mkdirSync(outDir, { recursive: true });

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

const store = { tuton_profile: { nama: 'Fatahillah Mirza Achmadil', nim: '055752694', matkul: 'EKMA5102 Statistika' } };
globalThis.chrome = {
  runtime: { getURL: (rel) => 'file:///' + path.join(root, rel).replace(/\\/g, '/') },
  storage: { local: {
    get: async (k) => { const o = {}; for (const x of [].concat(k)) if (x in store) o[x] = store[x]; return o; },
    set: async (o) => { Object.assign(store, o); }, remove: async () => {} } },
  downloads: { download: async () => 1 },
  tabs: { create: async () => ({ id: 1 }) },
  windows: { create: async () => ({ id: 1 }) },
};
globalThis.URL.createObjectURL = () => 'blob:sim';
globalThis.URL.revokeObjectURL = () => {};
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, o) => {
  if (typeof url === 'string' && url.startsWith('file:///')) {
    const p = decodeURIComponent(url.replace('file:///', ''));
    if (!fs.existsSync(p)) return { ok: false, status: 404 };
    const b = fs.readFileSync(p);
    return { ok: true, status: 200, arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) };
  }
  return realFetch(url, o);
};

const { exportDocx } = await import(pathToFileURL(path.join(root, 'src/export/index.js')).href);

// Dokumen besar: 40 soal, rumus bervariasi + karakter sulit.
const tricky = [
  'Simbol & rumus <penting> "kutip" \'petik\' 100% <tag>',
  'Emoji 🎓 dan tanda ± × ÷ ≈ ≠ ≤ ≥ →',
  'Tabel & baris dengan | pipa | di dalam sel',
  'Nama file mirip: D:\\kuliah\\EKMA5102\\modul-1.pdf',
];
let md = '# Uji Beban Export\n\n';
for (let i = 1; i <= 40; i++) {
  md += `## Soal ${i}\n\nHitung $\\int_0^${i} x^2\\,dx$ dan bandingkan dengan $\\sum_{k=1}^{${i}} k$.\n\n`;
  md += `$$\\bar{x}_{${i}} = \\frac{1}{n}\\sum_{j=1}^{n} x_j, \\qquad \\sigma_{${i}} = \\sqrt{\\frac{\\sum (x_j-\\bar{x})^2}{n}}$$\n\n`;
  md += `${tricky[i % tricky.length]}\n\n`;
  md += `| Simbol | Nilai |\n|---|---|\n| $\\alpha$ | ${i} |\n| $\\beta$ | ${i * 2} |\n\n`;
  if (i % 5 === 0) md += '```python\nprint("halo & <uji>")\n```\n\n';
  if (i % 7 === 0) md += '---\n\n';
}

const t0 = Date.now();
const r = await exportDocx({ markdown: md, doc: { course: 'UJI-BEBAN EKMA5102' } });
console.log(`[stress] ${md.length} char markdown -> DOCX ${(r.bytes / 1024).toFixed(0)} KB dalam ${Date.now() - t0} ms`);

// tulis file (mock download tidak menyimpan)
const { unzip } = await import(pathToFileURL(path.join(root, 'src/export/zip.js')).href);
const bytes = await (async () => {
  const { buildDocx } = await import(pathToFileURL(path.join(root, 'src/export/docx.js')).href);
  return buildDocx({ markdown: md, doc: { course: 'UJI-BEBAN EKMA5102', nama: 'Fatahillah Mirza Achmadil', nim: '055752694' }, templateBytes: new Uint8Array(fs.readFileSync(path.join(root, 'template/template.docx'))) });
})();
const file = path.join(outDir, 'stress-beban.docx');
fs.writeFileSync(file, bytes);
const parts = await unzip(bytes);
const xml = new TextDecoder().decode(parts.get('word/document.xml'));
console.log('[stress] oMath:', (xml.match(/<m:oMath>/g) || []).length, '| tabel:', (xml.match(/<w:tbl>/g) || []).length,
  '| kode:', (xml.match(/<w:shd/g) || []).length, '| entitas &amp;:', (xml.match(/&amp;/g) || []).length);
// XML harus well-formed
try {
  const { DOMParser } = await import('@xmldom/xmldom').catch(() => ({ DOMParser: null }));
  if (DOMParser) { new DOMParser().parseFromString(xml, 'text/xml'); console.log('[stress] XML parse: OK (xmldom)'); }
  else console.log('[stress] xmldom tidak ada — lewati parse');
} catch (e) { console.log('[stress] XML parse gagal:', e.message); }

// Word membuka tanpa repair?
const ps = path.join(outDir, 'stress.ps1');
const win = file.replace(/\//g, '\\');
fs.writeFileSync(ps, [
  "$ErrorActionPreference='Stop'",
  '$w = New-Object -ComObject Word.Application', '$w.Visible = $false', '$w.DisplayAlerts = 0',
  `$d = $w.Documents.Open("${win}", $false, $true)`,
  'Write-Output ("OMATHS=" + $d.OMaths.Count + " PAGES=" + $d.ComputeStatistics(2) + " TABLES=" + $d.Tables.Count)',
  '$d.Close(0)', '$w.Quit()',
].join('\n'), 'utf8');
try {
  console.log('[stress] Word:', execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ps], { encoding: 'utf8', timeout: 240000 }).trim());
} catch (e) {
  console.log('[stress] Word GAGAL membuka:', String(e.stdout || e.message).slice(0, 300));
}