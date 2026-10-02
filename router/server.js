// router/server.js — Tuton Runtime minimalis (NOL dependensi, Node bawaan saja).
// Satu proses untuk laptop (127.0.0.1) & VPS (0.0.0.0 + token) agar AI maksimal:
//   GET  /health      -> { ok, service, time, pdf, token }
//   GET  /api/models  -> proxy daftar model dari MODEL_API_URL (tanpa CORS buat HP)
//   POST /api/process  -> { model?, messages[], context?, actions?, maxTokens? } -> { content, via }
//   POST /api/read    -> { filename?, dataBase64 } (PDF/gambar/teks) -> { text, pages?, mode }
// Jalankan:  node router/server.js
// Env (router/.env, JANGAN di-commit): PORT, HOST, MODEL_API_URL, MODEL_API_KEY,
// MODEL_NAME, RUNTIME_TOKEN (wajib bila di VPS / diakses selain localhost).
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

try {
  const envPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '.env');
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
    }
  }
} catch { /* .env opsional */ }

const PORT = Number(process.env.PORT || 3721);
const HOST = process.env.HOST || '127.0.0.1'; // VPS: HOST=0.0.0.0
const MODEL_API_URL = (process.env.MODEL_API_URL || 'http://127.0.0.1:20128/v1').replace(/\/+$/, '');
const MODEL_API_KEY = process.env.MODEL_API_KEY || '';
const MODEL_NAME = process.env.MODEL_NAME || 'nura/muse-spark-1.3';
const RUNTIME_TOKEN = process.env.RUNTIME_TOKEN || '';

function send(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  });
  res.end(body);
}

function readJson(req, maxBytes = 35_000_000) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (c) => { raw += c; if (raw.length > maxBytes) reject(new Error('body terlalu besar (max ~35MB)')); });
    req.on('end', () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch { reject(new Error('JSON tidak valid')); } });
    req.on('error', reject);
  });
}

function needAuth(req) {
  if (!RUNTIME_TOKEN) return null; // mode laptop: bebas
  const h = req.headers.authorization || '';
  if (h === 'Bearer ' + RUNTIME_TOKEN) return null;
  return 'token salah / kosong (kirim Authorization: Bearer RUNTIME_TOKEN)';
}

// ---------- PDF text extractor via pdfjs-dist (npm, di node_modules) ----------
// Kenapa pdf.js beneran, bukan regex/zlib mentah: PDF UT memakai font custom
// encoding + stream objek campur (teks + JPEG). Regex mentah hanya dapat sampah
// biner JPEG (terbukti di file EKMA5102). pdf.js menangani ToUnicode/CMap +
// FlateDecode secara internal. Di Node tidak ada CSP/worker issue seperti di
// browser, jadi ini jalur paling akurat. NOL dep tambahan selain pdfjs-dist
// (sudah dipakai extension sebagai vendor UMD juga).
const require = createRequire(import.meta.url);
let _pdfjs = null;
function pdfjs() {
  if (_pdfjs) return _pdfjs;
  _pdfjs = require('pdfjs-dist/legacy/build/pdf.js');
  return _pdfjs;
}

async function extractPdfText(buf, maxChars = 60000, maxPages = 60) {
  const pdf = await pdfjs().getDocument({ data: new Uint8Array(buf), useSystemFonts: true }).promise;
  try {
    const n = pdf.numPages;
    if (n > maxPages) { try { await pdf.destroy(); } catch {} throw new Error(`terlalu besar (${n} hal, max ${maxPages})`); }
    const parts = [];
    for (let p = 1; p <= n; p++) {
      const page = await pdf.getPage(p);
      const tc = await page.getTextContent();
      const line = (tc.items || []).map((it) => it.str || '').join(' ').replace(/\s{2,}/g, ' ').trim();
      if (line.replace(/\s/g, '').length >= 20) parts.push(`[hal ${p}]\n${line}`);
    }
    const text = parts.join('\n\n');
    return { pages: n, textPages: parts.length, text };
  } finally {
    try { await pdf.destroy(); } catch {}
  }
}

// ---------- DOCX -> PDF lewat Microsoft Word (COM) ----------
// Kualitas paling tinggi untuk dokumen berumus (persamaan OMML jadi asli),
// dan Word sudah terpasang di Windows. Alternatif: LibreOffice headless.
let _wordChecked = null;
function hasWord() {
  if (_wordChecked !== null) return _wordChecked;
  const cands = [
    'C:/Program Files/Microsoft Office/root/Office16/WINWORD.EXE',
    'C:/Program Files (x86)/Microsoft Office/root/Office16/WINWORD.EXE',
    'C:/Program Files/Microsoft Office/Office16/WINWORD.EXE',
  ];
  _wordChecked = process.platform === 'win32' && cands.some((p) => { try { return fs.existsSync(p); } catch { return false; } });
  return _wordChecked;
}

