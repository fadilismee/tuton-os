# 02 — Fitur Tuton OS (lengkap per halaman)

Nav inti: Dashboard · IPK · Simulasi · Tracker · AI Agen · **Jadikan File** ·
Capture · Setting.
Overlay (dari Dashboard): Bank Soal · BMP Studio · PDF Tools · Tugas · Catatan.
Popup toolbar: IPK/Streak/Level + check-in + status AI.

## Dashboard (`vDashboard`)
Ringkasan + heatmap aktivitas ala GitHub (Jan → hari ini, max tahun 2029, swipe
ganti tahun, tooltip custom gelap). Aksi cepat (Tanya AI, Fokus, Nilai,
Check-in), peralatan (Bank Soal, BMP Studio, PDF Tools, Simulasi), ringkasan
Tugas & Catatan. Hero ala UT (streak/pomodoro/lencana/status AI).
Cara pakai: buka sidebar → semua angka dari data lokal; Check-in tiap hari
untuk streak.

## IPK Calculator (`vIpk`)
Input semester → matkul (`code, name, sks, tuton, uas, scheme?, finalOverride?`).
Skala UT mode SULIT: A≥70 (4.00), A- 65–69.99 (3.50), B 60–64.99 (3.00),
B- 50–59.99 (2.50), C 45–49.99 (2.00), C- 40–44.99 (1.50), D 30–39.99 (1.00),
E <30 (0). Skema: 30/70 Tuton+UAS, 50/50, 60/40 Praktik, TTM langsung.
Predikat: ≥3.51 Dengan Pujian, ≥3.01 Sangat Memuaskan, ≥2.76 Memuaskan,
≥2.0 Lulus. Simpan → picu lencana Cum Laude (`TUTON_IPK_SAVED`).

## Simulasi What-If (`vSimulasi`)
Prediksi IPK akhir dari SKS berjalan + target IPS; daftar "parasit IPK"
(point<3.0, urut dampak `(4-point)×sks`). Cara pakai: isi SKS jalan + target
IPS → kejar matkul parasit teratas dulu.

## Tracker & Fokus (`vTracker`)
Pomodoro (alarm worker, XP 4/menit = 100 XP/25 mnt), stopwatch persisten,
timer bebas, checklist mingguan, ring SVG + live-chip. Pindah page bebas,
timer tetap jalan (state di storage + alarm). Selesai → XP + lencana
(Rajin 7 Hari, Legendaris 30, Fokus 10/50 Sesi, Cum Laude Track).

## Bank Soal — overlay (`vSoal`)
Paket terenkripsi AES-256-GCM (`keyId/nonce/ciphertext`, kunci tidak disimpan),
quiz + nilai (`gradeQuiz`), simulasi acak 30 soal, generate 10 soal dari modul
via AI (JSON), cache (`tuton_qcache`), XP kuis (≥60 = 50 XP).

## BMP Studio — overlay (`vBmp`, `rbv*`)
RBV Reader: deteksi halaman reader `pustaka.ut.ac.id` → unduh image (sesi login
user) → OCR Tesseract `ind` → rakit PDF searchable (pdf-lib) → cache IndexedDB
(`tuton-bmp-cache`, kunci `KODE:M{n}`) → unduh via `chrome.downloads`.
Mode manual untuk situs lain (capture tab + teks DOM via `minpdf`, tanpa OCR).
Ringkasan AI + generate soal per modul (cache `tuton_summary`/`tuton_genquiz`/
`tuton_modtexts`). Riwayat job (`tuton_bmp`). Handshake opsional ke extension
BMP Terbuka via ID di Setting.

## PDF Tools — overlay (`vPdf`)
Gabung, pisah/ekstrak, hapus halaman, putar, gambar→PDF, teks→PDF — semua via
pdf-lib lokal, tanpa server. Cara pakai: pilih file → pilih operasi → unduh hasil.

## Tugas & Catatan — overlay (`vTugas`, `vCatatan`, `initTasks/Notes`)
CRUD tugas (judul, deadline, prioritas, selesai) + catatan (judul, isi).
Ringkasan tampil di Dashboard.

## AI Agen (`vAi`) — fitur terbesar
- Chat multi-provider: 9router lokal, OpenAI, Anthropic native, Custom
  OpenAI-compatible (base + **chatPath/modelsPath custom**), via Runtime relay,
  auto (utama → relay). Toggle Cepat (ringkas, ~800 token) / Mendalam (detail).
