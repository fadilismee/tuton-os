// sidepanel/boot.js — inisialisasi engine vendor (pdf.js UMD) SEBELUM app.js.
// Dulu ini blok <script> inline di index.html; CSP MV3
// (`script-src 'self' 'wasm-unsafe-eval'`) memblokir script inline, jadi
// dipindah ke file terpisah (script klasik, bukan module, supaya jalan lebih
// dulu dan tidak menunggu antrean module).
(function initPdfJs() {
  try {
    if (globalThis.pdfjsLib) {
      globalThis.pdfjsLib.GlobalWorkerOptions.workerSrc =
        chrome.runtime.getURL('src/bmp/vendor/pdfjs-umd/pdf.worker.min.js');
      globalThis.PDFJS_LOCAL = globalThis.pdfjsLib;
      globalThis.PDFJS_READY = true;
    }
  } catch (e) {
    globalThis.PDFJS_READY = false;
    globalThis.PDFJS_ERROR = String((e && e.message) || e);
  }
  // Poller: vendor ESM/UMD lain bisa belum siap saat app.js jalan.
  globalThis.pdfjsReady = async function pdfjsReady() {
    for (let i = 0; i < 40; i++) {
      if (globalThis.PDFJS_LOCAL && globalThis.PDFJS_LOCAL.getDocument) return true;
      await new Promise((r) => setTimeout(r, 200));
    }
    return false;
  };
})();