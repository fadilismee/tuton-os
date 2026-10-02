// src/ai/client.js — Klien AI Tuton OS (multi-provider, OpenAI-compatible).
// Provider: '9router' | 'openai' | 'anthropic' | 'custom' | 'router' | 'auto'.
// - 9router: OpenAI-compatible di http://127.0.0.1:20128/v1, model default
//   nura/muse-spark-1.3, key dari key.local.js (gitignored) / Setting.
// - openai: https://api.openai.com/v1 (atau base custom), key user.
// - anthropic: https://api.anthropic.com/v1 (messages API, header
//   x-api-key + anthropic-version; key user).
// - custom: endpoint OpenAI-compatible bebas (URL + key user).
// - router: router tuton lokal (POST {routerUrl}/api/process, blueprint §1).
// - auto: 9router/openai/anthropic/custom dulu, gagal -> router tuton.
//
// Catatan 9router (hasil diagnosis 30 Sep 2026, JANGAN diubah tanpa verifikasi ulang):
// - GET /v1/models TANPA auth -> 200 (publik, dipakai untuk health-check).
// - GET /v1/models DENGAN auth -> 200. POST /chat/completions WAJIB auth.
// - key di key.local.js VALID (POST dgn key -> 200). 401 = key salah/kosong,
//   BUKAN server mati. Jangan fallback diam-diam saat 401/403: user harus
//   tahu key-nya yang ditolak.
// - Respons kadang SSE (data: {...} data: [DONE]) walau tanpa stream:true,
//   kadang JSON polos + suffix "data: [DONE]". parseLooseJson menangani keduanya.
// - max_tokens KECIL (mis. 20) bisa bikin content KOSONG + finish_reason=length.
//   Default chat 2000 agar jawaban tidak kepotong.
export const PROVIDERS = {
  '9router': { label: '9router lokal', kind: 'openai', base: 'http://127.0.0.1:20128/v1', model: 'nura/muse-spark-1.3' },
  openai: { label: 'OpenAI', kind: 'openai', base: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  anthropic: { label: 'Anthropic', kind: 'anthropic', base: 'https://api.anthropic.com/v1', model: 'claude-3-5-haiku-latest' },
  custom: { label: 'Custom (OpenAI-compatible)', kind: 'openai', base: '', model: '' },
  router: { label: 'Router tuton lokal', kind: 'router', base: '', model: '' },
  auto: { label: 'Auto (utama → router tuton)', kind: 'auto', base: '', model: '' },
};

// Base gateway OpenAI-compatible milikmu (bisa juga diisi dari Setting).
export const NINE_BASE = 'http://127.0.0.1:20128/v1';
export const NINE_MODEL = 'nura/muse-spark-1.3';
export const ANTHROPIC_VERSION = '2023-06-01';

export function defaultAIConfig() {
  return { provider: '9router', baseUrl: NINE_BASE, model: NINE_MODEL, apiKey: '', chatPath: '/chat/completions', modelsPath: '/models', routerUrl: 'http://127.0.0.1:3721', runtimeToken: '', maxTokens: 2000, aiDepth: 'cepat' };
}

// Key lokal (opsional): dibaca dari key.local.js yang TIDAK di-commit.
let _localKey = null;
let _localKeyTried = false;
async function localKey() {
  if (_localKeyTried) return _localKey;
  _localKeyTried = true;
  try {
    const m = await import('./key.local.js');
    _localKey = { baseUrl: m.LOCAL_9R_BASE, model: m.LOCAL_9R_MODEL, apiKey: m.LOCAL_API_KEY };
  } catch { _localKey = null; }
  return _localKey;
}

export async function loadAIConfig() {
  const stored = await (typeof chrome !== 'undefined' && chrome.storage?.local
    ? chrome.storage.local.get(['tuton_ai']).then((d) => d.tuton_ai || null)
    : Promise.resolve(null));
  const lk = await localKey();
  const cfg = { ...defaultAIConfig(), ...(stored || {}) };
  // Key disimpan TERPISAH dari setting UI (chrome.storage tuton_key), agar
  // kolom kosong di Setting TIDAK menimpa key valid yang pernah jalan.
  // Prioritas: key valid tersimpan > key kolom UI > key.local.js.
  let savedKey = '';
  try {
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      savedKey = (await chrome.storage.local.get(['tuton_key'])).tuton_key || '';
    }
  } catch { /* abaikan */ }
  // Isi yang masih kosong dari key lokal (tanpa menimpa setting manual user).
  if (lk) {
    if (!cfg.apiKey && lk.apiKey) cfg.apiKey = lk.apiKey;
    if (!cfg.baseUrl && lk.baseUrl) cfg.baseUrl = lk.baseUrl;
    if (!cfg.model && lk.model) cfg.model = lk.model;
  }
  // Key valid yang pernah dipakai (tuton_key) menang atas kolom kosong.
  if (savedKey) {
    if (!cfg.apiKey) cfg.apiKey = savedKey;
    cfg.keySource = cfg.apiKey === savedKey && stored?.apiKey !== savedKey ? 'saved' : (cfg.keySource || 'setting');
    if (!cfg.keySource || cfg.keySource === 'setting') cfg.keySource = stored?.apiKey ? 'setting' : 'saved';
  } else if (cfg.apiKey) {
    cfg.keySource = stored?.apiKey ? 'setting' : 'local';
  } else {
    cfg.keySource = 'none';
  }
  return cfg;
}

