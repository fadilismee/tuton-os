# 04 — Teknis Tuton OS (arsitektur → fork → app)

## 4.1 Arsitektur (5 blok)

```
tab web ──inject on-click──> reader.js (baca/isi/klik) · tools.js (SS/draw/rekam)
        │
sidepanel/app.js (semua UI+logika, 3.047 baris) ◄── popup.js (ringkas)
        │                    │
        │                    ├── chrome.storage.local (19 key, §4.3)
        │                    └── IndexedDB tuton-bmp-cache (PDF BMP, KODE:M{n})
        │
        ├── src/worker/index.js (alarms, XP/lencana, TUTON_BG_FETCH, TUTON_TAB_STREAM)
        │
        ├── AI langsung ──> provider (9router/OpenAI/Anthropic/custom/relay)
        │
        ├── tools berat ──> router/server.js (127.0.0.1:3721 / VPS https+token)
        │                   /health · /api/models · /api/process · /api/read
        │                   · /api/export/pdf (DOCX -> PDF via Word/LibreOffice)
        │
        └── mesin export (src/export/) ── markdown -> DOCX (OMML asli) di panel
                                       └─ PDF: runtime/Word, else halaman cetak
```

Alasan worker proxy: fetch sidepanel + `Authorization` wajib preflight OPTIONS;
9router menjawab OPTIONS 401 tanpa CORS → browser blokir ("Failed to fetch").
Dari service worker (+`host_permissions`) request sama lolos.

## 4.2 Peta file (kode → fungsi)

| File | Baris | Peran | Fungsi kunci |
|---|---|---|---|
| `manifest.json` | 53 | MV3: permissions (`storage, sidePanel, alarms, tabs, contextMenus, activeTab, scripting, notifications, downloads, desktopCapture, tabCapture`), host (`127.0.0.1, localhost, nutaraline`), CSP (`script-src 'self' 'wasm-unsafe-eval'`) | — |
| `sidepanel/index.html` | 68 | Shell + vendor script (pdf-lib, tesseract, katex, pdfjs-UMD) + init `PDFJS_LOCAL`/`pdfjsReady` | — |
| `sidepanel/app.js` | 3.047 | SELURUH UI+logika | `render/go/openOverlay`, `vDashboard/vIpk/vSimulasi/vTracker/vSoal/vBmp/vPdf/vAi/vCap/vSetting`, `extractPdfTextLocal`, `mdToHtml/renderKatex/bindCodeCopy`, sesi `tuton_ai_sessions` |
| `sidepanel/styles.css` | 433 | Tema luxury dark + chat/markdown/kode/KaTeX/chip/heatmap | — |
| `sidepanel/icons.js` | 43 | 30+ ikon SVG (tanpa emoji) | `icon(name,size)` |
| `popup.js/html` | 81/63 | Toolbar mini: IPK/streak/level, check-in, status AI (pakai `modelsPath`) | — |
| `src/ai/client.js` | 544 | AI client multi-provider | `PROVIDERS, defaultAIConfig/loadAIConfig/saveAIConfig/rememberWorkingKey, bgFetch, listModels, diagConnection, askAI/viaOpenAIKind/viaAnthropic/viaTutonRouter, readViaRuntime, profileSummary, normPath/joinPath` |
| `src/ai/key.local.js` | — | Key lokal, **gitignored, jangan commit** | `LOCAL_9R_BASE/MODEL/API_KEY` |
| `src/worker/index.js` | 249 | Alarm pomodoro/timer/streak, badge, activity, fetch proxy, tab stream | `TUTON_CHECKIN/POMO_*/FOCUS_SAVE/TIMER_*/TRACKER_GET/QUIZ_DONE/IPK_SAVED/BG_FETCH/TAB_STREAM` |
| `src/content/reader.js` | 171 | Skill baca/isi/klik tab | `TUTON_PING/READ_TAB/FIELDS/FILL/CLICK` (+`selOf/labelOf/flash`) |
| `src/content/tools.js` | 164 | Skill SS/draw/rekam di tab | `TUTON_SHOT_AREA/DRAW_START-STOP-CLEAR-SHOT/REC_START-STOP-STATE` |
| `src/lib/gpa.js` | 139 | Mesin IPK skala UT + simulasi + parasit | `UT_SCALE/SCHEMES/PREDICATES, scoreToGrade/gradeToPoint/courseFinal/validateSemester/cumulative/simulate/parasites` |
| `src/lib/qbank.js` | 83 | Bank soal AES-GCM + nilai + acak | `importAdminKey/encryptPackage/decryptPackage/shuffle/gradeQuiz/buildSimulasi` |
| `src/lib/store.js` | 40 | Satu pintu storage (+fallback memori utk node) | `load/save/loadGrades/saveGrades/uid` |
| `src/lib/minpdf.js` | 118 | Perakit PDF A4+NOL dep (gambar + invisible text layer) | `buildPdf/pdfString` |
| `src/bmp/engine.js` | 249 | OCR Tesseract `ind` + rakit pdf-lib + cache + teks modul | `ensureWorker/prepareJob/ocrPage/finishModule/getModuleText/…` |
| `src/bmp/rbv.js` | 274 | Deteksi halaman reader pustaka.ut.ac.id + unduh image | — |
| `router/server.js` | 264 | Tuton Runtime (Node, 1 dep: pdfjs-dist) | `GET /health (+export.docxToPdf), /api/models, POST /api/process, /api/read, /api/export/pdf` + `extractPdfText/docxToPdf (Word COM → LibreOffice)` |
| `src/export/zip.js` | 145 | ZIP baca/tulis tanpa dep (DecompressionStream + CRC32) | `unzip/zip/crc32` |
| `src/export/mdblocks.js` | 150 | Markdown → blok & run inline (rumus utuh) | `parseInline/parseBlocks/blocksToText/guessTitle` |
| `src/export/latex.js` | 60 | LaTeX → OMML (KaTeX MathML → mathml2omml) + cache | `latexToOmml/mathmlToOmml` |
| `src/export/docx.js` | 200 | Rakit .docx dari template (persamaan OMML, tabel, kode, kop JAWABAN) | `buildDocx` (yield tiap 4 blok) |
| `src/export/printdoc.js` | 70 | Markdown → HTML cetak (rumus jadi `data-tex`) | `bodyHtml/inlineHtml/collectTex` |
| `src/export/pending.js` | 60 | Titipan antar halaman + job cetak | `stageExport/takeExport/peekExport/stagePrint/takePrint` |
| `src/export/index.js` | 157 | API export panel (unduh otomatis, runtime, fallback cetak) | `exportDocx/exportPdf/exportPdfViaRuntime/runtimeCapability/openPrintTab/saveBytes` |
| `src/export/vendor/mathml2omml.min.js` | — | mathml2omml IIFE (MIT, esbuild) | global `mml2ommlPkg` |
| `sidepanel/print.html` + `print.js` | 100 | Halaman cetak A4 (KaTeX lokal, auto `window.print()`) | — |
| `router/README.md`, `.env.example` | — | Panduan laptop/VPS + template env | — |

