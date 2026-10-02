// app-desktop/src/main.js — skeleton V1. Wiring AI/search/OCR nyusul setelah
// toolchain Rust + Build Tools siap. TTS (Windows OneCore) PALING AKHIR.
const $ = (id) => document.getElementById(id);
const log = (who, text) => {
  const d = document.createElement('div');
  d.className = 'msg ' + who;
  d.textContent = text;
  $('log').appendChild(d);
  d.scrollIntoView({ block: 'nearest' });
};

log('ai', 'Halo. Saya Tuton Jarvis (desktop V1). Backend Rust belum dicompile — tombol di bawah aktif setelah build pertama sukses.');

$('b-send').addEventListener('click', () => {
  const v = $('in').value.trim();
  if (!v) return;
  $('in').value = '';
  log('user', v);
  log('ai', 'Backend AI belum tersambung (tahap: engine shared sudah jadi, shell Tauri antre compile).');
});
$('in').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('b-send').click(); });

// TODO setelah `tauri dev` jalan:
// - b-screen → invoke('screen_capture') → OCR/vision → jawab (teks dulu, TTS terakhir)
// - b-search → @tuton/core search.js (DuckDuckGo, tanpa key)
$('b-screen').addEventListener('click', () => log('ai', 'Baca layar butuh backend Rust (xcap + hotkey global). Status: menunggu Build Tools selesai diunduh.'));
$('b-search').addEventListener('click', () => log('ai', 'Search nyusul setelah shell jalan — engine @tuton/core/search.js sudah siap dites via node.'));
