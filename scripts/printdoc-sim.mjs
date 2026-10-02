// scripts/printdoc-sim.mjs — uji jalur fallback cetak: markdown -> HTML cetak
// (printdoc.js, kode extension asli) -> render tiap rumus dengan KaTeX lokal
// (kode vendor yang sama dengan panel) -> laporan berapa yang gagal.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

function loadScript(file) {
  const ctx = {};
  ctx.self = ctx; ctx.window = ctx; ctx.globalThis = ctx;
  ctx.module = { exports: {} }; ctx.exports = ctx.module.exports;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(file, 'utf8'), ctx);
  return ctx.katex || ctx.module.exports;
}
const katex = loadScript(path.join(root, 'src/bmp/vendor/katex/katex.min.js'));

const { bodyHtml, collectTex } = await import(pathToFileURL(path.join(root, 'src/export/printdoc.js')).href);

const SAMPLE = `## Soal 1 — Statistika

Rata-rata $\\bar{x}=\\frac{\\sum_{i=1}^{n} x_i}{n}$ dan simpangan baku $s=\\sqrt{s^2}$.

$$s^2=\\frac{1}{n-1}\\sum_{i=1}^{n}(x_i-\\bar{x})^2$$

### Uji hipotesis

$$t=\\frac{\\bar{x}-\\mu_0}{s/\\sqrt{n}}, \\qquad H_0:\\mu=\\mu_0$$

| Simbol | Arti | Rumus |
|---|---|---|
| $\\bar{x}$ | rata-rata | $\\frac{\\sum x_i}{n}$ |

\`\`\`python
import statistics as st
print(st.mean([2,4,4,4,5,5,7,9]))
\`\`\`

*Kesimpulan:* tolak $H_0$ bila $|t|>t_{\\alpha/2,n-1}$.

$$A^{-1}=\\frac{1}{\\det A}\\begin{pmatrix} d & -b \\\\ -c & a \\end{pmatrix}$$
`;

const html = bodyHtml(SAMPLE);
const tex = collectTex(html);
console.log('[print] HTML', html.length, 'char | rumus ditemukan:', tex.length);
let ok = 0;
const bad = [];
for (const t of tex) {
  try {
    const out = katex.renderToString(t, { throwOnError: true, displayMode: false });
    if (!/<span class="katex"/.test(out)) throw new Error('output bukan katex');
    ok++;
  } catch (e) {
    bad.push(`${t} -> ${e.message.slice(0, 60)}`);
  }
}
console.log(`[print] ter-render: ${ok}/${tex.length}`);
if (bad.length) console.log('[print] GAGAL:\n  ' + bad.join('\n  '));
console.log('[print] potongan HTML:', html.slice(0, 160).replace(/\n/g, ' '));
console.log('[print] blok rumus:', (html.match(/class="eq"/g) || []).length, '| inline rumus:', (html.match(/data-tex/g) || []).length);
process.exitCode = bad.length ? 1 : 0;