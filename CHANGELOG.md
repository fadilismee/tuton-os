# Changelog

Semua perubahan penting proyek ini dicatat di sini.
Format mengikuti [Keep a Changelog](https://keepachangelog.com/id/1.1.0/)
dan versi mengikuti [Semantic Versioning](https://semver.org/lang/id/).

## [0.1.4] — 2026-10-15

Unduhan BMP tidak lagi gagal total saat jaringan jelek di tengah jalan.

### Diperbaiki
- **Halaman yang macet (mis. 32/41) tidak lagi mematikan unduhan.** Dulu satu
  halaman yang tidak kunjung termuat langsung menghentikan modul dan hasil
  sebelumnya dibuang tanpa PDF. Sekarang halaman itu **dilewati** (`TUTON_BMP_STALL`),
  sapuan lanjut ke halaman berikutnya, dan di akhir halaman yang macet dicoba
  sekali lagi. Hasil yang sudah ada **tetap diunduh sebagai PDF parsial**
  (nama file menyebut `parsial-31dari41`), jadi waktunya tidak terbuang.
- **Tombol "Lanjutkan yang belum".** Modul yang belum lengkap dicatat di
  `tuton_bmp_pending` (tahan tutup sidepanel / restart browser), lalu bisa
  disusul kapan saja: extension hanya mengunduh & meng-OCR **halaman yang
  bolong**, halaman yang sudah ada tidak diulang. Bisa per modul atau sekaligus.
- **Jaringan putus dikenali cepat**: 3 halaman beruntun macet → berhenti rapi
  dengan laporan halaman bolong, bukan menggantung 15 detik per halaman sisa.
- **Modul berikutnya tetap jalan**: satu modul yang belum lengkap tidak lagi
  membatalkan sisa rentang — lanjut otomatis ke modul berikutnya, sisanya
  disusulkan lewat tombol Lanjutkan.
- **OCR yang gagal tidak lagi mematikan job**: halaman dicoba ulang sekali,
  kalau tetap gagal halaman itu dilaporkan bolong dan sisanya tetap diproses.

### Ditambahkan
- Uji regresi `npm run test:bmp`: perilaku pembaca saat halaman macet, lanjutan
  yang tidak mengulang halaman, dan rakit PDF (urutan halaman 1…N + penolakan
  modul yang belum lengkap).

### Diubah
- Urutan halaman PDF selalu dirakit ulang dari simpanan per halaman, sehingga
  hasil lanjutan tidak mungkin teracak (halaman baru diproses lebih dulu
  daripada halaman lama).
- Modul yang belum lengkap tidak pernah ditandai selesai di cache lokal:
  PDF parsialnya disimpan di kunci terpisah dan dihapus begitu modul tuntas.
- Teks OCR disimpan per halaman, jadi ringkasan/soal AI tetap lengkap setelah
  modul disusun dari beberapa sesi.

## [0.1.3] — 2026-10-15

BMP Studio (RBV reader pustaka.ut.ac.id) dirombak jadi **perekam pasif** — satu-satunya
cara yang terbukti lolos WAF + sesi reader saat ini.

### Ditambahkan
- Alur **Mulai rekam → scroll pelan → Selesai & rakit PDF**; tiap halaman langsung
  disimpan bertahap ke IndexedDB sehingga progres tidak hilang saat sesi putus dan
  bisa dilanjutkan tanpa OCR ulang.
- Halaman bolong dilaporkan eksplisit (`missing`) — PDF tidak pernah terpotong diam-diam.
- Perbaikan guard idempoten `window.__TUTON_BMP__`: listener selalu dipasang ulang
  (`removeListener` sebelum `addListener`) sehingga Reload extension cukup tanpa
  menutup tab reader.

### Diubah
- Mode **Unduh otomatis (Cepat/Biasa)** tetap ada untuk rentang multi-modul; bila
  reader mencurigai pola otomatis (reload viewer / sesi putus), pakai **Mulai rekam**
  yang pasif dan aman.
- Deteksi gambar tahan revisi situs: URL `view.php` diparse via regex (urutan
  parameter apa pun) + dukungan render `background-image`, bukan hanya `<img>`.
- Pesan gagal kini menyebut **modul mana yang sedang terbuka** bila tab salah modul.

### Diperbaiki
- Hasil panen 0 tanpa pesan error (penyebab: skrip lama di tab terbuka mengabaikan
  pesan `TUTON_BMP_RECORD`).
- Blokir WAF reader: `fetch()`/`<img>` langsung ke `view.php` selalu dijawab
  HTTP 200 "Request Rejected" — kini hanya memanen `<img>` yang SUDAH dimuat
  viewer FlowPaper.

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

[0.1.4]: https://github.com/fadilismee/tuton-os/releases/tag/v0.1.4
[0.1.3]: https://github.com/fadilismee/tuton-os/releases/tag/v0.1.3
[0.1.2]: https://github.com/fadilismee/tuton-os/releases/tag/v0.1.2
[0.1.1]: https://github.com/fadilismee/tuton-os/releases/tag/v0.1.1
[0.1.0]: https://github.com/fadilismee/tuton-os/releases/tag/v0.1.0
