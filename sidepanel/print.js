// sidepanel/print.js — halaman cetak extension (A4 siap Ctrl+P -> Simpan sebagai PDF).
// Dipakai sebagai fallback bila Tuton Runtime/Word tidak tersedia: rumus tetap
// dirender KaTeX lokal, jadi tidak ada rumus yang jadi teks mentah.
import { bodyHtml, collectTex } from '../src/export/printdoc.js';
import { takePrint } from '../src/export/pending.js';

(async () => {
  const hint = document.querySelector('#hint');
  const bodyEl = document.querySelector('#body');
  const job = await takePrint();
  if (!job?.markdown) {
    bodyEl.innerHTML = '<p class="err">Tidak ada dokumen untuk dicetak (job kosong / sudah dipakai). Kembali ke panel Tuton OS lalu klik PDF lagi.</p>';
    hint.textContent = '';
    return;
  }
  const d = job.doc || {};
  document.title = job.title || d.label || d.title || 'Jawaban';
  const label = d.label || [d.tugas && `Tugas ${String(d.tugas).replace(/^tugas\s*/i, '')}`, d.sesi && `Sesi ${String(d.sesi).replace(/^sesi\s*/i, '')}`, d.course || d.matkul].filter(Boolean).join(' - ');
  document.querySelector('#course').textContent = label ? `JAWABAN ${label}` : 'JAWABAN';
  document.querySelector('#meta').textContent = `Nama: ${d.nama || '—'}  |  NIM: ${d.nim || '—'}`;

  const html = bodyHtml(job.markdown);
  bodyEl.innerHTML = html;

  const total = collectTex(html).length;
  let ok = 0;
  const bad = [];
  for (const el of document.querySelectorAll('[data-tex]')) {
    const t = el.getAttribute('data-tex');
    try {
      katex.render(t, el, { displayMode: el.hasAttribute('data-display'), throwOnError: true });
      ok++;
    } catch (e) {
      el.textContent = t;
      bad.push(t);
    }
  }
  hint.textContent = bad.length
    ? `${ok}/${total} rumus ter-render; ${bad.length} gagal (tampil sebagai teks): ${bad.slice(0, 2).join(' ; ')}`
    : `Tekan Ctrl+P lalu pilih "Simpan sebagai PDF" — ${ok} rumus sudah rapi.`;
  setTimeout(() => { try { window.focus(); window.print(); } catch (e) { /* user klik manual */ } }, 700);
})();