// Simpan key valid yang terbukti jalan (dipanggil otomatis setelah 200 OK),
// agar tidak hilang saat user menyimpan setting dengan kolom key kosong.
export async function rememberWorkingKey(apiKey) {
  if (!apiKey) return;
  try {
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      await chrome.storage.local.set({ tuton_key: apiKey });
    }
  } catch { /* abaikan */ }
}

export async function saveAIConfig(cfg) {
  if (typeof chrome !== 'undefined' && chrome.storage?.local) {
    await chrome.storage.local.set({ tuton_ai: cfg });
  }
}

// Fetch ke backend lokal SELALU lewat service worker (TUTON_BG_FETCH).
// Alasan: fetch langsung dari sidepanel/popup dgn header Authorization wajib
// preflight OPTIONS, dan 9router menjawab OPTIONS dgn 401 tanpa header CORS
// -> browser blokir ("Failed to fetch"). Dari worker request sama lolos.
async function bgFetch(url, { method = 'GET', headers = {}, body = null, timeoutMs = 90000 } = {}) {
  const res = await chrome.runtime.sendMessage({ type: 'TUTON_BG_FETCH', req: { url, method, headers, body, timeoutMs } });
  if (!res?.ok) {
    const e = String(res?.error || 'worker menolak');
    if (/could not establish|receiving end does not exist|worker/i.test(e)) {
      throw new Error('Worker belum aktif — reload extension di chrome://extensions lalu coba lagi.');
    }
    throw new Error(e);
  }
  return { status: res.status, ok: res.status >= 200 && res.status < 300, text: () => Promise.resolve(res.body), json: () => Promise.resolve(JSON.parse(res.body)) };
}

// Fallback khusus GET /models tanpa auth (endpoint ini publik — tanpa header
// Authorization tidak ada preflight, jadi fetch langsung sering lolos).
async function directGetJson(url, ms = 12000) {
  const r = await fetch(url, { signal: AbortSignal.timeout(ms) });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}

// Path endpoint bisa beda per gateway (mis. nutaraline pakai prefix lain):
// chatPath default '/chat/completions', modelsPath default '/models'.
// Disimpan per-config (cfg.chatPath/cfg.modelsPath) + kolom Setting.
function normPath(p, fb) {
  p = String(p || '').trim() || fb;
  return p.startsWith('/') ? p : '/' + p;
}
function joinPath(base, p) { return stripSlash(base) + normPath(p, '/'); }

// Daftar model live (untuk dropdown di Setting + "tarik data model").
// - openai-kind: GET {base}/models (OpenAI, 9router, dan kebanyakan gateway
//   custom OpenAI-compatible). Tanpa key dulu (publik), gagal -> pakai key.
// - anthropic: GET {base}/models dgn header x-api-key (Anthropic resmi).
export async function listModels(baseUrl, apiKey, provider = '9router', opts = {}) {
  const p = PROVIDERS[provider] || PROVIDERS['9router'];
  const base = stripSlash(baseUrl || p.base || NINE_BASE);
  const mp = normPath(opts.modelsPath || '/models', '/models');
  if ((p.kind || 'openai') === 'anthropic') return listModelsAnthropic(base, apiKey, mp);
  return listModelsOpenAIKind(base, apiKey, mp);
}

