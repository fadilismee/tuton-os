# TUTON OS — Export Lengkap Extension (fondasi App)

Dokumen ini indeks export. Baca urut 01 → 04.
Status snapshot: 1 Okt 2026. Semua `node --check` OK (8 file) + manifest valid.
Bukti runtime: `POST /api/read` file `tuton-ekma5102-M1-M1.pdf` → pdf-text, 16/16 hal, 21.911 char.

| File | Isi |
|---|---|
| `01-tech-stack.md` | Bahasa, framework, dependensi, vendor + lisensi, ukuran |
| `02-fitur.md` | Semua fitur per halaman, alur pakai per fitur |
| `03-cara-pakai.md` | Install, setting AI (termasuk gateway custom), runtime laptop & VPS/HP, operasional harian, backup |
| `04-teknis.md` | Arsitektur, peta file, storage, protokol pesan, alur AI, pipeline PDF, permission/CSP, API runtime, keamanan, fork guide, troubleshooting, limitasi |

Prinsip yang dibawa ke app (jangan dilanggar):
1. **AI bebas** — chat langsung ke provider masing-masing (9router / OpenAI / Anthropic / custom gateway). Runtime TIDAK boleh jadi wajib untuk chat.
2. **Runtime = tools** — hanya kerja berat: baca PDF (`/api/read`), proxy model, relay opsional.
3. **Local-first** — data di perangkat. Tanpa Vercel/GitHub/Supabase wajib.
4. **Forkable** — tanpa path Windows-only, tanpa binary OS, tanpa localhost wajib untuk fitur inti.
