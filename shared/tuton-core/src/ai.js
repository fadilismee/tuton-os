// @tuton/core — ai.js. MURNI: tanpa chrome.*, tanpa Tauri API, tanpa DOM.
// Semua I/O lewat `fetcher` yang di-inject:
//   fetcher(url, { method, headers, body, timeoutMs }) -> { ok, status, text() }
// Adapter contoh: extension pakai TUTON_BG_FETCH, desktop/Node pakai fetch global.
export const PROVIDERS = {
  '9router': { label: '9router lokal', kind: 'openai', base: 'http://127.0.0.1:20128/v1', model: 'nura/muse-spark-1.3' },
  openai: { label: 'OpenAI', kind: 'openai', base: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  anthropic: { label: 'Anthropic', kind: 'anthropic', base: 'https://api.anthropic.com/v1', model: 'claude-3-5-haiku-latest' },
  custom: { label: 'Custom (OpenAI-compatible)', kind: 'openai', base: '', model: '' },
  runtime: { label: 'via Tuton Runtime (relay)', kind: 'runtime', base: '', model: '' },
  auto: { label: 'Auto (utama → runtime relay)', kind: 'auto', base: '', model: '' },
};

export const NINE_BASE = 'http://127.0.0.1:20128/v1';
export const NINE_MODEL = 'nura/muse-spark-1.3';
export const ANTHROPIC_VERSION = '2023-06-01';

export function defaultAIConfig() {
  return { provider: '9router', baseUrl: NINE_BASE, model: NINE_MODEL, apiKey: '', chatPath: '/chat/completions', modelsPath: '/models', routerUrl: 'http://127.0.0.1:3721', runtimeToken: '', maxTokens: 2000, aiDepth: 'cepat' };
}

export function stripSlash(u) { return String(u || '').replace(/\/+$/, ''); }
export function normPath(p, fb) { p = String(p || '').trim() || fb; return p.startsWith('/') ? p : '/' + p; }
export function joinPath(base, p) { return stripSlash(base) + normPath(p, '/'); }

const defaultFetcher = async (url, { method = 'GET', headers = {}, body = null, timeoutMs = 90000 } = {}) => {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { method, headers, body, signal: ctl.signal });
    return { ok: r.ok, status: r.status, text: () => r.text() };
  } finally { clearTimeout(t); }
};

// 9router/gateway kadang balas SSE walau tanpa stream:true — tangani keduanya.
export function parseLooseJson(raw) {
  const t = String(raw || '').trim();
  try { return JSON.parse(t); } catch { /* lanjut SSE */ }
  const chunks = [];
  for (const part of t.split('data:')) {
    const s = part.trim();
    if (!s || s === '[DONE]') continue;
    try { chunks.push(JSON.parse(s)); } catch { /* abaikan */ }
  }
  if (!chunks.length) throw new Error('Respons tidak bisa dibaca: ' + t.slice(0, 200));
  const merged = chunks[0];
  if (chunks.length > 1 && merged.choices) {
    const texts = chunks.flatMap((c) => (c.choices || []).map((ch) => ch.delta?.content || ''));
    merged.choices[0] = { ...merged.choices[0], message: { role: 'assistant', content: texts.join('') } };
  }
  return merged;
}

export function extractContent(j) {
  const ch = j?.choices?.[0];
  return ch?.message?.content || ch?.delta?.content || ch?.message?.reasoning || '';
}

export async function chatOpenAI({ base, chatPath = '/chat/completions', apiKey, model, messages, maxTokens = 2000, temperature = 0.7 }, fetcher = defaultFetcher) {
  if (!base) throw new Error('Base URL kosong.');
  if (!apiKey) throw new Error('API key kosong.');
  const url = joinPath(base, chatPath);
  const body = JSON.stringify({ model, messages, temperature, max_tokens: Math.max(Number(maxTokens) || 2000, 300) });
  const r = await fetcher(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + apiKey }, body, timeoutMs: 120000 });
  if (!r.ok) {
    const t = (await r.text()).slice(0, 300);
    if (r.status === 401 || r.status === 403) throw new Error(`API key ditolak (${r.status}).`);
    throw new Error(`HTTP ${r.status}: ${t.slice(0, 200)}`);
  }
  const content = extractContent(parseLooseJson(await r.text()));
  if (!content) throw new Error('Jawaban kosong — coba lagi / naikkan batas token.');
  return { content, model };
}

export async function listModelsOpenAI({ base, modelsPath = '/models', apiKey = '' }, fetcher = defaultFetcher) {
  const url = joinPath(base, modelsPath);
  const r = await fetcher(url, { headers: apiKey ? { Authorization: 'Bearer ' + apiKey } : {}, timeoutMs: 20000 });
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${(await r.text()).slice(0, 150)}`);
  return (JSON.parse(await r.text()).data || []).map((m) => m.id).filter(Boolean).sort();
}

export async function chatAnthropic({ base, apiKey, model, messages, maxTokens = 2000, system = '' }, fetcher = defaultFetcher) {
  const norm = [];
  for (const m of messages || []) {
    if (m.role === 'system') { system += '\n' + (typeof m.content === 'string' ? m.content : JSON.stringify(m.content)); continue; }
    let text = typeof m.content === 'string' ? m.content : (m.content || []).filter((p) => p?.type === 'text').map((p) => p.text).join('');
    norm.push({ role: m.role === 'assistant' ? 'assistant' : 'user', content: text });
  }
  if (!norm.length) norm.push({ role: 'user', content: '(kosong)' });
  const r = await fetcher(joinPath(base, '/messages'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': ANTHROPIC_VERSION },
    body: JSON.stringify({ model, system: system || undefined, messages: norm, temperature: 0.7, max_tokens: Math.max(Number(maxTokens) || 2000, 300) }),
    timeoutMs: 120000,
  });
  if (!r.ok) throw new Error(`Anthropic HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const j = JSON.parse((await r.text()).trim());
  const content = ((j.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n')).trim();
  if (!content) throw new Error('Jawaban kosong.');
  return { content, model };
}

export async function viaRuntime({ runtimeUrl, token = '', model, messages, context = {}, maxTokens }, fetcher = defaultFetcher) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = 'Bearer ' + token;
  const r = await fetcher(stripSlash(runtimeUrl) + '/api/process', {
    method: 'POST', headers,
    body: JSON.stringify({ model: model || undefined, messages, context, maxTokens: maxTokens || undefined }),
    timeoutMs: 120000,
  });
  if (!r.ok) {
    if (r.status === 401) throw new Error('Runtime menolak token (401).');
    throw new Error(`Runtime HTTP ${r.status}: ${(await r.text()).slice(0, 150)}`);
  }
  const j = JSON.parse(await r.text());
  return { content: j.content ?? j.reply ?? JSON.stringify(j), via: 'runtime' };
}

export function profileSummary({ ipk, sks, weak = [], streak = 0 }) {
  const w = weak.slice(0, 5).map((m) => `${m.code}(${m.grade})`).join(', ') || '-';
  return `IPK ${ipk}, SKS ${sks}, matkul lemah: ${w}, streak ${streak} hari.`;
}
