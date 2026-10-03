# Audit UI: tema Gelap & Putih (clean & simple)

Diaudit langsung di Chrome (CDP) pada panel asli, bukan perkiraan. Alat: skrip
`ui-audit.mjs` / `msg-contrast.mjs` (audit computed-style, kontras WCAG,
deteksi elemen meluber) — hasil mentah ada di `audit-*.json`.

## Gejala yang dilaporkan
1. Panel berubah putih dan tampak berantakan/nyilau.
2. Teks kecil (label kartu, bulan heatmap, keterangan) sulit dibaca.

## Temuan (hasil ukur, bukan opini)
- **Tema Putih dulu memang rusak struktural**: `--acc-ink` putih + tombol
  `primary` hijau `#00a35c` hanya **3.28:1**; `--dim` `#7d968b` = **3.18:1**
  di putih; teks **bold di bubble AI memakai `#fff`** (putih di atas putih =
  tak terbaca); `--bg2/--bg3` terlalu dekat dengan putih.
- **Tema Gelap**: `--dim` `#5b636b` hanya **3.10:1** di `--bg1` → 24 node teks
  di bawah 3.2:1 pada satu halaman Dashboard.
- **Kontrol form bawaan browser** tetap terang karena `color-scheme` belum
  diset (efek "kok jadi putih").
- **Heatmap**: label bulan dipaksa `width:14px` untuk teks selebar 14–18px →
  "Mar/Mei/Agu" terpotong; label bulan lama muncul tiap minggu (tumpang tindih).
- Glow berlebih: `text-shadow` IPK, `box-shadow` hover kartu/tombol, kilau
  `heroSheen`, `barShine` — ramai dan bikin tidak "clean".

## Perbaikan
- Token warna ditata ulang; tambah `--acc-hi`, `--tint`, `--hover`, `--sb`,
  `--shadow`, `--warn`, `--info`, `--ok`, dan skala radius `--r-xs…--r-lg`.
- **`color-scheme: dark` di `:root` dan `light` di `body.light`**, plus
  `document.documentElement.style.colorScheme` di `applyTheme()`.
- Kontras dinaikkan sampai **>= 4.5:1**: `--dim` gelap `#767f88`,
  `--mut` gelap `#9aa3ab`; Putih: `--dim #5f7a6b`, `--mut #4a6a58`,
  `--acc #00854e`, `--bg2 #f1f5f3`, `--bg3 #e7ecea`.
- Hapus warna keras yang merusak tema: `#fff` pada `strong`/heading bubble AI →
  `var(--txt)`; `#2bf09d` hover tombol → `var(--acc-hi)`; `rgba(0,0,0,.3x)`
  pada chip/hero/thumb/att-chip → `var(--bg2)`; heatmap hijau keras →
  `rgba(--acc, .22/.42/.68)` + `var(--acc)`; latar rumus `rgba(0,0,0,.3)` →
  `var(--tint)`.
- Heatmap: kelas `.cal-m` (lebar 14px, teks tidak dipotong) + label bulan hanya
  tiap >= 4 minggu.
- Glow dikurangi (shadow halus, tanpa kilau animasi di hero tema putih).
- Label `th` tabel → `var(--mut)` (dulu hijau aksen 4.16:1, kini 5.47:1 putih /
  6.84:1 gelap).

## Bukti sesudah
| Pemeriksaan | Gelap | Putih |
|---|---|---|
| Elemen latar terang (glaring) di semua halaman | 0 | 0 |
| Teks kontras < 3.2:1 (semua halaman) | 0 | 0 |
| Node teks bubble pesan < 4.5:1 (21 node: bold, heading, tabel, kode, rumus) | 0 | 0 |
| Teks yang warnanya ~ sama dengan latar (<2.5:1) | 0 | 0 |
| `color-scheme` efektif | dark | light |
| Elemen lebih lebar dari panel | 0 | 0 |

Screenshot: `~/Downloads/tuton-ui-screenshots/` (`dark-dashboard.png`,
`light-dashboard.png`, `dark-ai.png`, `light-ai.png`) — 2x, 430x980.

Catatan: `.cal` masih `557px` dari `scrollWidth` di panel 430px — itu memang
carousel heatmap (sengaja bisa digeser), bukan overflow yang merusak layout.
