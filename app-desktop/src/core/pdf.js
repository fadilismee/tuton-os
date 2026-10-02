// @tuton/core — pdf.js. Kontrak baca PDF untuk semua shell (extension/PWA/desktop).
// Lapis lokal (pdf.js/OCR) tetap milik shell masing-masing; file ini hanya:
//  - kontrak hasil { ok, mode, pages, text, hint }
//  - fallback via Tuton Runtime (/api/read) — Node bebas CSP, sudah verified
//    EKMA5102-M1-M1.pdf → 16/16 hal, 21.911 char.
export function isPdfBytes(buf) {
  const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf || []);
  return b.length > 4 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46; // %PDF
}

export function toBase64(u8) {
  const buf = u8 instanceof Uint8Array ? u8 : new Uint8Array(u8);
  let bin = '';
  const CH = 0x8000;
  for (let i = 0; i < buf.length; i += CH) bin += String.fromCharCode.apply(null, buf.subarray(i, i + CH));
  return btoa(bin);
}

export async function pdfViaRuntime({ runtimeUrl, token = '', filename = '', base64 }, fetcher) {
  if (!base64) throw new Error('base64 kosong.');
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = 'Bearer ' + token;
  const fx = fetcher || ((url, opt) => fetch(url, { method: opt.method, headers: opt.headers, body: opt.body }).then(async (r) => ({ ok: r.ok, status: r.status, text: () => r.text(), json: () => r.json() })));
  const r = await fx(String(runtimeUrl).replace(/\/+$/, '') + '/api/read', {
    method: 'POST', headers, body: JSON.stringify({ filename, dataBase64: base64 }), timeoutMs: 120000,
  });
  if (!r.ok) throw new Error(`Runtime /api/read HTTP ${r.status}`);
  return r.json();
}
