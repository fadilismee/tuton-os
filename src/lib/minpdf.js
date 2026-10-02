// src/lib/minpdf.js — Perakit PDF minimal, NOL dependensi (browser & node).
// Pola pipeline BMP Terbuka (mentaliss/bukabmp): capture -> rakit lokal -> export.
// Bedanya: tanpa Tesseract/pdf-lib/CDN. Gambar JPEG diembed langsung; teks DOM
// halaman ditulis sebagai invisible text layer (rendering mode 3) sehingga
// PDF hasil tetap searchable. Font: Helvetica (base-14, tanpa embed).

const te = new TextEncoder();

function escByte(n) { return String.fromCharCode(n); }

// String PDF: ASCII -> (...) dengan escape; non-ASCII -> UTF-16BE hex <FEFF...>.
export function pdfString(s) {
  const str = String(s ?? '');
  if (/^[\x09\x0A\x0D\x20-\x7E]*$/.test(str)) {
    return `(${str.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)')})`;
  }
  let hex = 'FEFF';
  for (const ch of str) {
    const cp = ch.codePointAt(0);
    if (cp < 0x10000) hex += cp.toString(16).padStart(4, '0');
    else { const v = cp - 0x10000; hex += ((v >> 10) + 0xD800).toString(16) + ((v & 0x3FF) + 0xDC00).toString(16); }
  }
  return `<${hex.toUpperCase()}>`;
}

function wrapWords(text, maxChars) {
  const out = [];
  for (const para of String(text || '').split('\n')) {
    let line = '';
    for (const w of para.split(/\s+/).filter(Boolean)) {
      if ((line + ' ' + w).trim().length > maxChars) { if (line) out.push(line); line = w; }
      else line = (line + ' ' + w).trim();
    }
    out.push(line);
  }
  return out.filter((l) => l.length);
}

// pages: [{ jpeg: Uint8Array, width, height, text }]
// Kembali: Uint8Array PDF utuh.
export function buildPdf(pages, meta = {}) {
  if (!pages.length) throw new Error('Tidak ada halaman untuk dirakit');
  const PW = 595, PH = 842; // A4 portrait (pt)
  const objects = []; // { head: string, body: Uint8Array|string }
  const N = pages.length;
  // nomor objek: 1=catalog, 2=pages, 3=font, lalu per halaman: page, image, content
  const pageObj = (i) => 4 + i * 3;
  const imgObj = (i) => 5 + i * 3;
  const contentObj = (i) => 6 + i * 3;
  const total = 3 + N * 3;

  const kids = pages.map((_, i) => `${pageObj(i)} 0 R`).join(' ');
  objects[1] = { head: '<< /Type /Catalog /Pages 2 0 R >>' };
  objects[2] = { head: `<< /Type /Pages /Kids [${kids}] /Count ${N} >>` };
  objects[3] = { head: '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>' };

  const title = pdfString(meta.title || 'Tuton OS — BMP Studio');
  objects[1].head = `<< /Type /Catalog /Pages 2 0 R >>`;
  void title;

  pages.forEach((pg, i) => {
    const scale = Math.min(PW / pg.width, PH / pg.height, 1);
    const dw = Math.round(pg.width * scale), dh = Math.round(pg.height * scale);
    const dx = Math.round((PW - dw) / 2), dy = Math.round((PH - dh) / 2);
    objects[pageObj(i)] = { head: `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PW} ${PH}] /Resources << /XObject << /Im${i} ${imgObj(i)} 0 R >> /Font << /F1 3 0 R >> >> /Contents ${contentObj(i)} 0 R >>` };
    objects[imgObj(i)] = {
      head: `<< /Type /XObject /Subtype /Image /Width ${pg.width} /Height ${pg.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${pg.jpeg.length} >>\nstream`,
      body: pg.jpeg, tail: '\nendstream',
    };
    // content: gambar + invisible text layer
    const size = 10;
    const lines = wrapWords(pg.text, Math.max(20, Math.floor(dw / (size * 0.5))));
    const step = lines.length > 1 ? dh / lines.length : dh;
    let ops = `q\n${dw} 0 0 ${dh} ${dx} ${dy} cm\n/Im${i} Do\nQ\n`;
    if (lines.length) {
      ops += 'BT\n/F1 10 Tf\n3 Tr\n14.5 TL\n';
      lines.forEach((ln, li) => {
        const y = dy + dh - 12 - li * step;
        ops += `1 0 0 1 ${dx + 4} ${y.toFixed(1)} Tm\n${pdfString(ln)} Tj\nT*\n`;
      });
      ops += 'ET\n';
    }
    const bytes = te.encode(ops);
    objects[contentObj(i)] = { head: `<< /Length ${bytes.length} >>\nstream`, body: bytes, tail: '\nendstream' };
  });

  // info object (opsional, di akhir)
  const infoNum = total + 1;
  const expuls = [];
  const header = '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n';
  let offset = te.encode(header).length;
  const offsets = [0];
  for (let n = 1; n <= infoNum; n++) {
    const o = n === infoNum
      ? { head: `<< /Title ${pdfString(meta.title || 'Tuton OS')} /Creator ${pdfString('Tuton OS BMP Studio')} >>` }
      : objects[n];
    const head = `${n} 0 obj\n${o.head}\n`;
    const headB = te.encode(head);
    const bodyB = typeof o.body === 'string' ? te.encode(o.body) : (o.body || new Uint8Array(0));
    const tailB = te.encode((o.tail || '') + '\nendobj\n');
    offsets[n] = offset;
    expuls.push(headB, bodyB, tailB);
    offset += headB.length + bodyB.length + tailB.length;
  }
  const xrefPos = offset;
  let xref = `xref\n0 ${infoNum + 1}\n0000000000 65535 f \n`;
  for (let n = 1; n <= infoNum; n++) xref += `${String(offsets[n]).padStart(10, '0')} 00000 n \n`;
  xref += `trailer\n<< /Size ${infoNum + 1} /Root 1 0 R /Info ${infoNum} 0 R >>\nstartxref\n${xrefPos}\n%%EOF`;
  const xrefB = te.encode(xref);
  const totalLen = offset + xrefB.length;
  const out = new Uint8Array(totalLen);
  let p = 0;
  const put = (b) => { out.set(b, p); p += b.length; };
  put(te.encode(header));
  for (const b of expuls) put(b);
  put(xrefB);
  return out;
}
