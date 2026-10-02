// scripts/export-verify.mjs — verifikasi hasil export lewat jalur independen:
//  1) pdfjs-dist membaca teks PDF (apakah judul/matkul/nama/heading/tabel ada)
//  2) Microsoft Word COM membaca DOCX: jumlah persamaan (OMaths), tabel, halaman
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const outDir = process.argv[2] || 'out-export';
const docx = path.resolve(outDir, 'jawaban-smoke.docx');
const pdf = path.resolve(outDir, 'jawaban-smoke.pdf');

const pdfjs = require('pdfjs-dist/legacy/build/pdf.js');
const doc = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(pdf)), useSystemFonts: true }).promise;
let all = '';
for (let p = 1; p <= doc.numPages; p++) {
  const tc = await (await doc.getPage(p)).getTextContent();
  all += (tc.items || []).map((i) => i.str).join(' ') + '\n';
}
const flat = all.replace(/\s+/g, ' ');
console.log('[pdf] halaman:', doc.numPages, '| char:', flat.length);
for (const key of ['JAWABAN', 'EKMA5102', 'Fatahillah', '055752694', 'Statistika dasar', 'Soal 2', 'Simbol', 'statistics', 'Kesimpulan']) {
  console.log(`  ${key.padEnd(18)} ${flat.includes(key) ? 'ADA' : '—'}`);
}

const ps = path.resolve(outDir, 'verify-word.ps1');
fs.writeFileSync(ps, `$ErrorActionPreference='Stop'
$w = New-Object -ComObject Word.Application
$w.Visible = $false
$w.DisplayAlerts = 0
$d = $w.Documents.Open("${docx.replace(/\//g, '\\')}", $false, $true)
$om = $d.OMaths.Count
$tb = $d.Tables.Count
$pg = $d.ComputeStatistics(2)
$txt = $d.Content.Text
$hasTitle = $txt -match 'JAWABAN'
$hasNama = $txt -match 'Fatahillah'
$eq1 = $d.OMaths.Item(1).Range.Text
$eq2 = $d.OMaths.Item(2).Range.Text
Write-Output "OMATHS=$om"
Write-Output "TABLES=$tb"
Write-Output "PAGES=$pg"
Write-Output "TITLE=$hasTitle"
Write-Output "NAMA=$hasNama"
Write-Output ("EQ1=" + $eq1)
Write-Output ("EQ2=" + $eq2)
$d.Close(0)
$w.Quit()
`, 'utf8');
const out = execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ps], { encoding: 'utf8', timeout: 180000 });
console.log('[word] ' + out.trim().split(/\r?\n/).join('\n[word] '));