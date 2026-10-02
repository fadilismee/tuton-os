// src/export/docx.js — Markdown -> .docx memakai template/template.docx sebagai
// basis (font, gaya Title/Subtitle, warna, ukuran halaman ikut template).
// Rumus LaTeX jadi persamaan Word ASLI (OMML), bukan gambar/teks mentah.
// Nol dependensi: ZIP sendiri (zip.js) + KaTeX/mathml2omml vendor (latex.js).
import { unzip, zip } from './zip.js';
import { parseBlocks } from './mdblocks.js';
import { latexToOmml } from './latex.js';

const X = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');

// Style teks inline dari template.
const RPR = {
  title: '<w:rFonts w:ascii="Plus Jakarta Sans" w:cs="Plus Jakarta Sans" w:eastAsia="Plus Jakarta Sans" w:hAnsi="Plus Jakarta Sans"/><w:b w:val="1"/><w:bCs w:val="1"/><w:color w:val="0f172a"/><w:sz w:val="36"/><w:szCs w:val="36"/>',
  subtitle: '<w:rFonts w:ascii="Roboto" w:cs="Roboto" w:eastAsia="Roboto" w:hAnsi="Roboto"/><w:color w:val="475569"/><w:sz w:val="22"/><w:szCs w:val="22"/>',
  bold: '<w:b w:val="1"/><w:bCs w:val="1"/>',
  italic: '<w:i w:val="1"/><w:iCs w:val="1"/>',
  mono: '<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:cs="Consolas"/><w:color w:val="0f172a"/>',
};

const runXml = (text, { bold, italic, mono } = {}, extraRpr = '') => {
  if (text === '' || text == null) return '';
  const rPr = [extraRpr, mono ? RPR.mono : '', bold ? RPR.bold : '', italic ? RPR.italic : ''].filter(Boolean).join('');
  return `<w:r>${rPr ? `<w:rPr>${rPr}</w:rPr>` : ''}<w:t xml:space="preserve">${X(text)}</w:t></w:r>`;
};

/** Inline runs -> XML. Rumus inline jadi <m:oMath> (persamaan Word asli). */
function inlineXml(runs) {
  let out = '';
  for (const r of runs || []) {
    if (r.math) {
      const omml = latexToOmml(r.math, false);
      if (omml) { out += omml; continue; }
      out += runXml(r.text || `$${r.math}$`, { italic: true });
      continue;
    }
    out += runXml(r.text, r);
  }
  return out;
}

function paraXml(innerXml, pPrInner = '') {
  return `<w:p>${pPrInner ? `<w:pPr>${pPrInner}</w:pPr>` : ''}${innerXml}</w:p>`;
}

const defParaPr = '<w:spacing w:after="160" w:lineRule="auto"/><w:jc w:val="both"/>';

/**
 * Blok -> XML paragraf/tabel. Async + jeda tiap beberapa blok supaya panel
 * tidak freeze saat dokumen panjang (konversi OMML memang sinkron & berat).
 */
