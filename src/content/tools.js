// src/content/tools.js — Skill agent: screenshot area / draw overlay / rekam tab.
// Disuntik via chrome.scripting HANYA setelah klik user (activeTab).
// Pesan: TUTON_SHOT (visible tab PNG), TUTON_DRAW_START/STOP, TUTON_DRAW_CLEAR,
// TUTON_REC_START/STOP/STATE (MediaRecorder via chrome.tabCapture, webm).
// Catatan: TIDAK bisa jalan di chrome://, Web Store, PDF viewer, halaman
// extension lain (Chrome memblokir inject di sana).
(() => {
  if (window.__tutonTools) return;
  window.__tutonTools = true;

  function flash(el) {
    try {
      const old = el.style.outline;
      el.style.outline = '2px solid #00e68a';
      el.style.outlineOffset = '2px';
      setTimeout(() => { try { el.style.outline = old; el.style.outlineOffset = ''; } catch {} }, 1200);
    } catch { /* abaikan */ }
  }

  // ---------- Screenshot seleksi (drag area) ----------
  async function selectArea() {
    return new Promise((resolve, reject) => {
      const veil = document.createElement('div');
      veil.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:rgba(0,0,0,.35);cursor:crosshair;';
      const box = document.createElement('div');
      box.style.cssText = 'position:fixed;border:2px solid #00e68a;background:rgba(0,230,138,.12);display:none;';
      const hint = document.createElement('div');
      hint.textContent = 'Drag area yang mau di-SS · Esc batal';
      hint.style.cssText = 'position:fixed;top:12px;left:50%;transform:translateX(-50%);background:#10141a;color:#eafff4;font:12px/1.4 system-ui;padding:6px 12px;border-radius:8px;border:1px solid #00e68a;';
      veil.appendChild(box); veil.appendChild(hint);
      document.documentElement.appendChild(veil);
      let x0 = 0, y0 = 0, x1 = 0, y1 = 0, drag = false;
      const onMove = (e) => {
        if (!drag) return;
        x1 = e.clientX; y1 = e.clientY;
        const l = Math.min(x0, x1), t = Math.min(y0, y1);
        const w = Math.abs(x1 - x0), h = Math.abs(y1 - y0);
        box.style.display = 'block';
        Object.assign(box.style, { left: l + 'px', top: t + 'px', width: w + 'px', height: h + 'px' });
      };
      const done = (ok) => {
        window.removeEventListener('mousemove', onMove, true);
        window.removeEventListener('keydown', onKey, true);
        veil.remove();
        if (!ok) return reject(new Error('dibatalkan'));
        const l = Math.min(x0, x1), t = Math.min(y0, y1);
        const w = Math.abs(x1 - x0), h = Math.abs(y1 - y0);
        if (w < 8 || h < 8) return reject(new Error('area terlalu kecil'));
        resolve({ x: l, y: t, w, h, dpr: window.devicePixelRatio || 1 });
      };
      const onKey = (e) => { if (e.key === 'Escape') done(false); };
      veil.addEventListener('mousedown', (e) => { x0 = x1 = e.clientX; y0 = y1 = e.clientY; drag = true; });
      window.addEventListener('mousemove', onMove, true);
      window.addEventListener('keydown', onKey, true);
      veil.addEventListener('mouseup', (e) => { if (drag) { x1 = e.clientX; y1 = e.clientY; drag = false; done(true); } });
    });
  }

  // ---------- Draw / whiteboard overlay ----------
  let drawLayer = null;
  function drawStart(color = '#00e68a', size = 3) {
    drawStop(true);
    const c = document.createElement('canvas');
    // Canvas seukuran dokumen penuh — coretan ikut scroll dgn halaman.
    const W = Math.max(document.documentElement.scrollWidth, window.innerWidth);
    const H = Math.max(document.documentElement.scrollHeight, window.innerHeight);
    c.width = W; c.height = H;
    c.style.cssText = `position:absolute;top:0;left:0;width:${W}px;height:${H}px;z-index:2147483646;cursor:crosshair;touch-action:none;`;
    document.documentElement.appendChild(c);
    const ctx = c.getContext('2d');
    ctx.strokeStyle = color; ctx.lineWidth = size; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    let drawing = false, lx = 0, ly = 0;
    const pos = (e) => {
      const r = c.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    c.addEventListener('pointerdown', (e) => { drawing = true; const p = pos(e); lx = p.x; ly = p.y; c.setPointerCapture(e.pointerId); });
    c.addEventListener('pointermove', (e) => {
      if (!drawing) return;
      const p = pos(e);
      ctx.beginPath(); ctx.moveTo(lx, ly); ctx.lineTo(p.x, p.y); ctx.stroke();
      lx = p.x; ly = p.y;
    });
    c.addEventListener('pointerup', () => { drawing = false; });
    drawLayer = c;
    try { c.scrollIntoView({ block: 'nearest' }); } catch {}
  }
  function drawStop(silent) {
    if (drawLayer) { try { drawLayer.style.pointerEvents = 'none'; } catch {} drawLayer = null; if (!silent) return true; }
    // silent=true dipakai drawStart (ganti warna tanpa hapus).
    const olds = [...document.querySelectorAll('canvas')].filter((x) => x.style.zIndex === '2147483646');
    if (!silent) olds.forEach((x) => { try { x.style.pointerEvents = 'none'; } catch {} });
    return true;
  }

  // ---------- Rekam tab (MediaRecorder + chrome.tabCapture) ----------
  let rec = null, recChunks = [], recStream = null;
  async function recStart() {
    if (rec) return { ok: false, error: 'sudah merekam' };
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: 'TUTON_TAB_STREAM' }, async (res) => {
        try {
          if (!res?.ok || !res.streamId) return resolve({ ok: false, error: res?.error || 'tabCapture ditolak' });
          recStream = await navigator.mediaDevices.getUserMedia({
            audio: false,
            video: {
              mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: res.streamId },
            },
          });
          recChunks = [];
          rec = new MediaRecorder(recStream, { mimeType: 'video/webm' });
          rec.ondataavailable = (e) => { if (e.data?.size) recChunks.push(e.data); };
          rec.start(1000);
          resolve({ ok: true });
        } catch (e) { resolve({ ok: false, error: e.message }); }
      });
    });
  }
  async function recStop() {
    if (!rec) return { ok: false, error: 'tidak merekam' };
    const blob = await new Promise((resolve) => {
      rec.onstop = () => resolve(new Blob(recChunks, { type: 'video/webm' }));
      try { rec.stop(); } catch { resolve(new Blob(recChunks, { type: 'video/webm' })); }
    });
    try { recStream?.getTracks().forEach((t) => t.stop()); } catch {}
    rec = null; recStream = null;
    return new Promise((resolve) => {
      const r = new FileReader();
      r.onload = () => resolve({ ok: true, dataUrl: r.result, size: blob.size });
      r.onerror = () => resolve({ ok: false, error: 'gagal baca rekaman' });
      r.readAsDataURL(blob);
    });
  }

  chrome.runtime.onMessage.addListener((msg, _sender, send) => {
    (async () => {
      if (msg.type === 'TUTON_PING') { send({ ok: true }); return; }
      if (msg.type === 'TUTON_SHOT_AREA') {
        try {
          const rect = await selectArea();
          send({ ok: true, rect, url: location.href, title: document.title });
        } catch (e) { send({ ok: false, error: e.message }); }
        return;
      }
      if (msg.type === 'TUTON_DRAW_START') { drawStart(msg.color || '#00e68a', msg.size || 3); send({ ok: true }); return; }
      if (msg.type === 'TUTON_DRAW_STOP') { drawStop(false); send({ ok: true }); return; }
      if (msg.type === 'TUTON_DRAW_CLEAR') {
        [...document.querySelectorAll('canvas')].filter((x) => x.style.zIndex === '2147483646').forEach((x) => x.remove());
        drawLayer = null; send({ ok: true }); return;
      }
      if (msg.type === 'TUTON_DRAW_SHOT') {
        const c = [...document.querySelectorAll('canvas')].find((x) => x.style.zIndex === '2147483646');
        if (!c) return send({ ok: false, error: 'belum ada coretan' });
        try { send({ ok: true, dataUrl: c.toDataURL('image/png') }); } catch (e) { send({ ok: false, error: e.message }); }
        return;
      }
      if (msg.type === 'TUTON_REC_START') { send(await recStart()); return; }
      if (msg.type === 'TUTON_REC_STOP') { send(await recStop()); return; }
      if (msg.type === 'TUTON_REC_STATE') { send({ ok: true, recording: !!rec }); return; }
      send({ ok: false, error: 'unknown' });
    })();
    return true;
  });
})();
