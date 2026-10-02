import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const env = fs.readFileSync(path.join(root, 'router/.env'), 'utf8');
const g = (n) => (env.match(new RegExp('^\\s*' + n + '\\s*=\\s*(.*)$', 'm')) || [])[1] || '';
const base = (g('MODEL_API_URL') || '').replace(/\/+$/, '');
const key = g('MODEL_API_KEY');
const r = await fetch(`${base}/chat/completions`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
  body: JSON.stringify({ model: g('MODEL_NAME'), messages: [{ role: 'user', content: 'Sebutkan 3 langkah membuat PDF dari teks. Ringkas.' }], max_tokens: 200 }),
  signal: AbortSignal.timeout(90000),
});
const raw = await r.text();
console.log('=== PANJANG', raw.length, '| potongan baris:', raw.split('\n').length);
console.log(raw.slice(0, 1400));
console.log('...');
console.log('=== EKOR (400) ===');
console.log(raw.slice(-400));
