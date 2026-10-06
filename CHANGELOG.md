# Changelog

Semua perubahan penting proyek ini dicatat di sini.
Format mengikuti [Keep a Changelog](https://keepachangelog.com/id/1.1.0/)
dan versi mengikuti [Semantic Versioning](https://semver.org/lang/id/).

## [0.1.2] — 2026-10-06

Rilis kecil supaya hasil unduh dari GitHub benar-benar rapi dan siap dipasang.

### Diperbaiki
- **Icon extension asli** (16/48/128 px) — sebelumnya placeholder 1×1 transparan
  sehingga Chrome menampilkan ikon puzzle default di toolbar; kini monogram "T"
  neon di kotak gelap sesuai tema app.
- Versi icon sinkron di `manifest.json` dan `package.json` (0.1.2).

### Diubah
- README: peringatan jelas bahwa **file `.zip` harus diekstrak dulu** sebelum
  Load unpacked — men-drag zip langsung ke `chrome://extensions` tidak berfungsi.

## [0.1.1] — 2026-10-03

Rilis ini fokus pada **kualitas dokumen jawaban** dan **kerapian tampilan**,
ditambah pengaman supaya permintaan file tidak pernah gagal.

### Ditambahkan
- **Format dokumen ala tugas tutor**: kop `JAWABAN Tugas N Sesi N - Mata Kuliah`
  + `Nama: … | NIM: …`, nama file `jawaban tugas 1 sesi 3 - bahasa indonesia.docx`
  (tanpa tanggal). Isian Tugas/Sesi/Mata kuliah tersedia di baris "Jadikan file"
  di bawah jawaban AI, halaman Jadikan File, dan Setting → Profil akademik.
- **Pengaman permintaan file**: kalau AI menjawab tidak bisa membuat file,
  permintaan dikirim ulang sekali dengan penegasan; kalau masih menolak, panel
  menyediakan opsi "Pakai materi/soal saya", "Minta AI tulis materinya lagi",
  atau "Buka halaman Jadikan File" — jadi file tetap jadi tanpa bantuan AI.
- **Retry otomatis token**: model penalar yang kehabisan `max_tokens` (jawaban
  kosong / `finish_reason=length`) kini dicoba ulang dengan token lebih besar.
- Parameterisasi API key 9router (base URL, model, key) supaya berpindah
  environment tidak perlu mengubah kode.
- Skrip audit tampilan: `ui-shot`, `ui-audit`, `theme-audit`, `msg-contrast`,
  `verify-ui` — bisa dijalankan ulang untuk memeriksa kontras & overflow.
- `CHANGELOG.md` dan folder `docs/screenshots/`.

### Diperbaiki
- **Tema Terang**: teks tebal di bubble AI dulu memakai `#fff` (putih di atas
  putih sehingga tak terbaca), tombol utama hanya 3.28:1, label sekunder
  3.18:1. Semua naik ke ≥ 4.5:1.
- **Tema Gelap**: label abu `#5b636b` hanya 3.10:1 — 24 elemen teks di bawah
  ambang baca pada satu halaman. Dinaikkan ke 4.65:1.
- **Kontrol form bawaan browser** tidak lagi menyala terang di tema gelap:
  `color-scheme` kini mengikuti tema (dan diset ulang setiap ganti tema).
- **Heatmap aktivitas**: label bulan tidak lagi terpotong ("Mar/Mei/Agu") dan
  tidak lagi bertumpuk tiap minggu.
- Cache unduhan PDF yang gagal tidak lagi berisi byte PDF invalid
  (mencegah Word/LibreOffice menggantung saat konversi).
- Konversi Word tidak lagi menunggu sampai 5 menit saat runtime menerima
  payload bukan DOCX — sekarang langsung dijawab HTTP 400.
- Endpoint konversi Word → PDF menolak payload bukan DOCX (validasi header ZIP).
- Rumus LaTeX kini konsisten jadi persamaan Word asli (OMML), termasuk di dalam
  sel tabel.

### Diubah
- Glow/kilau berlebih dikurangi (bayangan lebih halus, animasi kilau dimatikan
  di tema terang); radius dan padding diseragamkan lewat token.
- Dokumentasi fitur export & cara pakai diperbarui (`docs/EXPORT-*.md`),
  ditambah laporan audit tema (`docs/UI-05-audit-tema.md`).

## [0.1.0] — 2026-10-02

Rilis pertama.

### Ditambahkan
- Extension MV3 **lokal-first** untuk mahasiswa UT, dua tema (gelap & terang).
- **AI Agen** multi-provider (9router lokal, OpenAI, Anthropic, custom
  OpenAI-compatible), lampiran teks/gambar/PDF, baca tab aktif.
- **Jadikan File**: ekspor jawaban ke **DOCX ber-persamaan asli (OMML)** dan
  **PDF**, dirakit lokal di extension (ZIP sendiri, KaTeX + mathml2omml vendor).
- **BMP Studio**: tangkap modul UT halaman per halaman, OCR bahasa Indonesia,
  rakit jadi PDF searchable tersimpan di IndexedDB.
- **IPK & Simulasi**: kalkulator skema UT, predikat, simulasi what-if,
  deteksi parasit IPK.
- **Tracker & Fokus**: pomodoro, stopwatch, timer, streak, heatmap, XP, level,
  7 lencana.
- **Bank Soal**: paket terenkripsi AES-256-GCM, kuis, mode fokus, simulasi acak.
- **PDF Tools**: 7 alat lokal tanpa upload.
- **Capture & Rekam**: screenshot full-page/area, rekam tab/layar/webcam,
  menggambar di halaman.
- **Runtime lokal opsional** (Node, port 3721): baca PDF besar + konversi
  Word → PDF via Microsoft Word/LibreOffice.

[0.1.2]: https://github.com/fadilismee/tuton-os/releases/tag/v0.1.2
[0.1.1]: https://github.com/fadilismee/tuton-os/releases/tag/v0.1.1
[0.1.0]: https://github.com/fadilismee/tuton-os/releases/tag/v0.1.0
