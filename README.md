# Tuton OS

Asisten akademik lokal-first untuk mahasiswa **Universitas Terbuka (UT)** —
extension Chrome/Edge. Gratis, opensource, dan datanya tinggal di perangkatmu.

Semua fitur inti jalan **tanpa server**: nilai & IPK, modul BMP, bank soal,
alat PDF, dan export jawaban jadi Word/PDF. Server lokal (opsional) cuma dipakai
untuk kerja berat seperti membaca PDF besar dan konversi Word → PDF.

Dibuat oleh **zerotime.web.id**.

---

## Fitur

**AI Agen** — chat AI pakai API key milikmu sendiri (9router lokal, OpenAI,
Anthropic, atau gateway OpenAI-compatible apa pun). Bisa melampirkan teks,
gambar, PDF modul, dan screenshot; bisa juga membaca isi tab aktif.

**Jadikan File** — jawaban AI langsung diubah jadi:
- **Word `.docx` ber-rumus asli** (persamaan OMML, bisa diedit di Word), atau
- **PDF** siap cetak.

Kop otomatis mengikuti kebiasaan tugas tutor UT:
`JAWABAN <mata kuliah>` + `Nama: … | NIM: …`, nama file
mis. `jawaban tugas 1 sesi 3 - bahasa indonesia.docx`.

**BMP Studio** — reader modul UT (`pustaka.ut.ac.id`) ditangkap halaman per
halaman, dibaca teksnya dengan OCR bahasa Indonesia, lalu dirakit jadi
**PDF searchable** yang tersimpan lokal dan langsung terunduh.

**IPK & Simulasi** — kalkulator IPK skala UT (skema 30/70, 50/50, 60/40 praktik,
TTM/Tuweb) + predikat, plus simulasi what-if dan daftar "parasit IPK" (matkul
yang paling merusak IPK).

**Tracker & Fokus** — pomodoro, stopwatch, timer, check-in harian (streak),
heatmap aktivitas, XP, level, dan 7 lencana.

**Bank Soal** — paket soal terenkripsi lokal (AES-256-GCM), kuis, simulasi acak
30 soal, generate soal dari modul via AI.

**PDF Tools** — 7 alat lokal tanpa upload: gabung, pisah/ekstrak, hapus, putar,
gambar → PDF, teks → PDF, kompres gambar.

**Capture** — screenshot full-page/area, rekam tab/layar/webcam, draw di atas
halaman, dan kirim hasilnya ke AI.

---

## Cara pasang (2 menit)

1. Unduh repo ini (tombol **Code → Download ZIP**, lalu ekstrak), atau clone:
   ```bash
   git clone https://github.com/fadilismee/tuton-os.git
   ```
2. Buka Chrome/Edge → alamat `chrome://extensions`
   (Edge: `edge://extensions`).
3. Nyalakan **Developer mode** (kanan atas).
4. Klik **Load unpacked** → pilih **folder hasil ekstrak** (folder yang berisi
   `manifest.json`).
5. Klik ikon Tuton OS di toolbar → **Buka Sidebar**.

Selesai. Belum perlu setting apa pun untuk fitur non-AI (IPK, tracker, PDF
tools, BMP Studio, capture, export file).

> **Penting:** pilih folder yang benar — folder yang langsung berisi
> `manifest.json`. Kalau setelah ekstrak muncul folder bertingkat, masuk satu
> level dulu.

---

## Setting AI (untuk fitur AI Agen)

Fitur AI butuh API key milikmu sendiri — Tuton OS tidak menyediakan token.

1. Klik ikon extension → **Buka Sidebar** → menu **Setting**.
2. Di card **AI Chat bebas**, pilih provider:
   - **OpenAI** — isi API key OpenAI.
   - **Anthropic** — isi API key Anthropic.
   - **Custom (OpenAI-compatible)** — isi Base URL + Chat path + Models path +
     Model + API key (mis. OpenRouter, Groq, atau gateway/langgananmu sendiri).
   - **9router lokal** — kalau kamu menjalankan router OpenAI-compatible di
     komputermu sendiri.
3. Klik **Tes chat** untuk memastikan konek. Kalau gagal, klik
   **Diagnosa koneksi**.

Catatan: base URL lokal wajib `http://127.0.0.1` atau `http://localhost`;
alamat non-lokal wajib `https`.

---

## Runtime lokal (opsional)

Hanya perlu kalau kamu mau:
- membaca PDF besar yang gagal dibaca di browser, atau
- konversi Word → PDF otomatis (paling rapi; butuh Microsoft Word atau
  LibreOffice terpasang).

```bash
cd tuton-os
npm install
npm run router          # jalan di http://127.0.0.1:3721
```

Cek: `curl http://127.0.0.1:3721/health` → `{"ok":true,...}`

Lalu di **Setting → Runtime tools**: URL `http://127.0.0.1:3721`, token kosong,
klik **Tes runtime**.

Kalau runtime tidak jalan, tombol PDF tetap bekerja — panel membuka halaman
cetak A4 dan kamu simpan sebagai PDF lewat dialog cetak.

---

## Isi repo

```
manifest.json          deklarasi extension (MV3)
popup.html/js          popup toolbar
sidepanel/             seluruh UI + logika panel
src/ai/                klien AI multi-provider
src/bmp/               BMP Studio (OCR + rakit PDF) + vendor
src/export/            mesin export DOCX (OMML) / PDF
src/lib/               mesin IPK, bank soal, PDF mini
src/worker/            service worker (alarm, XP, proxy fetch)
src/content/           content script (baca/isi/klik tab, screenshot)
template/              template kop jawaban (.docx)
router/                runtime lokal opsional (Node)
```

---

## Storage & privasi

Semua data ada di perangkatmu:

- `chrome.storage.local` — profil, nilai, tugas, catatan, sesi AI, tracker.
- `IndexedDB` (`tuton-bmp-cache`) — cache PDF modul.

Tidak ada telemetri dan tidak ada backend wajib. Backup lewat
**Setting → Data → Export JSON**.

Catatan: lampiran berupa file biner tidak disimpan di riwayat chat, dan
reader modul UT butuh login akun UT milikmu sendiri yang statusnya aktif —
extension ini hanya membantu mengunduh halaman yang memang bisa kamu buka.

---

## Batasan

- Chrome/Edge **desktop**. Chrome Android standar & Safari iOS tidak mendukung
  extension (jalur HP: buka panel sebagai tab di Edge Canary Android).
- Tidak jalan di `chrome://`, Web Store, halaman extension lain, dan PDF viewer
  (proteksi browser, bukan bug).
- Full-page capture bisa miring di situs dengan header melengket — pakai mode
  area pilihan.
- Video ber-DRM tidak ditembus (hasilnya layar hitam).

---

## Lisensi

**GPL-3.0** — karena sebagian pola BMP Studio diadaptasi dari
[BMP Terbuka](https://github.com/mentaliss/bukabmp) yang berlisensi GPL-3.0.
Atribusi lengkap pihak ketiga (pdf-lib, pdf.js, KaTeX, mathml2omml, tesseract.js)
ada di [`THIRD_PARTY.md`](THIRD_PARTY.md).

Dibuat oleh **zerotime.web.id**.