async function blocksXml(blocks, doc = {}) {
  const parts = [];
  // Kop ala tugas tutor: "JAWABAN Tugas 1 Sesi 3 - Bahasa Indonesia" + Nama/NIM.
  // doc.label diisi docLabel() (src/export/index.js) supaya kop Word dan nama
  // file selalu sama.
  const course = (doc.label || '').trim()
    || [doc.tugas && `Tugas ${String(doc.tugas).replace(/^tugas\s*/i, '')}`, doc.sesi && `Sesi ${String(doc.sesi).replace(/^sesi\s*/i, '')}`, doc.course].filter(Boolean).join(' - ')
    || 'Nama Matkul (Code matkul)';
  const titleInner = runXml('JAWABAN ', {}, RPR.title) + runXml(course, {}, RPR.title);
  parts.push(
    `<w:p><w:pPr><w:pStyle w:val="Title"/><w:spacing w:after="240" w:before="240" w:lineRule="auto"/><w:jc w:val="center"/></w:pPr>${titleInner}</w:p>`,
  );
  const nama = (doc.nama || '').trim() || '—';
  const nim = (doc.nim || '').trim() || '—';
  const subInner = runXml(`Nama: ${nama}  |  NIM: ${nim}`, {}, RPR.subtitle);
  parts.push(`<w:p><w:pPr><w:spacing w:after="360" w:before="0" w:lineRule="auto"/><w:jc w:val="center"/></w:pPr>${subInner}</w:p>`);

  let seen = 0;
  for (const b of blocks) {
    // Beri napas ke UI: 4 blok sekali.
    if (++seen % 4 === 0) await new Promise((r) => setTimeout(r, 0));
    if (b.type === 'heading') {
      const lvl = Math.min(Math.max(b.level, 1), 6);
      parts.push(paraXml(inlineXml(b.inline), `<w:pStyle w:val="Heading${lvl}"/><w:spacing w:before="260" w:after="120" w:lineRule="auto"/>`));
    } else if (b.type === 'para') {
      parts.push(paraXml(inlineXml(b.inline), defParaPr));
    } else if (b.type === 'hr') {
      parts.push(paraXml('', '<w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="CBD5E1"/></w:pBdr><w:spacing w:after="200"/>'));
    } else if (b.type === 'math') {
      const omml = latexToOmml(b.tex, true);
      if (omml) {
        const inner = omml.replace(/^<m:oMath[^>]*>/, '').replace(/<\/m:oMath>$/, '');
        parts.push(`<w:p><w:pPr><w:spacing w:before="120" w:after="160"/><w:jc w:val="center"/></w:pPr><m:oMathPara><m:oMathParaPr><m:jc m:val="center"/></m:oMathParaPr><m:oMath>${inner}</m:oMath></m:oMathPara></w:p>`);
      } else {
        parts.push(paraXml(runXml(b.tex, { italic: true, mono: true }), '<w:spacing w:before="120" w:after="160"/><w:jc w:val="center"/>'));
      }
    } else if (b.type === 'code') {
      const lines = String(b.code || '').split('\n').map((l) => X(l)).join('<w:br/>');
      parts.push(`<w:p><w:pPr><w:shd w:val="clear" w:color="auto" w:fill="F1F5F9"/><w:spacing w:before="120" w:after="160"/><w:ind w:left="200" w:right="200"/></w:pPr><w:r><w:rPr>${RPR.mono}<w:sz w:val="20"/></w:rPr><w:t xml:space="preserve">${lines}</w:t></w:r></w:p>`);
    } else if (b.type === 'list') {
      b.items.forEach((it, n) => {
        const mark = b.ordered ? `${n + 1}. ` : '• ';
        parts.push(paraXml(inlineXml([{ text: mark }, ...it]), '<w:spacing w:after="80" w:lineRule="auto"/><w:ind w:left="420" w:hanging="240"/>'));
      });
    } else if (b.type === 'table') {
      const cols = Math.max(1, b.header?.length || 1);
      const total = 9029; // 11909 - 2*1440 (twips)
      const w = Math.floor(total / cols);
      const cell = (runs, head) => `<w:tc><w:tcPr><w:tcW w:w="${w}" w:type="dxa"/>${head ? '<w:shd w:val="clear" w:color="auto" w:fill="F1F5F9"/>' : ''}<w:vAlign w:val="center"/></w:tcPr>${paraXml(inlineXml((runs || []).map((r) => (head ? { ...r, bold: true } : r))), '<w:spacing w:after="40" w:before="40" w:lineRule="auto"/>')}</w:tc>`;
      const borders = ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map((k) => `<w:${k} w:val="single" w:sz="6" w:space="0" w:color="CBD5E1"/>`).join('');
      const grid = Array.from({ length: cols }, () => `<w:gridCol w:w="${w}"/>`).join('');
      const rows = [b.header, ...b.rows].map((r, ri) => `<w:tr>${cell(r, ri === 0)}</w:tr>`).join('');
      parts.push(`<w:tbl><w:tblPr><w:tblW w:w="${total}" w:type="dxa"/><w:tblBorders>${borders}</w:tblBorders><w:tblCellMar><w:top w:w="60" w:type="dxa"/><w:left w:w="100" w:type="dxa"/><w:bottom w:w="60" w:type="dxa"/><w:right w:w="100" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid>${grid}</w:tblGrid>${rows}</w:tbl>${paraXml('', '<w:spacing w:after="120"/>')}`);
    }
  }
  return parts.join('');
}

/**
 * Bangun .docx dari markdown.
 * @param {{markdown:string, doc?:{course?:string,nama?:string,nim?:string}, templateBytes:Uint8Array}} opts
 * @returns {Promise<Uint8Array>}
 */
export async function buildDocx({ markdown, doc = {}, templateBytes }) {
  if (!templateBytes?.length) throw new Error('template.docx tidak terbaca (cek folder template/).');
  const parts = await unzip(templateBytes);
  const docXml = new TextDecoder('utf-8').decode(parts.get('word/document.xml') || new Uint8Array());
  const sect = (docXml.match(/<w:sectPr[\s\S]*?<\/w:sectPr>/) || [''])[0];
  const bodyInner = await blocksXml(parseBlocks(markdown || ''), doc);

  // Header XML diambil dari dokumen asal supaya semua namespace ikut.
  const head = docXml.slice(0, docXml.indexOf('<w:body>') + '<w:body>'.length);
  const newXml = `${head}${bodyInner}${sect}</w:body></w:document>`;

  const files = [];
  for (const [name, bytes] of parts) {
    files.push([name, name === 'word/document.xml' ? newXml : bytes]);
  }
  if (!files.some(([n]) => n === 'word/document.xml')) throw new Error('template.docx tanpa word/document.xml');
  return await zip(files);
}