## 4.3 Storage (19 key)

`chrome.storage.local`: `tuton_grades, tuton_profile, tuton_tracker, tuton_qcache,
tuton_todo, tuton_tasks, tuton_notes, tuton_summary, tuton_genquiz, tuton_modtexts,
tuton_ai (+tuton_key terpisah), tuton_ai_sessions (max 20×60 bubble),
tuton_activity, tuton_bmp, tuton_pomo, tuton_countdown, tuton_stopwatch,
tuton_pendingShot` (antrean Capture→AI). `IndexedDB tuton-bmp-cache`: PDF per
modul (`KODE:M{n}`). Contract `askAI({messages, context, actions})`.

## 4.4 Alur AI (chat bebas + PDF 3 lapis)

Chat: `send()` (app.js) → lampiran teks digabung prompt + gambar `image_url`
(max 3) → `askAI` → direct https ATAU `TUTON_BG_FETCH` bila lokal/gagal CSP →
model non-vision 400 → retry tanpa gambar. Provider `router/auto` → relay
runtime (Bearer token bila diisi). Config: `provider, baseUrl, chatPath,
modelsPath, model, apiKey, maxTokens, aiDepth, agentMode, routerUrl, runtimeToken`.

PDF lampiran: (1) pdf.js UMD lokal per halaman (≥20 char non-spasi);
(2) halaman kosong → render canvas → Tesseract `ind` (progres notif);
(3) gagal → `readViaRuntime` (base64 → `/api/read` → pdf.js di Node, max 60 hal).
Hasil → teks ditempel ke prompt (AI tidak butuh akses file lokal).
Terbukti: EKMA5102-M1-M1.pdf → 16/16 hal, 21.911 char via runtime.

## 4.4b Alur export DOCX/PDF (rumus tetap rumus)