async function listModelsOpenAIKind(base, apiKey, modelsPath = '/models') {
  const url = joinPath(base, modelsPath);
  // Coba langsung dulu (publik, tanpa header -> tanpa preflight).
  try {
    const j = await directGetJson(url, 12000);
    const ids = (j.data || []).map((m) => m.id).filter(Boolean).sort();
    if (ids.length) return ids;
  } catch { /* jatuh ke worker (pakai auth) */ }
  const r = await bgFetch(url, { headers: apiKey ? { Authorization: 'Bearer ' + apiKey } : {}, timeoutMs: 20000 });
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${String(r.body).slice(0, 150)}`);
  const j = await r.json();
  return (j.data || []).map((m) => m.id).filter(Boolean).sort();
}

async function listModelsAnthropic(base, apiKey, modelsPath = '/models') {
  if (!apiKey) throw new Error('API key Anthropic kosong — isi dulu baru tarik model.');
  const url = joinPath(base, modelsPath);
  const headers = {
    'x-api-key': apiKey,
    'anthropic-version': ANTHROPIC_VERSION,
    'anthropic-dangerous-direct-browser-access': 'true',
  };
  try {
    const r = await fetch(url, { headers, signal: AbortSignal.timeout(20000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}: ${(await r.text()).slice(0, 150)}`);
    const j = await r.json();
    const ids = (j.data || []).map((m) => m.id).filter(Boolean).sort();
    if (ids.length) return ids;
    throw new Error('respons kosong');
  } catch (e) {
    if (/HTTP 4|HTTP 5|respons kosong/.test(e.message)) throw e;
    // Jaringan/CSP dari halaman -> coba via worker.
    const r = await bgFetch(url, { headers, timeoutMs: 20000 });
    if (!r.ok) throw new Error(`HTTP ${r.status}: ${String(r.body).slice(0, 150)}`);
    const j = await r.json();
    return (j.data || []).map((m) => m.id).filter(Boolean).sort();
  }
}

