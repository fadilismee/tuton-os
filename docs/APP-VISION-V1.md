# JARVIS Desktop V1 — scope (TTS terakhir)

Urutan build: engine shared + shell Tauri (hotkey+screenshot) → OCR+vision layarku
→ search → fitur lama (IPK/tracker/PDF/bank soal) → TTS paling akhir.

## V1 harus bisa
1. Floating assistant + hotkey global (Ctrl+Shift+J): full screen / window aktif / drag seleksi.
2. "Baca layarku": screenshot level OS (lolos anti-scrape/Canvas protection/PDF lock)
   → OCR lokal (Tesseract ind+eng yg sudah ada) → vision via provider bebas (nutaraline) → jawab.
3. Search web → jawab ringkas + sumber.
4. Engine lama reuse (bukan rewrite): chat markdown/KaTeX/sesi, IPK, tracker, PDF, bank soal.
5. Push-to-talk dulu. Wake word always-listening = V1.5 (nanti).

## Batasan jujur (tetap)
- Video DRM (layar hitam) tidak di-bypass. Jendela admin/UAC butuh run-as-admin. Layar lock tidak dibaca.
- Target: installer <50MB, idle RAM <150MB → Tauri 2, bukan Electron.

## Struktur
- `app-desktop/` — shell Tauri (frontend ringan + Rust minimal: screenshot xcap, global-shortcut, tray).
- `shared/tuton-core/` — engine murni lepas chrome.* (AI client, PDF text, markdown/KaTeX render, GPA, qbank, sesi).
  Extension, PWA, Tauri panggil fungsi yg sama. Ini satu-satunya refactor besar.
- `router/` tetap tools backend (PDF berat, proxy model) — sudah verified.
