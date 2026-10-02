# 03 — Cara Pakai Tuton OS

## 3.1 Install (Chrome / Edge desktop)

1. Buka `chrome://extensions` → aktifkan Developer mode → Load unpacked →
   pilih folder `tuton-os`.
2. Klik ikon extension → Buka Sidebar (atau Popup Ngambang untuk jendela lebar).
3. Setting → isi Profil (prodi, **nama**, **NIM**, **matkul default**, target
   IPK/SKS) — nama/NIM/matkul dipakai untuk kop jawaban saat export.
4. Reload extension tiap habis update file (`chrome://extensions` → reload).

Catatan HP: Edge Canary Android bisa pasang extension yang sama; sidepanel
terbatas → buka sebagai tab. Chrome Android standar / Safari iOS tidak dukung
extension → jalurnya app/PWA (fondasi: dokumen ini).

## 3.1b Jadikan jawaban sebagai DOCX / PDF (fitur baru)

Tiga cara, semuanya **langsung terunduh** ke folder Downloads:

1. **Dari chat AI (paling cepat)**: tanya seperti biasa → di bawah jawaban klik
   **DOCX** atau **PDF** pada baris "Jadikan file". Bisa juga langsung minta di
   chat: *"jadiin PDF"*, *"bikin docx"*, *"kirim word"* — panel otomatis membuat
   filenya dari jawaban terakhir (kalau format tidak disebut, muncul tombol
   pilih format).
2. **Halaman "Jadikan File"** (nav kiri): tempel/tulis materi, isi nama matkul
   (nama/NIM terisi otomatis dari profil), lalu **DOCX ber-rumus** atau **PDF**.
   Tombol "Bahan cepat" mengisi dari jawaban AI terakhir / Bank Soal / ringkasan
   BMP.
3. **PDF Tools → "Materi → DOCX/PDF"**: tempel atau impor `.md`/`.txt`.

Rumus ditulis dengan LaTeX: `$x^2$` (inline) dan `$$\frac{a}{b}$$` (blok).
Di Word hasilnya jadi **objek persamaan** (bukan gambar) sehingga bisa diedit.

Catatan: AI-nya TIDAK membuat file — panel Tuton OS yang mengerjakannya. Kalau
AI menjawab "saya tidak bisa membuat file":

- Panel otomatis mengirim ulang permintaan dengan penegasan sekali (jawaban
  penolakan tidak dipakai).
- Kalau masih menolak, panel menawarkan: **Pakai materi/soal saya** (teks
  pertanyaanmu sendiri jadi file), **Minta AI tulis materinya lagi**, atau
  **Buka halaman Jadikan File** (tempel materinya di sana).
- Yang paling penting: pastikan folder extension yang ke-load adalah folder yang
  berisi `src/export/`. Buka `chrome://extensions` → Tuton OS → **Details**
  → lihat "Loaded from"/path. Pastikan folder yang ke-load berisi `src/export/`
  (di mesin ini: `C:\Users\fadilismee\tuton-os` ATAU `tuton-os-aifix` — keduanya
  sekarang sudah disinkronkan dan sama). Kalau yang ke-load folder tanpa
  `src/export/`, klik Remove lalu **Load unpacked** ke folder yang benar.

Agar PDF keluar otomatis tanpa dialog cetak, jalankan runtime sekali:

```
node router/server.js      # cek: curl http://127.0.0.1:3721/health
```

`/health` menjawab `export.docxToPdf: "word"` bila Microsoft Word terdeteksi
(konversi DOCX→PDF pakai Word). Kalau runtime mati, klik PDF tetap berfungsi:
panel membuka halaman cetak A4 dengan rumus KaTeX yang sudah rapi, lalu dialog
Ctrl+P muncul — pilih "Simpan sebagai PDF".

## 3.2 Setting AI Chat (bebas, provider apapun)

Setting → card **AI Chat bebas**:
- Pilih provider: `9router lokal` (`http://127.0.0.1:20128/v1`,
  model `nura/muse-spark-1.3`), `OpenAI`, `Anthropic`, atau `Custom`.
- Custom gateway (cth. nutaraline): isi Base URL (cth.
  `https://nutaraline.co.uk/...`) + **Chat path** (default `/chat/completions`)
  + **Models path** (default `/models`) + Model + API key → Simpan.
- Kolom key dikosongkan = key lama dipertahankan. `Reset key` = kembali ke
  `src/ai/key.local.js` (file gitignored, tidak di-commit).
