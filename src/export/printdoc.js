// src/export/printdoc.js — markdown -> HTML dokumen cetak (A4).
// Murni (tanpa DOM) supaya bisa diuji di Node dan dipakai halaman cetak.
// Rumus keluar sebagai <span data-tex> / <div class="eq" data-tex> untuk
// dirender KaTeX di halaman cetak (jadi tidak ada rumus jadi teks mentah).
import { parseBlocks } from './mdblocks.js';

export const escHtml = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export const inlineHtml = (runs) => (runs || []).map((r) => {
  if (r.math) return r.display
    ? `<span class="eq" data-tex="${escHtml(r.math)}" data-display="1"></span>`
    : `<span data-tex="${escHtml(r.math)}"></span>`;
  let t = escHtml(r.text);
  if (r.mono) return `<code>${t}</code>`;
  if (r.bold) t = `<strong>${t}</strong>`;
  if (r.italic) t = `<em>${t}</em>`;
  return t;
}).join('');

/** Markdown -> HTML badan dokumen (heading/paragraf/list/tabel/kode/rumus). */
export function bodyHtml(md) {
  return parseBlocks(md).map((b) => {
    if (b.type === 'heading') { const lv = Math.min(b.level + 1, 4); return `<h${lv}>${inlineHtml(b.inline)}</h${lv}>`; }
    if (b.type === 'para') return `<p>${inlineHtml(b.inline)}</p>`;
    if (b.type === 'hr') return '<hr>';
    if (b.type === 'math') return `<div class="eq" data-tex="${escHtml(b.tex)}" data-display="1"></div>`;
    if (b.type === 'code') return `<pre><code>${escHtml(b.code)}</code></pre>`;
    if (b.type === 'list') return `<${b.ordered ? 'ol' : 'ul'}>${b.items.map((it) => `<li>${inlineHtml(it)}</li>`).join('')}</${b.ordered ? 'ol' : 'ul'}>`;
    if (b.type === 'table') {
      const head = `<tr>${(b.header || []).map((c) => `<th>${inlineHtml(c)}</th>`).join('')}</tr>`;
      const rows = (b.rows || []).map((r) => `<tr>${r.map((c) => `<td>${inlineHtml(c)}</td>`).join('')}</tr>`).join('');
      return `<table>${head}${rows}</table>`;
    }
    return '';
  }).join('\n');
}

/** Daftar LaTeX di dalam HTML badan (untuk verifikasi render KaTeX). */
export function collectTex(html) {
  return [...String(html).matchAll(/data-tex="([^"]*)"/g)].map((m) => m[1]
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'));
}