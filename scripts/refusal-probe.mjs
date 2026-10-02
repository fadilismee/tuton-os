// scripts/refusal-probe.mjs — uji hipotesis: apakah (a) system message cukup, dan
// (b) riwayat chat lama berisi penolakan membuat model menolak lagi.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const env = fs.readFileSync(path.join(root, 'router/.env'), 'utf8');
const g = (n) => (env.match(new RegExp('^\\s*' + n + '\\s*=\\s*(.*)$', 'm')) || [])[1] || '';
const base = (g('MODEL_API_URL') || '').replace(/\/+$/, '');
const key = g('MODEL_API_KEY');
const model = g('MODEL_NAME');

const src = fs.readFileSync(path.join(root, 'src/ai/client.js'), 'utf8');
const m = src.match(/export const ASSIST_SYS = \[([\s\S]*?)\]\.join\('\\n'\);/);
const ASSIST_SYS = m[1].split('\n').map((l) => l.trim()).filter((l) => l.startsWith("'"))
  .map((l) => l.replace(/^'/, '').replace(/',?$/, '').replace(/\\'/g, "'")).join('\n');

const ask = async (messages, maxTokens = 4000) => {
  const r = await fetch(`${base}/chat/completions`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
    body: JSON.stringify({ model, messages, temperature: 0.6, max_tokens: maxTokens }),
    signal: AbortSignal.timeout(180000),
  });
  const raw = await r.text();
  let j;
  try { j = JSON.parse(raw.trim()); } catch {
    const parts = raw.split('data:').map((s) => s.trim()).filter((s) => s && s !== '[DONE]');
    j = JSON.parse(parts[0]);
  }
  return { c: j?.choices?.[0]?.message?.content || '', finish: j?.choices?.[0]?.finish_reason, reason: j?.usage?.completion_tokens_details?.reasoning_tokens };
};
const refuses = (t) => /tidak bisa|nggak bisa|ga bisa|gak bisa|tidak dapat|tidak mampu|saya hanya|maaf,? saya|instal|pip |python|pandoc|script|jalankan/i.test(t);

const Q = 'kamu bisa bikin file PDF ga? aku butuh file jawabannya sekarang';

// (a) system message + permintaan polos
const a = await ask([{ role: 'system', content: ASSIST_SYS }, { role: 'user', content: Q }]);
console.log('=== (a) sys + permintaan polos ===');
console.log('finish:', a.finish, '| reasoning_tokens:', a.reason, '| panjang:', a.c.length, '| MENOLAK:', refuses(a.c) ? 'YA' : 'tidak');
console.log(a.c.slice(0, 260).replace(/\n/g, ' '));

// (b) riwayat lama berisi penolakan model sendiri
const hist = [
  { role: 'system', content: ASSIST_SYS },
  { role: 'user', content: 'jadiin jawaban ini pdf' },
  { role: 'assistant', content: 'Maaf, saya tidak bisa membuat atau mengirim file PDF. Saya hanya bisa memberikan teks. Silakan jalankan kode Python sendiri untuk membuat PDF.' },
  { role: 'user', content: Q },
];
const b = await ask(hist);
console.log('\n=== (b) riwayat berisi penolakan lama ===');
console.log('finish:', b.finish, '| reasoning_tokens:', b.reason, '| panjang:', b.c.length, '| MENOLAK:', refuses(b.c) ? 'YA' : 'tidak');
console.log(b.c.slice(0, 260).replace(/\n/g, ' '));

// (c) riwayat lama + penegasan tegas di pesan user terakhir
const c = await ask([...hist.slice(0, 3), { role: 'user', content: Q + '\n\n[PENTING: ekspor file ditangani aplikasi Tuton OS, BUKAN olehmu. Tombol DOCX/PDF ada di bawah jawabanmu. Jangan menolak, jangan menyuruh user menjalankan kode.]' }]);
console.log('\n=== (c) riwayat lama + penegasan tegas ===');
console.log('finish:', c.finish, '| reasoning_tokens:', c.reason, '| panjang:', c.c.length, '| MENOLAK:', refuses(c.c) ? 'YA' : 'tidak');
console.log(c.c.slice(0, 260).replace(/\n/g, ' '));