- Tes chat (ping "konek"), Diagnosa koneksi (5 lapis + varian host
  127.0.0.1↔localhost), Tarik Model (dropdown live).
- Toggle Cepat/Mendalam ada di AI Agen (bukan Setting).

Aturan jaringan: base lokal wajib `127.0.0.1/localhost` (via worker, hindari
preflight CORS). Base non-lokal wajib `https` (http non-lokal ditolak worker
demi keamanan token). `https://nutaraline.co.uk/*` sudah di `host_permissions`;
gateway https lain lewat `optional_host_permissions` (`https://*/*`).

## 3.3 Tuton Runtime — laptop (wajib untuk PDF berat)

```bash
cd C:/Users/fadilismee/tuton-os
npm i            # sekali saja (pdfjs-dist untuk /api/read)
node router/server.js   # atau: npm run router
```

Cek `http://127.0.0.1:3721/health` → `{"ok":true,...}`.
Setting → card **Runtime**: URL `http://127.0.0.1:3721`, token KOSONG, Tes runtime.
Bukti: file `tuton-ekma5102-M1-M1.pdf` → `pdf-text, 16/16 hal, 21.911 char`.

## 3.4 Tuton Runtime — VPS (buat HP / fork orang lain)

```bash
git clone <repo> && cd tuton-os && npm i
cp router/.env.example router/.env   # isi: lihat bawah
HOST=0.0.0.0 PORT=3721 node router/server.js   # atau systemd/pm2
```

`router/.env` VPS: `PORT`, `HOST=0.0.0.0`, `MODEL_API_URL`, `MODEL_API_KEY`,
`MODEL_NAME`, `RUNTIME_TOKEN` (acak ≥32 char). WAJIB https di depan
(Nginx/Caddy, cth. `tuton.kamu.id { reverse_proxy 127.0.0.1:3721 }`).
Di HP: Runtime URL `https://tuton.kamu.id` + token + Tes runtime.
Chat di HP tetap langsung ke provider (direct); atau provider `via Runtime
(relay)` bila mau semua lewat VPS.

## 3.5 Operasional harian (urutan yang disarankan)

1. Popup → Check-in (atau Dashboard → Check-in) untuk streak.
2. Tracker → Pomodoro 25 mnt untuk sesi fokus (XP otomatis).
3. IPK → input nilai semester berjalan; Simulasi → kejar parasit teratas.
4. AI Agen → lampirkan PDF modul / SS seleksi → minta ringkasan/soal.
   Mode Cepat untuk intisari, Mendalam untuk bedah detail + rumus.
5. Bank Soal → kerjakan paket / generate dari modul → XP kuis.
6. Capture → SS full-page materi / rekam tutorial / draw coretan → Kirim ke AI.

## 3.6 Backup & pindah perangkat

Setting → Data → Export JSON (14 key: nilai, profil, tracker, sesi AI, soal,
tugas, catatan, ringkasan, dsb). Simpan file. Di perangkat baru: install →
import manual per fitur (belum ada tombol import — masuk backlog app).
Hapus semua = `chrome.storage.local.clear()` (tidak menyentuh IndexedDB cache
BMP — hapus via BMP Studio bila perlu).


## Format dokumen & nama file (ala tugas tutor)

Kop Word/PDF dan nama file mengikuti kebiasaan tugas Tutor UT:

    Kop   : JAWABAN Tugas 1 Sesi 3 - Bahasa Indonesia
            Nama: <nama>  |  NIM: <NIM>
    File  : jawaban tugas 1 sesi 3 - bahasa indonesia.docx / .pdf

Isian **Tugas ke-**, **Sesi**, dan **Mata kuliah** ada di tiga tempat (semua
tersimpan ke profil, jadi sekali isi langsung terbawa):

1. Baris "Jadikan file" di bawah tiap jawaban AI — ada kotak kecil Tugas/Sesi/
   Mata kuliah tepat sebelum tombol DOCX & PDF.
2. Halaman **Jadikan File** — kolom Tugas ke-, Sesi, Mata kuliah.
3. **Setting → Profil akademik** — nilai default untuk semuanya.

Kalau hanya angka yang diisi (mis. `1`), otomatis jadi `Tugas 1` / `Sesi 3`
(tidak akan jadi "Tugas Tugas 1"). Nama file tidak lagi memakai tanggal, dan
selalu berawalan `jawaban ` supaya mudah dicari di folder Downloads.
