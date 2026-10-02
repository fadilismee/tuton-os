// scripts/refusal-detect.test.mjs — pastikan detektor penolakan menangkap
// jawaban "tidak bisa bikin file" tapi TIDAK salah menandai jawaban yang benar
// (teks contoh diambil dari jawaban model asli).
const looksRefusal = (t) => {
  const x = String(t || '');
  return /(tidak|nggak|ga|gak|belum)\s+(bisa|dapat|mampu)[^.\n]{0,70}(membuat|bikin|buat|menyimpan|mengirim|mengunduh|menghasilkan|ekspor|convert|mengonversi)[^.\n]{0,40}(file|pdf|docx|word|dokumen)/i.test(x)
    || /(saya|aku)\s+(hanya|cuma|hanya bisa|cuma bisa)[^.\n]{0,40}(teks|menjawab|memberi)/i.test(x)
    || /(silakan|silahkan|kamu\s+harus|coba)\s+(jalankan|gunakan|pakai|install|instal|unduh)[^.\n]{0,40}(python|pip\b|pandoc|latexmk|kode|script|latex)/i.test(x)
    || /tidak\s+punya\s+akses[^.\n]{0,40}(file|sistem|penyimpanan)/i.test(x);
};
const refusalTexts = [
  'Maaf, saya tidak bisa membuat atau mengirim file PDF. Saya hanya bisa memberikan teks. Silakan jalankan kode Python sendiri untuk membuat PDF.',
  'Saya tidak dapat membuat file docx dari sini. Kamu harus jalankan script Python untuk itu.',
  'Aku cuma bisa memberi teks, tidak bisa menyimpan file.',
  'Saya tidak punya akses ke sistem file, jadi tidak bisa mengunduh PDF.',
  'Untuk membuat PDF, silakan install pandoc lalu jalankan perintahnya.',
  'Saya belum bisa mengekspor jawaban ini ke file Word.',
];
const goodTexts = [
  'Ya, bisa banget! Di aplikasi Tuton OS ini, jawaban yang aku tulis di sini bisa langsung kamu jadikan file PDF / Word. Caranya: klik tombol "Jadikan file: PDF" di bawah jawaban ini.',
  'Bisa — ekspor file PDF/DOCX itu yang memproses adalah aplikasi Tuton OS-nya, bukan saya mengetik manual. Jadi kamu nggak perlu install apa-apa dan nggak perlu jalanin script.',
  '## Soal 1\n\nRata-rata $\\bar{x}=\\frac{\\sum x_i}{n}$ dan varians sebagai berikut:\n\n$$s^2=\\frac{1}{n-1}\\sum (x_i-\\bar{x})^2$$',
  'Berikut jawabannya. Rumus ditulis dengan LaTeX supaya rapi saat diekspor ke Word.',
  'File PDF-nya sudah bisa kamu unduh lewat tombol di bawah jawaban ini.',
];
let fail = 0;
for (const t of refusalTexts) { const r = looksRefusal(t); if (!r) fail++; console.log(`${r ? 'OK  ' : 'FAIL'} terdeteksi=${r} | ${t.slice(0, 62)}`); }
console.log('');
for (const t of goodTexts) { const r = looksRefusal(t); if (r) fail++; console.log(`${!r ? 'OK  ' : 'FAIL'} terdeteksi=${r} | ${t.slice(0, 62)}`); }
console.log(fail ? `\n${fail} gagal` : `\n${refusalTexts.length + goodTexts.length} kasus lulus`);
process.exitCode = fail ? 1 : 0;
