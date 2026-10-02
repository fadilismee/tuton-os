# Atribusi Pihak Ketiga

## BMP Terbuka (mentaliss/bukabmp) — GPL-3.0

Bagian BMP Studio Tuton OS diadaptasi dari **BMP Terbuka**
(https://github.com/mentaliss/bukabmp) karya para kontributornya,
berlisensi **GNU General Public License v3.0**.

File yang diadaptasi:

| File Tuton OS | Sumber upstream |
|---|---|
| `src/bmp/rbv.js` | `extension/content.js` (deteksi halaman + unduh image reader, taksonomi gagal) |
| `src/bmp/engine.js` | `extension/offscreen.js` (worker OCR, rakit pdf-lib, cache IndexedDB) |
| `src/bmp/vendor/*` | `tools/build-release.mjs` (pin versi + SHA, pola hardening MV3) |

## pdf-lib (Hopding/pdf-lib) — MIT

Operasi PDF umum di menu PDF Tools (gabung, pisah/ekstrak, hapus, putar,
gambar→PDF, teks→PDF) memakai **pdf-lib** karya Hopding
(https://github.com/Hopding/pdf-lib), berlisensi **MIT**. File vendor lokal:
`src/bmp/vendor/pdf-lib.min.js` (v1.17.1, sudah termasuk dalam pin upstream
di atas). Pola API yang dipakai (create, load, copyPages, addPage,
setRotation/degrees, embedPng/embedJpg, save) mengikuti contoh resmi upstream.

## pdf.js (Mozilla) — Apache-2.0

Ekstrak teks PDF lampiran AI memakai **pdf.js** (https://github.com/mozilla/pdf.js),
berlisensi **Apache-2.0**. Dipakai sebagai **UMD legacy build lokal**
`src/bmp/vendor/pdfjs-umd/pdf.min.js` + `pdf.worker.min.js` (pdfjs-dist 3.11.174)
— dipilih UMD karena `.mjs` ES-module sering gagal dimuat di MV3 (MIME/CSP),
sedangkan UMD sebagai script klasik stabil + worker lokal. File `.mjs` di
`src/bmp/vendor/pdfjs/` dipertahankan sebagai cadangan. Atribusi lisensi penuh
ada di header tiap file vendor Mozilla tersebut.

## KaTeX (Khan Academy) — MIT

Render rumus matematika di bubble chat AI memakai **KaTeX**
(https://github.com/Khan/KaTeX), berlisensi **MIT**. File vendor lokal:
`src/bmp/vendor/katex/katex.min.js` + `katex.min.css` + `fonts/*.woff2`
(v0.16.11, unduh dari jsDelivr; hanya woff2 agar hemat). AI diminta
menjawab rumus dalam LaTeX (`$...$` / `$$...$$`) lalu dirender lokal.

Build yang sama juga dipakai mesin export: `renderToString(tex, {output:'mathml'})`
menghasilkan MathML yang lalu diubah jadi OMML (lihat bagian mathml2omml), dan
dirender ulang di halaman cetak `sidepanel/print.html` sebagai fallback PDF.

## mathml2omml — MIT

Konversi **MathML → OMML** (persamaan Word asli) memakai **mathml2omml**
(https://github.com/microsoft/mathml2omml, MIT lewat npm `mathml2omml` v0.5.0,
penulis asli Frédéric Wang). Dibundel jadi satu file IIFE dengan esbuild ke
`src/export/vendor/mathml2omml.min.js` (global `mml2ommlPkg`, tanpa dependensi
runtime — hanya `DOMParser` browser). Dipakai untuk mengubah keluaran MathML
KaTeX menjadi `<m:oMath>` yang bisa diedit sebagai persamaan di Word.

## Stirling PDF (Stirling-Tools/Stirling-PDF) — referensi daftar fitur

Daftar fitur PDF Tools merujuk pada **Stirling PDF**
(https://github.com/Stirling-Tools/Stirling-PDF) sebagai acuan kelengkapan,
namun kodenya TIDAK dipakai — Stirling butuh server Java/Docker sehingga tidak
cocok untuk extension MV3 lokal-first. Implementasi di sini ditulis ulang
dengan pdf-lib + canvas browser.

Versi vendor yang dipakai (identik dengan rilis upstream v1.1.0):

- tesseract.js 6.0.1, tesseract.js-core 6.0.0, pdf-lib 1.17.1
- ind.traineddata (tessdata_fast, commit `87416418657359cb625c412a48b6e1d6d41c29bd`)

Ketentuan yang dipatuhi:

1. Tidak memakai nama, logo, atau branding "BMP Terbuka" (lihat TRADEMARK.md upstream).
2. Tidak menyertakan backend/worker privat, bot, telemetri, iklan, atau aktivasi komunitas upstream.
3. Perubahan pola: OCR berjalan di sidepanel (bukan offscreen document); protokol pesan diganti `TUTON_BMP_*`.
4. Lisensi masing-masing dependensi vendor tetap berlaku (Apache-2.0 untuk tesseract.js/pdf-lib, Apache-2.0 untuk traineddata).

Sesuai GPL-3.0, source adaptasi ini tersedia bersama extension dan mencantumkan
perubahan terhadap karya aslinya.
