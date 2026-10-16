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
    // Fallback: hitung div pageContainer bila script numPages tidak ada di DOM
    const containers = document.querySelectorAll('[id*="pageContainer_"]');
    if (containers.length > 0) {
      addCandidate(containers.length, 95, 'page-containers-fallback');
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

  async function resetF5Cookies() {
    try {
      await chrome.runtime.sendMessage({ type: 'TUTON_CLEAR_F5_COOKIES' });
    } catch (_) {}
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

  // Kesabaran per halaman di mode Cepat. Kalau jaringan jelek, halaman yang
  // macet DILEWATI (bukan menggagalkan modul): sisanya tetap diunduh, halaman
  // bolong disusulkan di pass kedua atau pada sesi lanjutan.
  const STALL_MS = 15000;          // tunggu pass pertama
  const STALL_RETRY_MS = 8000;     // tunggu pass kedua (halaman yang tadi macet)
  const MAX_CONSEC_STALL = 3;      // 3 halaman macet beruntun = jaringan putus
  const NO_PROGRESS_MS = 45000;    // tidak ada halaman baru sama sekali

  // Kontainer scroll vertikal FlowPaper: [id^="pagesContainer"].
  // (Dipakai hanya untuk baca posisi — scraper TIDAK pernah scroll.)

  // ---- CATATAN PENTING (Okt 2026, terverifikasi): JANGAN minta halaman
  // langsung ke view.php dari skrip ----
  //
  // Sempat terlihat menjanjikan: 37 halaman EKMA4316 M1 berhasil ditarik dengan
  // `new Image()` memakai pola URL milik viewer. Tapi setelah ±50 permintaan
  // beruntun, Imperva menandai klien ini dan SELURUH reader (termasuk halaman
  // HTML-nya) dijawab "Request Rejected" — sesi ikut kena. Jadi jalur minta
  // halaman langsung = footgun: cepat, tapi mematikan sesi user.
  //
  // Aturan yang dipakai: SEMUA permintaan halaman harus datang dari viewer
  // sendiri (scroll atau tombol next miliknya), satu halaman per satu waktu,
  // dengan jeda seperti manusia. Itu juga satu-satunya cara yang sah.
  //
  // Konsekuensi untuk modul bertipe flipbook/zine (mis. EKMA4316): halaman
  // dirender sebagai background-image dan containernya TIDAK bisa di-scroll,
  // jadi halaman dimajukan lewat tombol next viewer (lihat flipNextPage).
  // Viewer flipbook? (tidak ada kontainer yang bisa di-scroll)
  function isFlipbook() {
    const conts = [...document.querySelectorAll('[id^="pagesContainer"]')].filter((e) => e.offsetWidth || e.offsetHeight);
    if (!conts.length) return false;
    return !conts.some((e) => e.scrollHeight > e.clientHeight + 8);
  }

  function nextButton() {
    return [...document.querySelectorAll('[class*="flowpaper_next"],[class*="bttnNextPage"]')]
      .find((e) => e.offsetParent && !e.id) || null;
  }

  // Majukan viewer satu halaman (dipakai viewer flipbook yang tidak bisa
  // di-scroll). Diberi jeda supaya ritmenya seperti orang membaca.
  async function flipNextPage() {
    const btn = nextButton();
    if (!btn) return false;
    const wait = 2200 + Math.floor(Math.random() * 900);
    if (Date.now() - (flipNextPage._t || 0) < wait) {
      await sleep(Math.max(0, wait - (Date.now() - (flipNextPage._t || 0))));
    }
    flipNextPage._t = Date.now();
    try { btn.click(); } catch (_) { return false; }
    await sleep(900);
    return true;
  }

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
    if (!cont) { flipNextPage(); return; }
    if (Date.now() - lastAutoScrollAt < 3500) return;
    lastAutoScrollAt = Date.now();
    const max = Math.max(0, cont.scrollHeight - cont.clientHeight);
    if (max < 8) { flipNextPage(); return; }   // viewer flipbook: majukan lewat tombol next
    if (cont.scrollTop >= max - 6) return;
    cont.scrollTop = Math.min(max, cont.scrollTop + 430);
  }
  async function waitViewerPage(moduleNo, pageNo, totalPages, stillActive) {
    const t0 = Date.now();
    let lastNewAt = Date.now();
    let lastCount = loadedModuleImages(moduleNo).filter((x) => !harvestedPages.has(x.page)).length;
    for (;;) {
      if (stillActive && !stillActive()) return { kind: 'error', reason: 'Dibatalkan' };
      if (pageRejected()) {
        await resetF5Cookies();
        return { kind: 'blocked', reason: 'Halaman viewer Request Rejected — cookie pelacak F5 telah di-reset.' };
      }
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

    const finish = async (result, extra) => {
      if (result === 'blocked') await resetF5Cookies();
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

    // Mode Panen pada viewer flipbook: menunggu saja tidak akan memuat halaman
    // baru, jadi viewer dimajukan lewat tombol next miliknya (satu halaman per
    // satu waktu). Semua permintaan gambar tetap datang dari viewer sendiri.
    if (finitePass && isFlipbook()) {
      let noNew = 0;
      let lastSize = harvestedPages.size;
      const batas = 240;
      for (let i = 0; i < batas; i++) {
        if (!stillActive()) return;
        if (pageRejected()) { finish('blocked', { reason: 'Request Rejected muncul saat memajukan viewer.' }); return; }
        if (passwordVisible()) { finish('login_required', { reason: 'Sesi butuh login ulang.' }); return; }
        const fresh = loadedModuleImages(module).filter((x) => !harvestedPages.has(x.page));
        for (const src of fresh) {
          if (!stillActive()) return;
          let dataUrl = null;
          try { dataUrl = await grabPageDataUrl(src); } catch (_) { dataUrl = null; }
          if (!dataUrl) continue;
          post({ type: 'TUTON_BMP_PAGE', runId, module, page: src.page, dataUrl });
          const acked = await waitPageAck(src.page);
          if (!acked || !stillActive()) return;
          harvestedPages.add(src.page);
          downloaded++;
        }
        const det = detectTotalPages(500);
        const total = det?.pages || null;
        post({ type: 'TUTON_BMP_HARVEST_STATUS', runId, module,
          count: downloaded, totalPages: total, pages: [...harvestedPages].sort((a, b) => a - b), hint: 'flip' });
        if (total && downloaded >= total) { finish('caught', { totalPages: total }); return; }
        const moved = await flipNextPage();
        if (!moved) { finish('caught', { totalPages: total, reason: 'Tombol maju viewer tidak ditemukan.' }); return; }
        await sleep(700);
        if (harvestedPages.size === lastSize) noNew++;
        else { noNew = 0; lastSize = harvestedPages.size; }
        if (noNew >= 4) { finish('caught', { totalPages: total, reason: 'Berhenti: viewer mentok (4x maju tanpa halaman baru).' }); return; }
      }
      finish('caught', { totalPages: detectTotalPages(500)?.pages || null, reason: 'Batas maju viewer tercapai.' });
      return;
    }

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
  //
  // JARINGAN JELEK (keluhan nyata: macet di halaman 32/41 lalu gagal total):
  // halaman yang tidak kunjung termuat TIDAK lagi mematikan modul. Halaman itu
  // dilewati (`TUTON_BMP_STALL`) dan sapuan lanjut ke halaman berikutnya; di
  // akhir halaman yang macet dicoba sekali lagi (pass 2). Modul selesai dengan
  // daftar `missing` — pemanggil merakit PDF parsial dan menawarkan lanjutan,
  // sehingga halaman yang sudah ada tidak pernah diulang.
  async function runModuleFast(cfg) {
    const { runId, code, module, maxPages, have } = cfg;
    const stillActive = () => Boolean(runId) && activeRunId === runId;
    if (!stillActive()) return;
    if (pageRejected()) {
      await resetF5Cookies();
      post({ type: 'TUTON_BMP_MODULE_DONE', runId, module, result: 'blocked', page: 0, reason: 'Halaman viewer Request Rejected — cookie pelacak F5 telah di-reset otomatis.' });
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
    const missingFrom = () => {
      const out = [];
      for (let p = 1; p <= totalPages; p++) if (!harvestedPages.has(p)) out.push(p);
      return out;
    };
    const finish = async (result, extra) => {
      if (result === 'blocked') await resetF5Cookies();
      const missing = missingFrom();
      post({ type: 'TUTON_BMP_MODULE_DONE', runId, module, result,
        page: extra?.page || 0, pages: harvestedPages.size, totalPages,
        missing: missing.slice(0, 40),
        reason: extra?.reason });
    };

    // Ambil piksel semua halaman yang SUDAH dimuat viewer (bisa lebih dari
    // satu sekaligus — FlowPaper kadang memuat beberapa halaman sekaligus).
    const harvest = async () => {
      const fresh = loadedModuleImages(module).filter((x) => !harvestedPages.has(x.page));
      let got = 0;
      for (const src of fresh) {
        if (!stillActive()) return got;
        let dataUrl = null;
        try { dataUrl = await grabPageDataUrl(src); } catch (_) { dataUrl = null; }
        if (!dataUrl || dataUrl.length < 1000) continue;
        // Mode cepat: kirim langsung TANPA menunggu ACK OCR.
        post({ type: 'TUTON_BMP_PAGE', runId, module, page: src.page, totalPages, dataUrl });
        harvestedPages.add(src.page);
        downloaded++;
        lastNewAt = Date.now();
        got++;
        post({ type: 'TUTON_BMP_HARVEST_STATUS', runId, module,
          count: downloaded, totalPages, pages: [...harvestedPages].sort((a, b) => a - b), hint: 'ok' });
      }
      return got;
    };

    // Tunggu satu halaman termuat. Return 'ok' | 'stall' | 'stop' |
    // 'blocked' | 'login' | 'deadline'. TIDAK pernah membunuh modul.
    const waitTarget = async (pageNo, budgetMs) => {
      currentTarget = pageNo;
      targetSince = Date.now();
      scrollToPage(pageNo);
      for (;;) {
        if (!stillActive()) return 'stop';
        if (pageRejected()) return 'blocked';
        if (passwordVisible()) return 'login';
        await harvest();
        if (harvestedPages.has(pageNo)) return 'ok';
        if (Date.now() - targetSince > budgetMs) return 'stall';
        // Tidak ada kemajuan sama sekali (jaringan putus) → jangan tunggu lama.
        if (Date.now() - lastNewAt > NO_PROGRESS_MS) return 'stall';
        if (Date.now() > deadline) return 'deadline';
        await sleep(250);
      }
    };

    const deadline = Date.now() + Math.max(180000, totalPages * 15000);
    let lastNewAt = Date.now();
    let currentTarget = 0;
    let targetSince = Date.now();
    const stalled = [];
    let consecStall = 0;
    let networkDead = false;

    // ---- Viewer flipbook (tidak bisa di-scroll): majukan lewat tombol next ----
    // Satu halaman per satu waktu dengan jeda seperti manusia, sambil memanen
    // setiap halaman yang muncul. Tidak ada permintaan halaman dari skrip:
    // semua gambar tetap dipicu viewer sendiri (syarat supaya WAF tidak marah).
    if (isFlipbook()) {
      post({ type: 'TUTON_BMP_FLIP', runId, module, active: true });
      let noNew = 0;
      let lastSize = harvestedPages.size;
      const maxFlips = totalPages * 2 + 8;
      for (let i = 0; i < maxFlips; i++) {
        if (!stillActive()) return;
        if (pageRejected()) { finish('blocked', { reason: 'Request Rejected muncul saat memajukan viewer.' }); return; }
        if (passwordVisible()) { finish('login_required', { reason: 'Sesi butuh login ulang.' }); return; }
        await harvest();
        const sisa = missingFrom();
        if (!sisa.length) { finish('complete', { page: 0 }); return; }
        post({ type: 'TUTON_BMP_PROGRESS', runId, module, page: sisa[0], totalPages, flip: true });
        const moved = await flipNextPage();
        if (!moved) { finish('incomplete', { page: sisa[0], reason: 'Tombol maju viewer tidak ditemukan — viewer mungkin sedang tidak terbuka.' }); return; }
        await sleep(700);
        await harvest();
        if (harvestedPages.size === lastSize) noNew++;
        else { noNew = 0; lastSize = harvestedPages.size; }
        if (noNew >= 4) break;              // 4x maju tanpa halaman baru → mentok
        if (Date.now() > deadline) break;
        if (consecStall >= MAX_CONSEC_STALL) break;
      }
      const sisa = missingFrom();
      if (!sisa.length) { finish('complete', { page: 0 }); return; }
      finish('incomplete', { page: sisa[0], reason: `${sisa.length} halaman belum berhasil dimuat (viewer mentok / jaringan). Sisa: ${sisa.slice(0, 12).join(', ')}. Hasil yang sudah ada tetap tersimpan.` });
      return;
    }

    // PASS 1 — sapu semua halaman yang belum. Halaman yang macet (jaringan
    // jelek, gambar tak kunjung termuat) DILEWATI, bukan mematikan modul:
    // sisanya tetap diunduh, dan halaman yang dilewati disusulkan di pass 2
    // atau pada sesi lanjutan tanpa mengulang halaman yang sudah ada.
    const order1 = missingFrom();
    for (const p of order1) {
      if (!stillActive()) return;
      if (harvestedPages.has(p)) continue;
      post({ type: 'TUTON_BMP_PROGRESS', runId, module, page: p, totalPages });
      await harvest();
      if (harvestedPages.has(p)) { consecStall = 0; continue; }
      const r = await waitTarget(p, STALL_MS);
      if (r === 'stop') return;
      if (r === 'blocked') { finish('blocked', { page: p, reason: 'Request Rejected muncul saat mengunduh.' }); return; }
      if (r === 'login') { finish('login_required', { page: p, reason: 'Sesi butuh login ulang.' }); return; }
      if (r === 'deadline') { finish('incomplete', { reason: 'Batas waktu modul tercapai.' }); return; }
      if (r === 'ok') { consecStall = 0; continue; }
      stalled.push(p);
      consecStall++;
      post({ type: 'TUTON_BMP_STALL', runId, module, page: p, totalPages, count: stalled.length,
        reason: `Halaman ${p}/${totalPages} tidak kunjung termuat — dilewati dulu, lanjut halaman berikutnya.` });
      if (consecStall >= MAX_CONSEC_STALL) {
        networkDead = true;
        post({ type: 'TUTON_BMP_STALL', runId, module, page: p, totalPages, count: stalled.length, networkDead: true,
          reason: `${MAX_CONSEC_STALL} halaman beruntun macet — sepertinya jaringan putus. Sisanya disimpan dulu.` });
        break;
      }
    }

    // PASS 2 — halaman yang macet dicoba sekali lagi dengan sabar lebih pendek
    // (jaringan sering balik setelah beberapa detik). Dilewati kalau masih macet.
    if (!networkDead && stalled.length) {
      for (const p of stalled) {
        if (!stillActive()) return;
        if (harvestedPages.has(p)) continue;
        post({ type: 'TUTON_BMP_PROGRESS', runId, module, page: p, totalPages, retry: true });
        await harvest();
        if (harvestedPages.has(p)) { consecStall = 0; continue; }
        const r = await waitTarget(p, STALL_RETRY_MS);
        if (r === 'stop') return;
        if (r === 'blocked') { finish('blocked', { page: p, reason: 'Request Rejected muncul saat mengunduh.' }); return; }
        if (r === 'login') { finish('login_required', { page: p, reason: 'Sesi butuh login ulang.' }); return; }
        if (r === 'deadline') { finish('incomplete', { reason: 'Batas waktu modul tercapai.' }); return; }
        if (r !== 'ok') {
          post({ type: 'TUTON_BMP_STALL', runId, module, page: p, totalPages, count: stalled.length, final: true,
            reason: `Halaman ${p}/${totalPages} tetap tidak termuat — disusulkan nanti (bisa dilanjutkan).` });
        }
      }
    }

    const missing = missingFrom();
    if (!missing.length) { finish('complete', { page: 0 }); return; }
    // Modul tidak lengkap: hasil yang sudah ada DIPERTAHANKAN supaya bisa
    // dirakit jadi PDF parsial dan disusulkan nanti tanpa mengulang.
    finish('incomplete', { page: missing[0], reason: `${missing.length} halaman belum termuat (jaringan). Sisa: ${missing.slice(0, 12).join(', ')}. Halaman yang sudah ada tetap tersimpan dan bisa dilanjutkan kapan saja.` });
  }

  async function runModule(cfg) {
    const { runId, code, module, maxPages, delayMs, have } = cfg;
    const stillActive = () => Boolean(runId) && activeRunId === runId;
    if (!stillActive()) return;
    if (pageRejected()) {
      await resetF5Cookies();
      post({ type: 'TUTON_BMP_MODULE_DONE', runId, module, result: 'blocked', page: 0, reason: 'Halaman viewer Request Rejected — cookie pelacak F5 telah di-reset otomatis.' });
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
