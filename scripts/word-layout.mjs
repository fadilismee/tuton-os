// scripts/word-layout.mjs — laporkan struktur DOCX dari sudut pandang Word:
// tiap paragraf (teks + apakah mengandung persamaan), jumlah OMath, tabel.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const file = path.resolve(process.argv[2]);
const win = file.replace(/\//g, '\\');
const ps = path.resolve(path.dirname(file), 'word-layout.ps1');
fs.writeFileSync(ps, [
  "$ErrorActionPreference='Stop'",
  '$w = New-Object -ComObject Word.Application',
  '$w.Visible = $false',
  '$w.DisplayAlerts = 0',
  `$d = $w.Documents.Open("${win}", $false, $true)`,
  'Write-Output ("OMATHS=" + $d.OMaths.Count + " TABLES=" + $d.Tables.Count + " PARAS=" + $d.Paragraphs.Count)',
  'foreach ($p in $d.Paragraphs) {',
  '  $t = $p.Range.Text -replace "[\\r\\n\\a\\t]", " "',
  '  $eq = 0',
  '  foreach ($o in $d.OMaths) { if ($o.Range.Start -ge $p.Range.Start -and $o.Range.End -le $p.Range.End) { $eq++ } }',
  '  if ($t.Trim().Length -gt 0 -or $eq -gt 0) {',
  '    Write-Output ("[" + $p.Range.ListFormat.ListString + "|eq=" + $eq + "] " + $t.Trim())',
  '  }',
  '}',
  '$d.Close(0)',
  '$w.Quit()',
].join('\n'), 'utf8');
console.log(execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ps], { encoding: 'utf8', timeout: 180000 }).trim());