// Diagnosa koneksi berlapis (tombol "Diagnosa koneksi" di Setting > AI).
// Mengembalikan { base, keyLen, model, steps: [{step, ok, detail}] }.
// Setiap lapis dites terpisah: worker hidup? direct GET? worker GET?
// worker GET+key? worker POST chat? — biar ketahuan macetnya di mana.
export async function diagConnection(baseUrl, apiKey, model, opts = {}) {
  const base = stripSlash(baseUrl || NINE_BASE);
  const chatP = normPath(opts.chatPath || '/chat/completions', '/chat/completions');
  const modP = normPath(opts.modelsPath || '/models', '/models');
  const steps = [];
  const push = (step, ok, detail) => steps.push({ step, ok: !!ok, detail: String(detail || '').slice(0, 160) });
  // S1: worker hidup? (respon objek apapun = hidup; throw = mati)
  let workerAlive = false;
  let noAuthRes = null;
  try {
    const r = await chrome.runtime.sendMessage({ type: 'TUTON_BG_FETCH', req: { url: joinPath(base, modP), timeoutMs: 15000 } });
    if (r && typeof r === 'object') {
      workerAlive = true;
      noAuthRes = r;
      push('1. Worker extension', true, r.ok ? `hidup, teruskan ke langkah 3 (HTTP ${r.status})` : `hidup, tapi requestnya gagal: ${String(r.error).slice(0, 100)}`);
    } else {
      push('1. Worker extension', false, 'tidak ada respon (null) — reload extension di chrome://extensions');
    }
  } catch (e) {
    push('1. Worker extension', false, `${String(e.message).slice(0, 110)} — reload extension di chrome://extensions`);
  }
  // S2: GET /models langsung dari halaman (tanpa key = tanpa preflight).
  try {
    const j = await directGetJson(joinPath(base, modP), 12000);
    push(`2. GET ${modP} langsung (tanpa key)`, true, `${(j.data || []).length} model — TERJANGKAU browser`);
  } catch (e) {
    push(`2. GET ${modP} langsung (tanpa key)`, false, `${String(e.message).slice(0, 110)} — kalau langkah 3 OK, abaikan ini (preflight/CORS)`);
  }
  // S3: GET /models via worker (pakai hasil S1, tanpa request ulang).
  if (noAuthRes) {
    if (noAuthRes.ok) {
      push(`3. GET ${modP} via worker (tanpa key)`, noAuthRes.status === 200, `HTTP ${noAuthRes.status} — ${noAuthRes.status === 200 ? 'TERJANGKAU dari extension' : 'isi: ' + String(noAuthRes.body).slice(0, 100)}`);
    } else {
      push(`3. GET ${modP} via worker (tanpa key)`, false, String(noAuthRes.error).slice(0, 140));
    }
  } else {
    push(`3. GET ${modP} via worker (tanpa key)`, false, workerAlive ? 'tidak ada hasil S1' : 'dilewati — worker mati (lihat langkah 1)');
  }
  // S2b/S3b: varian host alternatif (127.0.0.1 <-> localhost). Daftar
  // bypass proxy kadang hanya mencakup salah satunya; juga beda IPv4/IPv6.
  const altBase = base.includes('127.0.0.1') ? base.replace('127.0.0.1', 'localhost')
    : (base.includes('localhost') ? base.replace('localhost', '127.0.0.1') : null);
  if (altBase) {
    try {
      const j = await directGetJson(joinPath(altBase, modP), 12000);
      push('2b. GET host alternatif langsung', true, `${(j.data || []).length} model via ${altBase} — PAKAI HOST INI di kolom Base URL`);
    } catch (e) {
      push('2b. GET host alternatif langsung', false, `${altBase}: ${String(e.message).slice(0, 100)}`);
    }
    if (workerAlive) {
      try {
        const r = await bgFetch(joinPath(altBase, modP), { timeoutMs: 15000 });
        push('3b. GET host alternatif via worker', r.ok, r.ok ? `HTTP 200 via ${altBase} — PAKAI HOST INI di kolom Base URL` : `HTTP ${r.status}`);
      } catch (e) {
        push('3b. GET host alternatif via worker', false, String(e.message).slice(0, 120));
      }
    }
  }
  if (!apiKey) {
    push(`4. GET ${modP} via worker (pakai key)`, false, 'key kosong — isi kolom API key atau cek src/ai/key.local.js');
  } else if (!workerAlive) {
    push(`4. GET ${modP} via worker (pakai key)`, false, 'dilewati — worker mati (lihat langkah 1)');
  } else {
    try {
      const r = await bgFetch(joinPath(base, modP), { headers: { Authorization: 'Bearer ' + apiKey }, timeoutMs: 20000 });
      let n = '?';
      try { n = (JSON.parse(r.body).data || []).length; } catch { /* abaikan */ }
      push(`4. GET ${modP} via worker (pakai key)`, r.ok, r.ok ? `HTTP 200, ${n} model — KEY DITERIMA` : `HTTP ${r.status}: ${String(r.body).slice(0, 110)} — key ditolak?`);
    } catch (e) {
      push(`4. GET ${modP} via worker (pakai key)`, false, String(e.message).slice(0, 140));
    }
  }
  // S5: POST /chat/completions minimal via worker (ini yg dipakai Tes chat).
  if (!apiKey) {
    push('5. POST chat via worker', false, 'dilewati — key kosong');
  } else if (!workerAlive) {
    push('5. POST chat via worker', false, 'dilewati — worker mati (lihat langkah 1)');
  } else {
    try {
      const r = await bgFetch(joinPath(base, chatP), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + apiKey },
        body: JSON.stringify({ model: model || NINE_MODEL, messages: [{ role: 'user', content: 'Balas dengan kata: ok' }], max_tokens: 60 }),
        timeoutMs: 60000,
      });
      push('5. POST chat via worker', r.ok, r.ok ? `HTTP 200 — AI JALAN via ${(model || NINE_MODEL)}` : `HTTP ${r.status}: ${String(r.body).slice(0, 130)}`);
    } catch (e) {
      push('5. POST chat via worker', false, String(e.message).slice(0, 140));
    }
  }
  return { base, keyLen: (apiKey || '').length, model: model || NINE_MODEL, steps };
}