async function docxToPdf(docxBuf) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tuton-export-'));
  const inPath = path.join(tmp, 'in.docx');
  const outPath = path.join(tmp, 'out.pdf');
  fs.writeFileSync(inPath, docxBuf);
  try {
    if (hasWord()) {
      const psPath = path.join(tmp, 'conv.ps1');
      fs.writeFileSync(psPath, ['$ErrorActionPreference="Stop"',
        '$w = New-Object -ComObject Word.Application',
        '$w.Visible = $false', '$w.DisplayAlerts = 0',
        `$d = $w.Documents.Open("${inPath.replace(/\\/g, '\\\\')}", $false, $true)`,
        // 17 = wdExportFormatPDF
        `$d.ExportAsFixedFormat("${outPath.replace(/\\/g, '\\\\')}", 17)`,
        '$d.Close(0)', '$w.Quit()', 'Write-Output "OK"'].join('\n'), 'utf8');
      const r = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', psPath], { encoding: 'utf8', timeout: 180000 });
      if (r.status !== 0) throw new Error('Word gagal: ' + String(r.stderr || r.stdout || '').slice(0, 300));
      if (!fs.existsSync(outPath)) throw new Error('Word tidak menghasilkan PDF');
      const pdf = fs.readFileSync(outPath);
      return { pdf, engine: 'word' };
    }
    // LibreOffice headless (soffice) bila ada.
    const soffice = spawnSync('soffice', ['--headless', '--convert-to', 'pdf', '--outdir', tmp, inPath], { encoding: 'utf8', timeout: 180000 });
    if (fs.existsSync(outPath)) return { pdf: fs.readFileSync(outPath), engine: 'libreoffice' };
    throw new Error('tidak ada Word/LibreOffice di mesin ini' + (soffice.error ? ` (${soffice.error.code})` : ''));
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* abaikan */ }
  }
}

// ---------- Jawaban lokal darurat ----------
function localAnswer({ messages, context, model }) {
  const last = [...(messages || [])].reverse().find((m) => m.role === 'user')?.content || '(kosong)';
  const prof = context?.summary || context?.profile ? JSON.stringify(context.profile ?? context.summary) : '-';
  return [
    `Tuton Runtime (lokal, tanpa model eksternal)`,
    ``,
    `Kamu tanya: "${String(typeof last === 'string' ? last : JSON.stringify(last)).slice(0, 300)}"`,
    ``,
    `Profil: ${typeof prof === 'string' ? prof.slice(0, 300) : prof}`,
    context?.tabText ? `Saya menerima ${String(context.tabText).length} karakter dari tab.` : null,
    ``,
    `Saran cepat:`,
    `1. Fokus ke matkul parasit IPK di menu Simulasi.`,
    `2. Pomodoro 25 mnt + check-in harian untuk streak.`,
    `3. Mau AI beneran? Set MODEL_API_URL lalu restart runtime. Model diminta: ${model || MODEL_NAME}.`,
  ].filter(Boolean).join('\n');
}

