# Tuton Runtime — minimalis (laptop & VPS)

Satu proses Node, NOL framework. Laptop jalan di `127.0.0.1:3721`,
VPS jalan di `0.0.0.0:3721` + token. Extension ngobrol ke sini untuk
tiga hal: (1) teruskan chat ke model AI, (2) baca PDF berat server-side,
(3) konversi DOCX hasil export jadi PDF (via Microsoft Word / LibreOffice).

## Rute

| Rute | Guna |
|---|---|
| `GET /health` | status + kemampuan export (`export.docxToPdf: word\|none`) |
| `GET /api/models` | daftar model dari `MODEL_API_URL` (proxy, bebas CORS) |
| `POST /api/process` | teruskan chat ke model |
| `POST /api/read` | ekstrak teks PDF/gambar/teks (pdfjs-dist) |
| `POST /api/export/pdf` | `{dataBase64}` DOCX → `{pdfBase64, engine}` (Word COM / LibreOffice headless) |

`/api/export/pdf` memakai Microsoft Word COM di Windows (kualitas persamaan
paling tinggi) dan jatuh ke `soffice --headless --convert-to pdf` bila Word
tidak ada. Kalau keduanya tidak ada, `/health` menjawab
`export.docxToPdf: "none"` dan extension otomatis memakai jalur cetak (KaTeX di
halaman cetak A4) — PDF tetap bisa dihasilkan, hanya lewat dialog Ctrl+P.

## 1) Laptop (kamu sekarang) — 2 menit

```bash
cd C:/Users/fadilismee/tuton-os
npm i            # sekali saja (pdfjs-dist utk /api/read)
node router/server.js
```

Cek: buka `http://127.0.0.1:3721/health` -> `{"ok":true,...}`.

Di extension: Setting > AI
- Router tuton: `http://127.0.0.1:3721`
- Token runtime: KOSONGKAN
- Provider tetap `9router` untuk chat (runtime hanya fallback baca PDF bila
  baca lokal browser gagal — kasus file EKMA5102 kemarin).

Bukti di mesin ini: `POST /api/read` file `tuton-ekma5102-M1-M1.pdf`
-> `mode: pdf-text, pages: 16, textPages: 16, chars: 21911`.

## 2) VPS (buat HP / fork orang lain)

Di VPS (Ubuntu contoh):

```bash
git clone <repo> && cd tuton-os
npm i
cp router/.env.example router/.env   # lalu isi (lihat bawah)
HOST=0.0.0.0 PORT=3721 node router/server.js
# atau via systemd / pm2 agar hidup terus
```

`router/.env` di VPS:

```
PORT=3721
HOST=0.0.0.0
MODEL_API_URL=http://127.0.0.1:20128/v1
MODEL_API_KEY=isi-key-9router-atau-gateway
MODEL_NAME=nura/muse-spark-1.3
RUNTIME_TOKEN=isi-token-acaj-panjang-min-32-char
```

WAJIB https di depan VPS (reverse proxy Nginx/Caddy) — extension menolak
`http://` non-lokal demi keamanan token. Contoh Caddy 1 baris:

```
tuton.kamu.id { reverse_proxy 127.0.0.1:3721 }
```

Di HP (Edge Canary): Setting > AI
- Router tuton: `https://tuton.kamu.id`
- Token runtime: sama dgn RUNTIME_TOKEN
- Provider: `router tuton lokal` (semua chat + baca PDF lewat VPS)

## 3) Endpoint

- `GET /health` -> `{ ok, service, pdf, token }`
- `GET /api/models` (Bearer bila token diset) -> proxy daftar model
- `POST /api/process` `{ model?, messages[], context?, actions?, maxTokens? }`
  -> `{ content, via }` (gagal forward = fallback jawaban lokal + warning)
- `POST /api/read` `{ filename, dataBase64 }`
  -> PDF teks: `{ ok:true, mode:'pdf-text', pages, textPages, chars, text }`
  -> PDF gambar semua: `{ ok:false, mode:'pdf-image', pages, hint }`

## 4) Batasan jujur

- Runtime TIDAK OCR (tetap 1 dependensi: pdfjs-dist). PDF full-gambar
  (PPT/screenshot di-print ke PDF) -> mode `pdf-image` + diarahkan ke model
  vision / screenshot halaman. OCR Tesseract = iterasi berikut bila diminta.
- Gambar murni tetap diteruskan extension sebagai `image_url` ke model
  vision (runtime tidak perlu melihatnya).
- Token runtime BUKAN pengganti API key model — key model tetap milik user
  di `MODEL_API_KEY` (server) / Setting > AI (extension langsung).