export async function askAI({ messages, context = {}, actions = [] }, cfgOverride) {
  const cfg = cfgOverride || await loadAIConfig();
  const provider = cfg.provider || '9router';

  if (provider === 'router') return viaTutonRouter({ messages, context, actions }, cfg);
  // auto: provider utama dulu, gagal -> router tuton (kedua error dilaporkan).
  if (provider === 'auto') {
    try {
      return await viaMainProvider({ messages, context }, cfg);
    } catch (e9) {
      if (/401|403|ditolak|maintenance|503/i.test(e9.message)) throw e9;
      try {
        return await viaTutonRouter({ messages, context, actions }, cfg);
      } catch (eR) {
        throw new Error(`${e9.message} || Router cadangan juga gagal: ${eR.message}`);
      }
    }
  }
  return viaMainProvider({ messages, context }, cfg);
}

// Provider utama: openai-kind (9router/openai/custom) atau anthropic.
async function viaMainProvider({ messages, context }, cfg) {
  const p = PROVIDERS[cfg.provider] || PROVIDERS['9router'];
  if ((p.kind || 'openai') === 'anthropic') return viaAnthropic({ messages, context }, cfg);
  return viaOpenAIKind({ messages, context }, cfg, cfg.provider || '9router');
}

// System message WAJIB untuk semua provider: menjelaskan kemampuan file Tuton OS
// supaya model tidak pernah menolak ("tidak bisa bikin file") atau menyuruh user
// menjalankan Python/script sendiri — panel yang mengerjakan ekspornya.
export const ASSIST_SYS = [
  'Kamu tutor akademik mahasiswa Universitas Terbuka (UT) yang bekerja DI DALAM aplikasi Tuton OS (extension Chrome, lokal-first).',
  'KEMAMPUAN FILE (penting): aplikasi ini sendiri bisa mengubah jawabanmu menjadi file Word (.docx) dan PDF, dengan rumus matematika sebagai PERSAMAAN ASLI (OMML, bisa diedit di Word), lalu filenya otomatis terunduh ke folder Downloads. Tombol "Jadikan file: DOCX | PDF" ada di bawah setiap jawabanmu, dan ada halaman "Jadikan File".',
  'Karena itu: JANGAN PERNAH bilang kamu tidak bisa membuat/menyimpan/mengunduh file; JANGAN menyuruh user menjalankan kode Python, LaTeX, pandoc, atau script apa pun untuk membuat file; JANGAN menyuruh instalasi apa pun.',
  'Kalau user minta file (pdf / docx / word / "jadiin file"), jawablah materi lengkapnya dalam markdown + LaTeX (rumus inline $...$, blok $$...$$), lalu cukup katakan: klik tombol DOCX atau PDF di bawah jawaban ini — filenya langsung terunduh.',
  'Kalau user bilang kamu tidak bisa: klarifikasi singkat bahwa ekspor file ditangani aplikasi (bukan olehmu), lalu langsung sajikan materinya.',
].join('\n');