async function forwardToModel({ model, messages, maxTokens }) {
  const r = await fetch(`${MODEL_API_URL}/chat/completions`, {
    method: 'POST',
    headers: Object.assign({ 'Content-Type': 'application/json' }, MODEL_API_KEY ? { Authorization: 'Bearer ' + MODEL_API_KEY } : {}),
    body: JSON.stringify({ model: model || MODEL_NAME || 'default', messages, temperature: 0.7, max_tokens: Math.min(Math.max(Number(maxTokens) || 2000, 300), 8000) }),
    signal: AbortSignal.timeout(120000),
  });
  if (!r.ok) throw new Error(`model HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const raw = await r.text();
  let j;
  try { j = JSON.parse(raw.trim()); } catch {
    const mm = raw.match(/data:\s*(\{.*?\})\s*data:\s*\[DONE\]/s) || raw.match(/(\{.*\})/s);
    j = JSON.parse((mm ? mm[1] : raw).trim());
  }
  const ch = j.choices?.[0];
  const content = ch?.message?.content || ch?.delta?.content || JSON.stringify(j).slice(0, 2000);
  return { content, raw: j };
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return send(res, 204, {});
  const url = new URL(req.url, 'http://localhost');
  if (req.method === 'GET' && url.pathname === '/health') {
    return send(res, 200, {
      ok: true, service: 'tuton-runtime', time: new Date().toISOString(), pdf: 'pdfjs-dist', token: Boolean(RUNTIME_TOKEN),
      export: { docxToPdf: hasWord() ? 'word' : 'none', platform: process.platform },
    });
  }
  if (req.method === 'GET' && url.pathname === '/api/models') {
    const err = needAuth(req);
    if (err) return send(res, 401, { error: err });
    try {
      const r = await fetch(`${MODEL_API_URL}/models`, {
        headers: MODEL_API_KEY ? { Authorization: 'Bearer ' + MODEL_API_KEY } : {},
        signal: AbortSignal.timeout(20000),
      });
      const j = await r.json().catch(() => ({}));
      return send(res, 200, j);
    } catch (e) { return send(res, 502, { error: 'model tidak terjangkau: ' + e.message }); }
  }
  if (req.method === 'POST' && url.pathname === '/api/process') {
    const err = needAuth(req);
    if (err) return send(res, 401, { error: err });
    try {
      const body = await readJson(req);
      const messages = Array.isArray(body.messages) ? body.messages : [];
      if (!messages.length) return send(res, 400, { error: 'messages[] kosong' });
      if (MODEL_API_URL) {
        try {
          const out = await forwardToModel({ model: body.model, messages, maxTokens: body.maxTokens });
          return send(res, 200, { content: out.content, model: body.model || MODEL_NAME, via: 'model' });
        } catch (e) {
          return send(res, 200, { content: localAnswer(body) + `\n\n(catatan: forward gagal — ${e.message})`, via: 'local-fallback', warning: e.message });
        }
      }
      return send(res, 200, { content: localAnswer(body), via: 'local' });
    } catch (e) { return send(res, 400, { error: e.message }); }
  }
  // Ingest file: extension kirim { filename, dataBase64 } bila baca lokal gagal.
  // PDF -> ekstrak teks via zlib (tanpa OCR). Gambar/teks -> kembalikan ringkas
  // agar AI / model vision yg lanjutkan. Inilah "runtime agar AI maksimal".
  if (req.method === 'POST' && url.pathname === '/api/read') {
    const err = needAuth(req);
    if (err) return send(res, 401, { error: err });
    try {
      const body = await readJson(req);
      const { filename = '', dataBase64 = '' } = body;
      if (!dataBase64) return send(res, 400, { error: 'dataBase64 kosong' });
      const buf = Buffer.from(dataBase64, 'base64');
      if (!buf.length) return send(res, 400, { error: 'base64 tidak valid' });
      if (/\.pdf$/i.test(filename) || buf.slice(0, 4).toString() === '%PDF') {
        let r;
        try { r = await extractPdfText(buf); }
        catch (e) { return send(res, 200, { ok: false, mode: 'pdf-error', hint: 'gagal parse PDF di runtime: ' + e.message }); }
        if (r.text.replace(/\s/g, '').length < 50) {
          return send(res, 200, { ok: false, mode: 'pdf-image', pages: r.pages, text: '', hint: `PDF ${r.pages} hal ini gambar semua (PPT/screenshot di-print ke PDF). Kirim halaman sebagai gambar ke model vision, atau nyalakan OCR Tesseract di runtime (overflow: belum termasuk agar tetap minimalis).` });
        }
        return send(res, 200, { ok: true, mode: 'pdf-text', pages: r.pages, textPages: r.textPages, chars: r.text.length, text: `(judul: ${filename} · ${r.pages} hal via runtime${r.textPages < r.pages ? `, ${r.pages - r.textPages} hal gambar` : ''})\n${r.text}`.slice(0, 60000) });
      }
      if (/\.(png|jpe?g|webp|gif)$/i.test(filename)) {
        return send(res, 200, { ok: false, mode: 'image', hint: 'Gambar diteruskan apa adanya ke model vision oleh extension (runtime tidak OCR agar tetap 1 dependensi).' });
      }
      // teks mentah
      const text = buf.toString('utf8').slice(0, 60000);
      return send(res, 200, { ok: true, mode: 'text', chars: text.length, text });
    } catch (e) { return send(res, 400, { error: e.message }); }
  }
  // DOCX -> PDF (persamaan tetap asli). Body: { dataBase64 } (docx) -> { pdfBase64, engine }
  if (req.method === 'POST' && url.pathname === '/api/export/pdf') {
    const err = needAuth(req);
    if (err) return send(res, 401, { error: err });
    try {
      const body = await readJson(req);
      const b64 = String(body.dataBase64 || '');
      if (!b64) return send(res, 400, { error: 'dataBase64 (docx) kosong' });
      const buf = Buffer.from(b64, 'base64');
      // Harus benar-benar ZIP/DOCX (magic PK\x03\x04), bukan sekadar diawali "PK".
      if (buf.slice(0, 4).toString('latin1') !== 'PK\x03\x04') {
        return send(res, 400, { error: 'bukan DOCX (ZIP) yang valid — header PK\\x03\\x04 tidak ada' });
      }
      const out = await docxToPdf(buf);
      return send(res, 200, { ok: true, engine: out.engine, pdfBase64: out.pdf.toString('base64'), bytes: out.pdf.length });
    } catch (e) { return send(res, 500, { error: 'export gagal: ' + e.message }); }
  }
  return send(res, 404, { error: 'unknown route. GET /health, GET /api/models, POST /api/process, POST /api/read, POST /api/export/pdf' });
});

server.listen(PORT, HOST, () => {
  console.log(`[tuton-runtime] http://${HOST}:${PORT}  (forward model: ${MODEL_API_URL || 'MATI — mode lokal'})`);
  console.log(`[tuton-runtime] Tes: curl http://${HOST === '0.0.0.0' ? '127.0.0.1' : HOST}:${PORT}/health`);
});
