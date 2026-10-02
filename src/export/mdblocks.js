// src/export/mdblocks.js — Markdown -> blok terstruktur (tanpa dependensi).
// Dipakai oleh exporter DOCX & PDF. Rumus dipertahankan utuh sebagai LaTeX
// supaya bisa jadi OMML (Word) / dirender KaTeX (PDF).
//
// Blok: {type:'heading',level,inline} | {type:'para',inline}
//       {type:'list',ordered,items:[inline]} | {type:'table',header,rows}
//       {type:'code',lang,code} | {type:'math',tex} | {type:'hr'}
// Run inline: {text,bold,italic,mono,math?}

const MATH_RE = /(\$\$[\s\S]+?\$\$|\$[^$\n]+?\$)/g;

/** Inline: rumus $...$ + **bold** + *italic* + `kode`. */
export function parseInline(src) {
  const runs = [];
  const pushText = (text, bold, italic, mono) => {
    if (!text) return;
    runs.push({ text, bold: !!bold, italic: !!italic, mono: !!mono });
  };
  const parts = String(src ?? '').split(MATH_RE);
  for (const part of parts) {
    if (!part) continue;
    const blk = part.match(/^\$\$([\s\S]+?)\$\$$/);
    const inl = !blk && part.match(/^\$([^$\n]+?)\$$/);
    if (blk || inl) {
      runs.push({ text: '', math: (blk ? blk[1] : inl[1]).trim(), display: !!blk });
      continue;
    }
    // Teks biasa: pecah bold/italic/mono.
    const re = /(\*\*[^*]+\*\*|`[^`\n]+`|(^|\W)\*[^*\n]+\*(?=\W|$))/g;
    let last = 0;
    let m;
    while ((m = re.exec(part))) {
      pushText(part.slice(last, m.index));
      const tok = m[0];
      if (tok.startsWith('**')) pushText(tok.slice(2, -2), true);
      else if (tok.startsWith('`')) pushText(tok.slice(1, -1), false, false, true);
      else pushText(tok.replace(/^(\W?)\*|\*$/g, '$1'), false, true);
      last = m.index + tok.length;
    }
    pushText(part.slice(last));
  }
  // Gabung run teks berurutan dengan format sama.
  const merged = [];
  for (const r of runs) {
    const prev = merged[merged.length - 1];
    if (prev && !prev.math && !r.math && prev.bold === r.bold && prev.italic === r.italic && prev.mono === r.mono) prev.text += r.text;
    else merged.push({ ...r });
  }
  return merged;
}

/** Markdown -> daftar blok. */
export function parseBlocks(md) {
  const blocks = [];
  const lines = String(md ?? '').replace(/\r\n?/g, '\n').split('\n');
  let i = 0;
  const isTableRow = (s) => /^\s*\|.*\|\s*$/.test(s);
  const isTableSep = (s) => /^\s*\|[\s:|-]+\|\s*$/.test(s);
  while (i < lines.length) {
    const ln = lines[i];
    if (!ln.trim()) { i++; continue; }
    // Blok kode
    if (/^\s*```/.test(ln)) {
      const lang = (ln.match(/^\s*```(\w*)/) || [])[1] || '';
      const buf = [];
      i++;
      while (i < lines.length && !/^\s*```/.test(lines[i])) buf.push(lines[i++]);
      i++;
      blocks.push({ type: 'code', lang, code: buf.join('\n') });
      continue;
    }
    // Rumus blok: $$...$$ satu baris atau multi-baris
    if (/^\s*\$\$/.test(ln)) {
      const one = ln.match(/^\s*\$\$([\s\S]+?)\$\$\s*$/);
      if (one) { blocks.push({ type: 'math', tex: one[1].trim() }); i++; continue; }
      const buf = [ln.replace(/^\s*\$\$/, '')];
      i++;
      while (i < lines.length && !/\$\$\s*$/.test(lines[i])) buf.push(lines[i++]);
      if (i < lines.length) buf.push(lines[i].replace(/\$\$\s*$/, ''));
      i++;
      blocks.push({ type: 'math', tex: buf.join('\n').trim() });
      continue;
    }
    // Judul
    const hM = ln.match(/^(#{1,6})\s+(.*)$/);
    if (hM) { blocks.push({ type: 'heading', level: hM[1].length, inline: parseInline(hM[2]) }); i++; continue; }
    // Garis pemisah
    if (/^\s*([-*_])\1{2,}\s*$/.test(ln)) { blocks.push({ type: 'hr' }); i++; continue; }
    // Tabel
    if (isTableRow(ln) && i + 1 < lines.length && isTableSep(lines[i + 1])) {
      const cells = (s) => s.trim().replace(/^\||\|$/g, '').split('|').map((c) => parseInline(c.trim()));
      const header = cells(ln);
      i += 2;
      const rows = [];
      while (i < lines.length && isTableRow(lines[i])) rows.push(cells(lines[i++]));
      blocks.push({ type: 'table', header, rows });
      continue;
    }
    // List
    const liM = ln.match(/^\s*([-*+]|\d+[.)])\s+(.*)$/);
    if (liM) {
      const ordered = /\d/.test(liM[1]);
      const items = [];
      while (i < lines.length) {
        const m = lines[i].match(/^\s*([-*+]|\d+[.)])\s+(.*)$/);
        if (!m) break;
        items.push(parseInline(m[2]));
        i++;
      }
      blocks.push({ type: 'list', ordered, items });
      continue;
    }
    // Paragraf (gabung sampai baris kosong / awal blok lain)
    const buf = [ln];
    i++;
    while (i < lines.length) {
      const t = lines[i];
      if (!t.trim()) break;
      if (/^\s*(```|\$\$|#{1,6}\s)/.test(t)) break;
      if (/^\s*([-*+]|\d+[.)])\s+/.test(t)) break;
      if (isTableRow(t) && i + 1 < lines.length && isTableSep(lines[i + 1])) break;
      buf.push(t);
      i++;
    }
    blocks.push({ type: 'para', inline: parseInline(buf.join(' ')) });
  }
  return blocks;
}

/** Teks polos dari blok (buat fallback PDF / pratinjau). */
export function blocksToText(blocks) {
  const inlineText = (runs) => runs.map((r) => (r.math ? `$${r.math}$` : r.text)).join('');
  return blocks
    .map((b) => {
      if (b.type === 'heading') return '#'.repeat(b.level) + ' ' + inlineText(b.inline);
      if (b.type === 'para') return inlineText(b.inline);
      if (b.type === 'math') return `$$${b.tex}$$`;
      if (b.type === 'code') return '```' + b.lang + '\n' + b.code + '\n```';
      if (b.type === 'list') return b.items.map((it, n) => (b.ordered ? `${n + 1}. ` : '- ') + inlineText(it)).join('\n');
      if (b.type === 'table') return [b.header, ...b.rows].map((r) => '| ' + r.map(inlineText).join(' | ') + ' |').join('\n');
      return '---';
    })
    .join('\n\n');
}

/** Judul dokumen: heading pertama, atau baris pertama. */
export function guessTitle(md, fallback = 'Jawaban') {
  const first = String(md || '').split('\n').map((s) => s.trim()).find(Boolean) || '';
  return first.replace(/^#{1,6}\s*/, '').replace(/[*`$]/g, '').slice(0, 90) || fallback;
}
