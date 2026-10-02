// src/bmp/rbv.js — DISUNTIK ke tab reader RBV via chrome.scripting (atas klik user).
//
// Diadaptasi dari extension/content.js milik BMP Terbuka
// (https://github.com/mentaliss/bukabmp, lisensi GPL-3.0 — lihat THIRD_PARTY.md).
// Fungsi: deteksi jumlah halaman + unduh image tiap halaman dari
// /reader/services/view.php (memakai sesi login browser user), lalu kirim
// tiap halaman ke sidepanel Tuton OS untuk OCR+rakit lokal.
// Protokol pesan: TUTON_BMP_* (tidak bentrok dengan __BMP_TERBUKA__).
(() => {
  if (window.__TUTON_BMP__) return;
  window.__TUTON_BMP__ = true;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function passwordVisible() {
    const elems = [...document.querySelectorAll('input[type="password"]')];
    return elems.some((el) => {
      const s = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return s.display !== 'none' && s.visibility !== 'hidden' && r.width > 0 && r.height > 0;
    });
  }

  function bodyText() {
    return (document.body?.innerText || '').toLowerCase();
  }

  function positivePageCount(value, maxPages) {
    const n = Number.parseInt(String(value ?? '').trim(), 10);
    if (!Number.isInteger(n) || n < 1 || n > maxPages) return null;
    return n;
  }

  function detectTotalPages(maxPages) {
    const candidates = [];
    const seen = new Set();
    const addCandidate = (value, score, source) => {
      const n = positivePageCount(value, maxPages);
      if (!n) return;
      const key = `${n}:${score}:${source}`;
      if (seen.has(key)) return;
      seen.add(key);
      candidates.push({ pages: n, score, source });
    };
    for (const el of document.querySelectorAll('[data-total-pages],[data-page-count],[data-pages]')) {
      for (const attr of ['data-total-pages', 'data-page-count', 'data-pages']) {
        if (el.hasAttribute(attr)) addCandidate(el.getAttribute(attr), 120, attr);
      }
    }
    for (const el of document.querySelectorAll("#numPages,[id*='numPages' i],[class*='numPages' i],[id*='pageCount' i],[class*='pageCount' i],[id*='totalPage' i],[class*='totalPage' i]")) {
      const nums = String(el.textContent || '').match(/\d{1,4}/g) || [];
      if (nums.length) addCandidate(nums[nums.length - 1], 115, 'page-count-element');
    }
    for (const el of document.querySelectorAll("input[id*='page' i][max], input[name*='page' i][max]")) {
      addCandidate(el.getAttribute('max'), 110, 'page-input-max');
    }
    // Counter toolbar reader RBV seperti "1 / 63".
    for (const el of document.querySelectorAll('body *')) {
      const text = String(el.textContent || '').replace(/\s+/g, ' ').trim();
      if (!text || text.length > 40) continue;
      let m = text.match(/^(\d{1,4})\s*\/\s*(\d{1,4})$/);
      if (!m) m = text.match(/^(?:page|halaman)\s*(\d{1,4})\s*(?:of|dari|\/)\s*(\d{1,4})$/i);
      if (!m) continue;
      const current = Number.parseInt(m[1], 10);
      const total = Number.parseInt(m[2], 10);
      if (!Number.isInteger(current) || current < 1 || current > total) continue;
      let context = '';
      let node = el;
      for (let depth = 0; node && depth < 4; depth++, node = node.parentElement) {
        context += ' ' + [node.id || '', typeof node.className === 'string' ? node.className : '', node.getAttribute?.('aria-label') || ''].join(' ');
      }
      if (!/page|halaman|viewer|toolbar|pager/i.test(context)) continue;
      let score = 105;
      if (current === 1) score += 5;
      addCandidate(total, score, 'visible-page-counter');
    }
    candidates.sort((a, b) => b.score - a.score);
    return candidates[0] || null;
  }

  async function detectTotalPagesWithRetry(maxPages) {
    let previousPages = null;
    let stableReads = 0;
    for (let attempt = 0; attempt < 8; attempt++) {
      const found = detectTotalPages(maxPages);
      if (found) {
        if (found.pages === previousPages) {
          stableReads++;
          if (stableReads >= 2) return found;
        } else {
          previousPages = found.pages;
          stableReads = 0;
        }
      } else {
        previousPages = null;
        stableReads = 0;
      }
      await sleep(250);
    }
    return null;
  }

  function pageRejected() {
    const t = bodyText();
    return t.includes('request rejected') || t.includes('403 akses ditolak') || t.includes('support id');
  }

  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result);
      fr.onerror = () => reject(fr.error);
      fr.readAsDataURL(blob);
    });
  }

  async function fetchPage(code, moduleNo, pageNo) {
    const url = `/reader/services/view.php?doc=M${moduleNo}&format=jpg&subfolder=${encodeURIComponent(code)}/&page=${pageNo}`;
    let resp;
    try {
      resp = await fetch(url, { method: 'GET', credentials: 'include', redirect: 'follow', cache: 'no-store' });
    } catch (e) {
      return { kind: 'network_error', reason: String(e) };
    }
    const contentType = (resp.headers.get('content-type') || '').toLowerCase();
    if (resp.status === 403 || resp.status === 429) return { kind: 'blocked', status: resp.status, reason: `HTTP ${resp.status}` };
    if (resp.status === 401) return { kind: 'login_required', status: resp.status, reason: 'HTTP 401' };
    if (resp.status >= 500 || (resp.status >= 400 && resp.status !== 404)) return { kind: 'network_error', status: resp.status, reason: `HTTP ${resp.status}` };
    if (!contentType.startsWith('image/')) {
      let text = '';
      try { text = (await resp.text()).toLowerCase(); } catch (_) {}
      if (text.includes('request rejected') || text.includes('support id') || text.includes('403 akses ditolak') || text.includes('akses ditolak')) {
        return { kind: 'blocked', status: resp.status, reason: 'Request Rejected / response blokir' };
      }
      if (text.includes('password') && (text.includes('username') || text.includes('single sign-on') || text.includes('login'))) {
        return { kind: 'login_required', status: resp.status, reason: 'Response login' };
      }
      return { kind: 'not_image', status: resp.status, contentType };
    }
    if (!resp.ok) return { kind: 'not_image', status: resp.status, contentType };
    const blob = await resp.blob();
    if (blob.size < 300) return { kind: 'not_image', status: resp.status, contentType, reason: 'Image terlalu kecil' };
    return { kind: 'image', status: resp.status, contentType, size: blob.size, dataUrl: await blobToDataUrl(blob) };
  }

  let activeRunId = '';
  const pendingAcks = new Map(); // page -> { resolve }

  function post(msg) {
    // fire-and-forget; sidepanel yang mendengarkan
    try { chrome.runtime.sendMessage(msg).catch(() => {}); } catch (_) {}
  }

  // Backpressure ala upstream: halaman berikut diambil SETELAH sidepanel
  // selesai OCR halaman ini (ACK). Tanpa ini request menumpuk dan server
  // melembek → me-return 200 non-image (halaman "hilang" di akhir modul).
  function waitPageAck(pageNo, timeoutMs = 600000) {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        pendingAcks.delete(pageNo);
        resolve(false);
      }, timeoutMs);
      pendingAcks.set(pageNo, { resolve: (v) => { clearTimeout(timer); resolve(v); } });
    });
  }

  async function runModule(cfg) {
    const { runId, code, module, delayMs, maxPages } = cfg;
    const stillActive = () => Boolean(runId) && activeRunId === runId;
    if (!stillActive()) return;
    if (pageRejected()) {
      post({ type: 'TUTON_BMP_MODULE_DONE', runId, module, result: 'blocked', page: 0, reason: 'Halaman viewer Request Rejected — berhenti, tanpa retry.' });
      return;
    }
    if (passwordVisible()) {
      post({ type: 'TUTON_BMP_MODULE_DONE', runId, module, result: 'login_required', reason: 'Sesi butuh login ulang.' });
      return;
    }
    let downloaded = 0;
    const detected = await detectTotalPagesWithRetry(maxPages);
    const totalPages = detected?.pages || null;
    const pageLimit = totalPages || maxPages;
    for (let page = 1; page <= pageLimit; page++) {
      if (!stillActive()) return;
      post({ type: 'TUTON_BMP_PROGRESS', runId, module, page, totalPages });
      let r = await fetchPage(code, module, page);
      // Satu retry berjeda untuk respons ambigu (200 non-image / jaringan).
      // blocked/login langsung berhenti — tanpa request storm.
      if ((r.kind === 'not_image' || r.kind === 'network_error') && stillActive()) {
        await sleep(3000);
        if (!stillActive()) return;
        post({ type: 'TUTON_BMP_RETRY', runId, module, page });
        r = await fetchPage(code, module, page);
      }
      if (!stillActive()) return;
      if (r.kind === 'blocked' || r.kind === 'login_required' || r.kind === 'network_error') {
        post({ type: 'TUTON_BMP_MODULE_DONE', runId, module, result: r.kind === 'network_error' ? 'error' : r.kind, page, reason: r.reason || `HTTP ${r.status}` });
        return;
      }
      if (r.kind !== 'image') {
        if (totalPages) {
          post({ type: 'TUTON_BMP_MODULE_DONE', runId, module, result: 'error', page, reason: `Halaman ${page}/${totalPages} bukan image (HTTP ${r.status || 0}). Modul tidak disimpan agar PDF tidak terpotong.` });
          return;
        }
        if (page === 1 && downloaded === 0) {
          post({ type: 'TUTON_BMP_MODULE_DONE', runId, module, result: 'missing_module', page: 1, reason: `Page 1 bukan image (HTTP ${r.status}).` });
          return;
        }
        // Sentinel probe: pastikan akhir modul, bukan halaman bolong.
        const nextProbe = await fetchPage(code, module, page + 1);
        if (!stillActive()) return;
        if (nextProbe.kind === 'blocked' || nextProbe.kind === 'login_required' || nextProbe.kind === 'network_error') {
          post({ type: 'TUTON_BMP_MODULE_DONE', runId, module, result: nextProbe.kind === 'network_error' ? 'error' : nextProbe.kind, page: page + 1, reason: nextProbe.reason || `HTTP ${nextProbe.status}` });
          return;
        }
        if (nextProbe.kind === 'image') {
          post({ type: 'TUTON_BMP_MODULE_DONE', runId, module, result: 'error', page, reason: `Halaman ${page} hilang tapi ${page + 1} ada. Modul tidak disimpan agar PDF tidak terpotong.` });
          return;
        }
        post({ type: 'TUTON_BMP_MODULE_DONE', runId, module, result: 'complete', pages: downloaded });
        return;
      }
      // Kirim halaman ke sidepanel untuk OCR+rakit, lalu TUNGGU ACK sebelum
      // ambil halaman berikut ( ritme upstream: fetch -> OCR -> fetch ).
      post({ type: 'TUTON_BMP_PAGE', runId, module, page, totalPages, dataUrl: r.dataUrl });
      const acked = await waitPageAck(page);
      if (!acked || !stillActive()) return;
      downloaded++;
      if (totalPages && page === pageLimit) {
        post({ type: 'TUTON_BMP_MODULE_DONE', runId, module, result: 'complete', pages: downloaded, totalPages });
        return;
      }
      await sleep(Math.max(700, delayMs));
    }
    if (!stillActive()) return;
    post({ type: 'TUTON_BMP_MODULE_DONE', runId, module, result: 'error', page: maxPages, reason: `Mencapai maxPages=${maxPages}; modul tidak dianggap selesai.` });
  }

  let activeRunKey = '';
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type === 'TUTON_BMP_STOP') {
      const runId = String(msg.runId || '');
      if (!runId || activeRunId === runId) { activeRunId = ''; activeRunKey = ''; }
      for (const [, p] of pendingAcks) { try { p.resolve(false); } catch (_) {} }
      pendingAcks.clear();
      sendResponse({ ok: true });
      return;
    }
    if (msg.type === 'TUTON_BMP_PAGE_ACK') {
      // ACK tidak perlu sendResponse (sidepanel fire-and-forget).
      const p = pendingAcks.get(Number(msg.page));
      if (p && String(msg.runId || '') === activeRunId) {
        pendingAcks.delete(Number(msg.page));
        try { p.resolve(true); } catch (_) {}
      }
      return;
    }
    if (msg.type === 'TUTON_BMP_START_MODULE') {
      const runId = String(msg.runId || '');
      if (!runId) { sendResponse({ ok: false, error: 'runId kosong.' }); return; }
      const runKey = `${runId}:${String(msg.code || '')}:M${Number(msg.module || 0)}`;
      if (activeRunKey === runKey && activeRunId === runId) { sendResponse({ ok: true, alreadyRunning: true }); return; }
      activeRunId = runId;
      activeRunKey = runKey;
      sendResponse({ ok: true });
      runModule(msg).catch((e) => {
        if (activeRunId !== runId) return;
        post({ type: 'TUTON_BMP_MODULE_DONE', runId, module: msg.module, result: 'error', reason: String(e?.message || e) });
      }).finally(() => {
        if (activeRunKey === runKey && activeRunId === runId) { activeRunKey = ''; activeRunId = ''; }
      });
    }
  });
})();
