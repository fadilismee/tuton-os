// scripts/sysmsg-check.mjs — uji perilaku model untuk permintaan file:
//  (a) TANPA system message (perilaku lama)  (b) DENGAN system message Tuton OS,
// plus simulasi logika retry token klien (model reasoning menghabiskan max_tokens).
// Key dibaca dari router/.env — tidak pernah dicetak.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const env = fs.readFileSync(path.join(root, 'router/.env'), 'utf8');
const g = (n) => (env.match(new RegExp('^\\s*' + n + '\\s*=\\s*(.*)$', 'm')) || [])[1] || '';
const base = (g('MODEL_API_URL') || '').replace(/\/+$/, '');
const key = g('MODEL_API_KEY');
const model = g('MODEL_NAME');

const clientSrc = fs.readFileSync(path.join(root, 'src/ai/client.js'), 'utf8');
const m = clientSrc.match(/export const ASSIST_SYS = \[([\s\S]*?)\]\.join\('\\n'\);/);
const ASSIST_SYS = m[1].split('\n').map((l) => l.trim()).filter((l) => l.startsWith("'"))
  .map((l) => l.replace(/^'/, '').replace(/',?$/, '').replace(/\\'/g, "'")).join('\n');
console.log('[sys] system message:', ASSIST_SYS.length, 'char | model:', model);

// parseLooseJson + extractContent disalin dari client.js (perilaku sesudah patch).
function parseLooseJson(raw) {
  const t = String(raw || '').trim();
  try { return JSON.parse(t); } catch { /* lanjut */ }
  const chunks = [];
  for (const part of t.split('data:')) {
    const s = part.trim();
    if (!s || s === '[DONE]') continue;
    try { chunks.push(JSON.parse(s)); } catch { /* abaikan */ }
  }
  if (!chunks.length) throw new Error('Respons tidak bisa dibaca: ' + t.slice(0, 120));
  const merged = chunks[0];
  if (merged.choices) {
    const collect = (pick) => chunks.map((c) => (c.choices || []).map(pick).filter(Boolean).join('')).join('');
    const fromDelta = collect((ch) => ch.delta?.content);
    const fromMsg = collect((ch) => ch.message?.content);
    const text = fromMsg || fromDelta;
    if (text) merged.choices[0] = { ...merged.choices[0], message: { role: 'assistant', content: text } };
  }
  return merged;
}
const extractContent = (j) => j?.choices?.[0]?.message?.content || j?.choices?.[0]?.delta?.content || j?.choices?.[0]?.message?.reasoning || '';

async function ask(messages, maxTokens) {
  const r = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
    body: JSON.stringify({ model, messages, temperature: 0.6, max_tokens: maxTokens }),
    signal: AbortSignal.timeout(180000),
  });
  const raw = await r.text();
  const j = parseLooseJson(raw);
  return { content: extractContent(j), finish: j?.choices?.[0]?.finish_reason, usage: j?.usage?.completion_tokens, ok: r.ok, status: r.status };
}
const refuse = (t) => /tidak bisa|nggak bisa|ga bisa|gak bisa|tidak dapat|saya hanya|instal|install|pip\s|python|jalankan kode|menjalankan kode|pandoc|latexmk|script/i.test(String(t));

const ask_text = 'buatkan jawaban lengkap soal statistika (rata-rata, varians, uji hipotesis) pakai rumus, lalu jadiin PDF ya';

// (a) tanpa system message, mode "Cepat" 800 token (perilaku lama)
const a = await ask([{ role: 'user', content: ask_text + '\n\n[KECEPATAN: jawab CEPAT dan ringkas]' }], 800);
console.log('\n=== (a) TANPA system message, 800 token (perilaku lama) ===');
console.log('HTTP', a.status, '| finish_reason:', a.finish, '| completion_tokens:', a.usage, '| panjang jawaban:', a.content.length);
console.log('menolak/menyuruh run kode:', refuse(a.content) ? 'YA  <-- masalah user' : 'tidak');
console.log('cuplikan:', a.content.slice(0, 200).replace(/\n/g, ' '));

// (b) dengan system message + simulasi retry token (perilaku sesudah patch)
let b = await ask([{ role: 'system', content: ASSIST_SYS }, { role: 'user', content: ask_text + '\n\n[KECEPATAN: jawab CEPAT dan ringkas]' }], 800);
let retried = false;
if ((!b.content || b.finish === 'length') && 800 < 4000) {
  retried = true;
  const b2 = await ask([{ role: 'system', content: ASSIST_SYS }, { role: 'user', content: ask_text }], 4000);
  if (b2.content.length > b.content.length) b = b2;
}
console.log('\n=== (b) DENGAN system message + retry token besar ===');
console.log('HTTP', b.status, '| finish_reason:', b.finish, '| completion_tokens:', b.usage, '| panjang jawaban:', b.content.length, '| retry dipakai:', retried);
console.log('menolak/menyuruh run kode:', refuse(b.content) ? 'YA' : 'tidak');
console.log('ada LaTeX/blok rumus:', /\$\$|\\frac|\\sum|\\sqrt/.test(b.content) ? 'ya' : 'tidak');
console.log('menyebut tombol DOCX/PDF:', /docx|pdf|tombol|terunduh/i.test(b.content) ? 'ya' : 'tidak');
console.log('cuplikan (400):', b.content.slice(0, 400).replace(/\n/g, ' '));
