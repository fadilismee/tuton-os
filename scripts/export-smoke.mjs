// scripts/export-smoke.mjs — uji mesin export (docx + PDF) di Node.
// Pakai vendor KaTeX + mathml2omml yang sama dengan extension, lalu (opsional)
// konversi DOCX -> PDF via Microsoft Word COM untuk membuktikan hasilnya.
//   node scripts/export-smoke.mjs [--word] [--out DIR]
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { buildDocx } from '../src/export/docx.js';
import { unzip } from '../src/export/zip.js';
import { parseBlocks, blocksToText } from '../src/export/mdblocks.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const useWord = args.includes('--word');
const outDir = path.resolve(root, args.includes('--out') ? args[args.indexOf('--out') + 1] : 'out-export');
fs.mkdirSync(outDir, { recursive: true });

// --- muat vendor ke globalThis (persis seperti <script> di extension) ---
function loadUmd(file) {
  const code = fs.readFileSync(file, 'utf8');
  const ctx = {};
  ctx.self = ctx; ctx.window = ctx; ctx.globalThis = ctx;
  ctx.module = { exports: {} }; ctx.exports = ctx.module.exports;
  vm.createContext(ctx);
  vm.runInContext(code, ctx);
  return ctx;
}
{
  const k = loadUmd(path.join(root, 'src/bmp/vendor/katex/katex.min.js'));
  globalThis.katex = k.katex || k.module.exports;
  const m = loadUmd(path.join(root, 'src/export/vendor/mathml2omml.min.js'));
  globalThis.mml2ommlPkg = m.mml2ommlPkg || m.module.exports;
}
console.log('[vendor] katex', globalThis.katex.version, '| mml2omml', typeof globalThis.mml2ommlPkg.mml2omml);

// --- contoh jawaban tuton dengan rumus ---
const SAMPLE = `## Soal 1 — Statistika dasar

Rata-rata sampel dihitung dengan rumus $\\bar{x} = \\frac{\\sum_{i=1}^{n} x_i}{n}$ dan simpangan baku $s = \\sqrt{\\frac{\\sum (x_i-\\bar{x})^2}{n-1}}$.

Untuk data $2, 4, 4, 4, 5, 5, 7, 9$:

1. Jumlah data $n = 8$
2. Rata-rata $\\bar{x} = 5$
3. Varians $s^2 = 4$

### Rumus utama

$$s^2 = \\frac{1}{n-1}\\sum_{i=1}^{n}(x_i-\\bar{x})^2$$

Uji hipotesis memakai statistik **t**:

$$t = \\frac{\\bar{x}-\\mu_0}{s/\\sqrt{n}}, \\qquad H_0: \\mu = \\mu_0$$

## Soal 2 — Matriks

Invers matriks $2\\times2$:

$$A^{-1} = \\frac{1}{\\det A}\\begin{pmatrix} d & -b \\\\ -c & a \\end{pmatrix}$$

| Simbol | Arti | Rumus |
|---|---|---|
| $\\bar{x}$ | rata-rata | $\\frac{\\sum x_i}{n}$ |
| $s$ | simpangan baku | $\\sqrt{s^2}$ |

Contoh kode Python:

\`\`\`python
import statistics as st
data = [2, 4, 4, 4, 5, 5, 7, 9]
print(st.mean(data), st.stdev(data))
\`\`\`

**Kesimpulan:** $H_0$ ditolak bila $|t| > t_{\\alpha/2, n-1}$.

---

### Jebakan soal
- Jangan lupa pembagi $n-1$ (sampel), bukan $n$.
- Rumus $\\lim_{x\\to 0}\\frac{\\sin x}{x}=1$ sering dipakai untuk limit trigonometri.
`;

const doc = { course: 'EKMA5102 Statistika (contoh)', nama: 'Fatahillah Mirza Achmadil', nim: '055752694' };
const templateBytes = new Uint8Array(fs.readFileSync(path.join(root, 'template/template.docx')));
const blocks = parseBlocks(SAMPLE);
console.log('[md] blok:', blocks.length, '| jenis:', [...new Set(blocks.map((b) => b.type))].join(','));
console.log('[md] rumus blok:', blocks.filter((b) => b.type === 'math').length, '| tabel:', blocks.filter((b) => b.type === 'table').length);

const t0 = Date.now();
const docxBytes = await buildDocx({ markdown: SAMPLE, doc, templateBytes });
const docxPath = path.join(outDir, 'jawaban-smoke.docx');
fs.writeFileSync(docxPath, docxBytes);
console.log(`[docx] ${docxBytes.length} byte -> ${docxPath} (${Date.now() - t0} ms)`);

// Verifikasi isi paket: OMML, jumlah paragraf, tabel, teks terbaca.
const parts = await unzip(docxBytes);
const xml = new TextDecoder().decode(parts.get('word/document.xml'));
const count = (re) => (xml.match(re) || []).length;
console.log('[docx] parts:', parts.size, '| oMath:', count(/<m:oMath>/g), '| oMathPara:', count(/<m:oMathPara>/g), '| tabel:', count(/<w:tbl>/g), '| paragraf:', count(/<w:p>/g), '| m:f:', count(/<m:f>/g));
const textOut = blocksToText(blocks);
console.log('[md] teks polos:', textOut.length, 'char');

if (useWord) {
  const ps = path.join(outDir, 'to-pdf.ps1');
  const pdfPath = path.join(outDir, 'jawaban-smoke.pdf');
  fs.writeFileSync(ps, `$ErrorActionPreference='Stop'
$w = New-Object -ComObject Word.Application
$w.Visible = $false
$w.DisplayAlerts = 0
$d = $w.Documents.Open("${docxPath.replace(/\//g, '\\')}", $false, $true)
$d.ExportAsFixedFormat("${pdfPath.replace(/\//g, '\\')}", 17)
$d.Close(0)
$w.Quit()
Write-Output "PDF_OK"
`, 'utf8');
  const { execFileSync } = await import('node:child_process');
  try {
    const out = execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ps], { encoding: 'utf8', timeout: 180000 });
    console.log('[word]', out.trim());
    if (fs.existsSync(pdfPath)) {
      console.log('[pdf]', fs.statSync(pdfPath).size, 'byte ->', pdfPath);
      const pdfjs = await import(path.join(root, 'node_modules/pdfjs-dist/legacy/build/pdf.mjs')).catch(() => null);
      if (pdfjs) {
        const pdf = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(pdfPath)), useSystemFonts: true }).promise;
        let all = '';
        for (let p = 1; p <= pdf.numPages; p++) {
          const tc = await (await pdf.getPage(p)).getTextContent();
          all += (tc.items || []).map((i) => i.str).join(' ') + '\n';
        }
        console.log('[pdf] halaman:', pdf.numPages, '| char teks:', all.replace(/\s/g, '').length);
        console.log('[pdf] cek teks:', ['JAWABAN', 'EKMA5102', '055752694', 'Statistika'].map((k) => `${k}=${all.includes(k)}`).join(' '));
      } else {
        console.log('[pdf] pdfjs-dist tidak ada di node_modules — lewati cek teks');
      }
    }
  } catch (e) {
    console.log('[word] GAGAL:', String(e.stdout || e.message).slice(0, 400));
  }
}
