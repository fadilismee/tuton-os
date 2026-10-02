// src/export/latex.js — LaTeX -> OMML (Word) memakai KaTeX + mathml2omml yang
// sudah di-vendor di src/export/vendor/. Nol jaringan, nol server.
//   KaTeX.renderToString(tex, {output:'mathml'}) -> MathML
//   mml2omml(MathML) -> <m:oMath>…</m:oMath>
// Cache agar rumus yang sama tidak dikonversi dua kali.

const cache = new Map();

function katexLib() {
  const k = globalThis.katex;
  if (!k?.renderToString) throw new Error('KaTeX (vendor) belum termuat — reload extension.');
  return k;
}

function ommlLib() {
  const m = globalThis.mml2ommlPkg?.mml2omml || globalThis.mml2omml;
  if (!m) throw new Error('mathml2omml (vendor) belum termuat — reload extension.');
  return m;
}

/** MathML (string <math>…</math>) -> OMML (string <m:oMath>…</m:oMath>). */
export function mathmlToOmml(mathml) {
  try {
    return ommlLib()(mathml, {});
  } catch (e) {
    return null;
  }
}

/** LaTeX -> OMML. displayMode hanya memengaruhi KaTeX (layout blok). */
export function latexToOmml(tex, displayMode = false) {
  const key = (displayMode ? 'D:' : 'I:') + tex;
  if (cache.has(key)) return cache.get(key);
  let out = null;
  try {
    const html = katexLib().renderToString(tex, { output: 'mathml', throwOnError: false, displayMode });
    const m = html.match(/<math[\s\S]*?<\/math>/);
    if (m) out = mathmlToOmml(m[0]);
  } catch (e) {
    out = null;
  }
  if (out) {
    // mathml2omml menaruh namespace m & w di root; pastikan ada.
    if (!/xmlns:m=/.test(out)) out = out.replace('<m:oMath>', '<m:oMath xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math" xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">');
  }
  cache.set(key, out);
  return out;
}

/** OMML -> teks LaTeX datar (fallback bila konversi gagal). */
export function texFallback(tex) {
  return tex;
}

export function resetLatexCache() { cache.clear(); }