- Sesi persisten (`tuton_ai_sessions`, max 20 sesi × 60 bubble): pindah tab tidak
  hilang; bubble AI tersimpan sebagai HTML render (markdown + KaTeX utuh).
- Baca tab aktif (`reader.js`: `TUTON_READ_TAB/FIELDS/FILL/CLICK` + PING):
  sertakan isi tab, daftar field, isi field (semi/auto/manual), klik elemen.
  Tidak bisa di chrome://, Web Store, halaman extension lain, PDF viewer
  (pesan jelas per kasus — proteksi Chrome, bukan bug).
- Lampiran: txt/md/csv/json/html (langsung), gambar (vision `image_url`, max 3;
  model non-vision 400 → retry otomatis tanpa gambar), PDF 3 lapis
  (pdf.js UMD lokal → OCR Tesseract `ind` → fallback Runtime `/api/read`),
  PPT/DOCX (arahan export ke PDF), audio/video (catatan nama+ukuran).
- Screenshot seleksi (`tools.js`): drag area di tab → crop lokal (max 1600px) →
  lampiran. SS tampak (visible area). Paste gambar dari clipboard langsung jadi
  lampiran. Composer textarea: Enter kirim, Shift+Enter baris baru.
- Render bubble: markdown (bold/italic/list/tabel/kode+Salin), rumus KaTeX
  lokal (`$…$`/`$$…$$`), tabel, chip lampiran (nama+ukuran+char, hapus per file).
- Diagnosa 5 lapis (worker, direct, via worker, key, chat + varian host).
  Tarik daftar model live. Footer "via …" dihapus.

## Jadikan File (`vExport`) — DOCX/PDF ber-rumus
Tulis/tempel materi (markdown + LaTeX `$…$` / `$$…$$`) → **Word .docx** dengan
**persamaan Word asli** (OMML, bisa diedit di Word) memakai template
`template/template.docx` (judul "JAWABAN <matkul>" + "Nama: … | NIM: …",
font/warna template ikut), atau **PDF**. DOCX dirakit 100% lokal di panel
(~150 ms) lalu **langsung terunduh**; PDF dikonversi lewat Tuton Runtime +
Microsoft Word (hasil paling rapi, juga langsung terunduh) — bila runtime mati,
terbuka halaman cetak A4 (`sidepanel/print.html`) dengan KaTeX lokal + auto
Ctrl+P dialog. Bahan cepat: jawaban AI terakhir, butir Bank Soal, ringkasan
BMP. Nama/NIM/matkul tersimpan otomatis ke profil.

## Export cepat dari chat AI
Tiap bubble jawaban AI punya baris **"Jadikan file → DOCX | PDF"**: satu klik,
langsung unduh (tanpa tempel ulang). Di PDF Tools juga ada bagian
**"Materi → DOCX/PDF"** (tempel/impor .md/.txt, atau ambil jawaban AI terakhir).

## Capture & Rekam (`vCap`)
Screenshot: full-page (scroll-stitch, max ~15.000px), visible area, custom area
(drag). Rekam: tab aktif (tabCapture + audio tab), layar/window/app lain
(`getDisplayMedia` — ini jawaban "record di luar Chrome"), webcam. Hasil:
preview + download (`.jpg`/`.webm`) + **Kirim ke AI** (antrean
`tuton_pendingShot`, otomatis jadi lampiran saat AI Agen dibuka).
Draw/whiteboard (`tools.js`): canvas seukuran dokumen (ikut scroll), warna +
tebal, kunci (coretan tetap), hapus. Tidak bisa di halaman proteksi Chrome.

## Setting (`vSetting`) — 2 card terpisah (prinsip AI bebas)
1. **AI Chat bebas**: provider, base URL, chat path, models path, model, API
   key (kolom kosong = pertahankan key lama; Reset key → key lokal),
   batas token, Tes chat, Diagnosa koneksi, Tarik model.
2. **Tuton Runtime tools (bukan AI)**: Runtime URL + token + Tes runtime
   (`/health`). Chat biasa tidak lewat sini.
3. Profil akademik + ID BMP Terbuka + Export JSON (14 key storage) + Hapus semua.
