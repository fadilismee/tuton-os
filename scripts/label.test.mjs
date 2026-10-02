// scripts/label.test.mjs — cek label dokumen & nama file ala tugas tutor.
// Logika docLabel/docName disalin persis dari src/export/index.js; kalau salah
// satu diubah, uji ini harus ikut disesuaikan.
const safeName = (s) => String(s || 'jawaban').replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim().slice(0, 70) || 'jawaban';

const docLabel = (doc = {}) => {
  const norm = (v, word) => {
    const t = String(v || '').trim();
    if (!t) return '';
    return new RegExp('^' + word, 'i').test(t) ? t : `${word} ${t}`;
  };
  const head = [norm(doc.tugas, 'Tugas'), norm(doc.sesi, 'Sesi')].filter(Boolean).join(' ');
  const matkul = String(doc.matkul || doc.course || '').trim();
  const parts = [head, matkul].filter(Boolean);
  if (parts.length) return parts.join(' - ');
  return String(doc.title || '').trim();
};

const docName = (doc, ext) => {
  const label = docLabel(doc) || doc?.title || doc?.course || 'jawaban';
  const base = /^jawaban\b/i.test(label.trim()) ? label.trim() : `jawaban ${label}`;
  return `${safeName(base).toLowerCase()}.${ext}`;
};

const cases = [
  // [masukan, label yang diharapkan, nama file yang diharapkan]
  [{ tugas: '1', sesi: '3', matkul: 'Bahasa Indonesia' },
    'Tugas 1 Sesi 3 - Bahasa Indonesia', 'jawaban tugas 1 sesi 3 - bahasa indonesia.docx'],
  // user menulis lengkap: tidak jadi "Tugas Tugas 1"
  [{ tugas: 'Tugas 2', sesi: 'Sesi 5', matkul: 'EKMA5102 Statistika' },
    'Tugas 2 Sesi 5 - EKMA5102 Statistika', 'jawaban tugas 2 sesi 5 - ekma5102 statistika.pdf'],
  // hanya tugas
  [{ tugas: '3', matkul: 'Manajemen' }, 'Tugas 3 - Manajemen', 'jawaban tugas 3 - manajemen.docx'],
  // hanya matkul
  [{ matkul: 'Bahasa Indonesia' }, 'Bahasa Indonesia', 'jawaban bahasa indonesia.docx'],
  // tidak ada apa-apa -> pakai judul dari heading
  [{ title: 'Tutorial Python' }, 'Tutorial Python', 'jawaban tutorial python.docx'],
  // karakter terlarang di nama file dinetralkan
  [{ tugas: '1', matkul: 'Hukum/Pidana: "Khusus"' }, 'Tugas 1 - Hukum/Pidana: "Khusus"',
    'jawaban tugas 1 - hukum-pidana- -khusus-.docx'],
];

let fail = 0;
for (const [doc, wantLabel, wantName] of cases) {
  const gotLabel = docLabel(doc);
  const gotName = docName(doc, wantName.split('.').pop());
  const okL = gotLabel === wantLabel;
  const okN = gotName === wantName;
  if (!okL || !okN) fail++;
  console.log(`${okL && okN ? 'OK  ' : 'FAIL'} label="${gotLabel}"  file="${gotName}"`);
  if (!okL) console.log(`     label harusnya: "${wantLabel}"`);
  if (!okN) console.log(`     file harusnya : "${wantName}"`);
}
console.log(fail ? `\n${fail} gagal` : `\n${cases.length} kasus lulus`);
process.exitCode = fail ? 1 : 0;