// ---- OpenAI-compatible /chat/completions (9router, OpenAI, custom) ----
// Body SELALU lengkap: temperature + max_tokens 2000 default agar jawaban
// tidak kepotong (bug kemarin: max_tokens kecil -> finish_reason=length).
async function viaOpenAIKind({ messages, context }, cfg, provName) {
  const p = PROVIDERS[provName] || PROVIDERS['9router'];
  const base = stripSlash(cfg.baseUrl || p.base || NINE_BASE);
  if (!base) throw new Error('Base URL kosong. Isi di Setting > AI sesuai provider.');
  if (!cfg.apiKey) throw new Error('API key kosong. Isi di Setting > AI.');
  const model = cfg.model || p.model || NINE_MODEL;
  const chatP = normPath(cfg.chatPath || '/chat/completions', '/chat/completions');
  const chatUrl = joinPath(base, chatP);
  const maxT = Math.max(Number(cfg.maxTokens) || 2000, 300);
  // System message SELALU ada: kemampuan file Tuton OS + konteks akademik.
  const sys = ASSIST_SYS + (context?.summary
    ? `\n\nKonteks user: ${context.summary}${context?.tabText ? `\nIsi tab: ${String(context.tabText).slice(0, 4000)}` : ''}${context?.selection ? `\nSeleksi: ${String(context.selection).slice(0, 1000)}` : ''}`
    : '');
  const body = JSON.stringify({
    model,
    messages: [{ role: 'system', content: sys }, ...messages],
    temperature: 0.7,
    max_tokens: maxT,
  });
  // Endpoint lokal (127.0.0.1/localhost) WAJIB lewat worker (hindari preflight
  // CORS browser). Endpoint publik https langsung via fetch halaman — kalau
  // gagal (CSP connect-src), jatuh ke worker juga.
  const isLocal = /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//.test(base);
  let r;
  const doDirect = async (bodyOverride) => {
    const rr = await fetch(chatUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + cfg.apiKey },
      body: bodyOverride || body,
      signal: AbortSignal.timeout(180000),
    });
    return { ok: rr.ok, status: rr.status, text: () => rr.text() };
  };
  try {
    r = isLocal ? await bgFetch(chatUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + cfg.apiKey },
      body,
      timeoutMs: 120000,
    }) : await doDirect().catch(() => bgFetch(chatUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + cfg.apiKey },
      body,
      timeoutMs: 120000,
    }));
  } catch (e) {
    if (/Worker belum aktif/.test(e.message)) throw e;
    throw new Error(`Gagal konek ke ${p.label} (${base}). ${isLocal ? 'Pastikan app-nya JALAN, lalu Tes chat ulang.' : 'Cek koneksi/API key, lalu Tes chat ulang.'} (${e.message.slice(0, 80)})`);
  }
  const label = provName === '9router' ? '9router' : p.label;
  if (!r.ok) {
    const t = (await r.text()).slice(0, 500);
    if (r.status === 503 || /maintenance/i.test(t)) {
      throw new Error(`Gateway ${label} sedang maintenance — request tidak diproses. Coba lagi nanti, atau ganti model di Setting > AI.`);
    }
    if (r.status === 401 || r.status === 403) throw new Error(`API key ${label} ditolak (401/403). Periksa key di Setting > AI.`);
    throw new Error(`${label} HTTP ${r.status}: ${t.slice(0, 200)}`);
  }
  let raw = await r.text();
  let j = parseLooseJson(raw);
  let content = extractContent(j);
  // Model penalar (reasoning) menghabiskan max_tokens untuk berpikir:
  // jawaban kosong / finish_reason=length. Ulangi SEKALI dengan jatah besar.
  const truncated = j?.choices?.[0]?.finish_reason === 'length';
  if ((!content || truncated) && maxT < 4000) {
    try {
      const big = Math.max(maxT * 3, 4000);
      const body2 = JSON.stringify({ model, messages: [{ role: 'system', content: sys }, ...messages], temperature: 0.7, max_tokens: big });
      const r2 = isLocal
        ? await bgFetch(chatUrl, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + cfg.apiKey }, body: body2, timeoutMs: 180000 })
        : await doDirect(body2).catch(() => bgFetch(chatUrl, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + cfg.apiKey }, body: body2, timeoutMs: 180000 }));
      if (r2.ok) {
        raw = await r2.text();
        const j2 = parseLooseJson(raw);
        const c2 = extractContent(j2);
        if (c2 && c2.length > (content || '').length) { j = j2; content = c2; }
      }
    } catch { /* biarkan jawaban pertama */ }
  }
  if (!content) throw new Error(`${label} mengembalikan jawaban kosong. Coba lagi / naikkan batas token di Setting > AI.`);
  await rememberWorkingKey(provName === '9router' ? cfg.apiKey : '');
  return { content, raw: j, via: provName + ':' + model, provider: provName, model };
}

// Alias lama (dipakai kode lain bila ada).
async function via9router({ messages, context }, cfg) {
  return viaOpenAIKind({ messages, context }, cfg, '9router');
}

