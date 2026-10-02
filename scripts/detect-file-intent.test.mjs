// scripts/detect-file-intent.test.mjs — cek deteksi permintaan file di chat.
// Logika ini ada di sidepanel/app.js (wantsFile/fileKind) dan disalin persis di
// sini; kalau salah satu diubah, ubah keduanya.
const wantsFile = (q) => {
  const s = String(q || '').toLowerCase();
  const file = /(pdf|docx|doc\b|word|\.md\b|file|berkas|dokumen)/.test(s);
  const ask = /(jadiin|jadikan|bikin|buat|buatkan|convert|konversi|ekspor|export|unduh|download|simpan|kirim|tolong|minta|hasil|output|ke\s+(pdf|docx|word)|dalam\s+(pdf|docx|word)|format\s+(pdf|docx|word))/.test(s);
  return file && ask;
};
const fileKind = (q) => {
  const s = String(q || '').toLowerCase();
  if (/docx|word|\.doc\b/.test(s)) return 'docx';
  if (/pdf/.test(s)) return 'pdf';
  if (/\.md\b/.test(s)) return 'md';
  return null;
};
const should = [
  ['jadiin jawaban ini di pdf', true, 'pdf'],
  ['jadiin pdf dong', true, 'pdf'],
  ['bikin docx', true, 'docx'],
  ['buatkan file word', true, 'docx'],
  ['tolong jadikan docx', true, 'docx'],
  ['simpan ke pdf', true, 'pdf'],
  ['export ke word', true, 'docx'],
  ['kirim dalam bentuk pdf', true, 'pdf'],
  ['saya minta file pdf', true, 'pdf'],
  ['jadikan dokumen pdf', true, 'pdf'],
  ['tolong buat file word dari ini', true, 'docx'],
  ['jadiin .md', true, 'md'],
  ['apa itu pdf?', false, null],
  ['jelaskan distribusi pdf', false, null],
  ['soal ini susah', false, null],
  ['buatkan rangkuman', false, null],
  ['jadiin jawaban', false, null],
];
let fail = 0;
for (const [q, wantDetect, wantKind] of should) {
  const d = wantsFile(q), k = fileKind(q);
  const ok = d === wantDetect && (d ? k === wantKind : true);
  if (!ok) fail++;
  console.log(`${ok ? 'OK  ' : 'FAIL'} detect=${String(d).padEnd(5)} kind=${String(k).padEnd(5)} | ${q}`);
}
console.log(fail ? `\n${fail} gagal dari ${should.length}` : `\n${should.length}/${should.length} lulus`);
process.exitCode = fail ? 1 : 0;
