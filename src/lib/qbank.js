// src/lib/qbank.js — Bank soal terenkripsi (WebCrypto AES-256-GCM, ESM).
// Format paket di Vercel/GitHub:
//   { "keyId": "k1", "paket": "STSI4202-uas", "nonce": "<base64>", "ciphertext": "<base64>" }
// Plaintext = JSON: { "paket": "...", "questions": [{id, modul, q, choices[], answer}] }
//   answer = index kunci jawaban (baru terlihat setelah dekripsi lokal).

const te = new TextEncoder();
const td = new TextDecoder();

export function b64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function bytesToB64(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

// rawKey: 32 byte (Uint8Array) dari admin key.
export async function importAdminKey(rawKey) {
  return crypto.subtle.importKey('raw', rawKey, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

export async function encryptPackage(obj, key, keyId = 'k1') {
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce, additionalData: te.encode(keyId) },
    key, te.encode(JSON.stringify(obj)),
  );
  return {
    keyId,
    paket: obj.paket || 'paket',
    nonce: bytesToB64(nonce),
    ciphertext: bytesToB64(new Uint8Array(ct)),
  };
}

export async function decryptPackage(pkg, key) {
  if (!pkg || !pkg.nonce || !pkg.ciphertext || !pkg.keyId) {
    throw new Error('Format paket soal tidak valid');
  }
  const pt = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: b64ToBytes(pkg.nonce), additionalData: te.encode(pkg.keyId) },
    key, b64ToBytes(pkg.ciphertext),
  );
  const obj = JSON.parse(td.decode(pt));
  if (!Array.isArray(obj.questions)) throw new Error('Paket tidak berisi questions[]');
  return obj;
}

export function shuffle(arr, rand = Math.random) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// answers: { [questionId]: choiceIndex }
export function gradeQuiz(questions, answers) {
  let correct = 0;
  const detail = questions.map((q) => {
    const got = answers[q.id];
    const ok = got === q.answer;
    if (ok) correct++;
    return { id: q.id, ok, got, expected: q.answer };
  });
  return {
    correct, wrong: questions.length - correct, total: questions.length,
    score: questions.length ? Math.round((correct / questions.length) * 100) : 0,
    detail,
  };
}

// Simulasi UAS: acak n soal dari semua modul.
export function buildSimulasi(questions, n = 30, rand = Math.random) {
  return shuffle(questions, rand).slice(0, n);
}
