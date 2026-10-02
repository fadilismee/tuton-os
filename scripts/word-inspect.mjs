// scripts/word-inspect.mjs — periksa DOCX lewat Microsoft Word (COM): jumlah
// persamaan (OMaths), tabel, halaman, font, dan teks persamaan pertama.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const file = path.resolve(process.argv[2]);
const ps = path.resolve(path.dirname(file), 'word-inspect.ps1');
const win = file.replace(/\//g, '\\');
fs.writeFileSync(ps, [
  "$ErrorActionPreference='Stop'",
  '$w = New-Object -ComObject Word.Application',
  '$w.Visible = $false',
  '$w.DisplayAlerts = 0',
  `$d = $w.Documents.Open("${win}", $false, $true)`,
  'Write-Output ("OMATHS=" + $d.OMaths.Count)',
  'Write-Output ("PAGES=" + $d.ComputeStatistics(2))',
  'Write-Output ("PARAS=" + $d.Paragraphs.Count)',
  'Write-Output ("TABLES=" + $d.Tables.Count)',
  'Write-Output ("FONT=" + $d.Content.Font.Name)',
  'Write-Output ("TEXT_HEAD=" + $d.Paragraphs.Item(1).Range.Text.Trim())',
  '$n = [Math]::Min(3, $d.OMaths.Count)',
  'for ($i = 1; $i -le $n; $i++) {',
  '  $t = $d.OMaths.Item($i).Range.Text -replace "[\\r\\n\\a]", " "',
  '  Write-Output ("EQ" + $i + "=" + $t)',
  '}',
  '$d.Close(0)',
  '$w.Quit()',
].join('\n'), 'utf8');
console.log(execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ps], { encoding: 'utf8', timeout: 180000 }).trim());