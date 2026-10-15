// src/bmp/rbv.js — DISUNTIK ke tab reader RBV via chrome.scripting (atas klik user).
//
// Diadaptasi dari extension/content.js milik BMP Terbuka
// (https://github.com/mentaliss/bukabmp, lisensi GPL-3.0 — lihat THIRD_PARTY.md).
// Fungsi: deteksi jumlah halaman + panen image tiap halaman yang dimuat
// viewer FlowPaper (tanpa fetch langsung — lihat fetchPage), lalu kirim
// tiap halaman ke sidepanel Tuton OS untuk OCR+rakit lokal.
// Protokol pesan: TUTON_BMP_* (tidak bentrok dengan __BMP_TERBUKA__).
(() => {
  // Skrip ini disuntik berkali-kali (tiap klik tombol). JANGAN berhenti di
  // guard lama: kalau extension di-reload, salinan LAMA yang masih tertanam di
  // tab tetap memakai kode usang dan diam-diam mengabaikan pesan baru —
  // gejalanya persis "0 halaman tanpa error". Karena itu listener di bagian
  // bawah file SELALU diganti dengan versi terbaru.
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
    // Config inline viewer FlowPaper (getDocumentUrl/init embedding) memuat
    // numPages dokumen aktif — sumber paling otoritatif bila ada. Skor di
    // bawah counter visual (105) agar nilai toolbar yang terlihat menang
    // bila keduanya ada; stabil karena inline (lolos deteksi stabil).
    for (const s of document.querySelectorAll('script:not([src])')) {
      const t = s.textContent || '';
      const m = t.match(/numPages\s*[:=]\s*(\d{1,4})/);
      if (m) addCandidate(m[1], 100, 'inline-numpages');
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

  // MODE PASIF — IKUT SCROLL USER (pengganti request/scroll otomatis):
  // Server reader (Imperva TSPD, Okt 2026) menghanguskan sesi begitu ada
  // pola load otomatis: fetch()/XHR -> "Request Rejected", tag <img> baru
  // -> sesi hangus, BAHKAN scroll programmatic + lazy-load viewer -> sesi
  // hangus (terverifikasi: tab mental ke halaman Login). Satu-satunya yang
  // aman: user scroll MANUAL pelan (lazy-load milik viewer, ritme manusia).
  // Maka scraper TIDAK request dan TIDAK scroll sama sekali — ia hanya
  // polling DOM tiap detik dan memanen <img> view.php yang SUDAH keload
  // viewer (complete + naturalWidth > 0), urut per halaman, lalu salin
  // piksel via canvas same-origin ke JPEG untuk OCR. User cukup scroll
  // santai dari halaman 1 sampai akhir; PDF terakit sendiri.
  const HARVEST_TIMEOUT_MS = 25000;
  const HARVEST_SETTLE_MS = 1500;

  // Kontainer scroll vertikal FlowPaper: [id^="pagesContainer"].
  // (Dipakai hanya untuk baca posisi — scraper TIDAK pernah scroll.)

  // Semua gambar halaman (view.php) yang SUDAH dimuat viewer.
  // Tahan beda urutan parameter: doc & page dibaca via regex, bukan includes('&').
  // Mendukung dua bentuk render FlowPaper: <img src=view.php> dan
  // background-image:url(view.php) pada div load_on_demand.
  function parsePageSrc(src) {
    const s = String(src || '');
    if (!s.includes('view.php')) return null;
    const d = s.match(/[?&]doc=M(\d+)/i);
    const p = s.match(/[?&]page=(\d+)/i);
    if (!d) return null;
    return { doc: Number(d[1]), page: p ? Number(p[1]) : 0 };
  }

  function collectPageSources() {
    const out = [];
    const seen = new Set();
    const push = (src, el, kind) => {
      const info = parsePageSrc(src);
      if (!info || !info.page) return;
      const key = `${info.doc}:${info.page}`;
      if (seen.has(key)) return;
      seen.add(key);
      out.push({ doc: info.doc, page: info.page, el, src, kind });
    };
    for (const im of document.querySelectorAll('img')) {
      const src = im.src || im.getAttribute('src') || '';
      if (im.complete && (im.naturalWidth || 0) > 50) push(src, im, 'img');
    }
    for (const el of document.querySelectorAll('div,span,section')) {
      const bg = getComputedStyle(el).backgroundImage || '';
      if (bg.includes('view.php')) {
        const m = bg.match(/url\(["']?([^"')]+)["']?\)/);
        if (m) push(m[1], null, 'bg');
      }
    }
    return out.sort((a, b) => a.page - b.page);
  }

  function loadedModuleImages(moduleNo) {
    return collectPageSources().filter((x) => x.doc === Number(moduleNo));
  }

  // Apa yang sebenarnya sedang terbuka (untuk pesan diagnostik yang jelas).
  function openDocs() {
    const docs = new Set();
    for (const x of collectPageSources()) docs.add(x.doc);
    return [...docs].sort((a, b) => a - b);
  }

  function imgToDataUrl(im) {
    const w = im.naturalWidth || 0;
    const h = im.naturalHeight || 0;
    if (!w || !h) throw new Error('dimensi gambar nol');
    const cv = document.createElement('canvas');
    cv.width = w;
    cv.height = h;
    cv.getContext('2d').drawImage(im, 0, 0);
    // Re-encode JPEG (sumbernya juga JPEG): q0.92 menjaga kualitas OCR,
    // ukuran tetap wajar untuk pesan antar extension.
    return cv.toDataURL('image/jpeg', 0.92);
  }

  // Ambil piksel satu halaman: dari elemen <img> (canvas) atau, bila gambar
  // dirender sebagai background CSS, muat URL-nya lewat elemen Image baru
  // (jalur <img> = jalur yang viewer sendiri pakai, sudah terbukti lolos).
  async function grabPageDataUrl(src) {
    if (src.el && src.kind === 'img') return imgToDataUrl(src.el);
    const im = await new Promise((resolve, reject) => {
      const el = new Image();
      let done = false;
      const timer = setTimeout(() => { if (!done) { done = true; reject(new Error('timeout gambar')); } }, 30000);
      el.onload = () => { if (!done) { done = true; clearTimeout(timer); resolve(el); } };
      el.onerror = () => { if (!done) { done = true; clearTimeout(timer); reject(new Error('gambar gagal dimuat')); } };
      el.src = src.src;
    });
    return imgToDataUrl(im);
  }

  // Polling pasif: TIDAK scroll, TIDAK request. Hanya membaca <img> yang
  // sudah dimuat viewer lewat scroll MANUAL user. Timeout dinamis:
  // tiap ada gambar baru keload (halaman berapa pun), timer di-reset —
  // jadi modul 100 halaman tetap selesai selama user terus scroll santai.
  // Selesai bila: (a) semua halaman totalPages kepanen, atau (b) 90 detik
  // tanpa gambar baru + sentinel halaman berikut tak kunjung muncul.
  const PASSIVE_IDLE_MS = 60000;
  // Halaman yang sudah dipanen (per run): tidak dihitung sebagai "baru"
  // agar timer idle tidak ke-reset oleh gambar lama yang di-load ulang
  // viewer (mis. user scroll naik-turun).
  let harvestedPages = new Set();
  // Auto-scroll (opsional): saat idle, geser kontainer sedikit demi sedikit
  // meniru user membaca — memicu lazy-load viewer sendiri. Berguna di Chrome
  // normal; bisa dimatikan bila server mencurigai pola scroll otomatis.
  let autoScroll = true;
  let lastAutoScrollAt = 0;
  function nudgeScroll() {
    if (!autoScroll) return;
    const cont = document.querySelector('[id^="pagesContainer"]');
    if (!cont) return;
    if (Date.now() - lastAutoScrollAt < 3500) return;
    lastAutoScrollAt = Date.now();
    const max = Math.max(0, cont.scrollHeight - cont.clientHeight);
    if (cont.scrollTop >= max - 6) return;
    cont.scrollTop = Math.min(max, cont.scrollTop + 430);
  }
  async function waitViewerPage(moduleNo, pageNo, totalPages, stillActive) {
    const t0 = Date.now();
    let lastNewAt = Date.now();
    let lastCount = loadedModuleImages(moduleNo).filter((x) => !harvestedPages.has(x.page)).length;
    for (;;) {
      if (stillActive && !stillActive()) return { kind: 'error', reason: 'Dibatalkan' };
      if (pageRejected()) return { kind: 'blocked', reason: 'Halaman viewer Request Rejected — berhenti, tanpa retry.' };
      if (passwordVisible()) return { kind: 'login_required', reason: 'Sesi butuh login ulang.' };
      const loaded = loadedModuleImages(moduleNo);
      const fresh = loaded.filter((x) => !harvestedPages.has(x.page));
      if (fresh.length > lastCount) { lastCount = fresh.length; lastNewAt = Date.now(); }
      nudgeScroll();
      const found = loaded.find((x) => x.page === pageNo);
      if (found) {
        await sleep(HARVEST_SETTLE_MS);
        const recheck = loadedModuleImages(moduleNo).find((x) => x.page === pageNo);
        if (recheck) return { kind: 'image', el: recheck.el };
        continue;
      }
      // Halaman target belum ada tapi modul diklaim selesai (semua halaman
      // <= totalPages kepanen kecuali target): anggap halaman bolong.
      if (totalPages && pageNo <= totalPages) {
        const havePages = new Set(loaded.map((x) => x.page));
        let allElse = pageNo > 1;
        for (let p = 1; p <= totalPages; p++) {
          if (p === pageNo) continue;
          if (!havePages.has(p)) { allElse = false; break; }
        }
        if (allElse && loaded.length >= totalPages - 1) {
          return { kind: 'not_image', reason: `Halaman ${pageNo} tidak dimuat viewer (halaman lain lengkap)` };
        }
      }
      if (Date.now() - lastNewAt > PASSIVE_IDLE_MS) {
        const next = loadedModuleImages(moduleNo).find((x) => x.page === pageNo + 1);
        if (next) return { kind: 'not_image', reason: `Halaman ${pageNo} tidak dimuat viewer tapi ${pageNo + 1} ada` };
        if (!loaded.length && pageNo === 1) return { kind: 'missing', reason: 'Belum ada halaman termuat — scroll manual halaman 1 sampai gambarnya tampil.' };
        return { kind: 'missing', reason: `Halaman ${pageNo} tidak kunjung dimuat — scroll manual sampai gambarnya tampil.` };
      }
      // Ingatkan user tiap 20 detik idle agar terus scroll.
      if (Date.now() - t0 > 20000 && (Date.now() - (waitViewerPage._n || 0)) > 20000) {
        waitViewerPage._n = Date.now();
        post({ type: 'TUTON_BMP_PROGRESS', runId: activeRunId, module: moduleNo, page: pageNo, totalPages, hint: 'scroll' });
      }
      await sleep(1000);
    }
  }

  async function fetchPage(code, moduleNo, pageNo, totalPages, stillActive) {
    const w8 = await waitViewerPage(moduleNo, pageNo, totalPages, stillActive);
    if (w8.kind !== 'image') {
      if (w8.kind === 'missing') return { kind: 'missing', reason: w8.reason };
      return w8;
    }
    let dataUrl;
    try {
      dataUrl = imgToDataUrl(w8.el);
    } catch (e) {
      return { kind: 'not_image', status: 200, contentType: 'image/jpeg', reason: `Canvas gagal: ${(e && e.message) || e}` };
    }
    if (!dataUrl || dataUrl.length < 1000) return { kind: 'not_image', status: 200, contentType: 'image/jpeg', reason: 'DataURL kosong' };
    return { kind: 'image', status: 200, contentType: 'image/jpeg', size: dataUrl.length, dataUrl };
  }

  // ---- PEREKAM PASIF (menggantikan "sweep" yang gagal) ----
  //
  // Temuan live (Okt 2026), terbukti berulang:
  //  1. `fetch()`/`<img>` ke view.php -> HTTP 200 + "Request Rejected"
  //     (Imperva menandai request gambar yang dibuat skrip, bukan viewer).
  //  2. `scrollTop = n` TIDAK memicu lazy-load FlowPaper (terbukti: setelah
  //     scroll programmatic 4 detik, halaman ke-2 tetap tidak dimuat).
  //  3. Scroll agresif beruntun -> viewer melempar ke halaman lain (tab
  //     navigasi/reload) dan sesi login hangus.
  //
  // Kesimpulan: satu-satunya gambar yang SAH adalah yang dimuat viewer sendiri
  // saat user menggeser tampilan. Maka perekam ini tidak scroll, tidak
  // request, tidak navigasi — ia hanya menyalin tiap gambar begitu muncul,
  // SEKALI per halaman, dan menyimpannya bertahap supaya tidak ada pekerjaan
  // yang hilang kalau modul belum selesai.
  //
  // Berhenti bila: semua halaman terkunci (bila jumlahnya terbaca), user
  // menekan "selesai", atau idle PASSIVE_IDLE_MS tanpa halaman baru.
  // cfg.finitePass = true untuk mode "Panen" (sekali sapu lalu selesai);
  // false untuk mode "Rekam" (merekam terus saat user scroll sampai selesai).
  async function recordLoaded(cfg) {
    const { runId, code, module, delayMs, have: already, finitePass } = cfg;
    const stillActive = () => Boolean(runId) && activeRunId === runId;
    if (!stillActive()) return;

    const finish = (result, extra) => {
      const total = extra?.totalPages ?? null;
      const missing = [];
      if (total) for (let p = 1; p <= total; p++) if (!harvestedPages.has(p)) missing.push(p);
      post({ type: 'TUTON_BMP_MODULE_DONE', runId, module, result,
        pages: harvestedPages.size, totalPages: total,
        missing: missing.slice(0, 40),
        reason: extra?.reason });
    };

    if (pageRejected()) { finish('blocked', { reason: 'Halaman viewer Request Rejected.' }); return; }
    if (passwordVisible()) { finish('login_required', { reason: 'Sesi butuh login ulang.' }); return; }
    const open = openDocs();
    if (open.length && !open.includes(Number(module))) {
      finish('missing_module', {
        reason: `Tab reader sedang menampilkan Modul ${open.join(', ')}, bukan Modul ${module}. Buka Modul ${module} dulu di tab reader.` });
      return;
    }

    // Lanjutkan dari halaman yang sudah tersimpan (tidak mengulang kerja).
    harvestedPages = new Set((already || []).map(Number).filter((n) => n > 0));
    let downloaded = harvestedPages.size;
    let lastNewAt = Date.now();
    let warned = false;

    for (;;) {
      if (!stillActive()) return;
      if (pageRejected()) { finish('blocked', { reason: 'Request Rejected muncul saat merekam.' }); return; }
      if (passwordVisible()) { finish('login_required', { reason: 'Sesi butuh login ulang.' }); return; }

      const fresh = loadedModuleImages(module).filter((x) => !harvestedPages.has(x.page));
      if (fresh.length) lastNewAt = Date.now();
      for (const src of fresh) {
        if (!stillActive()) return;
        let dataUrl = null;
        try { dataUrl = await grabPageDataUrl(src); } catch (_) { dataUrl = null; }
        if (!dataUrl || dataUrl.length < 1000) continue;
        post({ type: 'TUTON_BMP_PAGE', runId, module, page: src.page, dataUrl });
        const acked = await waitPageAck(src.page);
        if (!acked || !stillActive()) return;
        harvestedPages.add(src.page);
        downloaded++;
      }

      const detected = detectTotalPages(500);
      const totalPages = detected?.pages || null;
      post({ type: 'TUTON_BMP_HARVEST_STATUS', runId, module,
        count: downloaded, totalPages, pages: [...harvestedPages].sort((a, b) => a - b),
        hint: fresh.length ? 'ok' : 'scroll' });

      if (totalPages && downloaded >= totalPages) { finish('caught', { totalPages }); return; }
      // Mode Panen: sekali sapu lalu selesai — user tinggal menekan Panen lagi
      // setelah scroll kalau masih ada yang kurang.
      if (finitePass) { finish('caught', { totalPages }); return; }
      if (Date.now() - lastNewAt > PASSIVE_IDLE_MS) {
        finish('caught', { totalPages, reason: warned
          ? 'Berhenti karena tidak ada halaman baru selama 60 detik.'
          : undefined });
        return;
      }
      if (!warned && Date.now() - lastNewAt > 15000 && fresh.length === 0) warned = true;
      await sleep(Math.max(600, delayMs || 1000));
    }
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

  // ---- MODE CEPAT (default): scroll otomatis per-halaman ----
  //
  // Uji live Okt 2026 (STMA4224 M2, 29 hal, 53.7 dtk, tanpa logout):
  // scroll programmatic TERBATAS ke posisi halaman berikutnya + polling
  // 250 ms ternyata memuat halaman dengan aman di sesi ini. Klaim lama
  // bahwa "scroll programmatic selalu logout" hanya berlaku untuk scroll
  // agresif beruntun / navigasi hash — bukan untuk pola satu-halaman ini.
  // Aturan aman: satu halaman per satu waktu, tanpa fetch/XHR sendiri,
  // tanpa navigasi, berhenti saat Request Rejected / login berubah.
  // Tidak menunggu ACK OCR antar-halaman (OCR diantre di sidepanel),
  // jadi penangkapan jalan terus sampai modul lengkap.
  async function runModuleFast(cfg) {
    const { runId, code, module, maxPages, have } = cfg;
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
    harvestedPages = new Set((have || []).map(Number).filter((n) => n > 0));
    let downloaded = harvestedPages.size;
    const detected = await detectTotalPagesWithRetry(maxPages);
    const totalPages = detected?.pages || null;
    if (!totalPages) {
      post({ type: 'TUTON_BMP_MODULE_DONE', runId, module, result: 'error', reason: 'Jumlah halaman tidak terbaca (numPages). Refresh viewer lalu coba lagi.' });
      return;
    }
    const open = openDocs();
    if (open.length && !open.includes(Number(module))) {
      post({ type: 'TUTON_BMP_MODULE_DONE', runId, module, result: 'missing_module',
        reason: `Tab reader sedang menampilkan Modul ${open.join(', ')}, bukan Modul ${module}.` });
      return;
    }
    const scrollToPage = (pageNo) => {
      const cont = document.querySelector('[id^="pagesContainer"]');
      if (!cont) return false;
      const target = document.getElementById(`pageContainer_${pageNo - 1}_documentViewer`);
      if (target) cont.scrollTop = target.offsetTop;
      else cont.scrollTop = Math.min(cont.scrollHeight - cont.clientHeight, (pageNo - 1) * (cont.clientHeight || 700));
      return true;
    };
    const deadline = Date.now() + Math.max(180000, totalPages * 15000);
    let lastNewAt = Date.now();
    let currentTarget = 0;
    let targetSince = Date.now();
    for (;;) {
      if (!stillActive()) return;
      if (pageRejected()) {
        post({ type: 'TUTON_BMP_MODULE_DONE', runId, module, result: 'blocked', reason: 'Request Rejected muncul saat mengunduh.' });
        return;
      }
      if (passwordVisible()) {
        post({ type: 'TUTON_BMP_MODULE_DONE', runId, module, result: 'login_required', reason: 'Sesi butuh login ulang.' });
        return;
      }
      let next = 0;
      for (let p = 1; p <= totalPages; p++) { if (!harvestedPages.has(p)) { next = p; break; } }
      if (!next) {
        post({ type: 'TUTON_BMP_MODULE_DONE', runId, module, result: 'complete', pages: downloaded, totalPages });
        return;
      }
      if (next !== currentTarget) {
        currentTarget = next;
        targetSince = Date.now();
        scrollToPage(next);
        post({ type: 'TUTON_BMP_PROGRESS', runId, module, page: next, totalPages });
      } else if (Date.now() - targetSince > 25000) {
        post({ type: 'TUTON_BMP_MODULE_DONE', runId, module, result: 'incomplete', page: next, totalPages,
          reason: `Halaman ${next}/${totalPages} tidak kunjung dimuat.` });
        return;
      }
      const fresh = loadedModuleImages(module).filter((x) => !harvestedPages.has(x.page));
      for (const src of fresh) {
        if (!stillActive()) return;
        let dataUrl = null;
        try { dataUrl = await grabPageDataUrl(src); } catch (_) { dataUrl = null; }
        if (!dataUrl || dataUrl.length < 1000) continue;
        // Mode cepat: kirim langsung TANPA menunggu ACK OCR.
        post({ type: 'TUTON_BMP_PAGE', runId, module, page: src.page, totalPages, dataUrl });
        harvestedPages.add(src.page);
        downloaded++;
        lastNewAt = Date.now();
        post({ type: 'TUTON_BMP_HARVEST_STATUS', runId, module,
          count: downloaded, totalPages, pages: [...harvestedPages].sort((a, b) => a - b), hint: 'ok' });
      }
      if (Date.now() - lastNewAt > 40000) {
        post({ type: 'TUTON_BMP_MODULE_DONE', runId, module, result: 'incomplete', totalPages,
          reason: 'Berhenti: 40 detik tanpa halaman baru.' });
        return;
      }
      if (Date.now() > deadline) {
        post({ type: 'TUTON_BMP_MODULE_DONE', runId, module, result: 'incomplete', totalPages,
          reason: 'Batas waktu modul tercapai.' });
        return;
      }
      await sleep(250);
    }
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
    harvestedPages = new Set();
    const detected = await detectTotalPagesWithRetry(maxPages);
    const totalPages = detected?.pages || null;
    const pageLimit = totalPages || maxPages;
    for (let page = 1; page <= pageLimit; page++) {
      if (!stillActive()) return;
      post({ type: 'TUTON_BMP_PROGRESS', runId, module, page, totalPages });
      let r = await fetchPage(code, module, page, totalPages, stillActive);
      // Satu retry berjeda untuk respons ambigu (viewer belum load / canvas).
      // blocked/login langsung berhenti — tanpa request storm (panen pun
      // tanpa request tambahan; retry hanya mengulang tunggu+scroll).
      if ((r.kind === 'not_image' || r.kind === 'missing' || r.kind === 'network_error' || r.kind === 'error') && stillActive()) {
        await sleep(3000);
        if (!stillActive()) return;
        post({ type: 'TUTON_BMP_RETRY', runId, module, page });
        r = await fetchPage(code, module, page, totalPages, stillActive);
      }
      if (!stillActive()) return;
      if (r.kind === 'blocked' || r.kind === 'login_required' || r.kind === 'network_error' || r.kind === 'error') {
        post({ type: 'TUTON_BMP_MODULE_DONE', runId, module, result: (r.kind === 'network_error' || r.kind === 'error') ? 'error' : r.kind, page, reason: r.reason || `HTTP ${r.status}` });
        return;
      }
      if (r.kind !== 'image') {
        if (totalPages) {
          post({ type: 'TUTON_BMP_MODULE_DONE', runId, module, result: 'error', page, reason: `Halaman ${page}/${totalPages} tidak termuat di viewer (${r.reason || 'bukan image'}). Modul tidak disimpan agar PDF tidak terpotong.` });
          return;
        }
        if (page === 1 && downloaded === 0) {
          post({ type: 'TUTON_BMP_MODULE_DONE', runId, module, result: 'missing_module', page: 1, reason: `Page 1 tidak termuat di viewer (${r.reason || 'bukan image'}).` });
          return;
        }
        // Sentinel probe: pastikan akhir modul, bukan halaman bolong.
        const nextProbe = await fetchPage(code, module, page + 1, totalPages, stillActive);
        if (!stillActive()) return;
        if (nextProbe.kind === 'blocked' || nextProbe.kind === 'login_required' || nextProbe.kind === 'network_error' || nextProbe.kind === 'error') {
          post({ type: 'TUTON_BMP_MODULE_DONE', runId, module, result: (nextProbe.kind === 'network_error' || nextProbe.kind === 'error') ? 'error' : nextProbe.kind, page: page + 1, reason: nextProbe.reason || `HTTP ${nextProbe.status}` });
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
      harvestedPages.add(page);
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
  const onBmpMessage = (msg, _sender, sendResponse) => {
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
    if (msg.type === 'TUTON_BMP_RECORD' || msg.type === 'TUTON_BMP_HARVEST_LOADED') {
      const runId = String(msg.runId || '');
      if (!runId) { sendResponse({ ok: false, error: 'runId kosong.' }); return; }
      // Panen = sekali sapu; Rekam = terus merekam sampai user menekan selesai.
      const finitePass = msg.type === 'TUTON_BMP_HARVEST_LOADED';
      activeRunId = runId;
      activeRunKey = `${runId}:${String(msg.code || '')}:M${Number(msg.module || 0)}`;
      sendResponse({ ok: true });
      recordLoaded({ ...msg, finitePass }).catch((e) => {
        if (activeRunId !== runId) return;
        post({ type: 'TUTON_BMP_MODULE_DONE', runId, module: msg.module, result: 'error', reason: String(e?.message || e) });
      }).finally(() => {
        if (activeRunId === runId) { activeRunKey = ''; activeRunId = ''; }
      });
    }
    if (msg.type === 'TUTON_BMP_START_MODULE') {
      const runId = String(msg.runId || '');
      if (!runId) { sendResponse({ ok: false, error: 'runId kosong.' }); return; }
      if (typeof msg.autoScroll === 'boolean') autoScroll = msg.autoScroll;
      const runKey = `${runId}:${String(msg.code || '')}:M${Number(msg.module || 0)}`;
      if (activeRunKey === runKey && activeRunId === runId) { sendResponse({ ok: true, alreadyRunning: true }); return; }
      activeRunId = runId;
      activeRunKey = runKey;
      sendResponse({ ok: true });
      // Mode cepat = default. Mode biasa = ritme lama (fetch->OCR->fetch).
      const fast = msg.speed !== 'biasa';
      (fast ? runModuleFast(msg) : runModule(msg)).catch((e) => {
        if (activeRunId !== runId) return;
        post({ type: 'TUTON_BMP_MODULE_DONE', runId, module: msg.module, result: 'error', reason: String(e?.message || e) });
      }).finally(() => {
        if (activeRunKey === runKey && activeRunId === runId) { activeRunKey = ''; activeRunId = ''; }
      });
    }
  };
  // Daftarkan ulang tiap kali skrip disuntik: buang listener lama dulu supaya
  // tidak menumpuk (dan supaya versi terbaru yang selalu menang).
  try { if (window.__tutonBmpListener) chrome.runtime.onMessage.removeListener(window.__tutonBmpListener); } catch (_) {}
  chrome.runtime.onMessage.addListener(onBmpMessage);
  window.__tutonBmpListener = onBmpMessage;
})();