// ---- Anthropic Messages API (https://api.anthropic.com/v1/messages) ----
// Beda kontrak: header x-api-key + anthropic-version + danger-browser,
// system dipisah dari messages, max_tokens WAJIB, roles hanya user/assistant.
async function viaAnthropic({ messages, context }, cfg) {
  const base = stripSlash(cfg.baseUrl || PROVIDERS.anthropic.base);
  if (!base) throw new Error('Base URL kosong. Isi di Setting > AI sesuai provider.');
  if (!cfg.apiKey) throw new Error('API key Anthropic kosong. Isi di Setting > AI.');
  const model = cfg.model || PROVIDERS.anthropic.model;
  const maxT = Math.max(Number(cfg.maxTokens) || 2000, 300);
  const sysParts = [ASSIST_SYS];
  if (context?.summary) sysParts.push(`Konteks user: ${context.summary}`);
  if (context?.tabText) sysParts.push(`Isi tab: ${String(context.tabText).slice(0, 4000)}`);
  if (context?.selection) sysParts.push(`Seleksi: ${String(context.selection).slice(0, 1000)}`);
  // Normalisasi messages: gabung content-array jadi string, buang role system.
  const norm = [];
  for (const m of messages || []) {
    if (m.role === 'system') { sysParts.push(typeof m.content === 'string' ? m.content : JSON.stringify(m.content)); continue; }
    let text = '';
    if (typeof m.content === 'string') text = m.content;
    else if (Array.isArray(m.content)) {
      for (const part of m.content) {
        if (part?.type === 'text') text += part.text || '';
        else if (part?.type === 'image_url') text += '\n[lampiran gambar — model teks tidak bisa membacanya]\n';
      }
    }
    if (m.role === 'assistant') norm.push({ role: 'assistant', content: text });
    else norm.push({ role: 'user', content: text });
  }
  if (!norm.length) norm.push({ role: 'user', content: '(kosong)' });
  const body = JSON.stringify({ model, system: sysParts.join('\n\n') || undefined, messages: norm, temperature: 0.7, max_tokens: maxT });
  let r;
  try {
    r = await fetch(`${base}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': cfg.apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body,
      signal: AbortSignal.timeout(120000),
    }).catch(() => bgFetch(`${base}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': cfg.apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body,
      timeoutMs: 120000,
    }));
    r = { ok: r.ok, status: r.status, text: () => r.text() };
  } catch (e) {
    throw new Error(`Gagal konek ke Anthropic (${base}). Cek koneksi/API key, lalu Tes chat ulang. (${e.message.slice(0, 80)})`);
  }
  if (!r.ok) {
    const t = (await r.text()).slice(0, 300);
    if (r.status === 401 || r.status === 403) throw new Error(`API key Anthropic ditolak (401/403). Periksa key di Setting > AI.`);
    throw new Error(`Anthropic HTTP ${r.status}: ${t}`);
  }
  const raw = await r.text();
  let j;
  try { j = JSON.parse(raw.trim()); } catch { throw new Error('Respons Anthropic tidak bisa dibaca: ' + raw.slice(0, 150)); }
  const content = ((j.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n')).trim();
  if (!content) throw new Error('Anthropic mengembalikan jawaban kosong. Coba lagi / naikkan batas token.');
  return { content, raw: j, via: 'anthropic:' + model, provider: 'anthropic', model };
}

// 9router kadang mengembalikan SSE (data: {...} data: [DONE]) walau tanpa stream:true,
// kadang JSON polos. Fungsi ini menangani keduanya.
function parseLooseJson(raw) {
  const t = String(raw || '').trim();
  try { return JSON.parse(t); } catch { /* lanjut ke parse SSE */ }
  const chunks = [];
  for (const part of t.split('data:')) {
    const s = part.trim();
    if (!s || s === '[DONE]') continue;
    try { chunks.push(JSON.parse(s)); } catch { /* abaikan potongan non-JSON */ }
  }
  if (!chunks.length) throw new Error('Respons 9router tidak bisa dibaca: ' + t.slice(0, 200));
  // Gabung chunk streaming menjadi satu completion. Teks bisa datang sebagai
  // message.content (non-stream) ATAU delta.content (stream) — dan payload bisa
  // punya ekor "data: [DONE]" walau non-stream (terbukti di gateway 9router),
  // sehingga JSON.parse tunggal gagal.
  const merged = chunks[0];
  if (merged.choices) {
    const collect = (pick) => chunks.map((c) => (c.choices || []).map(pick).filter(Boolean).join('')).join('');
    const fromDelta = collect((ch) => ch.delta?.content);
    const fromMsg = collect((ch) => ch.message?.content);
    const text = fromMsg || fromDelta;
    if (text) merged.choices[0] = { ...merged.choices[0], message: { role: 'assistant', content: text } };
    else {
      const reason = collect((ch) => ch.message?.reasoning || ch.delta?.reasoning);
      if (reason) merged.choices[0] = { ...merged.choices[0], message: { role: 'assistant', content: reason }, reasoningOnly: true };
    }
  }
  return merged;
}

function extractContent(j) {
  const ch = j?.choices?.[0];
  return ch?.message?.content || ch?.delta?.content || ch?.message?.reasoning || '';
}

// ---- Tuton Runtime (router lokal / VPS): POST {routerUrl}/api/process ----
// Jalankan: node router/server.js  (laptop: 127.0.0.1:3721; VPS: HOST=0.0.0.0 + RUNTIME_TOKEN).
// Runtime = penerus AI + pembaca PDF server-side (/api/read). Token runtime
// dikirim sbg Bearer BILA diisi (wajib di VPS, kosong = mode laptop bebas).
async function viaTutonRouter({ messages, context, actions }, cfg) {
  // Relay juga wajib bawa system message (runtime meneruskan messages apa adanya).
  const relayMsgs = (messages || []).some((m) => m?.role === 'system')
    ? messages
    : [{ role: 'system', content: ASSIST_SYS }, ...(messages || [])];
  const url = stripSlash(cfg.routerUrl || 'http://127.0.0.1:3721') + '/api/process';
  const headers = { 'Content-Type': 'application/json' };
  if (cfg.runtimeToken) headers.Authorization = 'Bearer ' + cfg.runtimeToken;
  let r;
  try {
    r = await bgFetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ model: cfg.model || undefined, messages: relayMsgs, context, actions, maxTokens: cfg.maxTokens || undefined }),
      timeoutMs: 120000,
    });
  } catch (e) {
    throw new Error(`Tuton Runtime tidak jalan (${url}). Nyalakan dulu: node router/server.js — atau ganti Provider ke "9router direk" di Setting > AI. (${e.message.slice(0, 80)})`);
  }
  if (!r.ok) {
    const t = (await r.text()).slice(0, 200);
    if (r.status === 401) throw new Error(`Runtime menolak token (401). Isi Token runtime di Setting > AI sama dgn RUNTIME_TOKEN di server.`);
    throw new Error(`Tuton Runtime HTTP ${r.status} (${url}): ${t || 'ditolak server'}.`);
  }
  const j = await r.json();
  return { content: j.content ?? j.reply ?? JSON.stringify(j), raw: j, via: 'runtime' };
}