Tiga pintu: tombol **DOCX/PDF** di bawah tiap jawaban AI, halaman **Jadikan
File** (nav baru), dan bagian "Materi → DOCX/PDF" di PDF Tools.

1. **DOCX (selalu lokal, ~150 ms)**: `parseBlocks` → per blok jadi XML Word;
   rumus `$…$` dijalankan `katex.renderToString(tex,{output:'mathml'})` →
   `mml2omml` → `<m:oMath>` **persamaan Word asli** (bisa diedit di Word).
   Paket `template/template.docx` dibongkar (`unzip`), `word/document.xml`
   diganti, lalu di-zip ulang (`zip`) — font, gaya Title/Subtitle, ukuran
   halaman, warna template ikut apa adanya. Kop: "JAWABAN <matkul>",
   "Nama: … | NIM: …" dari `tuton_profile`. Unduh otomatis via
   `chrome.downloads`.
2. **PDF (paling rapi)**: DOCX dikirim base64 ke `POST /api/export/pdf` →
   runtime menulis DOCX sementara → **Microsoft Word COM**
   (`ExportAsFixedFormat(…,17)`) atau LibreOffice headless → PDF balik ke
   panel → unduh otomatis. Cek ketersediaan lewat `GET /health`
   (`export.docxToPdf: word|none`).
3. **PDF fallback (runtime mati / tanpa Word)**: `stagePrint` menyimpan
   dokumen → `chrome.tabs.create(chrome-extension://…/sidepanel/print.html)`
   → halaman cetak merender KaTeX lokal lalu `window.print()` (A4). Tidak ada
   rumus yang tampil sebagai teks mentah; kegagalan render dilaporkan di hint.

Bukti uji (dijalankan di mesin ini):

| Uji | Hasil |
|---|---|
| `npm run check` (syntax semua file) | OK |
| `npm run test:export` | DOCX 454 KB / 173 ms; PDF via runtime **engine=word**; 9/9 rumus ter-render di jalur cetak |
| `node scripts/word-inspect.mjs` (Word COM) | **OMATHS=4** (persamaan asli, bukan gambar), TABLES=1, PAGES=1, kepala paragraf "JAWABAN EKMA5102 Statistika (Uji)" |
| `node scripts/export-verify.mjs` (pdfjs) | PDF 1 hal, teks memuat JAWABAN/EKMA5102/nama/NIM/heading/tabel/kode |
| `node scripts/export-stress.mjs` (beban) | 12.423 char / 40 soal / 40 tabel → DOCX 447 KB, **OMATHS=120**, PAGES=16, Word membuka tanpa repair |
| `node scripts/detect-file-intent.test.mjs` | 17/17 lulus (deteksi "jadiin pdf/docx" di chat) |
| `node scripts/sysmsg-check.mjs` (model nyata) | tanpa sys + 800 token → `finish_reason=length`, 189 char, **menolak bikin file**; dengan sys + retry → `stop`, 3.591 char, LaTeX + arahkan ke tombol |

## 4.4c Kenapa model dulu bilang "tidak bisa bikin PDF"

Dua sebab, keduanya sudah dibereskan:

1. **System message tidak menyebut kemampuan file.** System message lama hanya
   berisi konteks akademik DAN hanya dikirim kalau `context.summary` ada —
   model jadi mengira dirinya chatbot biasa. Sekarang `ASSIST_SYS` (di
   `src/ai/client.js`) SELALU dikirim di semua provider (OpenAI-kind, Anthropic,
   relay runtime), berisi: aplikasi ini yang mengekspor file, JANGAN menolak,
   JANGAN menyuruh user jalankan Python/pandoc/script, cukup sajikan materi
   markdown + LaTeX lalu arahkan ke tombol DOCX/PDF.
2. **Model penalar (reasoning) kehabisan `max_tokens`.** Gateway 9router
   memakai `reasoning_tokens` (terbukti: 197 dari 200 token habis untuk berpikir,
   `content: ""`, `finish_reason: "length"`). Mode "Cepat" (≤800 token) bisa
   menghasilkan jawaban kosong/terpotong — yang terbaca user sebagai "AI tidak
   bisa". Klien sekarang: (a) meratakan parse jawaban (`message.content` maupun
   `delta.content`, plus ekor `data: [DONE]` yang bikin `JSON.parse` gagal),
   (b) **retry sekali otomatis** dengan token ≥4000 bila jawaban kosong atau
   `finish_reason=length`.

