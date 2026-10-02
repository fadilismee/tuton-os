// popup.js — module eksternal (MV3 melarang inline script).
import { cumulative } from './src/lib/gpa.js';

const $ = (id) => document.getElementById(id);

$('open-side').addEventListener('click', async () => {
  try {
    const w = await chrome.windows.getCurrent();
    await chrome.sidePanel.open({ windowId: w.id });
    window.close();
  } catch (e) {
    $('status').textContent = 'Gagal buka sidebar: ' + e.message;
  }
});

$('open-float').addEventListener('click', async () => {
  const url = chrome.runtime.getURL('sidepanel/index.html#/dashboard?mode=float');
  try {
    await chrome.windows.create({ url, type: 'popup', width: 1020, height: 700 });
    window.close();
  } catch (e) {
    $('status').textContent = 'Gagal buka popup: ' + e.message;
  }
});

$('checkin').addEventListener('click', async () => {
  try {
    const r = await chrome.runtime.sendMessage({ type: 'TUTON_CHECKIN' });
    $('st-streak').textContent = `${r.streak}h`;
    $('checkin-txt').textContent = r.added ? `Streak ${r.streak} hari` : 'Sudah check-in';
    $('checkin').disabled = true;
  } catch {
    $('status').textContent = 'Worker belum aktif — reload extension.';
  }
});

(async () => {
  try {
    const s = await chrome.storage.local.get(['tuton_profile', 'tuton_tracker', 'tuton_grades', 'tuton_ai']);
    const p = s.tuton_profile || {};
    const t = s.tuton_tracker || {};
    let ipk = '–';
    try {
      const g = s.tuton_grades || { semesters: [] };
      if (g.semesters.length) ipk = cumulative(g.semesters).ipk.toFixed(2);
    } catch (_) {}
    $('st-ipk').textContent = ipk;
    $('st-streak').textContent = `${t.streak || 0}h`;
    $('st-level').textContent = `Lv${t.level || 1}`;
    $('status').innerHTML = p.prodi
      ? `${p.prodi} · target IPK <b>${p.targetIPK ?? '–'}</b>`
      : 'Belum setup — buka sidebar, isi profil di Setting.';
    // cek 9router: GET /models TANPA header auth (publik, tanpa preflight).
    // Kalau gagal (cth. preflight/CORS), fallback via worker TUTON_BG_FETCH.
    const a = s.tuton_ai || {};
    const base = (a.baseUrl || 'http://127.0.0.1:20128/v1').replace(/\/+$/, '');
    const modP = (a.modelsPath || '/models').trim() || '/models';
    const modUrl = base + (modP.startsWith('/') ? modP : '/' + modP);
    try {
      let j = null;
      try {
        const ctl = await fetch(modUrl, { signal: AbortSignal.timeout(8000) });
        if (!ctl.ok) throw new Error();
        j = await ctl.json();
      } catch {
        const w = await chrome.runtime.sendMessage({ type: 'TUTON_BG_FETCH', req: { url: modUrl, timeoutMs: 12000 } });
        if (!w?.ok) throw new Error();
        j = JSON.parse(w.body);
      }
      {
        var rc = (j.data || []).length, rm = a.model || 'nura/muse-spark-1.3';
        const prov = a.provider || '9router';
        $('router').innerHTML = '<span class="dot on"></span>' + prov + ' · ' + rc + ' model · ' + rm;
      }
    } catch {
      $('router').innerHTML = '<span class="dot off"></span>AI tidak terjangkau — fitur lokal tetap jalan';
    }
  } catch {
    $('status').textContent = 'Tidak bisa baca status.';
  }
})();