// ---- Baca file BERAT via Tuton Runtime (POST {routerUrl}/api/read) ----
// Dipakai sbg lapis fallback bila baca lokal di browser gagal (inilah kasus
// PDF UT kemarin: worker/CSP browser menolak, tapi Node bebas). Mengirim
// { filename, dataBase64 } -> { ok, mode, pages?, text?, hint? }.
// Token: sama seperti viaTutonRouter (Bearer bila diisi).
export async function readViaRuntime(file, cfgOverride) {
  const cfg = cfgOverride || await loadAIConfig();
  const url = stripSlash(cfg.routerUrl || 'http://127.0.0.1:3721') + '/api/read';
  const headers = { 'Content-Type': 'application/json' };
  if (cfg.runtimeToken) headers.Authorization = 'Bearer ' + cfg.runtimeToken;
  const buf = new Uint8Array(await file.arrayBuffer());
  let bin = '';
  const CH = 0x8000;
  for (let i = 0; i < buf.length; i += CH) bin += String.fromCharCode.apply(null, buf.subarray(i, i + CH));
  const dataBase64 = btoa(bin);
  const r = await bgFetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ filename: file.name || '', dataBase64 }),
    timeoutMs: 120000,
  });
  if (!r.ok) {
    const t = (await r.text()).slice(0, 150);
    if (r.status === 401) throw new Error('Runtime menolak token (401) — isi Token runtime di Setting > AI');
    throw new Error(`Runtime /api/read HTTP ${r.status}: ${t || 'ditolak'}`);
  }
  return r.json();
}

// Ringkasan profil akademik untuk diselipkan ke context tiap request AI.
export function profileSummary({ ipk, sks, weak = [], streak = 0 }) {
  const w = weak.slice(0, 5).map((m) => `${m.code}(${m.grade})`).join(', ') || '-';
  return `IPK ${ipk}, SKS ${sks}, matkul lemah: ${w}, streak ${streak} hari.`;
}

export function stripSlash(u) { return String(u || '').replace(/\/+$/, ''); }