Selain itu, permintaan file di chat kini **langsung dieksekusi panel**:
`wantsFile()/fileKind()` di `sidepanel/app.js` mendeteksi "jadiin pdf",
"bikin docx", "kirim word", dsb → setelah jawaban AI masuk, file langsung
dibuat dan terunduh (kalau formatnya tidak disebut, muncul tombol pilih format).

Verifikasi endpoint (runtime hidup): `POST /api/export/pdf` dengan payload bukan
DOCX → HTTP **400** (`header PK\x03\x04 tidak ada`), dengan DOCX asli → HTTP
**200** `{engine:"word", pdfBase64}`.

### 4.4d Pengaman kalau model tetap menolak

System message menyelesaikan hampir semua kasus (uji `scripts/refusal-probe.mjs`:
model yang sama, dengan system message, mengoreksi sendiri penolakan lamanya:
"Koreksi singkat untuk pesan saya sebelumnya: ekspor file itu yang memproses
adalah aplikasi Tuton OS-nya"). Kalau model tetap menolak:

1. **Retry tegas otomatis.** Kalau permintaan user meminta file (`wantsFile`)
   dan jawaban AI terdeteksi penolakan (`looksRefusal`), panel mengirim ulang
   permintaan dengan penegasan eksplisit sekali, lalu memakai jawaban yang bukan
   penolakan.
2. **File tetap bisa jadi.** Jawaban penolakan TIDAK dipakai sebagai isi file.
   Panel menampilkan pilihan: "Pakai materi/soal saya" (ekspor teks pertanyaan
   user sendiri), "Minta AI tulis materinya lagi", atau "Buka halaman Jadikan
   File". Jadi permintaan file tetap menghasilkan file — AI tidak bisa
   memblokirnya.

Detektor penolakan diuji `scripts/refusal-detect.test.mjs` (11 kasus: 6 kalimat
penolakan asli tertangkap, 5 jawaban benar/LaTeX tidak salah tertandai).

## 4.5 Permission & CSP

Butuh: storage, sidePanel, alarms, tabs, activeTab, scripting, contextMenus,
notifications, downloads, desktopCapture, tabCapture. Host: localhost/127,
nutaraline; opsional `https://*/*`. CSP extension_pages:
`script-src 'self' 'wasm-unsafe-eval'` (wajib untuk Tesseract WASM).
Inject HANYA on-click (activeTab). Tidak jalan di chrome://, Web Store, halaman
extension lain, PDF viewer — pesan per kasus.

## 4.6 Keamanan (jujur)

Token runtime ≠ API key model. Key model milik user (Setting / `MODEL_API_KEY`
server / `key.local.js` gitignored). Non-lokal wajib https (worker tolak http).
`RUNTIME_TOKEN` ≥32 char di VPS. Tidak ada telemetri/ backend wajib.

## 4.7 Fork guide (5 menit)

`git clone → npm i → node router/server.js → load unpacked → isi Setting`.
Tanpa path OS-only, tanpa binary, tanpa localhost wajib utk fitur inti.
Lisensi vendor ikut: Apache-2.0 (pdf.js, tesseract), MIT (pdf-lib, KaTeX),
**GPL-3.0** (pola BMP Terbuka di `src/bmp/` — distribusi ikut GPL).

## 4.8 Troubleshooting cepat

| Gejala | Penyebab → obat |
|---|---|
| "mesin baca PDF belum termuat" | UMD/worker gagal → reload extension; fallback runtime otomatis bila runtime jalan |
| AI Failed to fetch | Preflight CORS → chat lokal lewat worker otomatis; cek Diagnosa 5 lapis; host alternatif 127↔localhost |
| 400 upstream rejected (gambar) | Model non-vision → retry tanpa gambar otomatis |
| Jawaban kepotong | `max_tokens` kecil → naikkan; mode Mendalam |
| Chat hilang pindah tab | Seharusnya persisten (`tuton_ai_sessions`) → cek storage; lampiran biner memang tidak disimpan |
| Runtime 401 | Token beda → samakan `RUNTIME_TOKEN` ↔ kolom Setting |
| Full-page jahit miring | Sticky header situs → pakai Custom area |
| Rekam tab tanpa suara | Tab tidak memutar audio → pakai mode Layar |

## 4.9 Backlog ke app

`import` backup JSON; RAG chunk+index (skr tempel teks ≤12k char); OCR di runtime
(Tesseract Node); rekam both cam+desktop; engine shared lepas `chrome.*`
(basis PWA/Tauri); PWA shell di VPS; Tauri desktop (shortcut/tray/drag-drop).
