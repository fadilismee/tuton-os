# 01 — Tech Stack Tuton OS

## 1.1 Bahasa & runtime

| Lapisan | Teknologi | Keterangan |
|---|---|---|
| Extension UI | HTML + CSS + JS (ES Module, tanpa framework/build) | `sidepanel/`, `popup.html/js`. Load langsung, tanpa bundler |
| Background | Service Worker MV3 (`type: module`) | `src/worker/index.js` — alarms, badge/XP, proxy fetch, tabCapture |
| Content script | Vanilla JS IIFE | `src/content/reader.js`, `tools.js` — inject on-click via `chrome.scripting` |
| Logika murni | ES Module (jalan di browser & node) | `src/lib/*.js` — IPK, bank soal, store, perakit PDF |
| AI client | ES Module | `src/ai/client.js` — multi-provider OpenAI-compatible + Anthropic native |
| Runtime tools | Node.js 24 (bawaan, tanpa framework) | `router/server.js` — 1 dependensi: `pdfjs-dist` |

## 1.2 Dependensi npm (hanya 2, runtime saja)

| Paket | Versi | Dipakai di |
|---|---|---|
| `pdfjs-dist` | 3.11.174 | `router/server.js` (`/api/read`) via `require('pdfjs-dist/legacy/build/pdf.js')` |
| `path2d-polyfill` | 2.0.1 | transitif pdfjs-dist (bukan dipakai langsung) |

Extension sendiri NOL npm — semua vendor dibundel sebagai file di `src/bmp/vendor/`.

## 1.3 Vendor lokal (dibundel, tanpa CDN)

| File | Asal | Versi | Lisensi | Fungsi |
|---|---|---|---|---|
| `src/bmp/vendor/pdfjs-umd/pdf.min.js` + `pdf.worker.min.js` | `pdfjs-dist` | 3.11.174 | Apache-2.0 (Mozilla) | Baca PDF lapis-1 di browser (UMD stabil di MV3) |
| `src/bmp/vendor/pdfjs/pdf.min.mjs` + `pdf.worker*.mjs` | `pdfjs-dist` | 4.2.67 | Apache-2.0 | Cadangan ES-module |
| `src/bmp/vendor/tesseract.min.js` + `worker.min.js` + `core/*.wasm.js` | `tesseract.js` | 6.0.1 / core 6.0.0 | Apache-2.0 | OCR lapis-2 (bahasa `ind`) |
| `src/bmp/vendor/lang/ind.traineddata` (+`.gz`) | tessdata_fast | commit `8741641` | Apache-2.0 | Data bahasa Indonesia OCR |
| `src/bmp/vendor/pdf-lib.min.js` | `pdf-lib` | 1.17.1 | MIT | PDF Tools (gabung/pisah/putar) + BMP Studio rakit PDF |
| `src/bmp/vendor/katex/katex.min.js` | `katex` | 0.16.11 | MIT | Render rumus di chat + **MathML untuk export** |
| `src/export/vendor/mathml2omml.min.js` | `mathml2omml` | 0.5.0 | MIT | MathML → OMML (persamaan Word asli) |
| `src/bmp/vendor/katex/katex.min.js` + `.css` + `fonts/*.woff2` | KaTeX | 0.16.11 | MIT | Render rumus `$…$` / `$$…$$` di bubble AI |

Atribusi penuh: `THIRD_PARTY.md`. Catatan lisensi penting: pola BMP Studio
diadaptasi dari BMP Terbuka (`mentaliss/bukabmp`, **GPL-3.0**) — file adaptasi
(`src/bmp/engine.js`, `rbv.js`) ikut aturan GPL bila didistribusikan.

## 1.4 Ukuran (di mesin dev)

| Komponen | Ukuran |
|---|---|
| `src/bmp/vendor/katex` | 568 KB |
| `src/bmp/vendor/lang` (ind) | 1,7 MB |
| `src/bmp/vendor/pdfjs-umd` | 1,4 MB |
| `src/bmp/vendor/core` (tesseract wasm) | ~17 MB |
| `node_modules` (dev/runtime) | ~32 MB (tidak ikut paket extension) |

Kode sendiri: 6.023 baris total (`manifest` 53, `popup` 81, `app.js` 3.047,
`client.js` 544, `worker` 249, `reader` 171, `tools` 164, lib 380, bmp 523,
`server.js` 204).

## 1.5 Kompatibilitas

- Chrome / Edge desktop (MV3 sidePanel) — utama, sudah jalan.
- Edge Canary Android — bisa pasang extension, sidepanel terbatas (fallback: buka sebagai tab — pola yang dipakai rencana app/PWA).
- Chrome Android standar & Safari iOS — TIDAK dukung extension MV3 → jalurnya PWA/app (engine sama).
- Fork Windows / Mac / Linux — aman: tanpa path OS-only, tanpa binary, tanpa localhost wajib untuk fitur inti.
