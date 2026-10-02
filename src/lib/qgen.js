// src/lib/qgen.js — Generator soal dari teks modul: AI + manual (offline).
// Prinsip user: pilih folder modul -> pilih jumlah + kesulitan -> AI (kalau ada
// token) atau manual (komputer lokal). Soal dienkripsi sisi client (AES-GCM,
// kunci perangkat di tuton_qkey), dirender ulang oleh extension sendiri.
// Modul sama -> paket sama dimunculkan lagi (cache by modKey+jumlah+diff+mode),
// isi "beda angka tapi kurang lebih sama" via RNG deterministik + varian angka.
import { encryptPackage, decryptPackage, importAdminKey } from './qbank.js';
import { load, save } from './store.js';

const te = new TextEncoder();

export const DIFFS = ['mudah', 'sedang', 'sulit', 'hots'];
export const COUNTS = [5, 10, 15, 20, 30];

// ---------- hash & normalisasi (dedup) ----------
export function normQ(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9\u00c0-\u024f\u1e00-\u1eff ]/gi, ' ').replace(/\s+/g, ' ').trim();
}

export async function sha256Hex(s) {
  const d = await crypto.subtle.digest('SHA-256', te.encode(String(s)));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function qHash(q) { return sha256Hex(normQ(q)); }

// ---------- RNG deterministik (modul sama -> soal mirip, angka bisa beda) ----------
function xfnv1a(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- kunci perangkat (enkripsi sisi client) ----------
async function deviceKey() {
  let rec = null;
  try { rec = await load('tuton_qkey', null); } catch { rec = null; }
  if (!rec?.b64) {
    const raw = crypto.getRandomValues(new Uint8Array(32));
    let s = '';
    for (const b of raw) s += String.fromCharCode(b);
    rec = { b64: btoa(s), createdAt: Date.now() };
    try { await save('tuton_qkey', rec); } catch { /* abaikan */ }
  }
  const bin = atob(rec.b64);
  const raw = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) raw[i] = bin.charCodeAt(i);
  return importAdminKey(raw);
}

export async function encQuestions(obj) {
  const key = await deviceKey();
  return encryptPackage(obj, key, 'q1');
}

export async function decQuestions(pkg) {
  const key = await deviceKey();
  return decryptPackage(pkg, key);
}

// ---------- ekstraksi kandidat (manual) ----------
const STOP = new Set(('yang,dan,atau,dengan,untuk,dari,pada,adalah,merupakan,ini,itu,dalam,sebagai,oleh,karena,serta,akan,telah,sudah,dapat,bisa,harus,setiap,antara,juga,lebih,kurang,sangat,para,nya,yaitu,yakni,terdiri,jika,maka,meski,namun,tetapi,serta,kepada,terhadap,hingga,sampai,kami,kita,mereka,beliau,tersebut,dimana,apabila,agar,supaya,yang,yaitu,the,and,for,with,from,that,this,are,was,were,have,has,akan').split(','));

function sentencesOf(text) {
  return String(text || '')
    .replace(/\[(hal|halaman)[^\]]*\]/gi, ' ')
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+(?=[A-Z0-9"])/)
    .map((s) => s.trim())
    .filter((s) => s.replace(/\s/g, '').length >= 30 && s.length <= 320);
}

function scoreSent(s) {
  const x = s.toLowerCase();
  let sc = 0;
  if (/adalah|merupakan|disebut|didefinisikan|diartikan/.test(x)) sc += 3;
  if (/terdiri dari|meliputi|mencakup|tahapan|jenis|macam|fungsi|tujuan|manfaat|prinsip|ciri/.test(x)) sc += 2;
  if (/\d/.test(x)) sc += 1;
  if (/rumus|persamaan|=|%/.test(x)) sc += 1;
  if (s.length > 60 && s.length < 220) sc += 1;
  return sc;
}

function keywordsOf(sents, top = 60) {
  const freq = new Map();
  for (const s of sents) {
    for (const w of s.replace(/[^A-Za-z\u00c0-\u024f\u1e00-\u1eff0-9\- ]/g, ' ').split(/\s+/)) {
      const t = w.trim();
      if (t.length < 5 || STOP.has(t.toLowerCase())) continue;
      freq.set(t, (freq.get(t) || 0) + 1);
    }
  }
  return [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, top).map(([w]) => w);
}

function pickAnswerWord(sent, rng) {
  const cands = sent.replace(/[^A-Za-z\u00c0-\u024f\u1e00-\u1eff0-9\- ]/g, ' ').split(/\s+/)
    .filter((w) => w.length >= 5 && !STOP.has(w.toLowerCase()));
  if (!cands.length) return null;
  cands.sort((a, b) => b.length - a.length);
  const pool = cands.slice(0, Math.min(4, cands.length));
  return pool[Math.floor(rng() * pool.length)];
}

function varyNumbers(sent, rng) {
  // "beda angka tapi kurang lebih sama": geser angka 10-30%.
  return sent.replace(/\d+([.,]\d+)?/g, (m) => {
    const v = parseFloat(m.replace(',', '.'));
    if (!Number.isFinite(v)) return m;
    const f = 1 + ((rng() - 0.5) * 0.4);
    const nv = Math.max(1, Math.round(v * f));
    return String(nv);
  });
}

function distractors(answer, keywords, rng, diff, n = 3) {
  const pool = keywords.filter((k) => k.toLowerCase() !== String(answer).toLowerCase());
  let cand = pool;
  if (diff === 'sedang') {
    const L = String(answer).length;
    const same = pool.filter((k) => Math.abs(k.length - L) <= 2);
    if (same.length >= n) cand = same;
  } else if (diff === 'sulit' || diff === 'hots') {
    const first = String(answer)[0]?.toLowerCase();
    const same = pool.filter((k) => k[0]?.toLowerCase() === first);
    if (same.length >= n) cand = same;
  }
  const out = [];
  const cp = cand.slice();
  while (out.length < n && cp.length) out.push(cp.splice(Math.floor(rng() * cp.length), 1)[0]);
  while (out.length < n && pool.length) {
    const w = pool[Math.floor(rng() * pool.length)];
    if (!out.includes(w) && w.toLowerCase() !== String(answer).toLowerCase()) out.push(w);
    else break;
  }
  return out.slice(0, n);
}

/**
 * Generator manual deterministik (offline, tanpa AI).
 * @returns [{id,q,choices[4],answer,bahas,modul,diff,auto:true}]
 */
export function manualGen({ text, modKey = 'M', modul = 1, count = 10, diff = 'sedang', seedSalt = '' }) {
  const sents = sentencesOf(text).map((s) => ({ s, sc: scoreSent(s) })).sort((a, b) => b.sc - a.sc);
  if (!sents.length) throw new Error('Teks modul terlalu pendek / tidak terbaca — coba PDF lain.');
  const top = sents.slice(0, Math.max(12, count * 3));
  const keywords = keywordsOf(sents.map((x) => x.s), 60);
  const rng = mulberry32(xfnv1a(`${modKey}|${diff}|${seedSalt}|${String(text).length}`));
  const qs = [];
  let i = 0;
  let guard = 0;
  while (qs.length < count && guard++ < count * 12) {
    const base = top[(i++) % top.length].s;
    const sent = diff === 'sulit' || diff === 'hots' ? varyNumbers(base, rng) : base;
    const ans = pickAnswerWord(sent, rng);
    if (!ans) continue;
    const ds = distractors(ans, keywords, rng, diff, 3);
    if (ds.length < 3) continue;
    const stemModes = [
      `Berdasarkan materi, manakah pernyataan yang TEPAT tentang "${ans}"?`,
      `Perhatikan uraian berikut: "${sent.slice(0, 160)}…" — kata yang tepat untuk melengkapi konsep tersebut adalah?`,
      `Manakah yang paling sesuai dengan konsep "${ans}" pada modul ini?`,
    ];
    let q, choices, answer, bahas;
    if (diff === 'hots' && top.length > 1) {
      const other = top[Math.floor(rng() * top.length)].s.slice(0, 120);
      q = `Analisis: "${sent.slice(0, 120)}…" dihubungkan dengan "${other}…" — simpulan yang TEPAT adalah?`;
      choices = [ans, ...ds];
      bahas = `Jawaban "${ans}" merangkum kedua uraian di atas.`;
    } else {
      q = stemModes[Math.floor(rng() * stemModes.length)];
      // Benamkan jawaban benar sebagai opsi parafrase kalimat + 3 pengecoh kata kunci.
      const correct = sent.length <= 140 ? sent : sent.slice(0, 140) + '…';
      choices = [correct, ...ds.map((d) => `${d} — bukan konsep yang dimaksud pada uraian ini`)];
      bahas = `Kunci: "${ans}". Acuan: ${sent.slice(0, 160)}`;
    }
    // Acak posisi kunci dengan RNG deterministik.
    const order = [0, 1, 2, 3].sort(() => rng() - 0.5);
    const ordered = order.map((k) => (k === 0 ? choices[0] : choices[k]));
    // Untuk mode definisi, choices[0] = kalimat benar; petakan ulang:
    const full = [choices[0], choices[1], choices[2], choices[3]];
    const shuffled = full.map((_, idx) => full[order[idx]]);
    answer = order.indexOf(0);
    qs.push({
      id: `${modKey}-${diff}-${qs.length + 1}`,
      modul, q, choices: shuffled, answer, bahas,
      diff, auto: true,
    });
    void ordered;
  }
  if (!qs.length) throw new Error('Gagal menyusun soal manual dari teks ini.');
  return qs.slice(0, count);
}

// ---------- nama paket & dedup ----------
export function pkgName(modKey, count, diff, mode) {
  return `${modKey}-Q${count}-${diff}-${mode}`;
}

export async function filterNew(questions, seenHashes = []) {
  const seen = new Set(seenHashes);
  const out = [];
  for (const q of questions) {
    const h = await qHash(q.q);
    if (!seen.has(h)) { seen.add(h); out.push({ ...q, _h: h }); }
  }
  return out;
}
