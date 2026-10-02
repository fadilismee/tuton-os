// sidepanel/app.js — UI utama Tuton OS (MV3, module eksternal, tanpa inline script).
// Lokal-first: semua data di chrome.storage.local. Router lokal opsional di 127.0.0.1:3000.
// Mendukung 2 mode: panel sempit (default) & jendela ngambang (?mode=float / lebar >=800px).
import { cumulative, simulate, parasites, SCHEMES, PREDICATES } from '../src/lib/gpa.js';
import { load, save, uid } from '../src/lib/store.js';
import { gradeQuiz, buildSimulasi, shuffle } from '../src/lib/qbank.js';
import { manualGen, encQuestions, decQuestions, filterNew, pkgName, qHash, DIFFS, COUNTS } from '../src/lib/qgen.js';
import { askAI, loadAIConfig, saveAIConfig, profileSummary, listModels, diagConnection, readViaRuntime, NINE_BASE, NINE_MODEL } from '../src/ai/client.js';
import { icon } from './icons.js';
import { buildPdf } from '../src/lib/minpdf.js';
import { exportDocx, exportPdf, runtimeCapability, parseBlocks, blocksToText, guessTitle, docLabel } from '../src/export/index.js';
import { stageExport, takeExport, peekExport } from '../src/export/pending.js';
import { prepareJob, cancelJob, ocrPage, finishModule, exportCachedModule, buildRange, dbListModules, onOcrProgress, getModuleText } from '../src/bmp/engine.js';

const $ = (s) => document.querySelector(s);
const content = $('#content');
const titleEl = $('#page-title');
const statusEl = $('#user-status');

const PAGES = [
  { id: 'dashboard', label: 'Dashboard', icon: 'grid' },
  { id: 'ipk', label: 'IPK', icon: 'chart' },
  { id: 'simulasi', label: 'Simulasi', icon: 'spark' },
  { id: 'tracker', label: 'Tracker', icon: 'timer' },
  { id: 'soal', label: 'Bank Soal', icon: 'book' },
  { id: 'bmp', label: 'BMP Studio', icon: 'layers' },
  { id: 'pdf', label: 'PDF Tools', icon: 'file' },
  { id: 'export', label: 'Jadikan File', icon: 'download' },
  { id: 'ai', label: 'AI Agen', icon: 'cpu' },
  { id: 'cap', label: 'Capture', icon: 'video' },
  { id: 'setting', label: 'Setting', icon: 'gear' },
];
// Dashboard single-page: fitur non-inti dibuka sebagai overlay dari tombol.
// Halaman yang tetap punya rute sendiri: ipk, simulasi, tracker, ai, setting.
const OVERLAY_PAGES = new Set(['soal', 'bmp', 'pdf', 'tugas', 'catatan']);
let overlayPage = null; // 'soal' | 'bmp' | 'pdf' | 'tugas' | 'catatan' | null
let overlayReturn = 'dashboard';

const params = new URLSearchParams(location.hash.split('?')[1] || location.search);
let isFloat = params.get('mode') === 'float' || window.innerWidth >= 800;
if (isFloat) document.getElementById('app').classList.add('float');

function notify(msg, type = 'success') {
  const n = $('#notif');
  $('#notif-msg').textContent = msg;
  n.className = `notif show ${type}`;
  clearTimeout(n._t);
  n._t = setTimeout(() => n.classList.remove('show'), 3500);
}

// ---------- Nav (tanpa onclick inline) ----------
function buildNav() {
  for (const id of ['#nav-top', '#nav-side']) {
    const nav = document.querySelector(id);
    if (!nav) continue;
    nav.innerHTML = '';
    // Single-page: navbar hanya rute inti. Soal/BMP/PDF dibuka via tombol
    // (overlay di atas dashboard) — tapi tetap dukung deep-link hash lama.
    const items = id === '#nav-top'
      ? PAGES.filter((p) => !OVERLAY_PAGES.has(p.id))
      : PAGES;
    for (const p of items) {
      const b = document.createElement('button');
      b.dataset.page = p.id;
      b.innerHTML = `${icon(p.icon, 15)}<span>${p.label}</span>`;
      b.setAttribute('aria-label', p.label);
      b.addEventListener('click', () => go(p.id));
      nav.appendChild(b);
    }
  }
}
function markActive(page) {
  document.querySelectorAll('.nav button').forEach((b) => {
    const on = b.dataset.page === page;
    b.classList.toggle('active', on);
    if (on) {
      try { b.scrollIntoView({ inline: 'center', block: 'nearest' }); } catch (_) {}
    }
  });
}

function go(page) {
  const clean = location.hash.split('?')[0] || '#/dashboard';
  const base = '#/' + page;
  // pertahankan ?mode=float kalau sedang mengambang
  location.hash = isFloat ? `${base}?mode=float` : base;
}
// Overlay single-page: soal/bmp/pdf dibuka di atas dashboard, tombol Kembali
// menutupnya tanpa menambah riwayat nav. Dipakai tombol dashboard + deep-link.
function openOverlay(page, ret) {
  overlayPage = page;
  overlayReturn = ret && !OVERLAY_PAGES.has(ret) ? ret : 'dashboard';
  render();
}
function closeOverlay() {
  overlayPage = null;
  render();
}
function currentRoute() {
  const m = (location.hash || '#/dashboard').match(/^#\/([a-z]+)/);
  return m ? m[1] : 'dashboard';
}

window.addEventListener('hashchange', render);
window.addEventListener('resize', () => {
  const shouldFloat = new URLSearchParams(location.hash.split('?')[1] || '').get('mode') === 'float';
  if (shouldFloat && !isFloat) { isFloat = true; document.getElementById('app').classList.add('float'); }
});

// ---------- Tombol ngambang ----------
$('#btn-float').addEventListener('click', async () => {
  const url = chrome.runtime.getURL('sidepanel/index.html#/dashboard?mode=float');
  try {
    await chrome.windows.create({ url, type: 'popup', width: 1020, height: 700 });
  } catch (e) {
    // fallback kalau dipreview di browser biasa
    window.open(url, '_blank', 'width=1020,height=700');
  }
});

// ---------- Status ----------
async function refreshStatus() {
  try {
    const p = await load('tuton_profile', {});
    const t = await load('tuton_tracker', {});
    statusEl.innerHTML = p.prodi
      ? `${icon('flame', 13)}<span><b>${t.streak || 0}</b>&nbsp;hari · Lv <b>${t.level || 1}</b></span>`
      : 'Belum setup';
    statusEl.title = p.prodi || 'Buka Setting untuk isi profil';
  } catch { statusEl.textContent = '—'; }
}

// ---------- Activity log + heatmap ala GitHub ----------
// tuton_activity: { days: { 'YYYY-MM-DD': { c:checkin, p:pomodoro, q:quiz, a:ai } } }
function dayKey(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function dayScore(d) {
  if (!d) return 0;
  return (d.c ? 2 : 0) + (d.p || 0) * 2 + (d.q || 0) + (d.a || 0);
}
function levelOf(score) {
  if (score <= 0) return 0;
  if (score === 1) return 1;
  if (score <= 3) return 2;
  if (score <= 5) return 3;
  return 4;
}
export async function bumpActivity(kind) {
  // kind: 'c' (checkin) | 'p' (pomodoro) | 'q' (quiz) | 'a' (ai)
  const a = await load('tuton_activity', { days: {} });
  const k = dayKey();
  const d = a.days[k] || { c: 0, p: 0, q: 0, a: 0 };
  if (kind === 'c') d.c = 1; else d[kind] = (d[kind] || 0) + 1;
  a.days[k] = d;
  // pangkas > 400 hari
  const keys = Object.keys(a.days).sort();
  while (keys.length > 400) delete a.days[keys.shift()];
  await save('tuton_activity', a);
}
async function loadActivityBackfilled() {
  const a = await load('tuton_activity', { days: {} });
  if (Object.keys(a.days).length) return a;
  // Backfill dari streak lama supaya grafik tidak kosong
  const t = await load('tuton_tracker', {});
  const n = Number(t.streak) || 0;
  if (n > 0 && t.lastDay) {
    const end = new Date(t.lastDay + 'T12:00:00');
    for (let i = 0; i < Math.min(n, 365); i++) {
      const d = new Date(end);
      d.setDate(d.getDate() - i);
      a.days[dayKey(d)] = { c: 1, p: 0, q: 0, a: 0 };
    }
    await save('tuton_activity', a);
  }
  return a;
}
function streaksFrom(days, weeks = 26) {
  const today = new Date();
  let cur = 0, best = 0, run = 0;
  // streak berjalan: mulai hari ini, mundur selama skor>0 (toleransi hari ini kosong)
  const t = new Date(today);
  if (dayScore(days[dayKey(t)]) === 0) t.setDate(t.getDate() - 1);
  while (dayScore(days[dayKey(t)]) > 0) { cur++; t.setDate(t.getDate() - 1); }
  // longest dalam window
  const start = new Date(today);
  start.setDate(start.getDate() - weeks * 7);
  for (let d = new Date(start); d <= today; d.setDate(d.getDate() + 1)) {
    if (dayScore(days[dayKey(d)]) > 0) { run++; best = Math.max(best, run); }
    else run = 0;
  }
  return { cur, best };
}
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
// Heatmap ala GitHub untuk 1 tahun: Jan → HARI INI (bukan full Des).
// Bulan ke depan TIDAK digambar (kosong = belum terjadi, bukan 0 aktivitas).
// Navigasi tahun via toggle ‹ tahun › (yearBounds: 5 tahun ke belakang).
function heatmapYearHTML(days, year) {
  const today = new Date();
  const isCurYear = year === today.getFullYear();
  const last = isCurYear ? today : new Date(year, 11, 31);
  let cols = '', months = '', total = 0, lastMonth = -1;
  const jan1 = new Date(year, 0, 1);
  const start = new Date(jan1);
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  const weeks = Math.ceil((((last - start) / 864e5) + 1) / 7);
  for (let w = 0; w < weeks; w++) {
    let cells = '', colMonth = '';
    for (let d = 0; d < 7; d++) {
      const date = new Date(start);
      date.setDate(date.getDate() + w * 7 + d);
      const inRange = date.getFullYear() === year && date <= last;
      const s = inRange ? dayScore(days[dayKey(date)]) : 0;
      if (inRange) total += s;
      const tip = inRange ? `${s} aktivitas · ${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()}` : '';
      const ghost = !inRange ? ' ghost' : '';
      const iso = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
      cells += `<span class="cal-cell${s ? ' l' + levelOf(s) : ''}${ghost}"${inRange ? ` data-tip="${tip}" data-date="${iso}" data-n="${s}"` : ''}></span>`;
      if (d === 0 && date.getFullYear() === year && date.getMonth() !== lastMonth && date <= last) { colMonth = MONTHS[date.getMonth()]; lastMonth = date.getMonth(); }
    }
    cols += `<div class="cal-col">${cells}</div>`;
    months += `<span style="width:14px">${colMonth}</span>`;
  }
  const endNote = isCurYear ? ` · s/d ${today.getDate()} ${MONTHS[today.getMonth()]}` : '';
  return { html: `<div class="cal-wrap"><div class="cal-months">${months}</div><div class="cal">${cols}</div><div class="cal-legend">Less <span class="cal-cell"></span><span class="cal-cell l1"></span><span class="cal-cell l2"></span><span class="cal-cell l3"></span><span class="cal-cell l4"></span> More</div></div>`, total, endNote };
}
function yearBounds() {
  const y = new Date().getFullYear();
  return { min: y - 5, max: 2029 };
}

const TITLES = { dashboard: 'Dashboard', ipk: 'IPK Calculator', simulasi: 'Simulasi What-If', tracker: 'Tracker & Fokus', soal: 'Bank Soal', bmp: 'BMP Studio', pdf: 'PDF Tools', export: 'Jadikan File (DOCX/PDF)', ai: 'AI Agen', cap: 'Capture & Rekam', setting: 'Setting', tugas: 'Tugas Kuliah', catatan: 'Catatan' };

// ---------- Render ----------
async function render() {
  const page = currentRoute();
  // Halaman overlay tidak mengubah hash — render dashboard + panel overlay.
  if (overlayPage) {
    markActive(overlayReturn);
    titleEl.textContent = TITLES[overlayPage] || overlayPage;
    try {
      if (overlayPage === 'soal') await vSoal();
      else if (overlayPage === 'bmp') vBmp();
      else if (overlayPage === 'pdf') vPdf();
      else if (overlayPage === 'tugas') vTugas();
      else if (overlayPage === 'catatan') vCatatan();
      content.insertAdjacentHTML('afterbegin', `<div class="row" style="margin:0 0 10px"><button class="btn sm ghost" id="ov-back">${icon('x', 13)}Kembali ke ${escapeHtml(TITLES[overlayReturn] || 'Dashboard')}</button></div>`);
      content.querySelector('#ov-back')?.addEventListener('click', closeOverlay);
    } catch (e) {
      content.innerHTML = `<div class="empty">${icon('x', 30)}<h3>Gagal memuat</h3><p>${escapeHtml(e.message)}</p></div>`;
    }
    refreshStatus();
    return;
  }
  markActive(page);
  titleEl.textContent = TITLES[page] || page;
  try {
    if (page === 'dashboard') await vDashboard();
    else if (page === 'ipk') await vIpk();
    else if (page === 'simulasi') await vSimulasi();
    else if (page === 'tracker') await vTracker();
    else if (page === 'soal') { openOverlay('soal', 'dashboard'); return; }
    else if (page === 'bmp') { openOverlay('bmp', 'dashboard'); return; }
    else if (page === 'pdf') { openOverlay('pdf', 'dashboard'); return; }
    else if (page === 'ai') await vAi();
    else if (page === 'export') await vExport();
    else if (page === 'cap') await vCap();
    else if (page === 'setting') await vSetting();
    else content.innerHTML = `<div class="empty">${icon('grid', 30)}<h3>Halaman tidak dikenal</h3></div>`;
  } catch (e) {
    content.innerHTML = `<div class="empty">${icon('x', 30)}<h3>Gagal memuat</h3><p>${escapeHtml(e.message)}</p></div>`;
  }
  refreshStatus();
}
function escapeHtml(s) { return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

// Badge grade berwarna: A hijau … E merah
function gradePill(g) {
  const k = String(g || '').toUpperCase();
  const cls = k.startsWith('A') ? 'gA' : k.startsWith('B') ? 'gB' : k.startsWith('C') ? 'gC' : k === 'D' ? 'gD' : 'gE';
  return `<span class="grade ${cls}">${escapeHtml(g)}</span>`;
}
function predicateBadge(label) {
  const l = String(label || '');
  const cls = /pujian|sangat/i.test(l) ? 'ok' : /memuaskan|lulus/i.test(l) ? 'warn' : 'bad';
  return `<span class="badge ${cls}">${escapeHtml(l || '-')}</span>`;
}

// ---------- Dashboard ----------
async function vDashboard() {
  const g = await load('tuton_grades', { semesters: [] });
  const t = await load('tuton_tracker', { streak: 0, pomoTotal: 0, xp: 0, level: 1, badges: [] });
  const prof = await load('tuton_profile', {});
  const act = await loadActivityBackfilled();
  const hasData = g.semesters.length > 0;
  let ipk = '0.00', sks = 0, ipsLast = '–';
  try {
    if (hasData) {
      const c = cumulative(g.semesters);
      ipk = c.ipk.toFixed(2); sks = c.sks;
      ipsLast = c.perSemester[c.perSemester.length - 1].ips.toFixed(2);
    }
  } catch (e) { notify(e.message, 'error'); }
  const target = Number(prof.targetIPK) || 4;
  const pct = Math.max(0, Math.min(100, (Number(ipk) / target) * 100));
  const hour = new Date().getHours();
  const greet = hour < 11 ? 'Selamat pagi' : hour < 15 ? 'Selamat siang' : hour < 19 ? 'Selamat sore' : 'Selamat malam';
  // Heatmap ala GitHub: 12 bulan penuh + navigasi tahun.
  const bounds = yearBounds();
  let calYear = Number(prof.calYear) || new Date().getFullYear();
  if (calYear < bounds.min || calYear > bounds.max) calYear = bounds.max;
  const cal = heatmapYearHTML(act.days || {}, calYear);
  const st = streaksFrom(act.days || {}, 52);
  content.innerHTML = `
    <div class="card hero-dash">
      <div class="hero-ut-top">
        <span class="eyebrow" style="margin:0">${icon('grid', 13)} ${greet}${prof.prodi ? ` · ${escapeHtml(prof.prodi)}` : ''}</span>
        <span class="hero-lv">Lv${t.level || 1} · ${t.xp || 0} XP</span>
      </div>
      <div class="hero-top">
        <div>
          <div class="tiny" style="letter-spacing:2px">INDEKS PRESTASI KUMULATIF</div>
          <div class="hero-ipk"><em>${ipk}</em></div>
          <div class="hero-meta">
            <span class="hero-chip"><b>${sks}</b>&nbsp;SKS</span>
            <span class="hero-chip">IPS&nbsp;<b>${ipsLast}</b></span>
            <span class="hero-chip${Number(ipk) >= target ? ' hot' : ''}">Target&nbsp;<b>${target.toFixed(2)}</b></span>
          </div>
        </div>
        <div class="hero-ring" title="${pct.toFixed(0)}% dari target IPK">
          <svg viewBox="0 0 92 92">
            <circle cx="46" cy="46" r="40" fill="none" stroke="rgba(255,255,255,.08)" stroke-width="8"/>
            <circle cx="46" cy="46" r="40" fill="none" stroke="#00e68a" stroke-width="8" stroke-linecap="round" stroke-dasharray="${(2 * Math.PI * 40).toFixed(1)}" stroke-dashoffset="${(2 * Math.PI * 40 * (1 - Math.max(0, Math.min(1, Number(ipk) / target)))).toFixed(1)}"/>
          </svg>
          <div class="pct">${pct.toFixed(0)}<small>%</small></div>
        </div>
      </div>
      <div class="bar" style="position:relative;z-index:1"><i style="width:${pct.toFixed(0)}%"></i></div>
      <div class="hero-ut-grid">
        <div class="hero-ut-cell"><span class="tiny">STREAK</span><b>${st.cur} hari</b><span class="tiny dim">terbaik ${st.best}</span></div>
        <div class="hero-ut-cell"><span class="tiny">POMODORO</span><b>${t.pomoTotal || 0} sesi</b><span class="tiny dim">minggu ini ${t.pomoWeek || 0}</span></div>
        <div class="hero-ut-cell"><span class="tiny">LENCANA</span><b>${(t.badges || []).length}</b><span class="tiny dim">terkumpul</span></div>
        <div class="hero-ut-cell"><span class="tiny">9ROUTER</span><b id="router-dot" style="font-size:12px">cek…</b><span class="tiny dim">model AI</span></div>
      </div>
      ${!hasData ? `<div class="row" style="position:relative;z-index:1"><button class="btn primary" data-go="ipk">${icon('plus', 14)}Input nilai pertama</button></div>` : ''}
    </div>
    <div class="sec">Aktivitas · ${calYear}${cal.endNote || ''}</div>
    <div class="card">
      <div class="row" style="margin:0 0 8px;justify-content:space-between">
        <span class="s" style="margin:0"><b>${cal.total}</b> aktivitas</span>
        <span class="s" style="margin:0">Streak <b>${st.cur}</b> hari · terpanjang <b>${st.best}</b></span>
      </div>
      ${cal.html}
      <div class="tiny" style="text-align:center;margin-top:6px;user-select:none">‹ geser grafik ke kanan / kiri untuk ganti tahun › · <b>${calYear}</b></div>
    </div>
    <div class="sec">Aksi cepat</div>
    <div class="card">
      <div class="row" style="margin:0">
        <button class="btn primary" data-go="ai">${icon('send', 14)}Tanya AI Agen</button>
        <button class="btn" data-go="tracker">${icon('play', 14)}Fokus</button>
        <button class="btn" data-go="ipk">${icon('plus', 14)}Nilai</button>
        <button class="btn ghost" id="btn-checkin">${icon('check', 14)}Check-in</button>
      </div>
    </div>
    <div class="sec">Peralatan</div>
    <div class="card">
      <div class="row" style="margin:0">
        <button class="btn" data-ov="soal">${icon('book', 14)}Bank Soal</button>
        <button class="btn" data-ov="bmp">${icon('layers', 14)}BMP Studio</button>
        <button class="btn" data-ov="pdf">${icon('file', 14)}PDF Tools</button>
        <button class="btn primary" data-go="export">${icon('download', 14)}Jadikan File</button>
        <button class="btn ghost" data-go="simulasi">${icon('spark', 14)}Simulasi</button>
      </div>
    </div>
    <div class="sec">Tugas & Catatan</div>
    <div class="grid">
      <div class="card"><div class="stat"><span class="stat-ic">${icon('calendar', 16)}</span><div><div class="eyebrow">Tugas terbuka</div><div class="num" id="sum-task-open">0</div><div class="s" id="sum-task-sub">belum ada</div></div></div><div class="row" style="margin-bottom:0"><button class="btn sm block" data-ov="tugas">${icon('calendar', 13)}Kelola tugas</button></div></div>
      <div class="card"><div class="stat"><span class="stat-ic">${icon('text', 16)}</span><div><div class="eyebrow">Catatan</div><div class="num" id="sum-note-count">0</div><div class="s" id="sum-note-sub">belum ada</div></div></div><div class="row" style="margin-bottom:0"><button class="btn sm block" data-ov="catatan">${icon('text', 13)}Kelola catatan</button></div></div>
    </div>
    <div class="foot">LOCAL-FIRST · DATA DI PERANGKAT</div>`;
  content.querySelectorAll('[data-go]').forEach((b) => b.addEventListener('click', () => go(b.dataset.go)));
  content.querySelectorAll('[data-ov]').forEach((b) => b.addEventListener('click', () => openOverlay(b.dataset.ov, 'dashboard')));
  const setYear = async (y) => {
    const p = await load('tuton_profile', {});
    await save('tuton_profile', { ...p, calYear: y });
    vDashboard();
  };
  // Tooltip custom gelap (ganti title bawaan browser yg kuning + delay).
  attachCalTip();
  // Geser grafik (swipe/drag) untuk ganti tahun — tanpa tombol.
  attachCalSwipe(calYear, bounds, setYear);
  // Ringkasan tugas + catatan (full UI ada di overlay masing-masing).
  await paintTaskNoteSummary();
  $('#btn-checkin').addEventListener('click', async () => {
    try {
      const r = await chrome.runtime.sendMessage({ type: 'TUTON_CHECKIN' });
      await bumpActivity('c');
      notify(r.added ? `Check-in OK · streak ${r.streak} hari` : `Sudah check-in · streak ${r.streak} hari`);
      render();
    } catch { notify('Worker belum aktif — reload extension.', 'error'); }
  });
  // cek 9router via diagnosa berlapis (tanpa key = tanpa preflight).
  try {
    const cfg = await loadAIConfig();
    const d = await diagConnection(cfg.baseUrl, '', cfg.model);
    const s2 = d.steps[1];
    const el = $('#router-dot');
    if (el) el.innerHTML = s2.ok ? `<span class="dot on"></span> ${s2.detail.split(' ')[0]} model` : '<span class="dot off"></span> offline';
  } catch { const el = $('#router-dot'); if (el) el.innerHTML = '<span class="dot off"></span> offline'; }
}

// Tooltip custom gelap untuk sel heatmap: instan, ngikutin kursor,
// tanpa putih/kuning bawaan browser. Satu elemen #cal-tip dipakai ulang.
function attachCalTip() {
  let tip = document.getElementById('cal-tip');
  if (!tip) {
    tip = document.createElement('div');
    tip.id = 'cal-tip';
    tip.className = 'cal-tip';
    tip.style.display = 'none';
    document.body.appendChild(tip);
  }
  const show = (cell, x, y) => {
    const t = cell.dataset.tip;
    if (!t) return;
    const n = Number(cell.dataset.n) || 0;
    const dt = cell.dataset.date || '';
    tip.innerHTML = `<b>${escapeHtml(t)}</b><span>${dt}${n === 0 ? ' · belum ada aktivitas' : n === 1 ? ' · 1 aksi' : ` · ${n} aksi`}</span>`;
    tip.style.display = 'block';
    const r = tip.getBoundingClientRect();
    let lx = x + 14, ly = y + 16;
    if (lx + r.width > window.innerWidth - 8) lx = x - r.width - 12;
    if (ly + r.height > window.innerHeight - 8) ly = y - r.height - 12;
    tip.style.left = `${Math.max(4, lx)}px`;
    tip.style.top = `${Math.max(4, ly)}px`;
  };
  const hide = () => { tip.style.display = 'none'; };
  content.querySelectorAll('.cal-cell[data-tip]').forEach((cell) => {
    cell.addEventListener('pointerenter', (e) => show(cell, e.clientX, e.clientY));
    cell.addEventListener('pointermove', (e) => show(cell, e.clientX, e.clientY));
    cell.addEventListener('pointerleave', hide);
  });
}

// Geser kanan/kiri pada streak bar = ganti tahun (touch + drag mouse),
// dengan animasi slide. Ambang 40px agar scroll vertikal tidak kepicu.
function attachCalSwipe(calYear, bounds, setYear) {
  const wrap = content.querySelector('.cal-wrap');
  if (!wrap) return;
  let x0 = null;
  const down = (x) => { x0 = x; };
  const up = (x) => {
    if (x0 === null) return;
    const dx = x - x0;
    x0 = null;
    if (Math.abs(dx) < 40) return;
    const next = dx < 0 ? calYear + 1 : calYear - 1; // geser kiri = tahun depan
    if (next < bounds.min || next > bounds.max) { notify(`Hanya ${bounds.min}–${bounds.max}`, 'error'); return; }
    wrap.classList.add(dx < 0 ? 'slide-left' : 'slide-right');
    setTimeout(() => setYear(next), 140);
  };
  wrap.addEventListener('pointerdown', (e) => down(e.clientX));
  wrap.addEventListener('pointerup', (e) => up(e.clientX));
  wrap.addEventListener('pointercancel', () => { x0 = null; });
  wrap.addEventListener('touchstart', (e) => { if (e.touches[0]) down(e.touches[0].clientX); }, { passive: true });
  wrap.addEventListener('touchend', (e) => { if (e.changedTouches[0]) up(e.changedTouches[0].clientX); });
}

// ---------- Tugas kuliah + Catatan (local-first, overlay) ----------
// tuton_tasks: [{id, title, due:'YYYY-MM-DD'|null, prio, done, createdAt}]
// tuton_notes: [{id, title, body, updatedAt}]
// Dashboard hanya menampilkan RINGKASAN (angka + tombol Kelola).
async function paintTaskNoteSummary() {
  const tasks = await load('tuton_tasks', []);
  const notes = await load('tuton_notes', []);
  const today = dayKey();
  const open = tasks.filter((x) => !x.done);
  const late = open.filter((x) => x.due && x.due < today).length;
  const so = $('#sum-task-open');
  if (so) {
    so.textContent = open.length;
    const sub = $('#sum-task-sub');
    if (sub) sub.textContent = open.length ? `${late ? `${late} TERLAMBAT · ` : ''}${open.slice(0, 2).map((x) => x.title.slice(0, 22)).join(' · ')}${open.length > 2 ? '…' : ''}` : 'semua selesai ✓';
  }
  const nc = $('#sum-note-count');
  if (nc) {
    nc.textContent = notes.length;
    const sub = $('#sum-note-sub');
    if (sub) sub.textContent = notes.length ? String(notes[0].title || '').slice(0, 30) : 'belum ada';
  }
}

function vTugas() {
  content.innerHTML = `
    <div class="card">
      <div class="eyebrow">${icon('calendar', 13)} Tugas kuliah</div>
      <div id="task-list"></div>
      <div class="row">
        <input id="task-title" placeholder="cth: Diskusi 3 · STSI4202" style="flex:1;min-width:140px">
        <input id="task-due" type="date" style="max-width:150px">
      </div>
      <div class="row">
        <select id="task-prio" style="max-width:150px"><option value="normal">Prioritas: normal</option><option value="tinggi">tinggi</option><option value="rendah">rendah</option></select>
        <button class="btn primary sm" id="task-add">+ Tugas</button>
      </div>
      <div class="tiny">Tugas lewat deadline otomatis ditandai TERLAMBAT. Selesai = coret + 10 XP.</div>
    </div>`;
  initTasks();
}

function vCatatan() {
  content.innerHTML = `
    <div class="card">
      <div class="eyebrow">${icon('text', 13)} Catatan</div>
      <div id="note-list"></div>
      <input id="note-title" placeholder="Judul · cth: Ringkasan M3" style="margin-top:6px">
      <textarea id="note-body" rows="3" placeholder="Isi catatan…"></textarea>
      <div class="row"><button class="btn primary sm" id="note-add">+ Catatan</button></div>
      <div class="tiny">Max 100 catatan · tiap catatan bisa diunduh .md.</div>
    </div>`;
  initNotes();
}

async function initTasks() {
  const box = $('#task-list');
  if (!box) return;
  const tasks = await load('tuton_tasks', []);
  const today = dayKey();
  const paint = () => {
    const sorted = [...tasks].sort((a, b) => {
      if (!!a.done !== !!b.done) return a.done ? 1 : -1; // belum selesai dulu
      const da = a.due || '9999', db = b.due || '9999';
      if (da !== db) return da < db ? -1 : 1;
      return (b.createdAt || 0) - (a.createdAt || 0);
    });
    const open = tasks.filter((x) => !x.done).length;
    box.innerHTML = (sorted.length ? sorted.map((x) => {
      const late = !x.done && x.due && x.due < today;
      const dueTxt = x.due ? `${x.due.slice(8, 10)}/${x.due.slice(5, 7)}` : 'tanpa deadline';
      const prioBadge = x.prio === 'tinggi' ? '<span class="badge bad">tinggi</span>' : x.prio === 'rendah' ? '<span class="badge dim">rendah</span>' : '';
      const lateBadge = late ? '<span class="badge bad">TERLAMBAT</span>' : '';
      return `<div class="task${x.done ? ' done' : ''}"><label class="todo-row${x.done ? ' done' : ''}" style="flex:1;border:none;padding:0"><input type="checkbox" data-t="${x.id}" ${x.done ? 'checked' : ''}><span>${escapeHtml(x.title)}<div class="tiny">${dueTxt} ${prioBadge} ${lateBadge}</div></span></label><button class="btn sm ghost icon-only" data-tdel="${x.id}" title="Hapus">${icon('x', 12)}</button></div>`;
    }).join('') : `<div class="empty" style="padding:16px">${icon('calendar', 24)}<h3>Belum ada tugas</h3></div>`)
      + (sorted.length ? `<div class="tiny">Terbuka: ${open}/${tasks.length}</div>` : '');
    box.querySelectorAll('[data-t]').forEach((c) => c.addEventListener('change', async () => {
      const it = tasks.find((x) => x.id === c.dataset.t);
      if (!it) return;
      it.done = c.checked;
      await save('tuton_tasks', tasks);
      if (c.checked) {
        try {
          const t = await load('tuton_tracker', {});
          t.xp = (t.xp || 0) + 10; t.level = 1 + Math.floor(t.xp / 1000);
          await save('tuton_tracker', t);
          notify('Tugas selesai · +10 XP');
        } catch { /* XP best-effort */ }
      }
      paint(); refreshStatus();
    }));
    box.querySelectorAll('[data-tdel]').forEach((b) => b.addEventListener('click', async () => {
      const i = tasks.findIndex((x) => x.id === b.dataset.tdel);
      if (i >= 0) { tasks.splice(i, 1); await save('tuton_tasks', tasks); paint(); }
    }));
  };
  paint();
  $('#task-add')?.addEventListener('click', async () => {
    const title = $('#task-title').value.trim();
    if (!title) return notify('Isi judul tugas dulu', 'error');
    tasks.push({ id: uid('task'), title, due: $('#task-due').value || null, prio: $('#task-prio').value || 'normal', done: false, createdAt: Date.now() });
    await save('tuton_tasks', tasks);
    $('#task-title').value = ''; $('#task-due').value = '';
    notify('Tugas ditambah'); paint();
  });
}

async function initNotes() {
  const box = $('#note-list');
  if (!box) return;
  const notes = await load('tuton_notes', []);
  const paint = () => {
    box.innerHTML = notes.length ? notes.map((n) => `<div class="note"><div class="top"><b>${escapeHtml(n.title)}</b><span><button class="btn sm ghost" data-ndl="${n.id}">Hapus</button> <button class="btn sm ghost" data-ndl-dl="${n.id}" title="Unduh .md">.md</button></span></div><div class="tiny">${new Date(n.updatedAt || Date.now()).toLocaleString('id-ID')}</div><div class="body">${escapeHtml((n.body || '').slice(0, 300))}${(n.body || '').length > 300 ? '…' : ''}</div></div>`).join('')
      : `<div class="empty" style="padding:16px">${icon('text', 24)}<h3>Belum ada catatan</h3></div>`;
    box.querySelectorAll('[data-ndl]').forEach((b) => b.addEventListener('click', async () => {
      const i = notes.findIndex((x) => x.id === b.dataset.ndl);
      if (i >= 0) { notes.splice(i, 1); await save('tuton_notes', notes); paint(); }
    }));
    box.querySelectorAll('[data-ndl-dl]').forEach((b) => b.addEventListener('click', () => {
      const n = notes.find((x) => x.id === b.dataset.ndlDl);
      if (n) download(`${bmpSlug(n.title) || 'catatan'}.md`, `# ${n.title}\n\n${n.body || ''}\n`, 'text/markdown');
    }));
  };
  paint();
  $('#note-add')?.addEventListener('click', async () => {
    const title = $('#note-title').value.trim();
    const body = $('#note-body').value.trim();
    if (!title && !body) return notify('Isi judul/catatan dulu', 'error');
    notes.unshift({ id: uid('note'), title: title || '(tanpa judul)', body, updatedAt: Date.now() });
    await save('tuton_notes', notes.slice(0, 100));
    $('#note-title').value = ''; $('#note-body').value = '';
    notify('Catatan tersimpan'); paint();
  });
}

// ---------- IPK ----------
async function vIpk() {
  const g = await load('tuton_grades', { semesters: [] });
  const semOpts = g.semesters.map((s) => `<option value="${s.id}">${escapeHtml(s.label)}</option>`).join('');
  const schemeOpts = Object.entries(SCHEMES).map(([k, v]) => `<option value="${k}">${escapeHtml(v.label)}</option>`).join('');
  content.innerHTML = `
    <div class="card"><div class="eyebrow">${icon('calendar', 13)} Semester</div>
      <div class="row"><input id="sem-label" placeholder="cth: SMT-3 · 2025 Ganjil" style="flex:1;min-width:150px"><button class="btn primary" id="sem-add">+ Semester</button></div>
      <label class="f">Semester aktif</label><select id="sem-sel">${semOpts || '<option value="">— belum ada —</option>'}</select>
    </div>
    <div class="sec">Tambah matkul</div>
    <div class="card"><div class="eyebrow">${icon('chart', 13)} Nilai matkul</div>
      <div class="row"><input id="c-code" placeholder="Kode · STSI4202" style="flex:1;min-width:105px"><input id="c-sks" type="number" min="1" max="6" value="3" title="SKS" style="width:64px;flex:0 0 auto"></div>
      <input id="c-name" placeholder="Nama matkul · cth: Rekayasa Perangkat Lunak">
      <label class="f">Skema bobot</label><select id="c-scheme">${schemeOpts}</select>
      <div class="row"><div style="flex:1"><label class="f">Tuton (0–100)</label><input id="c-tuton" type="number" min="0" max="100" placeholder="80"></div><div style="flex:1"><label class="f">UAS (0–100)</label><input id="c-uas" type="number" min="0" max="100" placeholder="75"></div></div>
      <div class="row"><button class="btn primary block" id="c-add">${icon('check', 14)}Simpan matkul</button></div>
      <div class="tiny">Duplikat kode dalam 1 semester otomatis ditolak · skala UT mode SULIT</div>
    </div>
    <div id="ipk-list"></div>`;
  $('#sem-add').addEventListener('click', async () => {
    const label = $('#sem-label').value.trim() || `Semester ${g.semesters.length + 1}`;
    g.semesters.push({ id: 'sem_' + Date.now().toString(36), label, courses: [] });
    await save('tuton_grades', g); notify('Semester ditambah'); vIpk();
  });
  $('#c-add').addEventListener('click', async () => {
    const semId = $('#sem-sel').value;
    if (!semId) return notify('Buat semester dulu', 'error');
    const sem = g.semesters.find((s) => s.id === semId);
    const course = { code: $('#c-code').value.trim(), name: $('#c-name').value.trim(), sks: Number($('#c-sks').value), scheme: $('#c-scheme').value, tuton: Number($('#c-tuton').value), uas: Number($('#c-uas').value) };
    // cegah duplikat
    if (sem.courses.some((c) => c.code.trim().toUpperCase() === course.code.toUpperCase())) return notify(`Duplikat kode ${course.code}`, 'error');
    sem.courses.push(course);
    try { (await import('../src/lib/gpa.js')).validateSemester(sem.courses); } catch (e) { sem.courses.pop(); return notify(e.message, 'error'); }
    await save('tuton_grades', g); notify('Matkul tersimpan'); vIpk();
  });
  // daftar + IPK
  const list = $('#ipk-list');
  try {
    const c = cumulative(g.semesters);
    try { chrome.runtime.sendMessage({ type: 'TUTON_IPK_SAVED', ipk: c.ipk }).catch(() => {}); } catch { /* worker mati */ }
    let html = `<div class="sec">Hasil</div><div class="card hero"><div class="eyebrow">${icon('chart', 13)} Indeks prestasi kumulatif</div><div class="big">IPK <em>${c.ipk.toFixed(2)}</em></div><div class="s">${c.sks} SKS · mutu ${c.mutu}</div></div>`;
    for (const sem of c.perSemester) {
      html += `<div class="card"><div class="eyebrow">${icon('calendar', 13)} ${escapeHtml(sem.label)} · IPS <b>${sem.ips.toFixed(2)}</b> · ${sem.sks} SKS</div>
      <table><tr><th>Matkul</th><th>Final</th><th>Grade</th><th></th></tr>${sem.courses.map((m) => `<tr><td><b>${escapeHtml(m.code)}</b><div class="tiny">${escapeHtml(m.name || '')}</div></td><td>${m.final}</td><td>${gradePill(m.grade)}</td><td><button class="btn sm ghost icon-only" data-del="${sem.id}|${escapeHtml(m.code)}" title="Hapus">${icon('x', 13)}</button></td></tr>`).join('')}</table></div>`;
    }
    if (!g.semesters.length) html += `<div class="empty">${icon('search', 30)}<h3>Belum ada data</h3><p>Tambah semester lalu isi matkul di atas.</p></div>`;
    list.innerHTML = html;
    list.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => {
      const [semId, code] = b.dataset.del.split('|');
      const sem = g.semesters.find((s) => s.id === semId);
      sem.courses = sem.courses.filter((c2) => c2.code !== code);
      await save('tuton_grades', g); vIpk();
    }));
  } catch (e) { list.innerHTML = `<div class="empty"><p>${escapeHtml(e.message)}</p></div>`; }
}

// ---------- Simulasi ----------
async function vSimulasi() {
  const g = await load('tuton_grades', { semesters: [] });
  let cur = { ipk: 0, sks: 0, mutu: 0 };
  try { if (g.semesters.length) cur = cumulative(g.semesters); } catch (e) { return notify(e.message, 'error'); }
  const weak = g.semesters.length ? parasites(g.semesters.flatMap((s) => s.courses)).slice(0, 5) : [];
  content.innerHTML = `
    <div class="card hero"><div class="eyebrow">${icon('chart', 13)} Posisi sekarang</div><div class="big">IPK <em>${cur.ipk.toFixed(2)}</em></div><div class="s">${cur.sks} SKS · mutu ${cur.mutu}</div></div>
    <div class="sec">Simulasi semester berjalan</div>
    <div class="card">
      <div class="row"><div style="flex:1;min-width:110px"><label class="f">SKS berjalan</label><input id="s-sks" type="number" value="21" min="1" max="24"></div><div style="flex:1;min-width:110px"><label class="f">Target IPS</label><input id="s-ips" type="number" step="0.01" value="3.50" min="0" max="4"></div></div>
      <div class="row"><button class="btn primary block" id="s-run">${icon('spark', 14)}Hitung prediksi</button></div>
      <div id="s-out" style="margin-top:10px"></div>
      <div class="tiny">Predikat: ${PREDICATES.map((p) => `${p.label} ≥${p.min}`).join(' · ')}</div>
    </div>
    <div class="sec">Parasit IPK</div>
    <div class="card">
      ${weak.length ? `<div class="s" style="margin:0 0 4px">Matkul yang paling menarik IPK-mu turun — perbaiki ini dulu:</div><table><tr><th>Matkul</th><th>Grade</th><th>Dampak</th></tr>${weak.map((w) => `<tr><td><b>${escapeHtml(w.code)}</b></td><td>${gradePill(w.grade)}</td><td>−${w.impact}</td></tr>`).join('')}</table>` : `<div class="empty">${icon('check', 30)}<h3>Bersih</h3><p>Tidak ada parasit — semua ≥ B, atau belum input nilai.</p></div>`}
    </div>`;
  $('#s-run').addEventListener('click', () => {
    try {
      const r = simulate({ curMutu: cur.mutu, curSKS: cur.sks, sksNow: Number($('#s-sks').value), targetIPS: Number($('#s-ips').value) });
      const pct = Math.max(0, Math.min(100, (r.predIPK / 4) * 100));
      $('#s-out').innerHTML = `<div class="eyebrow">${icon('spark', 13)} Prediksi IPK akhir</div><div class="big" style="font-size:32px;font-weight:800">IPK <em style="font-style:normal;color:var(--acc)">${r.predIPK.toFixed(2)}</em> ${predicateBadge(r.predicate)}</div><div class="bar"><i style="width:${pct.toFixed(0)}%"></i></div><div class="s">Δ ${r.delta >= 0 ? '+' : ''}${r.delta} · mutu akhir ${r.mutuTotal} (simulasi +${r.mutuSim})</div>`;
    } catch (e) { notify(e.message, 'error'); }
  });
}

// ---------- Tracker: Pomodoro + Stopwatch + Timer ----------
function fmtClock(totalSec) {
  const s = Math.max(0, Math.floor(totalSec));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60;
  const p = (n) => String(n).padStart(2, '0');
  return h > 0 ? `${p(h)}:${p(m)}:${p(ss)}` : `${p(m)}:${p(ss)}`;
}
function fmtDur(mins) { return mins >= 60 ? `${Math.floor(mins / 60)}j ${mins % 60 ? `${mins % 60}mnt` : ''}`.trim() : `${mins} mnt`; }

async function vTracker() {
  const t = await load('tuton_tracker', {});
  let pomo = null, timer = null, sw = null;
  try { const r = await chrome.runtime.sendMessage({ type: 'TUTON_POMO_STATE' }); pomo = r.pomo; } catch { /* worker mati */ }
  try { const r = await chrome.runtime.sendMessage({ type: 'TUTON_TIMER_STATE' }); timer = r.timer; } catch { /* worker mati */ }
  sw = await load('tuton_stopwatch', null); // {startedAt, accSec, running}
  const pomoLive = pomo && !pomo.done && pomo.endsAt > Date.now();
  const timerLive = timer && !timer.done && timer.endsAt > Date.now();
  const swLive = sw?.running;
  const swSecNow = sw ? (sw.accSec || 0) + (sw.running && sw.startedAt ? Math.floor((Date.now() - sw.startedAt) / 1000) : 0) : 0;

  // MODE LIVE (full-page ring): salah satu timer jalan → hanya ring + Batal.
  // User tetap bisa buka page lain (AI dsb) — ini cuma tampilan section tracker.
  if (pomoLive || timerLive || swLive) {
    const live = pomoLive
      ? { kind: 'pomo', label: pomo.label || 'Pomodoro', total: (pomo.mins || 25) * 60, left: () => Math.max(0, (pomo.endsAt - Date.now()) / 1000), cancel: 'TUTON_POMO_CANCEL', cancelTxt: 'Batalkan pomodoro (tanpa XP)' }
      : timerLive
        ? { kind: 'timer', label: timer.label || 'Timer', total: (timer.mins || 5) * 60, left: () => Math.max(0, (timer.endsAt - Date.now()) / 1000), cancel: 'TUTON_TIMER_CANCEL', cancelTxt: 'Batalkan timer' }
        : { kind: 'sw', label: 'Stopwatch', total: 0, left: () => swSecNowRef.v, cancel: null, cancelTxt: '' };
    const swSecNowRef = { v: swSecNow };
    content.innerHTML = `
      <div class="card hero"><div class="ring-wrap">
        <div class="eyebrow" style="justify-content:center">${icon(live.kind === 'sw' ? 'play' : 'timer', 13)} ${escapeHtml(live.label)} · live</div>
        <svg class="ring-svg live" viewBox="0 0 220 220">
          <circle cx="110" cy="110" r="96" fill="none" stroke="rgba(255,255,255,.08)" stroke-width="12"/>
          <circle id="ring-fg" cx="110" cy="110" r="96" fill="none" stroke="#00e68a" stroke-width="12" stroke-linecap="round" transform="rotate(-90 110 110)"/>
          <text x="110" y="106" text-anchor="middle" class="ring-time" id="ring-clock">${live.kind === 'sw' ? fmtClock(swSecNow) : fmtClock(live.left())}</text>
          <text x="110" y="132" text-anchor="middle" class="ring-label">${live.kind === 'pomo' ? 'FOKUS' : live.kind === 'timer' ? 'PENGINGAT' : 'HITUNG NAIK'}</text>
        </svg>
        <div class="s" style="text-align:center">${live.kind === 'pomo' ? 'Jalan walau panel ditutup · selesai = XP otomatis.' : live.kind === 'timer' ? 'Pengingat — tidak menambah XP.' : 'Tetap jalan walau pindah page / panel ditutup.'}</div>
        <div class="row" style="justify-content:center">
          ${live.kind === 'sw'
            ? `<button class="btn sm" id="live-sw-pause">${sw.running && sw.startedAt ? 'Jeda' : 'Lanjut'}</button><button class="btn sm primary" id="live-sw-save">Simpan</button>`
            : `<button class="btn sm danger" id="live-cancel">Batal</button>`}
          <button class="btn sm ghost" data-go="ai">${icon('send', 13)}Buka AI</button>
        </div>
      </div></div>
      <div class="foot">TRACKER LIVE · PINDAH PAGE BEBAS, TIMER TETAP JALAN</div>`;
    content.querySelector('[data-go]').addEventListener('click', () => go('ai'));
    const C = 2 * Math.PI * 96;
    const fg = $('#ring-fg');
    const paint = () => {
      const left = live.kind === 'sw' ? swSecNowRef.v : live.left();
      const clock = $('#ring-clock');
      if (!clock) { clearInterval(tick); return; }
      clock.textContent = fmtClock(left);
      if (fg) {
        const frac = live.total > 0 ? Math.max(0, Math.min(1, left / live.total)) : (left % 3600) / 3600;
        fg.style.strokeDasharray = `${C}`;
        fg.style.strokeDashoffset = `${C * (1 - frac)}`;
      }
    };
    const tick = setInterval(() => {
      if (live.kind === 'sw') {
        load('tuton_stopwatch', null).then((s) => {
          swSecNowRef.v = s ? (s.accSec || 0) + (s.running && s.startedAt ? Math.floor((Date.now() - s.startedAt) / 1000) : 0) : swSecNowRef.v;
          paint();
        }).catch(() => paint());
      } else paint();
    }, 1000);
    paint();
    $('#live-cancel')?.addEventListener('click', async () => {
      try { await chrome.runtime.sendMessage({ type: live.cancel }); notify('Dibatalkan'); vTracker(); }
      catch { notify('Worker mati — reload extension.', 'error'); }
    });
    $('#live-sw-pause')?.addEventListener('click', async () => {
      const cur = await load('tuton_stopwatch', null);
      if (!cur) return;
      if (cur.startedAt) await save('tuton_stopwatch', { accSec: (cur.accSec || 0) + Math.floor((Date.now() - cur.startedAt) / 1000), running: true, startedAt: 0 });
      else await save('tuton_stopwatch', { ...cur, startedAt: Date.now(), running: true });
      vTracker();
    });
    $('#live-sw-save')?.addEventListener('click', async () => {
      const cur = await load('tuton_stopwatch', null);
      const sec = cur ? (cur.accSec || 0) + (cur.startedAt ? Math.floor((Date.now() - cur.startedAt) / 1000) : 0) : 0;
      if (sec < 1) return;
      await save('tuton_stopwatch', null);
      try {
        const r = await chrome.runtime.sendMessage({ type: 'TUTON_FOCUS_SAVE', seconds: sec, label: 'Stopwatch' });
        notify(r.gained ? `Tersimpan ${fmtClock(sec)} · +${r.gained} XP` : 'Tersimpan (< 1 menit, tanpa XP)');
      } catch { notify('Worker mati — reload extension.', 'error'); }
      vTracker();
    });
    return;
  }

  // MODE IDLE: mini live-chip (sesi baru selesai / aksi cepat) + pemilih biasa.
  const focusH = ((t.focusSec || 0) / 3600).toFixed(1);
  content.innerHTML = `
    <div class="row" style="margin:0 0 10px;justify-content:center" id="sw-chip-row" ${swSecNow > 0 ? '' : 'style="display:none;margin:0"'}><span class="live-chip"><span class="dot on"></span>Stopwatch jeda · ${fmtClock(swSecNow)} — <a href="#" id="sw-resume" style="color:var(--acc)">lanjut</a></span></div>
    <div class="card hero" style="text-align:center">
      <div class="eyebrow" style="justify-content:center">${icon('timer', 13)} Pomodoro · alarm lokal</div>
      <div class="big">Siap</div>
      <div class="s">Pilih durasi — timer tetap jalan walau panel ditutup.</div>
      <div class="row" style="justify-content:center">
        <button class="btn sm" data-pomo="15">15</button>
        <button class="btn primary sm" data-pomo="25">25</button>
        <button class="btn sm" data-pomo="50">50</button>
        <input id="pomo-custom" type="number" min="1" max="180" placeholder="mnt" style="width:64px">
        <button class="btn sm" id="pomo-go">Mulai</button>
      </div>
      <div class="tiny">Selesai = XP proporsional (100 XP / 25 mnt) · minggu ini ${t.pomoWeek || 0} sesi · total fokus ${focusH} jam</div>
    </div>
    <div class="sec">Stopwatch — hitung naik (tetap jalan walau pindah page)</div>
    <div class="card" style="text-align:center">
      <div class="eyebrow" style="justify-content:center">${icon('play', 13)} Stopwatch</div>
      <div class="big" id="sw-clock">${fmtClock(swSecNow)}</div>
      <div class="s" id="sw-hint">${swSecNow > 0 ? `${fmtClock(swSecNow)} — jeda. Mulai untuk lanjut, Simpan untuk catat XP.` : 'Mulai — boleh pindah page/AI, stopwatch tetap jalan.'}</div>
      <div class="row" style="justify-content:center">
        <button class="btn primary sm" id="sw-start">Mulai</button>
        <button class="btn sm" id="sw-reset">Reset</button>
        <button class="btn sm primary" id="sw-save" ${swSecNow > 0 ? '' : 'disabled'}>Simpan</button>
      </div>
      <div class="tiny">Simpan = catat detik fokus + XP (min. 1 menit).</div>
    </div>
    <div class="sec">Timer — hitung mundur bebas (pengingat)</div>
    <div class="card" style="text-align:center">
      <div class="eyebrow" style="justify-content:center">${icon('timer', 13)} Timer</div>
      <div class="big">--:--</div>
      <div class="s">Tidak menambah XP — murni pengingat.</div>
      <div class="row" style="justify-content:center">
        <input id="timer-label" placeholder="label, cth: istirahat" style="flex:1;min-width:110px">
        <input id="timer-mins" type="number" min="1" max="720" placeholder="mnt" style="width:64px" value="5">
        <button class="btn sm primary" id="timer-go">Mulai</button>
      </div>
    </div>
    <div class="sec">Checklist mingguan</div>
    <div class="card"><div id="todo"></div>
      <div class="row" style="margin-bottom:0"><input id="todo-in" placeholder="cth: Diskusi 3 · STSI4202" style="flex:1;min-width:140px"><button class="btn primary icon-only" id="todo-add" title="Tambah">+</button></div>
      <div class="tiny">Tugas kuliah & deadline juga bisa dicatat di menu Tugas (di Dashboard bawah).</div>
    </div>`;
  // --- pomodoro bindings ---
  content.querySelectorAll('[data-pomo]').forEach((b) => b.addEventListener('click', () => pomoStart(Number(b.dataset.pomo))));
  $('#pomo-go').addEventListener('click', () => {
    const m = Math.min(Math.max(Number($('#pomo-custom').value) || 25, 1), 180);
    pomoStart(m);
  });
  async function pomoStart(m) {
    try { await chrome.runtime.sendMessage({ type: 'TUTON_POMO_START', minutes: m, label: `Pomodoro ${m} mnt` }); notify(`Pomodoro ${m} mnt dimulai`); setTimeout(vTracker, 500); }
    catch { notify('Worker mati — reload extension di chrome://extensions.', 'error'); }
  }
  // --- stopwatch persisten (storage + timestamp; jalan walau pindah page) ---
  $('#sw-resume')?.addEventListener('click', async (e) => {
    e.preventDefault();
    const cur = await load('tuton_stopwatch', null);
    if (cur && !cur.startedAt) await save('tuton_stopwatch', { ...cur, startedAt: Date.now(), running: true });
    vTracker();
  });
  $('#sw-start').addEventListener('click', async () => {
    const cur = (await load('tuton_stopwatch', null)) || { accSec: 0, running: false, startedAt: 0 };
    await save('tuton_stopwatch', { accSec: cur.accSec || 0, running: true, startedAt: Date.now() });
    notify('Stopwatch jalan — boleh pindah page'); setTimeout(vTracker, 300);
  });
  $('#sw-reset').addEventListener('click', async () => { await save('tuton_stopwatch', null); notify('Stopwatch direset'); vTracker(); });
  $('#sw-save').addEventListener('click', async () => {
    const cur = await load('tuton_stopwatch', null);
    const sec = cur ? (cur.accSec || 0) + (cur.startedAt ? Math.floor((Date.now() - cur.startedAt) / 1000) : 0) : 0;
    if (sec < 1) return;
    await save('tuton_stopwatch', null);
    try {
      const r = await chrome.runtime.sendMessage({ type: 'TUTON_FOCUS_SAVE', seconds: sec, label: 'Stopwatch' });
      notify(r.gained ? `Tersimpan ${fmtClock(sec)} · +${r.gained} XP` : 'Tersimpan (< 1 menit, tanpa XP)');
      refreshStatus();
    } catch { notify('Worker mati — reload extension.', 'error'); }
    vTracker();
  });
  // --- timer bindings (alarm, tanpa XP) ---
  $('#timer-go').addEventListener('click', async () => {
    const mins = Math.min(Math.max(Number($('#timer-mins').value) || 5, 1), 720);
    const label = $('#timer-label').value.trim() || 'Timer';
    try { await chrome.runtime.sendMessage({ type: 'TUTON_TIMER_START', minutes: mins, label }); notify(`Timer ${fmtDur(mins)} dimulai`); setTimeout(vTracker, 500); }
    catch { notify('Worker mati — reload extension.', 'error'); }
  });
  const todos = await load('tuton_todo', []);
  const box = $('#todo');
  const paint = () => { box.innerHTML = todos.length ? todos.map((x, i) => `<label class="todo-row${x.done ? ' done' : ''}"><input type="checkbox" data-i="${i}" ${x.done ? 'checked' : ''}><span>${escapeHtml(x.text)}</span></label>`).join('') : `<div class="empty">${icon('calendar', 30)}<h3>Kosong</h3><p>Tambah target mingguanmu di bawah.</p></div>`;
    box.querySelectorAll('input').forEach((c) => c.addEventListener('change', async () => { todos[Number(c.dataset.i)].done = c.checked; await save('tuton_todo', todos); })); };
  paint();
  $('#todo-add').addEventListener('click', async () => { const v = $('#todo-in').value.trim(); if (!v) return; todos.push({ text: v, done: false }); await save('tuton_todo', todos); paint(); $('#todo-in').value = ''; });
}

// ---------- Bank soal: dari folder modul PDF (AI bila ada token, manual bila tidak) ----------
// Alur user: pilih folder modul -> daftar PDF terdeteksi (nama file = kode modul)
// -> pilih jumlah (5/10/15/20/30) + kesulitan (mudah/sedang/sulit/hots)
// -> mode AI (token di Setting) atau Manual/Offline (komputer lokal).
// Soal dienkripsi sisi client (AES-GCM, kunci perangkat tuton_qkey), dirender
// ulang oleh extension sendiri. Modul sama -> paket sama muncul lagi (cache by
// modKey+jumlah+diff+mode + hash soal anti-duplikat qHash/tuton_qseen).
async function vSoal() {
  try { clearInterval(globalThis.__qTimer); } catch { /* abaikan */ }
  globalThis.__qTimer = null;
  const cache = await load('tuton_qcache', {});
  const seen = (await load('tuton_qseen', [])) || [];
  const qlog = (await load('tuton_qlog', {})) || {}; // { [paket]: [{at,score,correct,total,secs,diff}] }
  const names = Object.keys(cache);
  const pkgQs = (n) => {
    const v = cache[n];
    if (Array.isArray(v?.data?.questions)) return v.data.questions.length;
    if (typeof v?.count === 'number') return v.count;
    return 0;
  };
  // Statistik per paket dari riwayat tes (bukan dari soal!) — kunci tidak pernah bocor ke sini.
  const pkgStat = (n) => {
    const arr = Array.isArray(qlog[n]) ? qlog[n] : [];
    if (!arr.length) return null;
    const scores = arr.map((a) => Number(a.score) || 0);
    return {
      n: arr.length,
      best: Math.max(...scores),
      avg: Math.round(scores.reduce((a, b) => a + b, 0) / scores.length),
      last: scores[scores.length - 1],
    };
  };
  const allRuns = names.flatMap((n) => (Array.isArray(qlog[n]) ? qlog[n].map((a) => ({ ...a, pkg: n })) : []));
  const totSoal = names.reduce((a, n) => a + pkgQs(n), 0);
  const avgAll = allRuns.length ? Math.round(allRuns.reduce((a, r) => a + (Number(r.score) || 0), 0) / allRuns.length) : null;
  content.innerHTML = `
    <div class="qflow" id="qflow">
      <div class="qstep on" data-step="1"><i>1</i><span>Modul</span></div>
      <div class="qstep-bar"></div>
      <div class="qstep" data-step="2"><i>2</i><span>Atur</span></div>
      <div class="qstep-bar"></div>
      <div class="qstep" data-step="3"><i>3</i><span>Tes</span></div>
      <div class="qstep-bar"></div>
      <div class="qstep" data-step="4"><i>4</i><span>Hasil</span></div>
    </div>
    <div id="q-stage"></div>
    <div class="sec">Riwayat paket</div>
    <div class="card"><div class="eyebrow">${icon('book', 13)} Paket lokal (${names.length}) · terenkripsi perangkat</div>
      ${names.length ? names.map((n) => { const q = pkgQs(n); const mode = cache[n]?.mode ? ` · ${escapeHtml(cache[n].mode)}` : ''; const st = pkgStat(n); const sub = [q + ' soal · tersimpan lokal' + mode, st ? `terbaik ${st.best} · rata-rata ${st.avg} (${st.n}×)` : 'belum pernah dites'].join(' · '); return `<div class="pkg-row"><span class="stat-ic">${icon('book', 15)}</span><span class="name">${escapeHtml(n)}<div class="tiny">${escapeHtml(sub)}</div></span><span class="row" style="margin:0"><button class="btn sm primary" data-quiz="${escapeHtml(n)}">Tes</button><button class="btn sm ghost" data-exp="${escapeHtml(n)}">DOCX/PDF</button></span></div>`; }).join('') : `<div class="empty">${icon('book', 30)}<h3>Belum ada paket</h3><p>Pilih folder modul di bawah — tanpa server.</p></div>`}
    </div>
    <div class="sec">Tambah paket (manual JSON)</div>
    <div class="card">
      <label class="f">Nama paket</label><input id="q-name" placeholder="STSI4202-uas">
      <label class="f">JSON soal</label><textarea id="q-json" rows="5" placeholder='{"paket":"...","questions":[{"id":"1","modul":1,"q":"...","choices":["A","B","C","D"],"answer":0}]}'></textarea>
      <div class="row"><button class="btn primary" id="q-save">${icon('check', 14)}Simpan lokal</button><button class="btn ghost" id="q-sample">Contoh</button></div>
    </div>`;
  // ---- State mesin tes: setup -> tes -> hasil. Kunci TIDAK PERNAH dirender saat tes. ----
  const flow = { files: [], pick: 0, count: 10, diff: 'sedang', mode: 'auto', actual: 'manual', name: '', qs: [], ans: {}, idx: 0, secs: 0, timer: null, t0: 0 };
  const stage = () => $('#q-stage');
  const setStep = (n) => { content.querySelectorAll('.qstep').forEach((el) => el.classList.toggle('on', Number(el.dataset.step) <= n)); };
  const paintSetup = () => {
    setStep(flow.files.length ? 2 : 1);
    stage().innerHTML = `
    <div class="sec">1 · Modul — pilih folder PDF</div>
    <div class="card">
      <div class="tiny">Pilih <b>folder</b> tempat modul-modul PDF disimpan. Extension hanya membaca nama + isi file saat tes dimulai — tidak memantau folder terus-menerus.</div>
      <div class="row"><button class="btn primary" id="q-pickdir">${icon('file', 14)}Pilih folder modul</button><span class="tiny" id="q-dirname">${flow.files.length ? flow.files.length + ' PDF siap' : ''}</span></div>
      <div id="q-modlist">${flow.files.length ? `<div class="tiny" style="margin-top:6px">${flow.files.length} PDF terdeteksi:</div>` + flow.files.map((f, i) => `<label class="opt qmod"><input type="radio" name="qmod" value="${i}"${i === flow.pick ? ' checked' : ''}><span>${escapeHtml(f.name)}</span></label>`).join('') : ''}</div>
    </div>
    <div class="sec">2 · Jumlah + kesulitan + mode</div>
    <div class="card">
      <div class="row">
        <div style="flex:1;min-width:90px"><label class="f">Jumlah soal</label><select id="q-count">${COUNTS.map((c) => `<option value="${c}"${c === flow.count ? ' selected' : ''}>${c} soal</option>`).join('')}</select></div>
        <div style="flex:1;min-width:110px"><label class="f">Kesulitan</label><select id="q-diff">${DIFFS.map((d) => `<option value="${d}"${d === flow.diff ? ' selected' : ''}>${d}${d === 'hots' ? ' (analisis)' : ''}</option>`).join('')}</select></div>
        <div style="flex:1;min-width:130px"><label class="f">Mode</label><select id="q-mode"><option value="auto"${flow.mode === 'auto' ? ' selected' : ''}>Otomatis (AI bila ada token)</option><option value="ai"${flow.mode === 'ai' ? ' selected' : ''}>AI (butuh token AI)</option><option value="manual"${flow.mode === 'manual' ? ' selected' : ''}>Manual / offline</option></select></div>
      </div>
      <div class="tiny">Waktu tes otomatis: ${Math.ceil(flow.count * 1.5)} menit (${flow.count} soal × 90 detik). AI butuh token di Setting &gt; AI; Manual offline 100%.</div>
      <div class="row"><button class="btn primary block" id="q-gen">${icon('spark', 14)}MULAI TES</button></div>
      <div class="tiny" id="q-gen-note"></div>
    </div>`;
    stage().querySelectorAll('input[name=qmod]').forEach((r) => r.addEventListener('change', () => { flow.pick = Number(r.value); }));
    $('#q-count').addEventListener('change', (e) => { flow.count = Number(e.target.value) || 10; paintSetup(); });
    $('#q-diff').addEventListener('change', (e) => { flow.diff = String(e.target.value); });
    $('#q-mode').addEventListener('change', (e) => { flow.mode = String(e.target.value); });
    $('#q-pickdir').addEventListener('click', async () => {
      try {
        const input = document.createElement('input');
        input.type = 'file'; input.multiple = true; input.accept = '.pdf,application/pdf';
        if ('webkitdirectory' in input) {
          const useDir = confirm('OK = pilih FOLDER modul (semua PDF di dalamnya).\nBatal = pilih file PDF satu-per-satu.');
          if (useDir) { input.removeAttribute('multiple'); input.setAttribute('webkitdirectory', ''); }
        }
        const picked = await new Promise((res) => { input.onchange = () => res([...input.files]); input.click(); });
        flow.files = (picked || []).filter((f) => /\.pdf$/i.test(f.name)).map((f) => ({ name: f.name, file: f }));
        flow.pick = 0;
        paintSetup();
        if (flow.files.length) notify(`${flow.files.length} modul PDF terdeteksi`);
      } catch (e) { notify('Gagal pilih folder: ' + e.message, 'error'); }
    });
    $('#q-gen').addEventListener('click', () => genFromModule().catch((e) => {
      $('#q-gen-note').textContent = 'Gagal: ' + e.message;
      notify('Gagal buat soal: ' + e.message, 'error');
    }));
  };
  content.querySelectorAll('[data-quiz]').forEach((b) => b.addEventListener('click', () => playQuiz(b.dataset.quiz)));
  content.querySelectorAll('[data-exp]').forEach((b) => b.addEventListener('click', () => exportPkg(b.dataset.exp)));
  // Export paket -> markdown -> DOCX/PDF via template (rumus LaTeX jadi OMML).
  async function exportPkg(name) {
    const pkg = cache[name];
    let qs = [];
    try {
      if (pkg?.enc) qs = (await decQuestions(pkg.enc)).questions || [];
      else qs = pkg?.data?.questions || [];
    } catch (e) { notify('Gagal buka paket: ' + e.message, 'error'); return; }
    if (!qs.length) { notify('Paket kosong.', 'error'); return; }
    const lines = [`# Bank Soal — ${name}`, ''];
    qs.forEach((q, i) => {
      lines.push(`## Soal ${i + 1}`, '', String(q.q || ''), '');
      (q.choices || []).forEach((c, j) => lines.push(`- ${'ABCD'[j] || '•'}. ${c}`));
      lines.push('', `*Kunci: ${'ABCD'[q.answer] ?? q.answer}${q.bahas ? ` — ${q.bahas}` : ''}*`, '');
    });
    const md = lines.join('\n');
    try {
      const doc = { title: `Bank Soal ${name}`, label: `Bank Soal ${name}` };
      const r = await exportDocx({ markdown: md, doc });
      notify(`DOCX terunduh: ${r.name}`);
    } catch (e) { notify('Export gagal: ' + e.message, 'error'); }
  }
  // ---------- Generator: folder PDF -> soal (AI / manual), lalu LANGSUNG TES ----------
  // Kunci TIDAK PERNAH tampil sebelum Kumpulkan. Selesai -> hasil+statistik+save, balik setup.
  const qNote = () => $('#q-gen-note');
  async function pdfTextOf(file) {
    // Lapis 1: lokal (pdf.js + OCR). Lapis 2: runtime. Kembalikan teks polos.
    try {
      const t = await pdfFileToText(file, (m) => { if (qNote()) qNote().textContent = m; });
      return String(t || '').replace(/^\(judul:[^\n]*\n/, '').slice(0, 12000);
    } catch (eLocal) {
      if (qNote()) qNote().textContent = 'Baca lokal gagal, coba via Tuton Runtime…';
      const rr = await readViaRuntime(file);
      if (rr?.ok && rr.text) return String(rr.text).replace(/^\(judul:[^\n]*\n/, '').slice(0, 12000);
      throw new Error(`PDF tidak terbaca (lokal: ${String(eLocal.message).slice(0, 80)}; runtime: ${String(rr?.hint || rr?.mode || 'gagal').slice(0, 80)}). Nyalakan runtime / screenshot bila vision.`);
    }
  }
  function aiPrompt(text, modKey, count, diff, seenCount) {
    const lvl = { mudah: 'faktual-ingatan (C1)', sedang: 'pemahaman-aplikasi (C2-C3)', sulit: 'analisis (C4)', hots: 'evaluasi/sintesis HOTS (C5-C6), soal cerita mini' }[diff] || 'pemahaman';
    return `Buat TEPAT ${count} soal pilihan ganda (4 opsi A-D) dari materi UT berikut (kode: ${modKey}, level: ${diff} = ${lvl}).\n` +
      `Rumus MATEMATIKA wajib LaTeX ($...$ inline, $$...$$ blok). Bahasa Indonesia.\n` +
      `Jawab HANYA JSON valid tanpa fence/teks lain: {"paket":"${modKey}","questions":[{"id":"1","modul":1,"q":"...","choices":["...","...","...","..."],"answer":0,"bahas":"satu kalimat"}]} — answer=index 0-3.\n` +
      (seenCount ? `Sudah ada ${seenCount} soal lama dari modul ini — buat soal BARU yang tidak mengulanginya.\n` : '') +
      `Materi:\n${text}`;
  }
  async function genFromModule() {
    if (!flow.files.length) throw new Error('Pilih folder modul dulu (atau file PDF).');
    const pick = flow.files[flow.pick] || flow.files[0];
    const count = flow.count;
    const diff = flow.diff;
    const mode = flow.mode;
    const modKey = pick.name.replace(/\.pdf$/i, '').slice(0, 40) || 'MODUL';
    const note = (m) => { if (qNote()) qNote().textContent = m; };
    const name = pkgName(modKey, count, diff, mode === 'auto' ? 'mix' : mode);
    const loadCached = async (n) => {
      if (cache[n]?.enc || cache[n]?.data) {
        note(`Paket ${n} sudah ada — dibuka dari cache (modul sama tidak dibuat ulang).`);
        const qs = await decOrPlain(cache[n]);
        startExam(n, qs, cache[n]?.mode || 'cache');
        return true;
      }
      return false;
    };
    // Modul sama -> paket sama muncul lagi (cache). Beda angka tapi mirip ok.
    if (await loadCached(name)) return;
    note(`Membaca ${pick.name}…`);
    const text = await pdfTextOf(pick.file);
    if (text.replace(/\s/g, '').length < 200) throw new Error('Teks modul terlalu pendek — PDF mungkin gambar semua. Coba modul teks / nyalakan OCR.');
    // Tentukan mode aktual: auto = AI bila ada token, manual bila tidak.
    let useAI = mode === 'ai' || mode === 'auto';
    if (useAI) {
      try {
        const cfg = await loadAIConfig();
        if (!cfg.apiKey && (cfg.provider || '9router') !== 'router') {
          if (mode === 'ai') throw new Error('Mode AI butuh token: isi di Setting > AI dulu (atau pakai Manual/offline).');
          useAI = false;
        }
      } catch (e) { if (mode === 'ai') throw e; useAI = false; }
    }
    const actualMode = useAI ? 'ai' : 'manual';
    const finalName = pkgName(modKey, count, diff, actualMode);
    if (await loadCached(finalName)) return;
    note(useAI ? `Membuat ${count} soal ${diff} via AI…` : `Menyusun ${count} soal ${diff} secara offline…`);
    let questions;
    if (useAI) {
      const r = await askAI({ messages: [{ role: 'user', content: aiPrompt(text, modKey, count, diff, seen.length) }] });
      const obj = JSON.parse(extractJson(r.content));
      if (!Array.isArray(obj.questions) || !obj.questions.length) throw new Error('AI tidak mengembalikan questions[] — coba lagi.');
      questions = obj.questions.slice(0, count).map((q, i) => ({
        id: `${modKey}-${diff}-${i + 1}`, modul: 1,
        q: String(q.q || '').slice(0, 500),
        choices: (Array.isArray(q.choices) ? q.choices : []).slice(0, 4).map((c) => String(c).slice(0, 300)),
        answer: Math.min(3, Math.max(0, Number(q.answer) || 0)),
        bahas: String(q.bahas || '').slice(0, 300), diff, auto: false,
      })).filter((q) => q.q && q.choices.length === 4);
      if (!questions.length) throw new Error('Soal AI tidak valid (choices harus 4) — coba lagi.');
    } else {
      questions = manualGen({ text, modKey, modul: 1, count, diff, seedSalt: String(text.length) });
    }
    // Dedup vs soal lama (hash anti-duplikat) — soal yg sudah pernah ada tidak dibuat lagi.
    const fresh = await filterNew(questions, seen);
    const final = (fresh.length ? fresh : questions).slice(0, count);
    if (!final.length) throw new Error('Semua soal sudah pernah dibuat dari modul ini.');
    const enc = await encQuestions({ paket: finalName, questions: final });
    cache[finalName] = { paket: finalName, savedAt: Date.now(), mode: actualMode, modKey, diff, count: final.length, enc };
    await save('tuton_qcache', cache);
    const hashes = await Promise.all(final.map((q) => qHash(q.q)));
    await save('tuton_qseen', [...seen, ...hashes].slice(-500));
    // Soal tersimpan, langsung masuk ruang tes (tanpa bocor kunci). Preview ber-kunci DIHAPUS.
    startExam(finalName, final, actualMode);
    notify(`Paket ${finalName} tersimpan — selamat mengerjakan`);
  }
  async function decOrPlain(pkg) {
    if (pkg?.enc) return (await decQuestions(pkg.enc)).questions || [];
    return pkg?.data?.questions || [];
  }
  // ---- Mode fokus tes: full-page focus saat tes BERJALAN & HASIL. ----
  // Chrome app (sidebar/topbar/nav/toolbar) + kartu setup/riwayat disembunyikan
  // via body.qfocus + #content.qfocus-on; hanya stepper + #q-stage yang tampil.
  // Keluar fokus (batal/selesai-kembali) SELALU lewat exitFocus() agar tidak nyangkut.
  const enterFocus = () => {
    try { document.body.classList.add('qfocus'); content.classList.add('qfocus-on'); } catch { /* abaikan */ }
  };
  const exitFocus = () => {
    try { document.body.classList.remove('qfocus'); content.classList.remove('qfocus-on'); } catch { /* abaikan */ }
  };
  // ---------- Ruang tes: SATU SOAL PER LAYAR + timer + tanpa kunci ----------
  const fmtClock = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  function startExam(name, questions, mode) {
    if (!questions?.length) { notify('Paket kosong.', 'error'); paintSetup(); return; }
    try { clearInterval(globalThis.__qTimer); } catch { /* abaikan */ }
    // Acak urutan tampil (dengan kunci ikut terbawa, tapi TIDAK dirender).
    const order = questions.map((_, i) => i).sort(() => Math.random() - 0.5);
    Object.assign(flow, { name, qs: questions, order, ans: {}, idx: 0, actual: mode || flow.actual });
    const totalSecs = Math.max(60, questions.length * 90); // 90 detik/soal
    flow.secs = totalSecs;
    flow.t0 = Date.now();
    globalThis.__qTimer = setInterval(() => {
      flow.secs = Math.max(0, totalSecs - Math.round((Date.now() - flow.t0) / 1000));
      const el = $('#q-clock');
      if (el) {
        el.textContent = fmtClock(flow.secs);
        el.classList.toggle('danger', flow.secs <= 60);
      }
      if (flow.secs <= 0) finishExam(true);
    }, 1000);
    setStep(3);
    enterFocus(); // mulai fokus: setup/riwayat/nav hilang, tinggal soal
    paintExam();
  }
  function paintExam() {
    const i = flow.idx, q = flow.qs[flow.order[i]], n = flow.qs.length;
    const pct = Math.round((Object.keys(flow.ans).length / n) * 100);
    const unAns = n - Object.keys(flow.ans).length;
    stage().innerHTML = `
    <div class="qfocus-bar"><button class="btn sm ghost" id="q-exit">✕ Keluar tes</button>
      <span class="tiny">Mode fokus — navigasi disembunyikan. Keluar TIDAK menyimpan nilai.</span></div>
    <div class="qexam-top"><span class="badge ${flow.actual === 'ai' ? 'ok' : 'dim'}">${escapeHtml(flow.actual === 'ai' ? 'AI' : 'offline')}</span>
      <span class="tiny">${escapeHtml(flow.name)}</span>
      <span class="spacer"></span>
      <span class="qclock" id="q-clock">${fmtClock(flow.secs)}</span></div>
    <div class="bar" style="margin:8px 0"><i style="width:${pct}%"></i></div>
    <div class="tiny" style="margin-bottom:6px">Soal ${i + 1}/${n} · terjawab ${Object.keys(flow.ans).length} · sisa ${fmtClock(flow.secs)}</div>
    <div class="card qexam-q"><b class="q-title">${i + 1}. ${escapeHtml(q.q)}</b>
      ${(q.choices || []).map((c, j) => `<label class="opt${flow.ans[q.id] === j ? ' picked' : ''}"><input type="radio" name="qx" value="${j}"${flow.ans[q.id] === j ? ' checked' : ''}><span><b>${'ABCD'[j] || '•'}</b> ${escapeHtml(c)}</span></label>`).join('')}
    </div>
    <div class="row">
      <button class="btn sm ghost" id="q-prev"${i === 0 ? ' disabled' : ''}>← Sebelumnya</button>
      <button class="btn sm ghost" id="q-next"${i === n - 1 ? ' disabled' : ''}>Berikutnya →</button>
      <span class="spacer"></span>
      <button class="btn sm danger" id="q-giveup">Selesai & kumpulkan</button>
    </div>
    <div class="qexam-nav">${flow.qs.map((qq, k) => `<button class="qdot${k === i ? ' cur' : ''}${flow.ans[qq.id] !== undefined ? ' done' : ''}" data-jump="${k}">${k + 1}</button>`).join('')}</div>
    <div class="tiny" id="q-unans" style="margin-top:8px">${unAns ? `Belum dijawab: ${unAns} soal — kumpulkan tetap bisa, yang kosong dihitung salah.` : 'Semua soal sudah dijawab ✓'}</div>`;
    stage().querySelectorAll('input[name=qx]').forEach((r) => r.addEventListener('change', () => {
      flow.ans[q.id] = Number(r.value);
      paintExam(); // refresh progress + highlight tanpa bocor kunci
    }));
    $('#q-prev').addEventListener('click', () => { if (flow.idx > 0) { flow.idx--; paintExam(); } });
    $('#q-next').addEventListener('click', () => { if (flow.idx < n - 1) { flow.idx++; paintExam(); } });
    stage().querySelectorAll('[data-jump]').forEach((b) => b.addEventListener('click', () => { flow.idx = Number(b.dataset.jump); paintExam(); }));
    $('#q-giveup').addEventListener('click', () => finishExam(false));
    $('#q-exit').addEventListener('click', () => {
      // Keluar TANPA nilai: hentikan timer + keluar fokus + balik setup.
      try { clearInterval(globalThis.__qTimer); } catch { /* abaikan */ }
      globalThis.__qTimer = null;
      exitFocus();
      notify('Tes dibatalkan — jawaban tidak disimpan');
      paintSetup();
    });
    stage().scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  async function finishExam(timeUp) {
    try { clearInterval(globalThis.__qTimer); } catch { /* abaikan */ }
    globalThis.__qTimer = null;
    const qs = flow.qs, name = flow.name;
    const r = gradeQuiz(qs, flow.ans);
    const secs = Math.round((Date.now() - flow.t0) / 1000);
    let xpMsg = '';
    try {
      const qr = await chrome.runtime.sendMessage({ type: 'TUTON_QUIZ_DONE', score: r.score });
      if (qr?.gained) xpMsg = ` · +${qr.gained} XP`;
      refreshStatus();
    } catch { await bumpActivity('q'); }
    // Simpan riwayat: skor + benar/total + waktu + kesulitan (TANPA kunci jawaban).
    try {
      const log = (await load('tuton_qlog', {})) || {};
      const arr = Array.isArray(log[name]) ? log[name] : [];
      arr.push({ at: Date.now(), score: r.score, correct: r.correct, total: r.total, secs, diff: flow.diff });
      log[name] = arr.slice(-20);
      await save('tuton_qlog', log);
    } catch { /* riwayat best-effort */ }
    setStep(4);
    const avg = Math.round((r.correct / Math.max(1, r.total)) * 100);
    const perDiff = {};
    qs.forEach((q, i) => {
      const d = q.diff || flow.diff;
      perDiff[d] = perDiff[d] || { ok: 0, tot: 0 };
      perDiff[d].tot++;
      if (r.detail[i]?.ok) perDiff[d].ok++;
    });
    stage().innerHTML = `
    <div class="qfocus-bar"><span class="tiny">Hasil tersimpan otomatis ✓ · kunci & pembahasan terbuka di bawah</span>
      <span class="spacer"></span><button class="btn sm ghost" id="q-back-top">Kembali ke awal ↑</button></div>
    <div class="card qresult"><div class="eyebrow">${icon('chart', 13)} Hasil tes ${timeUp ? '· waktu habis (otomatis dikumpulkan)' : ''}</div>
      <div class="qscore"><b>${r.score}</b><span>/ 100 · ${r.correct} benar dari ${r.total} · ${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}</span>${xpMsg ? `<span>${escapeHtml(xpMsg)}</span>` : ''}</div>
      <div class="bar" style="margin:8px 0"><i style="width:${avg}%"></i></div>
      <div class="qstat-bars">${Object.entries(perDiff).map(([d, v]) => {
        const p = Math.round((v.ok / Math.max(1, v.tot)) * 100);
        return `<div class="qstat-row"><span class="qstat-name">${escapeHtml(d)}<span class="tiny dim"> · ${v.ok}/${v.tot}</span></span><span class="qstat-bar"><i style="width:${p}%"></i></span><b class="qstat-num">${p}</b></div>`;
      }).join('')}</div>
      <div class="sec" style="margin-top:10px">Pembahasan (kunci baru dibuka di sini)</div>
      ${qs.map((q, i) => `<div class="q"><b class="q-title">${i + 1}. ${escapeHtml(q.q)}</b>
        ${(q.choices || []).map((c, j) => `<div class="tiny${j === q.answer ? ' qkey' : (flow.ans[q.id] === j ? ' qwrong' : '')}">${'ABCD'[j] || '•'}. ${escapeHtml(c)}${j === q.answer ? ' ✓ kunci' : (flow.ans[q.id] === j ? ' ✕ jawabanmu' : '')}</div>`).join('')}
        ${q.bahas ? `<div class="tiny dim">${escapeHtml(q.bahas)}</div>` : ''}</div>`).join('')}
      <div class="row">
        <button class="btn sm primary" id="q-again">Tes lagi (acak ulang)</button>
        <button class="btn sm ghost" id="q-todocx">Unduh DOCX + pembahasan</button>
        <button class="btn sm ghost" id="q-back">Kembali ke awal</button>
      </div>
    </div>`;
    $('#q-again').addEventListener('click', () => startExam(name, qs, flow.actual));
    $('#q-todocx').addEventListener('click', () => exportPkg(name));
    $('#q-back').addEventListener('click', () => { exitFocus(); vSoal(); });
    $('#q-back-top').addEventListener('click', () => { exitFocus(); vSoal(); stage()?.scrollIntoView?.({ behavior: 'smooth' }); });
    notify(timeUp ? 'Waktu habis — jawaban otomatis dikumpulkan' : `Tes selesai — skor ${r.score}`);
    stage().scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  $('#q-sample').addEventListener('click', () => {
    $('#q-name').value = 'contoh-uas';
    $('#q-json').value = JSON.stringify({ paket: 'contoh-uas', questions: [{ id: '1', modul: 1, q: 'Ibukota Indonesia?', choices: ['Jakarta', 'Bandung', 'Surabaya', 'Medan'], answer: 0 }, { id: '2', modul: 1, q: '2 + 2 = ?', choices: ['3', '4', '5', '22'], answer: 1 }] }, null, 2);
  });
  $('#q-save').addEventListener('click', async () => {
    try {
      const obj = JSON.parse($('#q-json').value);
      if (!Array.isArray(obj.questions)) throw new Error('questions[] tidak ditemukan');
      const name = $('#q-name').value.trim() || obj.paket || 'paket-' + Date.now();
      cache[name] = { paket: name, savedAt: Date.now(), data: obj };
      await save('tuton_qcache', cache); notify('Paket tersimpan lokal'); vSoal();
    } catch (e) { notify('JSON tidak valid: ' + e.message, 'error'); }
  });
  async function playQuiz(name) {
    // Tes dari riwayat paket: dekrip -> LANGSUNG ruang tes (tanpa bocor kunci).
    const pkg = cache[name];
    let qs = [];
    try {
      if (pkg?.enc) qs = (await decQuestions(pkg.enc)).questions || [];
      else qs = pkg?.data?.questions || [];
    } catch (e) { notify('Gagal buka paket (kunci perangkat berubah?): ' + e.message, 'error'); return; }
    if (!qs.length) { notify('Paket kosong.', 'error'); return; }
    flow.actual = pkg?.mode || 'cache';
    startExam(name, qs, flow.actual);
  }
  paintSetup();
}

// ---------- BMP Studio ----------
// Dua mode:
//  A. RBV Reader (otomatis) — logic diadaptasi dari BMP Terbuka (mentaliss/bukabmp,
//     GPL-3.0, lihat THIRD_PARTY.md): deteksi halaman + unduh image dari reader
//     pustaka.ut.ac.id (sesi login user) -> OCR Tesseract ind lokal -> rakit pdf-lib
//     -> cache IndexedDB -> unduh via chrome.downloads.
//  B. Manual — capture tab + teks DOM untuk situs lain (minpdf, tanpa OCR).
const RBV_ROOT = 'https://pustaka.ut.ac.id';
let bmpPages = []; // sesi memori mode manual
// bmpRun: { runId, code, queue, tabId, mods:[{m,state,page,total,pages}], merge, ocrCtx }
let bmpRun = null;

function rbvEl(id) { return document.querySelector('#' + id); }
function rbvLog(line) {
  const e = rbvEl('rbv-log');
  if (!e) return;
  const d = document.createElement('div');
  d.textContent = line;
  e.prepend(d);
  while (e.children.length > 6) e.lastChild.remove();
}

// Indikator utama: pill status + tombol start/stop.
function rbvPill(state, label) {
  const pill = rbvEl('rbv-pill');
  if (pill) {
    const cls = { idle: 'dim', run: 'ok', done: 'ok', stop: 'warn', error: 'bad' }[state] || 'dim';
    pill.className = `badge ${cls}${state === 'run' ? ' pulse' : ''}`;
    pill.textContent = label;
  }
  const btn = rbvEl('rbv-start');
  if (btn) {
    btn.disabled = state === 'run';
    btn.style.opacity = state === 'run' ? '.45' : '';
  }
}
function rbvStage(html) {
  const e = rbvEl('rbv-stage');
  if (e) e.innerHTML = html;
}
function rbvBar(id, pct) {
  const e = document.querySelector(`#${id} > i`);
  if (e) e.style.width = `${Math.max(0, Math.min(100, pct))}%`;
}

// Checklist modul: kondisi tiap modul + progress halamannya.
function paintRbvMods() {
  const box = rbvEl('rbv-mods');
  if (!box) return;
  const run = bmpRun;
  if (!run) { box.innerHTML = ''; return; }
  box.innerHTML = run.mods.map((md) => {
    const pct = md.total ? Math.round((Math.min(md.page, md.total) / md.total) * 100) : 0;
    const right = md.state === 'wait' ? '<span class="badge dim">Antre</span>'
      : md.state === 'fetch' ? `<span class="badge dim">Unduh <b>${md.page}/${md.total || '?'}</b></span>`
      : md.state === 'ocr' ? `<span class="badge warn">OCR <b>${md.page}/${md.total || '?'}</b></span>`
      : md.state === 'build' ? '<span class="badge warn">Merakit</span>'
      : md.state === 'done' ? `<span class="badge ok">Selesai · ${md.pages} hal</span>`
      : '<span class="badge bad">Gagal</span>';
    const cls = md.state === 'done' ? 'done' : md.state === 'error' ? 'error' : (md.state === 'wait' ? '' : 'active');
    return `<div class="mod ${cls}"><div class="top"><b>Modul ${md.m}</b>${right}</div>${md.state !== 'wait' && md.state !== 'done' && md.state !== 'error' ? `<div class="bar"><i style="width:${pct}%"></i></div>` : ''}</div>`;
  }).join('');
  const done = run.mods.filter((m) => m.state === 'done').length;
  rbvBar('rbv-bar-all', (done / run.mods.length) * 100);
}
function rbvMod(code, m) {
  const run = bmpRun;
  if (!run) return null;
  let md = run.mods.find((x) => x.m === m);
  if (!md) { md = { m, state: 'wait', page: 0, total: 0, pages: 0 }; run.mods.push(md); }
  return md;
}

async function downloadBlobUrl(blobUrl, filename) {
  try {
    await chrome.downloads.download({ url: blobUrl, filename, conflictAction: 'overwrite', saveAs: false });
  } catch {
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = filename;
    a.click();
  }
  setTimeout(() => { try { URL.revokeObjectURL(blobUrl); } catch (_) {} }, 60000);
}

async function rbvStart() {
  const code = (rbvEl('rbv-code').value || '').trim().toUpperCase();
  const from = Math.max(1, Number(rbvEl('rbv-from').value) || 1);
  const to = Math.max(from, Math.min(99, Number(rbvEl('rbv-to').value) || from));
  const merge = !!rbvEl('rbv-mergeflag')?.checked;
  if (!/^[A-Z0-9]{4,12}$/.test(code)) { notify('Kode BMP tidak valid (cth: MSIM4303).', 'error'); return; }
  if (bmpRun) { notify('Job masih berjalan — hentikan dulu.', 'error'); return; }
  try {
    const granted = await chrome.permissions.request({ origins: [`${RBV_ROOT}/*`] });
    if (!granted) { notify('Izin akses reader ditolak.', 'error'); return; }
  } catch (e) { notify('Izin host gagal: ' + e.message, 'error'); return; }
  const tabs = await chrome.tabs.query({ url: `${RBV_ROOT}/reader/*` }).catch(() => []);
  let tab = tabs[0];
  if (!tab) {
    await chrome.tabs.create({ url: `${RBV_ROOT}/reader/index.php?subfolder=${encodeURIComponent(code)}/&doc=M${from}.pdf` });
    rbvPill('stop', 'BUTUH TAB');
    rbvStage('Tab reader dibuka. <b>Login bila diminta</b>, lalu klik <b>Proses</b> lagi.');
    notify('Tab reader dibuka — login bila diminta, lalu klik Proses lagi.');
    return;
  }
  const runId = 'tut' + Date.now().toString(36);
  const queue = [];
  for (let m = from; m <= to; m++) queue.push(m);
  bmpRun = { runId, code, queue, tabId: tab.id, merge, mods: queue.map((m) => ({ m, state: 'wait', page: 0, total: 0, pages: 0 })), ocrCtx: '' };
  try {
    rbvStage('Menyiapkan mesin OCR lokal…');
    await prepareJob(runId);
  } catch (e) {
    bmpRun = null;
    rbvPill('error', 'GAGAL');
    rbvStage(`Mesin lokal gagal: ${escapeHtml(e.message)}`);
    notify(e.message, 'error');
    return;
  }
  onOcrProgress((m) => {
    if (!bmpRun || m.status !== 'recognizing text' || typeof m.progress !== 'number') return;
    const md = rbvMod(bmpRun.code, bmpRun.queue[0]);
    rbvStage(`Membaca teks halaman <b>${bmpRun.ocrCtx || ''}</b> — <b>${Math.round(m.progress * 100)}%</b>`);
    if (md) { md.state = 'ocr'; paintRbvMods(); }
  });
  rbvPill('run', 'JALAN');
  rbvLog(`Job: ${code} M${from}–M${to}${merge ? ' (gabung di akhir)' : ' (file per modul)'}`);
  await rbvRunNextModule();
}

function waitTabComplete(tabId, timeoutMs = 30000) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const tick = async () => {
      try {
        const t = await chrome.tabs.get(tabId);
        if (t.status === 'complete' || Date.now() - t0 > timeoutMs) return resolve();
      } catch { return resolve(); }
      setTimeout(tick, 500);
    };
    tick();
  });
}

// Tunggu sampai tab BENAR-BENAR di dokumen modul tujuan (bukan halaman lama
// yang belum ke-navigate) — mencegah START jatuh ke viewer modul sebelumnya.
function waitTabUrl(tabId, needle, timeoutMs = 30000) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const tick = async () => {
      try {
        const t = await chrome.tabs.get(tabId);
        if ((t.url || '').includes(needle) && t.status === 'complete') return resolve(true);
        if (Date.now() - t0 > timeoutMs) return resolve(false);
      } catch { return resolve(false); }
      setTimeout(tick, 500);
    };
    tick();
  });
}

async function rbvRunNextModule() {
  const run = bmpRun;
  if (!run) return;
  const mod = run.queue[0];
  if (mod === undefined) {
    // Semua modul selesai → gabung bila dicentang.
    if (run.merge && run.mods.length > 1) {
      rbvStage('Menggabung semua modul…');
      try {
        const ms = run.mods.map((x) => x.m);
        const url = await buildRange(run.code, ms[0], ms[ms.length - 1]);
        await downloadBlobUrl(url, `tuton-${bmpSlug(run.code)}-M${ms[0]}-M${ms[ms.length - 1]}.pdf`);
        rbvLog(`Gabungan M${ms[0]}–M${ms[ms.length - 1]} terunduh.`);
      } catch (e) {
        rbvLog('Gabung gagal: ' + e.message);
        notify('Gabung gagal: ' + e.message, 'error');
      }
    }
    rbvPill('done', 'SELESAI');
    rbvStage(`Selesai — <b>${run.mods.length} modul</b> terunduh${run.merge ? ' + file gabungan' : ''}.`);
    rbvBar('rbv-bar', 100);
    notify('Unduhan BMP selesai.');
    bmpRun = null;
    paintRbvMods();
    paintRbvCache();
    return;
  }
  const md = rbvMod(run.code, mod);
  if (md) { md.state = 'fetch'; paintRbvMods(); }
  // Samakan upstream: buka viewer DOKUMEN modul ini dulu — view.php memvalidasi
  // terhadap sesi viewer yang sedang terbuka. Lalu tunggu load + retry handshake.
  rbvStage(`Modul <b>${mod}</b>: membuka viewer…`);
  try {
    await chrome.tabs.update(run.tabId, { url: `${RBV_ROOT}/reader/index.php?subfolder=${encodeURIComponent(run.code)}/&doc=M${mod}.pdf` });
  } catch (e) {
    if (md) { md.state = 'error'; paintRbvMods(); }
    rbvPill('error', 'GAGAL');
    rbvStage(`Modul <b>${mod}</b>: tab reader hilang (${escapeHtml(e.message)}). Buka reader lalu Proses ulang.`);
    bmpRun = null;
    return;
  }
  await waitTabComplete(run.tabId);
  const settled = await waitTabUrl(run.tabId, `doc=M${mod}.pdf`);
  if (!bmpRun || bmpRun.runId !== run.runId) return;
  if (!settled) {
    rbvLog(`Modul ${mod}: tab belum pindah dokumen — lanjut dengan retry handshake.`);
  }
  rbvStage(`Modul <b>${mod}</b>: menghubungi reader…`);
  try {
    await chrome.scripting.executeScript({ target: { tabId: run.tabId }, files: ['src/bmp/rbv.js'] });
  } catch (e) {
    if (md) { md.state = 'error'; paintRbvMods(); }
    rbvPill('error', 'GAGAL');
    rbvStage(`Modul <b>${mod}</b>: suntik gagal (${escapeHtml(e.message)}).`);
    bmpRun = null;
    return;
  }
  let started = false;
  let lastErr = '';
  for (let attempt = 1; attempt <= 8; attempt++) {
    if (!bmpRun || bmpRun.runId !== run.runId) return;
    try {
      const r = await chrome.tabs.sendMessage(run.tabId, {
        type: 'TUTON_BMP_START_MODULE', runId: run.runId, code: run.code, module: mod, delayMs: 2500, maxPages: 500,
      });
      if (r?.ok) { started = true; break; }
      lastErr = r?.error || 'reader belum siap';
    } catch (e) { lastErr = e.message; }
    rbvStage(`Modul <b>${mod}</b>: menunggu reader siap… (${attempt}/8)`);
    await new Promise((r) => setTimeout(r, 1500));
  }
  if (!started) {
    if (md) { md.state = 'error'; paintRbvMods(); }
    rbvPill('error', 'GAGAL');
    rbvStage(`Modul <b>${mod}</b>: reader tidak merespons (${escapeHtml(lastErr)}). Refresh tab reader lalu coba lagi.`);
    rbvLog(`Modul ${mod} gagal start: ${lastErr}`);
    notify(`Gagal mulai modul ${mod}: ${lastErr}`, 'error');
    bmpRun = null;
  }
}

async function rbvStop(silent) {
  const run = bmpRun;
  bmpRun = null;
  if (run) {
    try { await chrome.tabs.sendMessage(run.tabId, { type: 'TUTON_BMP_STOP', runId: run.runId }); } catch (_) {}
    try { cancelJob(run.runId); } catch (_) {}
    if (!silent) {
      rbvPill('stop', 'BERHENTI');
      rbvStage('Dihentikan oleh user.');
      notify('Job BMP dihentikan.');
    }
    paintRbvMods();
  }
}

async function rbvFinishModule(code, moduleNo, pages, runId, downloadNow) {
  const md = rbvMod(code, moduleNo);
  if (md) { md.state = 'build'; paintRbvMods(); }
  rbvStage(`Modul <b>${moduleNo}</b>: merakit PDF (${pages} hal)…`);
  try {
    const { blobUrl, bytes } = await finishModule(code, moduleNo, pages, runId);
    if (downloadNow) {
      await downloadBlobUrl(blobUrl, `tuton-${bmpSlug(code)}-M${moduleNo}.pdf`);
    } else {
      // mode gabung: file per modul tetap di cache, unduhan menyusul di akhir
      setTimeout(() => { try { URL.revokeObjectURL(blobUrl); } catch (_) {} }, 60000);
    }
    const hist = await load('tuton_bmp', { jobs: [] });
    hist.jobs.unshift({ title: `${code} M${moduleNo} (OCR)`, pages, at: new Date().toISOString().slice(0, 10) });
    await save('tuton_bmp', { jobs: hist.jobs.slice(0, 20) });
    if (md) { md.state = 'done'; md.pages = pages; paintRbvMods(); }
    rbvLog(`M${moduleNo}: ${pages} hal, ${(bytes / 1024).toFixed(0)} KB${downloadNow ? ' — terunduh.' : ' — masuk antre gabung.'}`);
    paintRbvCache();
    return true;
  } catch (e) {
    if (md) { md.state = 'error'; paintRbvMods(); }
    rbvLog(`M${moduleNo} gagal rakit: ${e.message}`);
    notify(`Modul ${moduleNo}: ${e.message}`, 'error');
    return false;
  }
}

async function paintRbvCache() {
  const box = rbvEl('rbv-cache');
  if (!box) return;
  const code = (rbvEl('rbv-code')?.value || '').trim().toUpperCase();
  if (!code) { box.innerHTML = ''; return; }
  let mods = [];
  try { mods = await dbListModules(code); } catch { mods = []; }
  box.innerHTML = mods.length
    ? `<div class="eyebrow" style="margin-top:10px">${icon('layers', 13)} Cache lokal ${code}</div>` + mods.map((m) => `<div class="pkg-row"><span class="name">Modul ${m}<div class="tiny">searchable PDF · IndexedDB</div></span><span><button class="btn sm ghost" data-sum="${m}">Ringkasan</button> <button class="btn sm ghost" data-quiz="${m}">Soal</button> <button class="btn sm" data-exp="${m}">Export</button></span></div>`).join('') + `<div class="row"><button class="btn sm primary" id="rbv-merge">${icon('download', 13)}Gabung ${mods[0]}–${mods[mods.length - 1]}</button></div><div id="rbv-ai-out"></div>`
    : '';
  box.querySelectorAll('[data-sum]').forEach((b) => b.addEventListener('click', () => rbvSummarize(code, Number(b.dataset.sum))));
  box.querySelectorAll('[data-quiz]').forEach((b) => b.addEventListener('click', () => rbvGenQuiz(code, Number(b.dataset.quiz))));
  box.querySelectorAll('[data-exp]').forEach((b) => b.addEventListener('click', async () => {
    try {
      const url = await exportCachedModule(code, Number(b.dataset.exp));
      await downloadBlobUrl(url, `tuton-${bmpSlug(code)}-M${b.dataset.exp}.pdf`);
      notify(`Modul ${b.dataset.exp} diekspor.`);
    } catch (e) { notify(e.message, 'error'); }
  }));
  const mg = rbvEl('rbv-merge');
  if (mg) mg.addEventListener('click', async () => {
    try {
      const url = await buildRange(code, mods[0], mods[mods.length - 1]);
      await downloadBlobUrl(url, `tuton-${bmpSlug(code)}-M${mods[0]}-M${mods[mods.length - 1]}.pdf`);
      notify('PDF gabungan diunduh.');
    } catch (e) { notify(e.message, 'error'); }
  });
}

// ---------- Ringkasan + generate soal dari teks modul (AI) ----------
// tuton_summary: { "KODE:M1": { text, savedAt } }
// tuton_genquiz: { "KODE:M1": { questions[], savedAt } }
function rbvAiBox() {
  let box = rbvEl('rbv-ai-out');
  if (!box) {
    const cache = rbvEl('rbv-cache');
    if (!cache) return null;
    box = document.createElement('div');
    box.id = 'rbv-ai-out';
    cache.appendChild(box);
  }
  return box;
}

async function rbvSummarize(code, mod) {
  const box = rbvAiBox();
  if (!box) return;
  const key = `${code}:M${mod}`;
  box.innerHTML = `<div class="tiny">Memuat teks Modul ${mod}…</div>`;
  try {
    const saved = await load('tuton_summary', {});
    if (saved[key]?.text) {
      paintSummary(box, code, mod, saved[key].text, true);
      return;
    }
    const { text, chars, pages } = await getModuleText(code, mod);
    box.innerHTML = `<div class="tiny">Meringkas ${pages} hal (${(chars / 1000).toFixed(1)}k char) via AI…</div>`;
    const r = await askAI({ messages: [{ role: 'user', content: `Ringkas materi UT ${code} Modul ${mod} berikut jadi poin-poin penting + definisi kunci + hal yang sering keluar di ujian. Bahasa Indonesia, padat, format markdown.\n\n${text}` }] });
    const all = await load('tuton_summary', {});
    all[key] = { text: r.content, savedAt: Date.now() };
    await save('tuton_summary', all);
    paintSummary(box, code, mod, r.content, false);
  } catch (e) {
    box.innerHTML = `<div class="tiny" style="color:var(--red)">Gagal: ${escapeHtml(e.message)}</div>`;
  }
}

function paintSummary(box, code, mod, text, cached) {
  box.innerHTML = `<div class="card" style="margin-top:8px"><div class="eyebrow">${icon('text', 13)} Ringkasan ${escapeHtml(code)} M${mod}${cached ? ' · tersimpan' : ''}</div><div class="s" style="white-space:pre-wrap">${escapeHtml(text).slice(0, 4000)}${text.length > 4000 ? '\n…(dipotong — unduh versi penuh)' : ''}</div><div class="row"><button class="btn sm primary" id="rbv-sum-dl">Unduh .md</button></div></div>`;
  box.querySelector('#rbv-sum-dl').addEventListener('click', () => {
    download(`ringkasan-${bmpSlug(code)}-M${mod}.md`, `# Ringkasan ${code} Modul ${mod}\n\n${text}\n`, 'text/markdown');
  });
}

async function rbvGenQuiz(code, mod) {
  const box = rbvAiBox();
  if (!box) return;
  const key = `${code}:M${mod}`;
  box.innerHTML = `<div class="tiny">Memuat teks Modul ${mod}…</div>`;
  try {
    const saved = await load('tuton_genquiz', {});
    if (saved[key]?.questions?.length) {
      paintGenQuiz(box, code, mod, saved[key].questions, true);
      return;
    }
    const { text, pages } = await getModuleText(code, mod, 8000);
    box.innerHTML = `<div class="tiny">Membuat 10 soal dari ${pages} hal via AI…</div>`;
    const r = await askAI({ messages: [{ role: 'user', content: `Buat 10 soal pilihan ganda dari materi UT ${code} Modul ${mod} berikut. Jawab HANYA JSON valid (tanpa markdown fence, tanpa teks lain): {"paket":"${code}-M${mod}","questions":[{"id":"1","modul":${mod},"q":"...","choices":["A","B","C","D"],"answer":0,"bahas":"..."}]} — answer = index 0-3, bahas = pembahasan 1 kalimat.\n\n${text}` }] });
    const obj = JSON.parse(extractJson(r.content));
    if (!Array.isArray(obj.questions) || !obj.questions.length) throw new Error('AI tidak mengembalikan questions[] — coba lagi.');
    const all = await load('tuton_genquiz', {});
    all[key] = { questions: obj.questions, savedAt: Date.now() };
    await save('tuton_genquiz', all);
    paintGenQuiz(box, code, mod, obj.questions, false);
  } catch (e) {
    box.innerHTML = `<div class="tiny" style="color:var(--red)">Gagal: ${escapeHtml(e.message)} — coba lagi.</div>`;
  }
}

// Ambil objek JSON pertama dari jawaban AI (toleran ada/tanpa fence).
function extractJson(text) {
  const t = String(text || '');
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  const cand = (fence ? fence[1] : t).trim();
  const a = cand.indexOf('{');
  const b = cand.lastIndexOf('}');
  if (a < 0 || b <= a) throw new Error('tidak ada JSON di jawaban AI');
  return cand.slice(a, b + 1);
}

function paintGenQuiz(box, code, mod, questions, cached) {
  const qs = shuffle(questions.slice(), Math.random).slice(0, 10);
  box.innerHTML = `<div class="card" style="margin-top:8px"><div class="eyebrow">${icon('book', 13)} Soal ${escapeHtml(code)} M${mod} · ${qs.length} soal${cached ? ' · tersimpan' : ''}</div>`
    + qs.map((q, i) => `<div class="q"><b class="q-title">${i + 1}. ${escapeHtml(q.q)}</b>${q.choices.map((c, j) => `<label class="opt"><input type="radio" name="gq${i}" value="${j}"><span><b>${'ABCD'[j] || '•'}</b> ${escapeHtml(c)}</span></label>`).join('')}</div>`).join('')
    + `<div class="row"><button class="btn primary block" id="gq-grade">Kumpulkan</button></div><div id="gq-res"></div></div>`;
  box.querySelector('#gq-grade').addEventListener('click', async () => {
    const ans = {};
    qs.forEach((q, i) => { const el = box.querySelector(`input[name=gq${i}]:checked`); if (el) ans[q.id] = Number(el.value); });
    const r = gradeQuiz(qs, ans);
    let xpMsg = '';
    try {
      const qr = await chrome.runtime.sendMessage({ type: 'TUTON_QUIZ_DONE', score: r.score });
      if (qr?.gained) xpMsg = ` · +${qr.gained} XP`;
      refreshStatus();
    } catch { await bumpActivity('q'); }
    box.querySelector('#gq-res').innerHTML = `<div class="s">Skor <b>${r.score}</b> — ${r.correct} benar / ${r.total}${xpMsg}</div>` + r.detail.map((d, i) => {
      const q = qs[i];
      return `<div class="tiny" style="margin-top:6px">${d.ok ? '✓' : '✕'} ${escapeHtml(q.q.slice(0, 80))}<br>Kunci: <b>${'ABCD'[d.expected] ?? d.expected}</b>${q.bahas ? ` — ${escapeHtml(q.bahas)}` : ''}</div>`;
    }).join('');
  });
}

let bmpListenerOn = false;
function ensureBmpListener() {
  if (bmpListenerOn) return;
  bmpListenerOn = true;
  chrome.runtime.onMessage.addListener((msg) => {
    const run = bmpRun;
    if (!run || msg.runId !== run.runId) return;
    (async () => {
      if (msg.type === 'TUTON_BMP_PROGRESS') {
        const md = rbvMod(run.code, msg.module);
        if (md) { md.state = 'fetch'; md.page = msg.page; md.total = msg.totalPages || md.total; paintRbvMods(); }
        rbvStage(`Modul <b>${msg.module}</b>: mengunduh halaman <b>${msg.page}${msg.totalPages ? '/' + msg.totalPages : ''}</b>`);
        if (msg.totalPages) rbvBar('rbv-bar', ((msg.page - 1) / msg.totalPages) * 100);
      } else if (msg.type === 'TUTON_BMP_PAGE') {
        run.ocrCtx = `M${msg.module} h${msg.page}`;
        const md = rbvMod(run.code, msg.module);
        if (md) { md.state = 'ocr'; md.page = msg.page; md.total = msg.totalPages || md.total; paintRbvMods(); }
        rbvStage(`Modul <b>${msg.module}</b>: membaca teks halaman <b>${msg.page}${msg.totalPages ? '/' + msg.totalPages : ''}</b>…`);
        try {
          await ocrPage(run.code, msg.module, msg.page, msg.dataUrl, run.runId);
          if (msg.totalPages) rbvBar('rbv-bar', (msg.page / msg.totalPages) * 100);
        } catch (e) {
          if (md) { md.state = 'error'; paintRbvMods(); }
          rbvPill('error', 'GAGAL');
          rbvStage(`OCR M${msg.module} h${msg.page} gagal: ${escapeHtml(e.message)}`);
          rbvLog(`OCR M${msg.module} h${msg.page} gagal: ${e.message}`);
          notify(`OCR gagal: ${e.message}`, 'error');
          await rbvStop(true);
          return;
        }
        // ACK: reader baru boleh ambil halaman berikut (ritme upstream).
        try { await chrome.tabs.sendMessage(run.tabId, { type: 'TUTON_BMP_PAGE_ACK', runId: run.runId, module: msg.module, page: msg.page }); } catch (_) {}
      } else if (msg.type === 'TUTON_BMP_RETRY') {
        rbvStage(`Modul <b>${msg.module}</b>: halaman <b>${msg.page}</b> tidak jelas — coba sekali lagi…`);
        rbvLog(`M${msg.module} h${msg.page}: retry sekali.`);
      } else if (msg.type === 'TUTON_BMP_MODULE_DONE') {
        if (msg.result === 'complete') {
          const pages = msg.pages ?? 0;
          const ok = await rbvFinishModule(run.code, msg.module, pages, run.runId, !run.merge);
          run.queue.shift();
          if (ok) await rbvRunNextModule();
          else {
            rbvPill('error', 'GAGAL');
            rbvStage(`Modul <b>${msg.module}</b> gagal dirakit — job berhenti.`);
            await rbvStop(true);
          }
        } else {
          const label = { blocked: 'Diblokir server (403/429/Rejected)', login_required: 'Sesi butuh login ulang', missing_module: 'Modul tidak ditemukan', error: 'Error' }[msg.result] || msg.result;
          const md = rbvMod(run.code, msg.module);
          if (md) { md.state = 'error'; paintRbvMods(); }
          rbvPill('error', 'BERHENTI');
          rbvStage(`Modul <b>${msg.module}</b>: ${escapeHtml(label)}${msg.reason ? ' — ' + escapeHtml(msg.reason) : ''}`);
          rbvLog(`M${msg.module}: ${label}${msg.reason ? ' — ' + msg.reason : ''}`);
          notify(`Modul ${msg.module}: ${label}`, 'error');
          await rbvStop(true);
        }
      }
    })();
  });
}

function bmpSlug(s) { return String(s || 'materi').toLowerCase().replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'materi'; }

function vBmp() {
  ensureBmpListener();
  content.innerHTML = `
    <div class="card">
      <div class="eyebrow">${icon('layers', 13)} RBV Reader · otomatis</div>
      <div class="runhead"><span id="rbv-pill" class="badge dim">IDLE</span><span class="stage" id="rbv-stage">Siap. Isi kode + modul, lalu klik <b>Proses</b>.</span></div>
      <label class="f">Kode BMP</label><input id="rbv-code" placeholder="MSIM4303" class="mono" style="text-transform:uppercase">
      <div class="row">
        <div style="flex:1;min-width:90px"><label class="f">Dari modul</label><input id="rbv-from" type="number" value="1" min="1" max="99"></div>
        <div style="flex:1;min-width:90px"><label class="f">Sampai modul</label><input id="rbv-to" type="number" value="1" min="1" max="99"></div>
      </div>
      <label class="checkline"><input type="checkbox" id="rbv-mergeflag"><span>Gabung jadi 1 PDF di akhir (tanpa centang = file per modul, otomatis tersimpan tiap modul selesai)</span></label>
      <div class="tiny" style="margin-top:8px">Halaman modul berjalan</div>
      <div class="bar" id="rbv-bar"><i style="width:0%"></i></div>
      <div class="tiny" style="margin-top:8px">Keseluruhan modul</div>
      <div class="bar" id="rbv-bar-all"><i style="width:0%"></i></div>
      <div id="rbv-mods"></div>
      <div class="row"><button class="btn primary" id="rbv-start">${icon('download', 14)}Proses</button><button class="btn danger" id="rbv-stop">Stop</button></div>
      <div class="tiny" id="rbv-log"></div>
      <div id="rbv-cache"></div>
    </div>
    <div class="sec">Mode manual · situs lain</div>
    <div class="card">
      <div class="eyebrow">${icon('camera', 13)} Capture tab (<span id="bmp-count">0</span> hal)</div>
      <label class="f">Judul dokumen</label>
      <input id="bmp-title" placeholder="materi" value="materi">
      <div class="row" style="margin-top:0">
        <button class="btn primary" id="bmp-shot">${icon('camera', 14)}Capture tab</button>
        <button class="btn" id="bmp-text">${icon('text', 14)}Ambil teks</button>
      </div>
      <div class="thumbs" id="bmp-thumbs"></div>
      <div class="tiny">Halaman tersimpan di memori sesi — export sebelum panel ditutup. Teks menempel pada halaman terakhir.</div>
    </div>
    <div class="sec">Export</div>
    <div class="card">
      <div class="row" style="margin:0">
        <button class="btn primary block" id="bmp-export">${icon('download', 14)}Export PDF searchable</button>
      </div>
      <div class="row">
        <button class="btn ghost sm" id="bmp-clear">${icon('trash', 13)}Bersihkan</button>
        <button class="btn ghost sm" id="bmp-send">${icon('external', 13)}Kirim ke BMP Terbuka</button>
      </div>
      <div class="tiny">Butuh OCR gambar + fitur penuh? Pakai extension BMP Terbuka (<span class="mono">mentaliss/bukabmp</span>) berdampingan — tombol kirim mencoba handshake bila ID-nya diisi di Setting.</div>
      <div id="bmp-hist"></div>
    </div>`;
  const paint = () => {
    $('#bmp-count').textContent = bmpPages.length;
    $('#bmp-thumbs').innerHTML = bmpPages.length ? bmpPages.map((pg, i) => `<div class="thumb"><img src="${pg.img}" alt="hal ${i + 1}"><span class="n">${i + 1}${pg.text ? ' · teks' : ''}</span><button data-rm="${i}" title="Hapus halaman">${icon('x', 12)}</button></div>`).join('') : '<div class="tiny">Belum ada halaman. Klik Capture tab.</div>';
    $('#bmp-thumbs').querySelectorAll('[data-rm]').forEach((b) => b.addEventListener('click', () => { bmpPages.splice(Number(b.dataset.rm), 1); paint(); }));
  };
  paint();
  paintHist();
  $('#rbv-start').addEventListener('click', rbvStart);
  $('#rbv-stop').addEventListener('click', () => rbvStop(false));
  $('#rbv-code').addEventListener('change', paintRbvCache);
  paintRbvCache();

  $('#bmp-shot').addEventListener('click', async () => {
    try {
      notify('Membuka capture…');
      const url = await chrome.tabs.captureVisibleTab(chrome.windows.WINDOW_ID_CURRENT, { format: 'jpeg', quality: 72 });
      const pg = await downscaleJpeg(url, 1100);
      bmpPages.push(pg);
      paint();
      notify(`Halaman ${bmpPages.length} ditangkap`);
    } catch (e) { notify('Capture gagal: ' + e.message + ' — pastikan tab materi yang aktif.', 'error'); }
  });
  $('#bmp-text').addEventListener('click', async () => {
    if (!bmpPages.length) return notify('Capture halaman dulu.', 'error');
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) return notify('Tidak ada tab aktif', 'error');
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['src/content/reader.js'] });
      const res = await chrome.tabs.sendMessage(tab.id, { type: 'TUTON_READ_TAB' });
      const last = bmpPages[bmpPages.length - 1];
      last.text = ((last.text ? last.text + '\n' : '') + (res.selection || '') + '\n' + (res.text || '')).slice(0, 12000);
      paint();
      notify('Teks ditempel ke halaman terakhir');
    } catch (e) { notify('Gagal baca tab: ' + e.message, 'error'); }
  });
  $('#bmp-export').addEventListener('click', async () => {
    if (!bmpPages.length) return notify('Belum ada halaman.', 'error');
    try {
      const title = $('#bmp-title').value.trim() || 'materi';
      const pages = [];
      for (const pg of bmpPages) {
        const buf = await (await fetch(pg.img)).arrayBuffer();
        pages.push({ jpeg: new Uint8Array(buf), width: pg.w, height: pg.h, text: pg.text || '' });
      }
      const pdf = buildPdf(pages, { title });
      const url = URL.createObjectURL(new Blob([pdf], { type: 'application/pdf' }));
      await downloadBlobUrl(url, `tuton-${bmpSlug(title)}.pdf`);
      const hist = await load('tuton_bmp', { jobs: [] });
      hist.jobs.unshift({ title, pages: pages.length, at: new Date().toISOString().slice(0, 10) });
      await save('tuton_bmp', { jobs: hist.jobs.slice(0, 20) });
      paintHist();
      notify(`PDF diekspor (${pages.length} halaman)`);
    } catch (e) { notify('Export gagal: ' + e.message, 'error'); }
  });
  $('#bmp-clear').addEventListener('click', () => { bmpPages = []; paint(); });
  $('#bmp-send').addEventListener('click', async () => {
    const cfg = await loadAIConfig().catch(() => ({}));
    const extId = (await load('tuton_profile', {})).bmpExtId || cfg.bmpExtId || '';
    if (!extId) return notify('Isi ID extension BMP Terbuka di Setting dulu.', 'error');
    try {
      await chrome.runtime.sendMessage(extId, { type: 'TUTON_OS_HANDOFF', title: $('#bmp-title').value.trim(), pages: bmpPages.length });
      notify('Terkirim ke BMP Terbuka');
    } catch { notify('BMP Terbuka tidak merespons — pastikan terinstal.', 'error'); }
  });
  async function paintHist() {
    const h = await load('tuton_bmp', { jobs: [] });
    $('#bmp-hist').innerHTML = h.jobs.length ? `<div class="eyebrow" style="margin-top:12px">Riwayat export</div>` + h.jobs.map((j) => `<div class="pkg-row"><span class="name">${escapeHtml(j.title)}<div class="tiny">${j.pages} hal · ${j.at}</div></span></div>`).join('') : '';
  }
}

function downscaleJpeg(dataUrl, maxW) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxW / img.naturalWidth);
      const w = Math.round(img.naturalWidth * scale), h = Math.round(img.naturalHeight * scale);
      const cv = document.createElement('canvas');
      cv.width = w; cv.height = h;
      cv.getContext('2d').drawImage(img, 0, 0, w, h);
      resolve({ img: cv.toDataURL('image/jpeg', 0.82), w, h, text: '' });
    };
    img.onerror = () => reject(new Error('gambar tidak terbaca'));
    img.src = dataUrl;
  });
}

// ---------- PDF tools (lokal, tanpa server) ----------
// Mesin: pdf-lib lokal (vendor, pola Hopding/pdf-lib MIT — lihat THIRD_PARTY.md)
// untuk operasi PDF beneran + canvas browser untuk gambar. Stirling PDF
// (Stirling-Tools/Stirling-PDF) dijadikan referensi daftar fitur, tapi TIDAK
// dipakai langsung karena butuh server Java/Docker — tidak cocok untuk MV3.
function vPdf() {
  content.innerHTML = `
    <div class="card hero"><div class="eyebrow">${icon('file', 13)} PDF Tools · lokal</div>
      <div class="s" style="margin-top:0">Semua diproses di perangkat — tanpa server. Mesin PDF: pdf-lib lokal.</div>
      <div class="row"><button class="btn primary" id="pdf-print">${icon('file', 14)}Cetak / Save as PDF</button></div>
    </div>
    <div class="sec">Materi → DOCX/PDF (rumus jadi persamaan asli)</div>
    <div class="card">
      <label class="f">1 · Tempel materi / jawaban (markdown, rumus $…$ atau $$…$$)</label>
      <textarea id="pdf-md" rows="5" placeholder="## Soal 1&#10;Rata-rata $&#92;bar{x}=&#92;frac{&#92;sum x_i}{n}$&#10;&#10;$$s^2 = &#92;frac{1}{n-1}&#92;sum (x_i-&#92;bar{x})^2$$"></textarea>
      <label class="f" style="margin-top:6px">Nama matkul (code matkul)</label>
      <input id="pdf-md-course" placeholder="cth: EKMA5102 Statistika (Tuton 3)">
      <div class="row" style="margin-top:6px">
        <button class="btn sm ghost" id="pdf-md-last">Isi dari jawaban AI terakhir</button>
        <button class="btn sm ghost" id="pdf-md-file">Impor .md/.txt</button>
        <input type="file" id="pdf-md-file-input" hidden accept=".md,.txt,.markdown">
      </div>
      <div class="row">
        <button class="btn block" id="pdf-md-docx">${icon('file', 14)}Jadikan DOCX &amp; unduh</button>
      </div>
      <div class="row">
        <button class="btn block" id="pdf-md-pdf">${icon('file', 14)}Jadikan PDF &amp; unduh</button>
      </div>
      <div class="tiny" id="pdf-md-note">DOCX memakai template (judul JAWABAN + nama/NIM dari profil). PDF memakai Tuton Runtime/Word bila hidup; kalau tidak, terbuka tab siap Ctrl+P.</div>
    </div>
    <div class="sec">Rakit &amp; ubah PDF</div>
    <div class="card">
      <label class="f">1 · Gabung PDF (urutan sesuai pilihan)</label>
      <input type="file" id="pdf-merge-files" multiple accept="application/pdf,.pdf">
      <div class="row"><button class="btn block" id="pdf-merge">${icon('download', 14)}Gabung dan unduh</button></div>
    </div>
    <div class="card">
      <label class="f">2 · Pisah / ambil halaman (cth: 1-3,5,8-10)</label>
      <input type="file" id="pdf-split-file" accept="application/pdf,.pdf">
      <input id="pdf-split-range" placeholder="1-3,5" style="margin-top:6px">
      <div class="row"><button class="btn block" id="pdf-split">${icon('download', 14)}Ekstrak dan unduh</button></div>
    </div>
    <div class="card">
      <label class="f">3 · Hapus halaman (cth: 2,4-5)</label>
      <input type="file" id="pdf-del-file" accept="application/pdf,.pdf">
      <input id="pdf-del-range" placeholder="2,4-5" style="margin-top:6px">
      <div class="row"><button class="btn block" id="pdf-del">${icon('trash', 14)}Hapus dan unduh</button></div>
    </div>
    <div class="card">
      <label class="f">4 · Putar halaman (90° / 180° / 270°)</label>
      <input type="file" id="pdf-rot-file" accept="application/pdf,.pdf">
      <div class="row" style="margin-top:6px">
        <input id="pdf-rot-range" placeholder="halaman: 1-2 (kosong = semua)" style="flex:1;min-width:140px">
        <select id="pdf-rot-deg" style="max-width:90px"><option value="90">90°</option><option value="180">180°</option><option value="270">270°</option></select>
      </div>
      <div class="row"><button class="btn block" id="pdf-rot">${icon('check', 14)}Putar dan unduh</button></div>
    </div>
    <div class="card">
      <label class="f">5 · Gambar → 1 PDF (JPG/PNG, tiap gambar 1 halaman)</label>
      <input type="file" id="pdf-img-files" multiple accept="image/*">
      <div class="row"><button class="btn block" id="pdf-imgs">${icon('download', 14)}Rakit dan unduh</button></div>
    </div>
    <div class="card">
      <label class="f">6 · Teks → PDF (catatan .txt/.md/.csv)</label>
      <input type="file" id="pdf-txt-files" multiple accept=".txt,.md,.csv,.json,.html">
      <div class="row"><button class="btn block" id="pdf-txt">${icon('download', 14)}Rakit dan unduh</button></div>
    </div>
    <div class="sec">Gambar</div>
    <div class="card">
      <label class="f">7 · Kompres gambar (canvas lokal, JPG)</label>
      <input type="file" id="pdf-cimg" accept="image/*">
      <div class="row" style="margin-top:6px">
        <select id="pdf-cq" style="max-width:120px"><option value="0.8">kualitas 80%</option><option value="0.6">60%</option><option value="0.4">40%</option></select>
        <input id="pdf-cw" type="number" placeholder="lebar max px (opsional)" min="100" style="flex:1;min-width:120px">
      </div>
      <div class="row"><button class="btn block" id="pdf-compress">${icon('check', 14)}Kompres dan unduh</button></div>
      <div class="tiny" id="pdf-cinfo"></div>
    </div>
    <div class="sec">File teks (lama)</div>
    <div class="card">
      <input type="file" id="pdf-files" multiple accept=".txt,.md,.csv,.json,.html">
      <div class="row"><button class="btn block" id="pdf-merge-txt">${icon('download', 14)}Gabung dan unduh .txt</button></div>
    </div>
    <div class="card">
      <input type="file" id="pdf-split-file-txt" accept=".txt,.md,.csv">
      <label class="f">Baris per bagian</label><input id="pdf-split-n" type="number" value="100" min="1">
      <div class="row"><button class="btn block" id="pdf-split-txt">${icon('download', 14)}Pisah dan unduh</button></div>
    </div>
    <div class="tiny" id="pdf-status"></div>`;
  const P = () => {
    const lib = globalThis.PDFLib;
    if (!lib) throw new Error('pdf-lib lokal belum termuat — reload extension.');
    return lib;
  };
  const status = (m, err = false) => {
    const el = $('#pdf-status'); if (!el) return;
    el.textContent = m; el.style.color = err ? 'var(--red)' : '';
  };
  const savePdfBytes = async (bytes, name) => {
    const blobUrl = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
    await downloadBlobUrl(blobUrl, name);
  };
  // "1-3,5" -> [1,2,3,5] (1-based), dibatasi maxPages
  const parseRange = (s, maxPages) => {
    const set = new Set();
    for (const part of String(s || '').split(',')) {
      const t = part.trim(); if (!t) continue;
      const m = t.match(/^(\d+)\s*-\s*(\d+)$/);
      if (m) {
        let a = Math.max(1, Number(m[1])), b = Math.min(maxPages, Number(m[2]));
        if (a > b) [a, b] = [b, a];
        for (let i = a; i <= b; i++) set.add(i);
      } else if (/^\d+$/.test(t)) {
        const n = Number(t);
        if (n >= 1 && n <= maxPages) set.add(n);
      } else throw new Error(`Rentang tidak valid: "${t}"`);
    }
    return [...set].sort((a, b) => a - b);
  };
  $('#pdf-print').addEventListener('click', () => window.print());
  // Materi -> DOCX/PDF (mesin export ber-rumus).
  const mdNote = (m, err) => { const el = $('#pdf-md-note'); if (el) { el.textContent = m; el.style.color = err ? 'var(--red)' : 'var(--acc)'; } };
  const mdVal = () => String($('#pdf-md')?.value || '').trim();
  const runMdExport = async (kind) => {
    const md = mdVal();
    if (!md) { mdNote('Tempel materi dulu (atau klik "Isi dari jawaban AI terakhir").', true); return; }
    mdNote(kind === 'docx' ? 'Menyusun DOCX…' : 'Menyusun PDF…');
    try {
      const doc = { course: String($('#pdf-md-course')?.value || '').trim(), title: guessTitle(md, 'Jawaban') };
      if (kind === 'docx') {
        const r = await exportDocx({ markdown: md, doc });
        mdNote(`✓ ${r.name} (${(r.bytes / 1024).toFixed(0)} KB) terunduh`);
        notify(`DOCX terunduh: ${r.name}`);
      } else {
        const r = await exportPdf({ markdown: md, doc });
        if (r.mode === 'runtime') { mdNote(`✓ ${r.name} terunduh (via ${r.engine})`); notify(`PDF terunduh: ${r.name}`); }
        else { mdNote('Tab siap-cetak dibuka → Ctrl+P → "Simpan sebagai PDF".' + (r.note ? ` (${String(r.note).slice(0, 90)})` : '')); notify('Tab siap-cetak dibuka'); }
      }
    } catch (e) { mdNote('Gagal: ' + e.message, true); notify('Export gagal: ' + e.message, 'error'); }
  };
  $('#pdf-md-last')?.addEventListener('click', () => {
    const last = String(globalThis.__lastAiMd || '').trim();
    if (!last) { mdNote('Belum ada jawaban AI di sesi ini — buka AI Agen dan tanya dulu.', true); return; }
    $('#pdf-md').value = last;
    mdNote(`Jawaban AI terakhir dimuat (${last.length} char).`);
  });
  $('#pdf-md-file')?.addEventListener('click', () => $('#pdf-md-file-input')?.click());
  $('#pdf-md-file-input')?.addEventListener('change', async () => {
    const f = $('#pdf-md-file-input').files?.[0];
    if (!f) return;
    $('#pdf-md').value = (await f.text()).slice(0, 200000);
    $('#pdf-md-file-input').value = '';
    mdNote(`Impor ${f.name} (${$('#pdf-md').value.length} char).`);
  });
  $('#pdf-md-docx')?.addEventListener('click', () => runMdExport('docx'));
  $('#pdf-md-pdf')?.addEventListener('click', () => runMdExport('pdf'));

  // 1 · Gabung
  $('#pdf-merge').addEventListener('click', async () => {
    const fs = [...$('#pdf-merge-files').files];
    if (!fs.length) return notify('Pilih file PDF dulu', 'error');
    try {
      status(`Menggabung ${fs.length} file…`);
      const { PDFDocument } = P();
      const out = await PDFDocument.create();
      for (const f of fs) {
        const src = await PDFDocument.load(await f.arrayBuffer(), { ignoreEncryption: true });
        const pages = await out.copyPages(src, src.getPageIndices());
        pages.forEach((p) => out.addPage(p));
      }
      await savePdfBytes(await out.save(), 'gabungan.pdf');
      status(`OK: ${fs.length} PDF digabung.`); notify('gabungan.pdf terunduh');
    } catch (e) { status('Gagal: ' + e.message, true); notify('Gagal gabung: ' + e.message, 'error'); }
  });

  // 2 · Pisah / ekstrak
  $('#pdf-split').addEventListener('click', async () => {
    const f = $('#pdf-split-file').files[0];
    if (!f) return notify('Pilih file PDF dulu', 'error');
    try {
      const { PDFDocument } = P();
      const src = await PDFDocument.load(await f.arrayBuffer(), { ignoreEncryption: true });
      const n = src.getPageCount();
      const keep = parseRange($('#pdf-split-range').value, n);
      if (!keep.length) throw new Error(`Rentang kosong — PDF ini ${n} halaman.`);
      const out = await PDFDocument.create();
      const pages = await out.copyPages(src, keep.map((x) => x - 1));
      pages.forEach((p) => out.addPage(p));
      await savePdfBytes(await out.save(), `${f.name.replace(/\.pdf$/i, '')}-ekstrak.pdf`);
      status(`OK: ${keep.length}/${n} halaman diekstrak.`);
    } catch (e) { status('Gagal: ' + e.message, true); notify('Gagal pisah: ' + e.message, 'error'); }
  });

  // 3 · Hapus halaman
  $('#pdf-del').addEventListener('click', async () => {
    const f = $('#pdf-del-file').files[0];
    if (!f) return notify('Pilih file PDF dulu', 'error');
    try {
      const { PDFDocument } = P();
      const src = await PDFDocument.load(await f.arrayBuffer(), { ignoreEncryption: true });
      const n = src.getPageCount();
      const drop = new Set(parseRange($('#pdf-del-range').value, n));
      if (!drop.size) throw new Error('Rentang hapus kosong.');
      const keep = [];
      for (let i = 1; i <= n; i++) if (!drop.has(i)) keep.push(i - 1);
      if (!keep.length) throw new Error('Semua halaman dihapus — tidak ada sisa.');
      const out = await PDFDocument.create();
      (await out.copyPages(src, keep)).forEach((p) => out.addPage(p));
      await savePdfBytes(await out.save(), `${f.name.replace(/\.pdf$/i, '')}-hapus.pdf`);
      status(`OK: ${drop.size} halaman dihapus, sisa ${keep.length}.`);
    } catch (e) { status('Gagal: ' + e.message, true); notify('Gagal hapus: ' + e.message, 'error'); }
  });

  // 4 · Putar
  $('#pdf-rot').addEventListener('click', async () => {
    const f = $('#pdf-rot-file').files[0];
    if (!f) return notify('Pilih file PDF dulu', 'error');
    try {
      const { PDFDocument, degrees } = P();
      const src = await PDFDocument.load(await f.arrayBuffer(), { ignoreEncryption: true });
      const n = src.getPageCount();
      const raw = $('#pdf-rot-range').value.trim();
      const targets = raw ? new Set(parseRange(raw, n)) : new Set(Array.from({ length: n }, (_, i) => i + 1));
      const deg = Number($('#pdf-rot-deg').value) || 90;
      src.getPages().forEach((pg, i) => {
        if (targets.has(i + 1)) pg.setRotation(degrees((pg.getRotation().angle + deg) % 360));
      });
      await savePdfBytes(await src.save(), `${f.name.replace(/\.pdf$/i, '')}-putar.pdf`);
      status(`OK: ${targets.size} halaman diputar ${deg}°.`);
    } catch (e) { status('Gagal: ' + e.message, true); notify('Gagal putar: ' + e.message, 'error'); }
  });

  // 5 · Gambar -> PDF
  $('#pdf-imgs').addEventListener('click', async () => {
    const fs = [...$('#pdf-img-files').files];
    if (!fs.length) return notify('Pilih gambar dulu', 'error');
    try {
      status(`Merakit ${fs.length} gambar…`);
      const { PDFDocument } = P();
      const out = await PDFDocument.create();
      for (const f of fs) {
        const buf = new Uint8Array(await f.arrayBuffer());
        let img, dims;
        if (/png$/i.test(f.type) || /\.png$/i.test(f.name)) { img = await out.embedPng(buf); dims = img.scale(1); }
        else { img = await out.embedJpg(buf); dims = img.scale(1); }
        const page = out.addPage([dims.width, dims.height]);
        page.drawImage(img, { x: 0, y: 0, width: dims.width, height: dims.height });
      }
      await savePdfBytes(await out.save(), 'gambar.pdf');
      status(`OK: ${fs.length} gambar jadi gambar.pdf.`);
    } catch (e) { status('Gagal: ' + e.message, true); notify('Gagal rakit: ' + e.message + ' (PNG rusak / HEIC tidak didukung)', 'error'); }
  });

  // 6 · Teks -> PDF (pdf-lib + Helvetica standar, bungkus kata manual)
  const wrapPdfText = (font, text, size, maxW) => {
    const out = [];
    for (const para of String(text || '').split('\n')) {
      let line = '';
      for (const w of para.split(/\s+/).filter(Boolean)) {
        const t = line ? line + ' ' + w : w;
        try {
          if (font.widthOfTextAtSize(t, size) > maxW) { if (line) out.push(line); line = w; }
          else line = t;
        } catch { if (line) out.push(line); line = w; }
      }
      out.push(line);
    }
    return out;
  };
  // Helvetica standar hanya aman untuk WinAnsi — ganti sisanya dengan '?'.
  const toWinAnsi = (s) => String(s || '').replace(/[^\x09\x0A\x0D\x20-\xFF]/g, '?');
  $('#pdf-txt').addEventListener('click', async () => {
    const fs = [...$('#pdf-txt-files').files];
    if (!fs.length) return notify('Pilih file teks dulu', 'error');
    try {
      status(`Merakit ${fs.length} file teks…`);
      const { PDFDocument, StandardFonts } = P();
      const out = await PDFDocument.create();
      const font = await out.embedFont(StandardFonts.Helvetica);
      const fontB = await out.embedFont(StandardFonts.HelveticaBold);
      const PW = 595, PH = 842, M = 50, SIZE = 11, LH = 15;
      for (const f of fs) {
        const lines = wrapPdfText(font, toWinAnsi(await f.text()), SIZE, PW - M * 2);
        let page = out.addPage([PW, PH]);
        page.drawText(toWinAnsi(f.name).slice(0, 90), { x: M, y: PH - M, size: 13, font: fontB });
        let y = PH - M - 26;
        for (const ln of lines.length ? lines : ['(kosong)']) {
          if (y < M) { page = out.addPage([PW, PH]); y = PH - M; }
          page.drawText(ln, { x: M, y, size: SIZE, font });
          y -= LH;
        }
      }
      await savePdfBytes(await out.save(), 'teks.pdf');
      status(`OK: ${fs.length} file teks jadi teks.pdf (searchable).`);
    } catch (e) { status('Gagal: ' + e.message, true); notify('Gagal rakit: ' + e.message, 'error'); }
  });

  // 7 · Kompres gambar
  $('#pdf-compress').addEventListener('click', async () => {
    const f = $('#pdf-cimg').files[0];
    if (!f) return notify('Pilih gambar dulu', 'error');
    try {
      const q = Number($('#pdf-cq').value) || 0.8;
      const maxW = Number($('#pdf-cw').value) || 0;
      const bmp = await createImageBitmap(f);
      let { width: w, height: h } = bmp;
      if (maxW > 0 && w > maxW) { h = Math.round((h * maxW) / w); w = maxW; }
      const cv = document.createElement('canvas');
      cv.width = w; cv.height = h;
      cv.getContext('2d').drawImage(bmp, 0, 0, w, h);
      const blob = await new Promise((res) => cv.toBlob(res, 'image/jpeg', q));
      if (!blob) throw new Error('Canvas gagal encode.');
      const info = $('#pdf-cinfo');
      if (info) info.textContent = `${(f.size / 1024).toFixed(0)} KB → ${(blob.size / 1024).toFixed(0)} KB (${w}×${h}, q${q})`;
      const url = URL.createObjectURL(blob);
      await downloadBlobUrl(url, f.name.replace(/\.\w+$/, '') + '-kompres.jpg');
      status('OK: gambar dikompres.');
    } catch (e) { status('Gagal: ' + e.message, true); notify('Gagal kompres: ' + e.message, 'error'); }
  });

  // lama: gabung txt
  $('#pdf-merge-txt').addEventListener('click', async () => {
    const fs = [...$('#pdf-files').files];
    if (!fs.length) return notify('Pilih file dulu', 'error');
    let out = '';
    for (const f of fs) out += `\n\n===== ${f.name} =====\n` + await f.text();
    download('gabungan.txt', out, 'text/plain'); notify('Terunduh gabungan.txt');
  });
  $('#pdf-split-txt').addEventListener('click', async () => {
    const f = $('#pdf-split-file-txt').files[0];
    if (!f) return notify('Pilih file dulu', 'error');
    const n = Math.max(1, Number($('#pdf-split-n').value) || 100);
    const lines = (await f.text()).split('\n');
    for (let i = 0; i < lines.length; i += n) download(`${f.name.replace(/\.\w+$/, '')}-part${i / n + 1}.txt`, lines.slice(i, i + n).join('\n'), 'text/plain');
    notify(`Terpisah jadi ${Math.ceil(lines.length / n)} file`);
  });
}
function download(name, text, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

// ---------- Teks PDF per file (dipakai AI Agen + Bank Soal) ----------
// Baca PDF 100% lokal: teks dulu (pdf.js), kalau kosong/gambar -> OCR.
// 3 lapis: (1) getTextContent per halaman; (2) kalau <50 char non-spasi,
// render tiap halaman ke canvas -> Tesseract 'ind' (mesin BMP Studio yg
// sama, teks Indonesia); (3) kalau OCR juga kosong -> throw jujur.
// PPT/IMG/SS yg di-print ke PDF = gambar -> otomatis jatuh ke lapis 2.
// Progress OCR dilaporkan via notify agar user tahu prosesnya jalan.
async function pdfFileToText(file, onProgress) {
  // Tunggu mesin pdf.js siap (modul index.html dimuat paralel dgn app.js —
  // tanpa tunggu ini, "mesin belum termuat" walau file-nya ada = bug kemarin).
  if (!globalThis.PDFJS_LOCAL?.getDocument) {
    onProgress?.('Menyiapkan mesin baca PDF…');
    const ok = typeof globalThis.pdfjsReady === 'function' ? await globalThis.pdfjsReady() : false;
    if (!ok || !globalThis.PDFJS_LOCAL?.getDocument) {
      const why = globalThis.PDFJS_ERROR ? ` (${globalThis.PDFJS_ERROR.slice(0, 100)})` : '';
      throw new Error(`mesin baca PDF belum termuat${why} — reload extension sekali lalu coba lagi`);
    }
  }
  const pdfjs = globalThis.PDFJS_LOCAL;
  const buf = await file.arrayBuffer();
  // Tanpa workerSrc: pdf.js jalan single-thread (fake worker). Di extension
  // ini justru paling stabil (worker .mjs sering ditolak MIME/CSP) dan
  // cukup cepat untuk ekstrak teks (file 3 MB ~ detikan).
  const loadingTask = pdfjs.getDocument({ data: new Uint8Array(buf), useSystemFonts: true, isEvalSupported: false });
  loadingTask.onPassword = () => { throw new Error('PDF terkunci password — buka kuncinya dulu baru lampirkan'); };
  let pdf;
  try {
    pdf = await loadingTask.promise;
  } catch (e) {
    const m = String(e?.message || e);
    // Fake-worker gagal di node/edge-case tertentu -> fallback jelas.
    if (m.includes('fake worker')) throw new Error('mesin PDF gagal start (fake worker): ' + m.slice(0, 120));
    throw e;
  }
  const n = pdf.numPages;
  if (n > 60) { try { await pdf.destroy(); } catch { /* abaikan */ } throw new Error(`terlalu besar (${n} hal, max 60)`); }
  const parts = [];
  const ocrPages = [];
  for (let p = 1; p <= n; p++) {
    const page = await pdf.getPage(p);
    const tc = await page.getTextContent();
    const line = (tc.items || []).map((it) => it.str || '').join(' ').replace(/\s{2,}/g, ' ').trim();
    if (line && line.replace(/\s/g, '').length >= 20) parts.push(`[hal ${p}]\n${line}`);
    else ocrPages.push(p);
  }
  // Lapis 2: halaman bergambar -> OCR lokal (Tesseract ind, via BMP engine).
  if (ocrPages.length) {
    onProgress?.(`Teks langsung hanya ${parts.length}/${n} hal — OCR ${ocrPages.length} hal bergambar…`);
    try {
      const { ensureWorker } = await import('../src/bmp/engine.js');
      const w = await ensureWorker();
      for (const p of ocrPages.slice(0, 30)) {
        onProgress?.(`OCR hal ${p}/${n}…`);
        const page = await pdf.getPage(p);
        const viewport = page.getViewport({ scale: 2 });
        const canvas = document.createElement('canvas');
        canvas.width = Math.min(Math.round(viewport.width), 2400);
        canvas.height = Math.min(Math.round(viewport.height), 3200);
        const scale = Math.min(canvas.width / viewport.width, canvas.height / viewport.height);
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        await page.render({ canvasContext: ctx, viewport: page.getViewport({ scale }) }).promise;
        const res = await w.recognize(canvas.toDataURL('image/jpeg', 0.92));
        const text = String(res?.data?.text || '').replace(/\s{2,}/g, ' ').trim();
        if (text.replace(/\s/g, '').length >= 10) parts.push(`[hal ${p} · OCR]\n${text}`);
      }
    } catch (e) {
      onProgress?.(`OCR gagal (${e.message}) — hanya teks langsung yg dipakai.`);
    }
  }
  try { await pdf.destroy(); } catch { /* abaikan */ }
  parts.sort((a, b) => Number(a.match(/hal (\d+)/)?.[1] || 0) - Number(b.match(/hal (\d+)/)?.[1] || 0));
  const text = parts.join('\n\n');
  if (text.replace(/\s/g, '').length < 50) throw new Error('PDF ini gambar semua dan OCR tidak membaca apa pun (mungkin resolusi terlalu kecil / tulisan tangan)');
  const title = file.name || '';
  const ocrCount = parts.filter((x) => x.includes('· OCR')).length;
  return `(judul: ${title} · ${n} hal${ocrCount ? `, ${ocrCount} hal via OCR` : ''})\n${text}`.slice(0, 12000);
}

// ---------- AI Agen (9router + skill tab + lampiran + isi field) ----------
// Skill agen (lihat src/content/reader.js + blueprint):
//  #1 baca tab aktif (TUTON_READ_TAB) — teks + seleksi, HANYA saat user klik.
//  #2 daftar field (TUTON_FIELDS) — selector stabil agar AI tahu yg bisa diisi.
//  #3 isi field (TUTON_FILL) — mode: otomatis / semi (konfirmasi) / manual.
//  #4 lampiran file (audio/img/pdf/md/txt/…) — teks langsung, biner via AI vision.
// Mode agen tersimpan di tuton_ai.agentMode: 'semi' (default) | 'auto' | 'manual'.
async function vAi() {
  const cfg = await loadAIConfig();
  const agentMode = cfg.agentMode || 'semi';
  content.innerHTML = `
    <div class="card">
      <div class="eyebrow">${icon('cpu', 13)} AI Agen · <span class="dot on"></span>&nbsp;${escapeHtml((cfg.provider || '9router') === 'custom' ? 'custom' : (cfg.provider || '9router'))}</div>
      <div class="tiny"><code class="inline">${escapeHtml(cfg.baseUrl || NINE_BASE)}</code> · model: <b>${escapeHtml(cfg.model || NINE_MODEL)}</b></div>
      <div class="row" style="margin-top:6px">
        <button class="btn sm ghost" id="ai-new" title="Mulai percakapan baru (arsipkan yg lama)">${icon('plus', 13)}Baru</button>
        <select id="ai-hist" style="flex:1;min-width:140px" title="Riwayat sesi chat"></select>
        <button class="btn sm ghost" id="ai-del" title="Hapus sesi ini">${icon('trash', 13)}</button>
      </div>
      <div class="chat" id="chat"></div>
      <div class="composer"><textarea id="ai-in" rows="2" placeholder="Tanya / perintahkan agen… (Shift+Enter baris baru, gambar bisa ditempel langsung)"></textarea><button class="btn primary icon-only" id="ai-send" title="Kirim">${icon('send', 15)}</button></div>
      <div class="row">
        <button class="btn sm ghost" id="ai-read">${icon('file', 13)}<span id="ai-read-txt">Sertakan isi tab aktif</span></button>
        <button class="btn sm ghost" id="ai-fields">${icon('grid', 13)}Daftar field tab</button>
        <label class="btn sm ghost" for="ai-file" style="cursor:pointer" title="PDF teks langsung terbaca; PDF gambar/PPT-di-PDF-kan otomatis di-OCR (Indonesia); PPT/DOCX: export ke PDF dulu">${icon('plus', 13)}Lampiran</label>
        <input type="file" id="ai-file" hidden multiple accept=".txt,.md,.csv,.json,.html,.pdf,.png,.jpg,.jpeg,.webp,.gif,.mp3,.wav,.m4a,.ogg,.mp4,.webm,.ppt,.pptx,.odp,.doc,.docx,.odt">
      </div>
      <div class="row">
        <button class="btn sm ghost" id="ai-shot" title="Screenshot area: drag di tab aktif, hasilnya masuk lampiran + dibaca AI">${icon('crop', 13)}SS seleksi</button>
        <button class="btn sm ghost" id="ai-vis" title="Screenshot area terlihat tab aktif">${icon('camera', 13)}SS tampak</button>
        <button class="btn sm ghost" id="ai-draw" title="Corat-coret di tab aktif (klik lagi untuk kunci, coretan ikut scroll)">${icon('pen', 13)}Draw</button>
        <button class="btn sm ghost" data-go="cap" title="Screenshot full-page & rekam layar/webcam/tab">${icon('video', 13)}Capture</button>
      </div>
      <div class="row">
        <select id="ai-mode" style="max-width:190px" title="Mode agen isi field">
          <option value="semi">Semi: AI usul → saya klik OK</option>
          <option value="auto">Otomatis: AI langsung isi</option>
          <option value="manual">Manual: hanya teks panduan</option>
        </select>
        <select id="ai-depth" style="max-width:170px" title="Kecepatan vs kedalaman jawaban (fungsional)">
          <option value="cepat">⚡ Cepat: ringkas</option>
          <option value="mendalam">🔍 Mendalam: detail</option>
        </select>
        <button class="btn sm ghost" data-go="setting">${icon('gear', 13)}Setting AI</button>
      </div>
      <div class="tiny" id="ai-ctx">Konteks: profil akademik. Tab & lampiran hanya dibaca saat kamu klik tombol.</div>
            <div class="att-row" id="ai-att"></div>
            <div class="sec">Jadikan file (DOCX / PDF)</div>
            <div class="card">
              <div class="tiny" id="exp-hint">Rumus jadi <b>persamaan Word asli</b>; DOCX memakai template (font & judul sama). PDF lewat Tuton Runtime/Word — kalau runtime mati, terbuka tab siap Ctrl+P.</div>
              <label class="f">Sumber isi</label>
              <textarea id="exp-md" rows="5" placeholder="Tempel / tulis materi di sini… (atau klik 'Pakai jawaban AI terakhir')"></textarea>
              <label class="f" style="margin-top:6px">Nama matkul (code matkul)</label>
              <input id="exp-course" placeholder="cth: EKMA5102 Statistika (Tuton 3)">
              <div class="row" style="margin-top:6px">
                <button class="btn sm ghost" id="exp-use-ai">Pakai jawaban AI terakhir</button>
                <button class="btn sm ghost" id="exp-check">Cek runtime PDF</button>
              </div>
              <div class="row">
                <button class="btn sm primary" id="exp-docx">${icon('file', 13)}DOCX (persamaan asli)</button>
                <button class="btn sm primary" id="exp-pdf">${icon('file', 13)}PDF</button>
                <button class="btn sm ghost" id="exp-txt">${icon('download', 13)}.md</button>
              </div>
              <div class="tiny" id="exp-note"></div>
                      </div>
                    <div id="ai-fill-box"></div>
                  </div>`;
  $('#ai-mode').value = agentMode;
  $('#ai-mode').addEventListener('change', async () => {
    const c = await loadAIConfig();
    await saveAIConfig({ ...c, agentMode: $('#ai-mode').value });
    notify(`Mode agen: ${$('#ai-mode').selectedOptions[0].textContent}`);
  });
  content.querySelectorAll('[data-go]').forEach((b) => b.addEventListener('click', () => go(b.dataset.go)));
  // Toggle kedalaman jawaban (fungsional!): cepat = maxTokens kecil + instruksi
  // ringkas; mendalam = token besar + instruksi detail + konteks tab penuh.
  const depthSel = $('#ai-depth');
  const savedDepth = cfg.aiDepth || 'cepat';
  depthSel.value = savedDepth;
  depthSel.addEventListener('change', async () => {
    const c = await loadAIConfig();
    await saveAIConfig({ ...c, aiDepth: depthSel.value });
    notify(depthSel.value === 'mendalam' ? 'Mode Mendalam: jawaban detail + konteks penuh' : 'Mode Cepat: jawaban ringkas');
  });
  let tabCtx = { tabText: '', selection: '', tabTitle: '', tabUrl: '' };
  let tabFields = []; // [{selector, tag, type, label, value}]
  let tabClicks = []; // [{selector, text}] — tombol/link untuk TUTON_CLICK
  let tabId = null;
  let attachments = []; // [{name, kind:'text'|'image', text?, dataUrl?}]
  const removeAtt = (idx) => { attachments.splice(idx, 1); paintCtx(); };
  // Antrean dari halaman Capture ("Kirim ke AI") -> otomatis jadi lampiran.
  try {
    const pend = (await chrome.storage.local.get(['tuton_pendingShot'])).tuton_pendingShot || [];
    if (pend.length) {
      for (const s of pend.slice(-5)) {
        if (s?.dataUrl) attachments.push({ name: s.name || `capture-${Date.now()}.jpg`, size: s.size || 0, kind: 'image', dataUrl: s.dataUrl });
      }
      await chrome.storage.local.remove(['tuton_pendingShot']);
      if (attachments.length) notify(`${pend.length} hasil Capture masuk lampiran otomatis`);
    }
  } catch { /* antrean kosong */ }
  // ---- Export DOCX/PDF: card mandiri (materi ditempel atau jawaban AI terakhir).
  const expNote = (m, err) => {
    const el = $('#exp-note');
    if (!el) return;
    el.textContent = m;
    el.style.color = err ? 'var(--red)' : 'var(--acc)';
  };
  const expMd = () => String($('#exp-md')?.value || '').trim();
  const expCourse = () => String($('#exp-course')?.value || '').trim();
  const expRun = async (kind) => {
    const md = expMd();
    if (!md) { expNote('Isi dulu: tempel materi atau klik "Pakai jawaban AI terakhir".', true); return; }
    expNote(kind === 'docx' ? 'Menyusun DOCX…' : kind === 'pdf' ? 'Menyusun PDF…' : 'Menyimpan…');
    try {
      const doc = { course: expCourse(), title: guessTitle(md, 'Jawaban') };
      if (kind === 'docx') {
        const r = await exportDocx({ markdown: md, doc });
        expNote(`✓ ${r.name} (${(r.bytes / 1024).toFixed(0)} KB) terunduh`);
        notify(`DOCX terunduh: ${r.name}`);
      } else if (kind === 'pdf') {
        const r = await exportPdf({ markdown: md, doc });
        if (r.mode === 'runtime') { expNote(`✓ ${r.name} terunduh (via ${r.engine})`); notify(`PDF terunduh: ${r.name}`); }
        else { expNote('Tab siap-cetak dibuka → Ctrl+P → "Simpan sebagai PDF".' + (r.note ? ` (${String(r.note).slice(0, 90)})` : '')); notify('Tab siap-cetak dibuka'); }
      } else {
        // .md cadangan: bisa dipakai di app lain (Notion, Typora, dsb).
        const blobUrl = URL.createObjectURL(new Blob([md], { type: 'text/markdown' }));
        const a = document.createElement('a');
        a.href = blobUrl;
        a.download = `${guessTitle(md, 'jawaban')}.md`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(blobUrl), 30000);
        expNote(`✓ ${a.download} terunduh`);
      }
    } catch (e) {
      expNote('Gagal: ' + e.message, true);
      notify('Export gagal: ' + e.message, 'error');
    }
  };
  $('#exp-use-ai')?.addEventListener('click', () => {
    const last = String(globalThis.__lastAiMd || '').trim();
    if (!last) { expNote('Belum ada jawaban AI di sesi ini — tanya dulu di atas, atau tempel materi manual.', true); return; }
    $('#exp-md').value = last;
    expNote(`Jawaban AI terakhir dimuat (${last.length} char). Pilih DOCX/PDF.`);
  });
  $('#exp-check')?.addEventListener('click', async () => {
    expNote('Mengecek runtime…');
    const cap = await runtimeCapability();
    expNote(cap.ok
      ? `Runtime HIDUP di ${cap.url} · ekspor PDF: ${cap.engine === 'none' ? 'TIDAK ADA Word/LibreOffice (pakai tab cetak)' : cap.engine}`
      : `Runtime MATI di ${cap.url} (${cap.reason}) → PDF via tab siap-cetak. Nyalakan: node router/server.js`, !cap.ok);
  });
  $('#exp-docx')?.addEventListener('click', () => expRun('docx'));
  $('#exp-pdf')?.addEventListener('click', () => expRun('pdf'));
  $('#exp-txt')?.addEventListener('click', () => expRun('md'));
  // Dokumen titipan dari halaman lain (PDF Tools dsb): langsung isi card.
  try {
    const staged = await takeExport();
    if (staged?.markdown) {
      $('#exp-md').value = staged.markdown;
      if (staged.course) $('#exp-course').value = staged.course;
      expNote(`Dokumen dari halaman lain dimuat (${staged.markdown.length} char). Pilih DOCX / PDF.`);
      notify('Dokumen siap-ekspor dimuat dari halaman sebelumnya');
    }
  } catch { /* tidak ada titipan */ }
  const paintCtx = () => {
    const bits = [];
    if (tabCtx.tabText) bits.push(`tab: ${tabCtx.tabTitle || 'aktif'} (${(tabCtx.tabText.length / 1000).toFixed(1)}k char)`);
    if (tabFields.length) bits.push(`${tabFields.length} field`);
    if (tabClicks.length) bits.push(`${tabClicks.length} bisa-klik`);
    if (attachments.length) bits.push(`${attachments.length} lampiran`);
    $('#ai-ctx').textContent = bits.length ? 'Konteks: profil + ' + bits.join(' + ') + '.' : 'Konteks: profil akademik. Tab & lampiran hanya dibaca saat kamu klik tombol.';
    const rt = $('#ai-read-txt');
    if (rt) rt.textContent = tabCtx.tabText ? 'Tab terlampir ✓ (klik untuk ganti)' : 'Sertakan isi tab aktif';
    // Chip lampiran: nama + ukuran + tombol hapus per file.
    const box = $('#ai-att');
    if (box) {
      box.innerHTML = attachments.map((a, i) => {
        const tag = a.kind === 'image' ? 'gambar' : (/\.pdf$/i.test(a.name) ? 'PDF' : 'teks');
        const size = a.size ? ` · ${(a.size / 1024).toFixed(0)} KB` : '';
        const extra = a.kind === 'text' && a.text ? ` · ${(a.text.length / 1000).toFixed(1)}k char` : '';
        return `<span class="att-chip" title="${escapeHtml(a.name)}">${icon('file', 12)}<b>${escapeHtml(a.name.length > 22 ? a.name.slice(0, 20) + '…' : a.name)}</b><span class="tiny">${tag}${size}${extra}</span><button data-att-del="${i}" title="Hapus lampiran ini">${icon('x', 12)}</button></span>`;
      }).join('');
      box.querySelectorAll('[data-att-del]').forEach((b) => b.addEventListener('click', () => removeAtt(Number(b.dataset.attDel))));
    }
  };
  async function ensureReader(id) {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true }).catch(() => []);
    const url = tab?.url || '';
    let blocked = blockedReason(url);
    if (blocked === 'PDF-READER') blocked = 'PDF di tab browser tidak bisa dibaca langsung (proteksi Chrome). Klik Lampiran → pilih file PDF yang sama.';
    if (blocked) throw new Error(blocked);
    try {
      await chrome.scripting.executeScript({ target: { tabId: id }, files: ['src/content/reader.js'] });
    } catch (e) {
      throw new Error(blockReasonFromErr(url, e));
    }
    // Tunggu listener siap (timing: inject vs sendMessage balapan) — retry 3x.
    for (let i = 0; i < 3; i++) {
      try {
        await chrome.tabs.sendMessage(id, { type: 'TUTON_PING' });
        return;
      } catch (_) {
        try { await chrome.scripting.executeScript({ target: { tabId: id }, files: ['src/content/reader.js'] }); } catch {}
        await new Promise((r) => setTimeout(r, 300));
      }
    }
  }
  function blockedReason(url) {
    const u = String(url || '');
    if (!u) return null;
    if (/^(chrome|edge|about|opera|brave):\/\//.test(u)) return 'Tab ini halaman internal browser (chrome://…) — Chrome melarang extension membaca/mengkliknya. Buka halaman web biasa (http/https) dulu.';
    if (/^chrome-extension:\/\//.test(u)) return 'Tab ini halaman extension lain — tidak bisa dibaca/diklik. Buka halaman web biasa dulu.';
    // PDF viewer bawaan Chrome (chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/):
    // TIDAK bisa di-inject. Cara baca PDF: pakai tombol Lampiran di bawah
    // (file PDF langsung) — teksnya diekstrak lokal lalu dikirim ke AI.
    if (/^chrome-extension:\/\/mhjfbmdgcfjbbpaeojofohoefgiehjai\//.test(u)) return 'PDF-READER';
    if (/^file:\/\//.test(u) && /\.pdf$/i.test(u)) return 'PDF-READER';
    if (/^file:\/\//.test(u)) return 'File lokal diblokir Chrome secara default. Aktifkan "Allow access to file URLs" di chrome://extensions > Tuton OS > Details, lalu reload extension.';
    if (/chromewebstore\.google\.com|microsoftedge\.microsoft\.com/.test(u)) return 'Web Store memblokir inject extension. Buka situs targetnya langsung (bukan lewat Store).';
    if (/^view-source:/.test(u)) return 'Tab view-source tidak bisa dibaca. Buka halaman normalnya.';
    return null;
  }
  function blockReasonFromErr(url, e) {
    const m = String(e?.message || e);
    if (/cannot be scripted|chrome pages|permission/i.test(m)) return blockedReason(url) || 'Chrome menolak inject ke tab ini (halaman terproteksi). Buka halaman web biasa.';
    return 'Gagal suntik reader: ' + m;
  }
  $('#ai-read').addEventListener('click', async () => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) return notify('Tidak ada tab aktif', 'error');
      // PDF di viewer Chrome tidak bisa di-inject — arahkan ke Lampiran.
      if (blockedReason(tab.url || '') === 'PDF-READER') {
        notify('PDF di tab browser tidak bisa dibaca langsung (proteksi Chrome). Klik Lampiran → pilih file PDF yang sama — teksnya diekstrak lokal.', 'error');
        push('ai', 'Kamu membuka PDF di tab browser. Chrome melarang extension membaca PDF viewer bawaan — jadi klik tombol Lampiran di atas lalu pilih file PDF yang sama. Teksnya saya ekstrak lokal dan bahas di sini.');
        return;
      }
      tabId = tab.id;
      await ensureReader(tab.id);
      const res = await chrome.tabs.sendMessage(tab.id, { type: 'TUTON_READ_TAB' });
      if (!res?.ok) throw new Error(res?.error || 'reader menolak');
      tabCtx = { tabText: (res.text || '').slice(0, 8000), selection: res.selection || '', tabTitle: res.title || '', tabUrl: res.url || '' };
      paintCtx();
      notify(`Tab dibaca: ${(res.title || '').slice(0, 40)}…`);
    } catch (e) { notify('Gagal baca tab: ' + e.message + ' (halaman chrome:// & Web Store memang diblokir Chrome)', 'error'); }
  });
  $('#ai-fields').addEventListener('click', async () => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) return notify('Tidak ada tab aktif', 'error');
      tabId = tab.id;
      await ensureReader(tab.id);
      const res = await chrome.tabs.sendMessage(tab.id, { type: 'TUTON_FIELDS' });
      if (!res?.ok) throw new Error(res?.error || 'reader menolak');
      tabFields = res.fields || [];
      tabClicks = res.clickables || [];
      paintCtx();
      notify(tabFields.length ? `${tabFields.length} field terdaftar — AI bisa mengisinya.` : 'Tidak ada field isian di tab ini.');
    } catch (e) { notify('Gagal daftar field: ' + e.message, 'error'); }
  });
  $('#ai-file').addEventListener('change', async () => {
    const fs = [...$('#ai-file').files];
    if (!fs.length) return;
    for (const f of fs.slice(0, 5)) {
      try {
        if (/\.(txt|md|csv|json|html?)$/i.test(f.name) || f.type.startsWith('text/')) {
          attachments.push({ name: f.name, size: f.size, kind: 'text', text: (await f.text()).slice(0, 12000) });
        } else if (f.type.startsWith('image/') || /\.(png|jpe?g|webp|gif)$/i.test(f.name)) {
          // Gambar → image_url (vision). Model non-vision akan 400 → ditangani
          // di send(): otomatis dicoba ulang TANPA gambar + pesan jelas.
          const dataUrl = await readAsDataUrl(f);
          attachments.push({ name: f.name, size: f.size, kind: 'image', dataUrl });
        } else if (f.type === 'application/pdf' || /\.pdf$/i.test(f.name)) {
          // PDF 3 lapis: (1) teks lokal via pdf.js UMD; (2) halaman gambar via
          // OCR Tesseract; (3) FALLBACK Tuton Runtime (/api/read, Node bebas
          // CSP) — inilah yg menyelamatkan file UT kemarin. Runtime MATI =
          // pesan jelas cara nyalakannya, bukan "mesin belum termuat".
          try {
            const prog = (m) => notify(m);
            const text = await extractPdfTextLocal(f, prog);
            attachments.push({ name: f.name, size: f.size, kind: 'text', text: `(isi PDF ${f.name} — diekstrak lokal)\n${text}`.slice(0, 12000) });
          } catch (eLocal) {
            notify(`Baca lokal gagal (${eLocal.message.slice(0, 80)}), coba via Tuton Runtime…`);
            try {
              const rr = await readViaRuntime(f);
              if (rr?.ok && rr.text) {
                attachments.push({ name: f.name, size: f.size, kind: 'text', text: `(isi PDF ${f.name} — via Tuton Runtime)\n${String(rr.text).slice(0, 12000)}` });
              } else {
                attachments.push({ name: f.name, size: f.size, kind: 'text', text: `(PDF ${f.name}: lokal gagal (${eLocal.message.slice(0, 100)}); runtime: ${rr?.hint || rr?.mode || 'gagal'}. Saran: nyalakan runtime (node router/server.js) lalu lampirkan ulang, atau screenshot halaman bila model vision.)`.slice(0, 600) });
              }
            } catch (eRt) {
              attachments.push({ name: f.name, size: f.size, kind: 'text', text: `(PDF ${f.name} tidak bisa dibaca: lokal gagal (${eLocal.message.slice(0, 100)}), runtime juga gagal (${eRt.message.slice(0, 100)}). Nyalakan runtime: node router/server.js — atau screenshot halaman bila model vision.)`.slice(0, 600) });
            }
          }
        } else if (/\.(pptx?|odp)$/i.test(f.name)) {
          // PPT tidak bisa dibaca lokal (butuh unzip+XML) — arahkan user.
          attachments.push({ name: f.name, size: f.size, kind: 'text', text: `(lampiran ${f.name} adalah presentasi — extension tidak membaca PPT langsung. Saran: buka di PowerPoint/WPS lalu File > Export > PDF, lampirkan PDF-nya (halaman bergambar otomatis di-OCR), atau screenshot slide penting sebagai gambar bila model vision.)`.slice(0, 500) });
        } else if (/\.(doc|docx|odt|rtf|xls|xlsx|ods|csv)$/i.test(f.name) && !/\.csv$/i.test(f.name)) {
          // Office non-teks polos — arahkan user (tanpa lib unzip tambahan).
          attachments.push({ name: f.name, size: f.size, kind: 'text', text: `(lampiran ${f.name} adalah dokumen Office — extension tidak membacanya langsung. Saran: Save As/Export ke PDF atau copy-paste teksnya ke file .txt lalu lampirkan.)`.slice(0, 500) });
        } else {
          // audio/video/dll: JANGAN dikirim sebagai image_url (pasti 400 di
          // model non-vision). Simpan sebagai catatan nama + ukuran.
          attachments.push({ name: f.name, size: f.size, kind: 'text', text: `(lampiran ${f.name}, ${(f.size / 1024).toFixed(0)} KB, tipe ${f.type || 'binari'} — model teks tidak bisa membaca file ini langsung. Jelaskan isi file dengan kata-katamu di pertanyaan.)`.slice(0, 500) });
        }
      } catch (e) { notify(`${f.name}: ${e.message}`, 'error'); }
    }
    $('#ai-file').value = '';
    paintCtx();
    const pdfOk = attachments.some((a) => /\.pdf$/i.test(a.name) && (a.text || '').length > 600);
    notify(pdfOk ? `${attachments.length} lampiran siap — teks PDF terbaca lokal, siap dibahas AI.` : `${attachments.length} lampiran siap (teks dikirim langsung; gambar ikut bila model mendukung vision).`);
  });
  function readAsDataUrl(f) {
    return new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(r.result);
      r.onerror = () => rej(new Error('gagal baca file'));
      r.readAsDataURL(f);
    });
  }
  const extractPdfTextLocal = pdfFileToText; // alias: logika pindah ke top-level agar Bank Soal bisa pakai
  const push = (who, text, typing = false) => {
    // typeof aman utk let-dalam-TDZ? TIDAK — pakai globalThis flag langsung.
    if (globalThis.__tutonSes && !typing && (who === 'user' || who === 'ai')) {
      const d = document.createElement('div'); d.className = 'msg ' + who; d.textContent = text; $('#chat').appendChild(d); d.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      try { rememberMsg(who, text).catch(() => {}); } catch { /* sesi belum siap */ }
      return d;
    }
    const d = document.createElement('div'); d.className = 'msg ' + who + (typing ? ' typing' : ''); d.textContent = text; $('#chat').appendChild(d); d.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); return d;
  };
  // Render bubble AI: markdown (**bold**, *italic*, list, tabel, ```kode```,
  // $rumus$ / $$blok$$) -> HTML aman (escape dulu, baru markup). Rumus via
  // KaTeX lokal; blok kode ala Gemini (header + tombol salin).
  const renderAi = (el, raw) => {
    el.classList.remove('typing');
    el.innerHTML = '';
    el.appendChild(mdToHtml(String(raw || '')));
    bindCodeCopy(el);
    renderKatex(el);
    el.__raw = String(raw || '');            // bahan export DOCX/PDF
    el.appendChild(exportBar(String(raw || '')));
    el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    if (globalThis.__tutonSes) {
      try { rememberMsg('ai-html', String(raw || ''), el.innerHTML).catch(() => {}); } catch { /* sesi belum siap */ }
    }
  };
  // Tombol export di bawah tiap jawaban AI: DOCX (persamaan Word asli) & PDF.
  // Ada input cepat Tugas/Sesi/Mata kuliah — sudah terisi dari profil (setting),
  // jadi biasanya cukup klik. Ini yang membuat kop & nama file jadi
  // "JAWABAN Tugas 1 Sesi 3 - Bahasa Indonesia" / "jawaban tugas 1 sesi 3 - ....docx".
  const exportBar = (markdown) => {
    const bar = document.createElement('div');
    bar.className = 'exp-bar';
    bar.innerHTML = `<span class="exp-lab">${icon('download', 12)} Jadikan file</span>
      <span class="exp-mini">
        <input class="exp-t" data-meta="tugas" placeholder="Tugas" title="Tugas ke- (isi angka)">
        <input class="exp-t" data-meta="sesi" placeholder="Sesi" title="Sesi ke- (isi angka)">
        <input class="exp-c" data-meta="matkul" placeholder="Mata kuliah" title="Nama mata kuliah, cth: Bahasa Indonesia">
      </span>
      <button class="btn sm ghost" data-exp="docx" title="Word .docx dari template: rumus jadi persamaan asli, langsung terunduh">DOCX</button>
      <button class="btn sm ghost" data-exp="pdf" title="PDF rapi (lewat Tuton Runtime/Word; tanpa runtime terbuka tab siap Ctrl+P)">PDF</button>
      <span class="exp-note"></span>`;
    const note = bar.querySelector('.exp-note');
    const say = (m, err) => { note.textContent = m; note.style.color = err ? 'var(--red)' : 'var(--acc)'; };
    const field = (k) => bar.querySelector(`[data-meta="${k}"]`);
    const metaOf = () => {
      const tugas = String(field('tugas')?.value || '').trim();
      const sesi = String(field('sesi')?.value || '').trim();
      const matkul = String(field('matkul')?.value || '').trim();
      return { tugas, sesi, matkul, course: matkul };
    };
    // Isi dari profil (setting) — biar tidak perlu ketik ulang tiap tugas.
    (async () => {
      try {
        const p = (await load('tuton_profile', {})) || {};
        if (field('tugas') && !field('tugas').value) field('tugas').value = p.tugas || '';
        if (field('sesi') && !field('sesi').value) field('sesi').value = p.sesi || '';
        if (field('matkul') && !field('matkul').value) field('matkul').value = p.matkul || '';
      } catch { /* profil belum ada */ }
    })();
    bar.querySelectorAll('[data-exp]').forEach((b) => b.addEventListener('click', async () => {
      const kind = b.dataset.exp;
      b.disabled = true;
      say(kind === 'docx' ? 'Menyusun DOCX…' : 'Menyusun PDF…');
      try {
        const meta = metaOf();
        // Simpan pilihan ini sebagai profil supaya klik berikutnya otomatis.
        try { const p = (await load('tuton_profile', {})) || {}; await save('tuton_profile', { ...p, tugas: meta.tugas || p.tugas || '', sesi: meta.sesi || p.sesi || '', matkul: meta.matkul || p.matkul || '' }); } catch { /* abaikan */ }
        const doc = { ...meta, title: guessTitle(markdown, 'Jawaban') };
        doc.label = docLabel(doc) || doc.title;
        if (kind === 'docx') {
          const r = await exportDocx({ markdown, doc });
          say(`✓ ${r.name} terunduh`);
          notify(`DOCX terunduh: ${r.name}`);
        } else {
          const r = await exportPdf({ markdown, doc });
          if (r.mode === 'runtime') { say(`✓ ${r.name} terunduh (${r.engine})`); notify(`PDF terunduh: ${r.name}`); }
          else { say('Tab siap-cetak dibuka — Ctrl+P → Simpan sebagai PDF'); notify(r.note ? `PDF via tab cetak (${String(r.note).slice(0, 60)})` : 'Tab siap-cetak dibuka'); }
        }
      } catch (e) {
        say('Gagal: ' + e.message, true);
        notify('Export gagal: ' + e.message, 'error');
      } finally { b.disabled = false; }
    }));
    return bar;
  };
  const escHtml = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  // Permintaan file di chat: "jadiin pdf", "buatkan docx", "kirim word", dsb.
  // Panel langsung mengekspor jawaban terakhir (bukan menyuruh user jalan kode).
  const wantsFile = (q) => {
    const s = String(q || '').toLowerCase();
    const file = /(pdf|docx|doc\b|word|\.md\b|file|berkas|dokumen)/.test(s);
    const ask = /(jadiin|jadikan|bikin|buat|buatkan|convert|konversi|ekspor|export|unduh|download|simpan|kirim|tolong|minta|hasil|output|ke\s+(pdf|docx|word)|dalam\s+(pdf|docx|word)|format\s+(pdf|docx|word))/.test(s);
    return file && ask;
  };
  const fileKind = (q) => {
    const s = String(q || '').toLowerCase();
    if (/docx|word|\.doc\b/.test(s)) return 'docx';
    if (/pdf/.test(s)) return 'pdf';
    if (/\.md\b/.test(s)) return 'md';
    return null;
  };
  // Jawaban yang MENOLAK bikin file / menyuruh user jalan kode sendiri.
  // Dipakai untuk retry otomatis + supaya jawaban penolakan tidak dipakai
  // sebagai bahan ekspor (user minta file, harus dapat file).
  const looksRefusal = (t) => {
    const x = String(t || '');
    return /(tidak|nggak|ga|gak|belum)\s+(bisa|dapat|mampu)[^.\n]{0,70}(membuat|bikin|buat|menyimpan|mengirim|mengunduh|menghasilkan|ekspor|convert|mengonversi)[^.\n]{0,40}(file|pdf|docx|word|dokumen)/i.test(x)
      || /(saya|aku)\s+(hanya|cuma|hanya bisa|cuma bisa)[^.\n]{0,40}(teks|menjawab|memberi)/i.test(x)
      || /(silakan|silahkan|kamu\s+harus|coba)\s+(jalankan|gunakan|pakai|install|instal|unduh)[^.\n]{0,40}(python|pip\b|pandoc|latexmk|kode|script|latex)/i.test(x)
      || /tidak\s+punya\s+akses[^.\n]{0,40}(file|sistem|penyimpanan)/i.test(x);
  };
  function mdToHtml(src) {
    const frag = document.createDocumentFragment();
    // 1) potong blok kode ```lang\n...``` dulu (jangan disentuh inline-parse).
    const blocks = [];
    const noCode = src.replace(/```(\w*)\n?([\s\S]*?)(?:```|$)/g, (m, lang, code) => {
      blocks.push({ lang: (lang || 'code').slice(0, 20), code: code.replace(/\n$/, '') });
      return `\u0000CODE${blocks.length - 1}\u0000`;
    });
    // 2) tabel | a | b | (opsional, 2+ kolom).
    const lines = noCode.split('\n');
    let i = 0;
    const inline = (t) => {
      let h = escHtml(t);
      h = h.replace(/`([^`\n]+)`/g, '<code class="inline">$1</code>');
      h = h.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
      h = h.replace(/(^|\W)\*([^*\n]+)\*/g, '$1<em>$2</em>');
      return h;
    };
    while (i < lines.length) {
      const ln = lines[i];
      const codeM = ln.match(/^\u0000CODE(\d+)\u0000$/);
      if (codeM) {
        const b = blocks[Number(codeM[1])];
        const wrap = document.createElement('div');
        wrap.className = 'codeblock';
        const head = document.createElement('div');
        head.className = 'cb-head';
        const lab = document.createElement('span');
        lab.textContent = b.lang;
        const btn = document.createElement('button');
        btn.className = 'cb-copy';
        btn.type = 'button';
        btn.dataset.code = b.code;
        btn.textContent = 'Salin';
        head.appendChild(lab);
        head.appendChild(btn);
        const pre = document.createElement('pre');
        const code = document.createElement('code');
        code.textContent = b.code;
        pre.appendChild(code);
        wrap.appendChild(head);
        wrap.appendChild(pre);
        frag.appendChild(wrap);
        i++;
        continue;
      }
      // tabel: baris header |...| + baris --- di bawahnya
      if (/^\s*\|.*\|\s*$/.test(ln) && i + 1 < lines.length && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1])) {
        const table = document.createElement('table');
        const headRow = document.createElement('tr');
        ln.split('|').slice(1, -1).forEach((c) => {
          const th = document.createElement('th');
          th.innerHTML = inline(c.trim());
          headRow.appendChild(th);
        });
        table.appendChild(headRow);
        i += 2;
        while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) {
          const tr = document.createElement('tr');
          lines[i].split('|').slice(1, -1).forEach((c) => {
            const td = document.createElement('td');
            td.innerHTML = inline(c.trim());
            tr.appendChild(td);
          });
          table.appendChild(tr);
          i++;
        }
        frag.appendChild(table);
        continue;
      }
      const hM = ln.match(/^(#{1,4})\s+(.*)/);
      if (hM) {
        const h = document.createElement('h' + (hM[1].length + 1));
        h.innerHTML = inline(hM[2]);
        frag.appendChild(h);
        i++;
        continue;
      }
      if (/^\s*---+\s*$/.test(ln)) { frag.appendChild(document.createElement('hr')); i++; continue; }
      const liM = ln.match(/^\s*([-*]|\d+[.)])\s+(.*)/);
      if (liM) {
        const ul = document.createElement(ln.trim()[0] === '*' || ln.trim()[0] === '-' ? 'ul' : 'ol');
        while (i < lines.length) {
          const m2 = lines[i].match(/^\s*([-*]|\d+[.)])\s+(.*)/);
          if (!m2) break;
          const li = document.createElement('li');
          li.innerHTML = inline(m2[2]);
          ul.appendChild(li);
          i++;
        }
        frag.appendChild(ul);
        continue;
      }
      if (!ln.trim()) { i++; continue; }
      // paragraf: gabung sampai baris kosong/blok berikut
      const buf = [ln];
      i++;
      while (i < lines.length) {
        const t = lines[i];
        if (!t.trim()) break;
        if (/^\u0000CODE\d+\u0000$/.test(t)) break;
        if (/^(#{1,4})\s+/.test(t)) break;
        if (/^\s*([-*]|\d+[.)])\s+/.test(t)) break;
        buf.push(t);
        i++;
      }
      const p = document.createElement('p');
      p.innerHTML = buf.map(inline).join('<br>');
      frag.appendChild(p);
    }
    return frag;
  }
  function bindCodeCopy(scope) {
    scope.querySelectorAll('.cb-copy').forEach((b) => {
      b.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(b.dataset.code || '');
          b.textContent = 'Disalin ✓';
          setTimeout(() => { b.textContent = 'Salin'; }, 1500);
        } catch { b.textContent = 'Gagal'; }
      });
    });
  }
  function renderKatex(scope) {
    const K = globalThis.katex;
    if (!K?.render) return;
    // Blok $$...$$ dulu (displayMode), lalu inline $...$.
    const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
    const texts = [];
    while (walker.nextNode()) texts.push(walker.currentNode);
    for (const node of texts) {
      if (node.parentElement?.closest?.('.codeblock')) continue;
      const t = node.textContent;
      if (!t || !t.includes('$')) continue;
      const parts = t.split(/(\$\$[\s\S]+?\$\$|\$[^$\n]+?\$)/g);
      if (parts.length < 2) continue;
      const frag = document.createDocumentFragment();
      for (const part of parts) {
        const bM = part.match(/^\$\$([\s\S]+?)\$\$$/);
        const iM = !bM && part.match(/^\$([^$\n]+?)\$$/);
        if (bM || iM) {
          const span = document.createElement('span');
          try {
            K.render((bM ? bM[1] : iM[1]).trim(), span, { displayMode: !!bM, throwOnError: false });
          } catch { span.textContent = part; }
          frag.appendChild(span);
        } else if (part) {
          frag.appendChild(document.createTextNode(part));
        }
      }
      node.replaceWith(frag);
    }
  }
  const send = async () => {
    const q = $('#ai-in').value.trim();
    if (!q) return;
    $('#ai-in').value = '';
    push('user', q + (attachments.length ? ` [${attachments.length} lampiran: ${attachments.map((a) => a.name).join(', ')}]` : ''));
    const thinking = push('ai', 'Mengetik…', true);
    bumpActivity('a');
    try {
      const g = await load('tuton_grades', { semesters: [] });
      let prof = { ipk: 0, sks: 0 };
      try { if (g.semesters.length) prof = cumulative(g.semesters); } catch { /* abaikan */ }
      const t = await load('tuton_tracker', {});
      const mode = $('#ai-mode').value;
      // Toggle kedalaman: CEPAT = ringkas + hemat token; MENDALAM = detail.
      const deep = ($('#ai-depth')?.value || cfg.aiDepth || 'cepat') === 'mendalam';
      const maxTok = deep ? Math.max(Number(cfg.maxTokens) || 2000, 2000) : Math.min(Number(cfg.maxTokens) || 800, 800);
      const cfgSend = { ...cfg, maxTokens: maxTok };
      // Susun pesan: teks lampiran digabung ke prompt; GAMBAR jadi image_url.
      const textAtt = attachments.filter((a) => a.kind === 'text');
      const imgAtt = attachments.filter((a) => a.kind === 'image');
      let fullQ = q;
      if (deep) fullQ += `\n\n[KEDALAMAN: jawab MENDALAM dan detail — definisi lengkap, langkah penurunan rumus, contoh angka, jebakan soal tuton, checklist pemahaman.]`;
      else fullQ += `\n\n[KECEPATAN: jawab CEPAT dan ringkas — inti + poin penting saja, tanpa basa-basi.]`;
      for (const a of textAtt) fullQ += `\n\n--- lampiran ${a.name} ---\n${deep ? a.text : String(a.text || '').slice(0, 4000)}`;
      // KONTEKS TAB SELALU DISERTAKAN bila sudah dibaca (inilah yg bikin AI
      // "bisa summary apa yang ada di tab"): teks tab + judul + URL + seleksi.
      if (tabCtx.tabText) {
        fullQ += `\n\n[ISI TAB "${tabCtx.tabTitle || 'aktif'}" (${tabCtx.tabUrl || ''}):\n${tabCtx.tabText.slice(0, deep ? 10000 : 3000)}${tabCtx.selection ? `\n\nTEKS YANG USER SELEKSI:\n${tabCtx.selection.slice(0, 2000)}` : ''}\n\nInstruksi: user sedang membuka tab di atas. Ringkas/jawab berdasarkan isinya bila relevan.]`;
      }
      if (tabFields.length) {
        fullQ += `\n\n[FIELD TAB — ${tabFields.length} field tersedia. Bila user minta isi form, jawab SERTAKAN blok: \`\`\`json {"actions":[{"selector":"...","value":"..."}]} \`\`\` Daftar: ${tabFields.map((f) => `${f.selector} (${f.label}${f.value ? `, saat ini: ${f.value.slice(0, 40)}` : ''})`).join(' | ').slice(0, 2000)}]`;
      }
      if (tabClicks.length) {
        fullQ += `\n\n[ELEMEN BISA-KLIK — ${tabClicks.length} tombol/link. Bila user minta klik sesuatu, jawab SERTAKAN blok: \`\`\`json {"clicks":[{"selector":"..."}]} \`\`\` Daftar: ${tabClicks.map((c) => `${c.selector} (“${c.text}”)`).join(' | ').slice(0, 1500)}]`;
      }
      // Minta AI menjawab dgn markdown + LaTeX ($...$ / $$...$$) agar rumus
      // dirender KaTeX dan kode dirender dgn tombol salin di bubble.
      fullQ += `\n\n[FORMAT JAWABAN: pakai markdown (## judul, **bold**, - list, | tabel |). Rumus matematika WAJIB dalam LaTeX: inline $...$, blok $$...$$ (cth: $\\sin^2 x + \\cos^2 x = 1$, $$\\int_0^1 x^2 dx$$). Kode WAJIB dalam \`\`\`blok\`\`\` dgn nama bahasa.]`;
      fullQ += `\n\n[CATATAN FILE: aplikasi ini bisa mengubah jawabanmu langsung jadi file Word (.docx) dan PDF dengan rumus sebagai PERSAMAAN ASLI — tombol "Jadikan file: DOCX / PDF" ada di bawah jawaban. Jadi JANGAN bilang tidak bisa membuat file; cukup beri jawaban lengkap dalam markdown + LaTeX seperti format di atas.]`;
      const userMsg = { role: 'user', content: [{ type: 'text', text: fullQ }] };
      for (const a of imgAtt.slice(0, 3)) userMsg.content.push({ type: 'image_url', image_url: { url: a.dataUrl } });
      if (userMsg.content.length === 1) userMsg.content = fullQ; // hemat: teks murni
      const ctxBase = { ...tabCtx, profile: { ipk: prof.ipk, matkulLemah: parasites(g.semesters.flatMap((s) => s.courses)).slice(0, 3).map((x) => x.code) }, summary: profileSummary({ ipk: prof.ipk, sks: prof.sks, streak: t.streak || 0 }) };
      let r;
      try {
        r = await askAI({ messages: [userMsg], context: ctxBase, actions: [] }, cfgSend);
      } catch (e) {
        // Model non-vision menolak image_url dengan 400 "upstream provider
        // rejected request parameters" → coba ulang TANPA gambar + pesan jelas.
        if (imgAtt.length && /400|rejected request|invalid_request|vision|image_url|image/i.test(e.message)) {
          push('ai', `Model menolak lampiran gambar (${imgAtt.map((a) => a.name).join(', ')}) — kemungkinan model ini tidak mendukung vision. Mencoba ulang tanpa gambar…`);
          r = await askAI({ messages: [{ role: 'user', content: fullQ + `\n\n[catatan: user melampirkan ${imgAtt.length} gambar (${imgAtt.map((a) => a.name).join(', ')}) tapi model ini tidak bisa membacanya — minta user menjelaskan isi gambar dengan kata-kata bila relevan.]` }], context: ctxBase, actions: [] }, cfgSend);
        } else throw e;
      }
      // --- Pengaman: model menolak bikin file? Retry tegas sekali. ---------
      let answer = String(r.content || '');
      const askedFile = wantsFile(globalThis.__lastUserAsk || q);
      if (askedFile && looksRefusal(answer)) {
        try {
          const hard = fullQ + `\n\n[PENTING: ekspor file ditangani aplikasi Tuton OS, BUKAN olehmu — tombol "Jadikan file: DOCX | PDF" ada di bawah jawabanmu dan filenya otomatis terunduh. JANGAN menolak, JANGAN menyebut keterbatasanmu, JANGAN menyuruh user menjalankan kode/instalasi. Tulis SEKARANG materi jawaban lengkapnya dalam markdown + LaTeX.]`;
          const r2 = await askAI({ messages: [{ role: 'user', content: hard }], context: ctxBase, actions: [] }, cfgSend);
          const a2 = String(r2?.content || '');
          if (a2 && !looksRefusal(a2)) answer = a2;
        } catch { /* pakai jawaban pertama */ }
      }
      renderAi(thinking, answer);
      globalThis.__lastAiMd = answer;
      globalThis.__lastAnswerRefusal = looksRefusal(answer);
      // Ekstrak usulan aksi dari jawaban AI: {"actions":[...]} isi field,
      // {"clicks":[...]} klik elemen. Mode otomatis = langsung jalan,
      // semi = kartu konfirmasi, manual = panduan teks saja.
      const actions = extractActions(r.content);
      const clicks = extractClicks(r.content);
      if (mode === 'manual') {
        if ((actions.length || clicks.length) && tabId) {
          push('ai', `Mode manual: saya tidak eksekusi otomatis. Panduan: isi ${actions.length} field + klik ${clicks.length} elemen sesuai jawaban di atas (lakukan manual di tab).`);
        }
      } else if ((actions.length || clicks.length) && tabId) {
        if (mode === 'auto') {
          if (actions.length) await doFill(tabId, actions);
          for (const c of clicks) await doClick(tabId, c.selector);
        } else {
          offerActionConfirm(actions, clicks, tabId);
        }
      }
    } catch (e) {
      thinking.classList.remove('typing');
      thinking.textContent = `Error: ${e.message}`;
    }
  };
  function extractActions(text) {
    const out = [];
    const re = /```json\s*(\{[\s\S]*?\})\s*```|(\{"actions"\s*:\s*\[[\s\S]*?\]\})/g;
    let m;
    while ((m = re.exec(text))) {
      try {
        const j = JSON.parse(m[1] || m[2]);
        const arr = j.actions || j;
        if (Array.isArray(arr)) for (const a of arr) if (a?.selector) out.push({ selector: String(a.selector), value: a.value ?? '' });
      } catch { /* abaikan blok non-JSON */ }
    }
    return out.slice(0, 20);
  }
  function extractClicks(text) {
    const out = [];
    const re = /```json\s*(\{[\s\S]*?\})\s*```|(\{"clicks"\s*:\s*\[[\s\S]*?\]\})/g;
    let m;
    while ((m = re.exec(text))) {
      try {
        const j = JSON.parse(m[1] || m[2]);
        const arr = j.clicks || [];
        if (Array.isArray(arr)) for (const c of arr) if (c?.selector) out.push({ selector: String(c.selector) });
      } catch { /* abaikan blok non-JSON */ }
    }
    return out.slice(0, 10);
  }
  async function doFill(id, actions) {
    try {
      await ensureReader(id);
      const res = await chrome.tabs.sendMessage(id, { type: 'TUTON_FILL', actions });
      const ok = (res?.filled || []).filter((x) => x.ok).length;
      push('ai', `Terisi ${ok}/${actions.length} field di tab.`);
      notify(`Terisi ${ok}/${actions.length} field`);
    } catch (e) { push('ai', `Gagal isi field: ${e.message}`); }
  }
  async function doClick(id, selector) {
    try {
      await ensureReader(id);
      const res = await chrome.tabs.sendMessage(id, { type: 'TUTON_CLICK', selector });
      if (res?.ok) { push('ai', `Klik OK: ${selector}`); notify('Klik OK di tab'); }
      else push('ai', `Klik gagal (${selector}): ${res?.error || 'unknown'}`);
    } catch (e) { push('ai', `Klik gagal: ${e.message}`); }
  }
  function offerActionConfirm(actions, clicks, id) {
    const box = $('#ai-fill-box');
    const rows = [
      ...actions.map((a, i) => `<div class="tiny mono">${i + 1}. isi ${escapeHtml(a.selector)} → “${escapeHtml(String(a.value ?? '').slice(0, 80))}”</div>`),
      ...clicks.map((c, i) => `<div class="tiny mono">${actions.length + i + 1}. KLIK ${escapeHtml(c.selector)}</div>`),
    ].join('');
    box.innerHTML = `<div class="card" style="margin-top:8px"><div class="eyebrow">${icon('grid', 13)} AI usul ${actions.length} isi + ${clicks.length} klik</div>${rows}<div class="row"><button class="btn primary sm" id="ai-fill-ok">OK, jalankan</button><button class="btn ghost sm" id="ai-fill-no">Batal</button></div></div>`;
    $('#ai-fill-ok').addEventListener('click', async () => {
      box.innerHTML = '';
      if (actions.length) await doFill(id, actions);
      for (const c of clicks) await doClick(id, c.selector);
    });
    $('#ai-fill-no').addEventListener('click', () => { box.innerHTML = ''; });
  }
  $('#ai-send').addEventListener('click', send);
  $('#ai-in').addEventListener('keydown', (e) => { if (e.key === 'Enter') send(); });
  // ---- Sesi chat persisten (tuton_ai_sessions): pindah tab tidak hilang.
  // Struktur: { ids: [sid], cur: sid, map: { sid: { title, at, msgs: [{who, text|html}] } } }.
  // Bubble AI disimpan sbg HTML hasil render (md+KaTeX) agar rumus/kode utuh
  // saat sesi dibuka ulang; bubble user sbg teks polos.
  const SES_KEY = 'tuton_ai_sessions';
  let sesCache = null;
  const loadSes = async () => {
    sesCache = (await load(SES_KEY, null)) || { ids: [], cur: null, map: {} };
    if (!sesCache.cur || !sesCache.map[sesCache.cur]) {
      const sid = 's' + Date.now().toString(36);
      sesCache = { ids: [sid], cur: sid, map: { [sid]: { title: 'Percakapan baru', at: Date.now(), msgs: [] } } };
      await save(SES_KEY, sesCache);
    }
    return sesCache;
  };
  const curSes = () => sesCache.map[sesCache.cur];
  const paintHist = () => {
    const sel = $('#ai-hist');
    sel.innerHTML = sesCache.ids.map((sid) => {
      const s = sesCache.map[sid];
      const label = `${(s?.title || 'Sesi').slice(0, 28)} · ${new Date(s?.at || Date.now()).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' })}`;
      return `<option value="${sid}"${sid === sesCache.cur ? ' selected' : ''}>${escapeHtml(label)}</option>`;
    }).join('');
  };
  const renderSesMsgs = () => {
    const box = $('#chat');
    box.innerHTML = '';
    for (const m of curSes().msgs) {
      if (m.who === 'ai-html') {
        const d = document.createElement('div');
        d.className = 'msg ai';
        d.innerHTML = m.html;
        // Bar export ikut tersimpan di html; buang lalu pasang ulang supaya
        // tombolnya hidup lagi (listener tidak ikut tersimpan).
        d.querySelectorAll('.exp-bar').forEach((x) => x.remove());
        box.appendChild(d);
        bindCodeCopy(d);
        renderKatex(d);
        d.appendChild(exportBar(m.md || ''));
        if (m.md) globalThis.__lastAiMd = m.md;
      } else {
        push(m.who, m.text);
        if (m.who === 'ai') globalThis.__lastAiMd = String(m.text || '');
      }
    }
    box.lastElementChild?.scrollIntoView({ block: 'nearest' });
  };
  const rememberMsg = async (who, text, html) => {
    const s = curSes();
    if (who === 'ai-html') s.msgs.push({ who, html, md: text || '' });
    else s.msgs.push({ who, text });
    if (!s.title || s.title === 'Percakapan baru') {
      const first = s.msgs.find((m) => m.who === 'user');
      if (first) s.title = first.text.slice(0, 34);
    }
    s.msgs = s.msgs.slice(-60); // batasi 60 bubble/sesi
    await save(SES_KEY, sesCache);
  };
  await loadSes();
  paintHist();
  renderSesMsgs();
  if (!curSes().msgs.length) {
    push('ai', 'Halo. Saya agen lokal-first — bisa baca tab aktif, terima lampiran, dan isi field (mode semi-otomatis default). Datamu tidak keluar perangkat kecuali ke 9router lokalmu.');
  }
  $('#ai-hist').addEventListener('change', async () => {
    sesCache.cur = $('#ai-hist').value;
    await save(SES_KEY, sesCache);
    renderSesMsgs();
  });
  $('#ai-new').addEventListener('click', async () => {
    const sid = 's' + Date.now().toString(36);
    sesCache.ids.unshift(sid);
    sesCache.ids = sesCache.ids.slice(0, 20); // max 20 sesi
    sesCache.cur = sid;
    sesCache.map[sid] = { title: 'Percakapan baru', at: Date.now(), msgs: [] };
    await save(SES_KEY, sesCache);
    paintHist();
    renderSesMsgs();
  });
  $('#ai-del').addEventListener('click', async () => {
    if (!confirm('Hapus sesi chat ini?')) return;
    delete sesCache.map[sesCache.cur];
    sesCache.ids = sesCache.ids.filter((x) => sesCache.map[x]);
    if (!sesCache.ids.length) {
      const sid = 's' + Date.now().toString(36);
      sesCache.ids = [sid];
      sesCache.map[sid] = { title: 'Percakapan baru', at: Date.now(), msgs: [] };
    }
    sesCache.cur = sesCache.ids[0];
    await save(SES_KEY, sesCache);
    paintHist();
    renderSesMsgs();
  });
  // Bungkus sesi: send() asli sudah menyimpan via flag sendUseSes di
  // push/renderAi — di sini cukup alihkan listener ke sendSes.
  // (push/renderAi dideklarasi const -> tidak bisa di-reassign.)
  $('#ai-send').replaceWith($('#ai-send').cloneNode(true));
  $('#ai-in').replaceWith($('#ai-in').cloneNode(true));
  $('#ai-send').addEventListener('click', sendSes);
  // Textarea: Enter = kirim, Shift+Enter = baris baru. Paste gambar langsung
  // jadi lampiran (tanpa lewat file picker).
  const aiIn = $('#ai-in');
  aiIn.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendSes(); }
  });
  aiIn.addEventListener('paste', async (e) => {
    const items = [...(e.clipboardData?.items || [])];
    const imgs = items.filter((it) => it.type?.startsWith('image/'));
    if (!imgs.length) return; // teks biasa -> biarkan default
    e.preventDefault();
    for (const it of imgs.slice(0, 3)) {
      const f = it.getAsFile();
      if (!f) continue;
      const dataUrl = await new Promise((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(r.result); r.onerror = () => rej(new Error('gagal baca gambar'));
        r.readAsDataURL(f);
      }).catch(() => null);
      if (dataUrl) {
        attachments.push({ name: f.name || `tempel-${Date.now()}.png`, size: f.size, kind: 'image', dataUrl });
        notify('Gambar dari clipboard masuk lampiran');
      }
    }
    paintCtx();
  });
  // ---- Tools tab: pastikan tools.js (bukan reader.js) yg terinject.
  async function ensureTools(id) {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true }).catch(() => []);
    const url = tab?.url || '';
    let blocked = blockedReason(url);
    if (blocked === 'PDF-READER') blocked = 'PDF di tab browser tidak bisa di-SS/draw langsung (proteksi Chrome). Download PDF-nya lalu buka di Chrome biasa, atau pakai Capture > Full-page.';
    if (blocked) throw new Error(blocked);
    try {
      await chrome.scripting.executeScript({ target: { tabId: id }, files: ['src/content/tools.js'] });
    } catch (e) {
      throw new Error(blockReasonFromErr(url, e));
    }
    for (let i = 0; i < 3; i++) {
      try { await chrome.tabs.sendMessage(id, { type: 'TUTON_PING' }); return; }
      catch (_) {
        try { await chrome.scripting.executeScript({ target: { tabId: id }, files: ['src/content/tools.js'] }); } catch {}
        await new Promise((r) => setTimeout(r, 300));
      }
    }
  }
  const cropDataUrl = (url, rect) => new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      try {
        const sx = Math.round(rect.x * rect.dpr), sy = Math.round(rect.y * rect.dpr);
        const sw = Math.round(rect.w * rect.dpr), sh = Math.round(rect.h * rect.dpr);
        const c = document.createElement('canvas');
        c.width = sw; c.height = sh;
        // Downscale sisi panjang max 1600px agar payload vision wajar.
        const k = Math.min(1, 1600 / Math.max(sw, sh));
        if (k < 1) { c.width = Math.round(sw * k); c.height = Math.round(sh * k); }
        const ctx = c.getContext('2d');
        ctx.drawImage(img, sx, sy, sw, sh, 0, 0, c.width, c.height);
        resolve(c.toDataURL('image/jpeg', 0.85));
      } catch (e) { reject(e); }
    };
    img.onerror = () => reject(new Error('gagal muat screenshot'));
    img.src = url;
  });
  async function activeTabId() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error('Tidak ada tab aktif');
    return tab.id;
  }
  // SS seleksi: drag area di tab -> crop dari captureVisibleTab -> lampiran gambar.
  $('#ai-shot').addEventListener('click', async () => {
    try {
      const id = await activeTabId();
      await ensureTools(id);
      const sel = await chrome.tabs.sendMessage(id, { type: 'TUTON_SHOT_AREA' });
      if (!sel?.ok) throw new Error(sel?.error || 'gagal seleksi');
      const shot = await chrome.tabs.captureVisibleTab({ format: 'jpeg', quality: 90 });
      const cropped = await cropDataUrl(shot, sel.rect);
      attachments.push({ name: `ss-seleksi-${Date.now()}.jpg`, size: Math.round(cropped.length * 0.75), kind: 'image', dataUrl: cropped });
      paintCtx();
      notify('SS seleksi masuk lampiran — tulis perintah lalu kirim');
    } catch (e) { notify('SS gagal: ' + e.message, 'error'); }
  });
  // SS tampak: langsung capture area terlihat tanpa drag.
  $('#ai-vis').addEventListener('click', async () => {
    try {
      const shot = await chrome.tabs.captureVisibleTab({ format: 'jpeg', quality: 90 });
      attachments.push({ name: `ss-tampak-${Date.now()}.jpg`, size: Math.round(shot.length * 0.75), kind: 'image', dataUrl: shot });
      paintCtx();
      notify('SS area terlihat masuk lampiran');
    } catch (e) { notify('SS gagal: ' + e.message, 'error'); }
  });
  // Draw: toggle overlay corat-coret di tab (klik lagi = kunci, coretan tetap).
  let drawOn = false;
  const drawBtn = $('#ai-draw');
  drawBtn.addEventListener('click', async () => {
    try {
      const id = await activeTabId();
      await ensureTools(id);
      if (!drawOn) {
        await chrome.tabs.sendMessage(id, { type: 'TUTON_DRAW_START', color: '#00e68a', size: 3 });
        drawOn = true;
        drawBtn.classList.add('active');
        notify('Mode draw AKTIF — corat-coret di tab, klik Draw lagi utk kunci');
      } else {
        await chrome.tabs.sendMessage(id, { type: 'TUTON_DRAW_STOP' });
        drawOn = false;
        drawBtn.classList.remove('active');
        notify('Draw dikunci — coretan tetap di halaman');
      }
    } catch (e) { notify('Draw gagal: ' + e.message, 'error'); }
  });
  async function sendSes() {
    globalThis.__tutonSes = true;
    globalThis.__lastUserAsk = String($('#ai-in')?.value || '');
    try { await send(); } finally { globalThis.__tutonSes = false; }
    // Kalau permintaannya "jadiin PDF/DOCX", file langsung dibuat sekarang.
    try { await maybeAutoExport(); } catch { /* jangan ganggu chat kalau export gagal */ }
  }
  // Auto-export: kalau user minta file di chat, panel langsung membuat filenya
  // dari jawaban AI (dan memberi tombol cadangan bila permintaan ambigu).
  async function maybeAutoExport() {
    const ask = String(globalThis.__lastUserAsk || '');
    if (!ask || !wantsFile(ask)) return;
    const kind = fileKind(ask);
    const md = String(globalThis.__lastAiMd || '').trim();
    const box = $('#ai-fill-box');
    if (!md) { box.innerHTML = `<div class="card" style="margin-top:8px"><div class="tiny">Kamu minta file, tapi belum ada jawaban AI yang bisa diekspor. Tanya dulu (mis. "jelaskan X"), lalu minta "jadiin PDF".</div></div>`; return; }
    // Jawaban AI yang MENOLAK bukan bahan file. Tetap sediakan jalan keluar:
    // ekspor pertanyaan/materi user sendiri, atau minta ulang materinya.
    if (globalThis.__lastAnswerRefusal) {
      const q = String(globalThis.__lastUserAsk || '').trim();
      box.innerHTML = `<div class="card" style="margin-top:8px">
        <div class="eyebrow">${icon('download', 13)} AI tadi menolak bikin file</div>
        <div class="tiny">Yang mengekspor file itu <b>panel ini</b>, bukan AI-nya. Pilih sumber isi filenya:</div>
        <div class="row">
          <button class="btn sm primary" id="ae-fromq">Pakai materi/soal saya</button>
          <button class="btn sm" id="ae-retry">Minta AI tulis materinya lagi</button>
          <button class="btn sm ghost" id="ae-openex">Buka halaman Jadikan File</button>
        </div>
        <div class="tiny" id="ae-note"></div></div>`;
      const note = (m, e) => { const el = $('#ae-note'); if (el) { el.textContent = m; el.style.color = e ? 'var(--red)' : 'var(--acc)'; } };
      $('#ae-fromq')?.addEventListener('click', async () => {
        if (!q) { note('Tidak ada teks pertanyaan untuk dijadikan file.', true); return; }
        const kind2 = kind || 'docx';
        note(`Menyusun ${kind2.toUpperCase()} dari teks kamu…`);
        const res = await doExport(kind2, q, docMeta, (m) => note(m));
        if (res?.ok) note(`✓ ${res.name || 'file'} terunduh (isi: teks pertanyaanmu).`);
      });
      $('#ae-retry')?.addEventListener('click', async () => {
        note('Minta AI menulis materi…');
        try {
          const r = await askAI({ messages: [{ role: 'user', content: `Tulis materi lengkap untuk permintaan berikut, siap dicetak (markdown + LaTeX):\n\n${q}\n\n[Ingat: ekspor file ditangani aplikasi Tuton OS — jangan menolak, jangan menyuruh user menjalankan kode. Langsung tulis materinya.]` }], context: {}, actions: [] });
          const a = String(r?.content || '').trim();
          if (!a || looksRefusal(a)) { note('AI masih menolak. Pakai tombol "Pakai materi/soal saya" atau halaman Jadikan File (tempel materinya).', true); return; }
          globalThis.__lastAiMd = a;
          const res = await doExport(kind || 'docx', a, docMeta, (m) => note(m));
          if (res?.ok) note(`✓ ${res.name || 'file'} terunduh.`);
        } catch (e) { note('Gagal: ' + e.message, true); }
      });
      $('#ae-openex')?.addEventListener('click', () => go('export'));
      return;
    }
    const say = (m, err) => { box.innerHTML = `<div class="card" style="margin-top:8px"><div class="tiny" style="color:${err ? 'var(--red)' : 'var(--acc)'}">${escapeHtml(m)}</div></div>`; };
    const prof0 = (await load('tuton_profile', {})) || {};
    const docMeta = { tugas: prof0.tugas || '', sesi: prof0.sesi || '', course: prof0.matkul || '', matkul: prof0.matkul || '', nama: prof0.nama || '', nim: prof0.nim || '', title: guessTitle(md, 'Jawaban') };
    docMeta.label = docLabel(docMeta) || docMeta.title;
    if (!kind) {
      box.innerHTML = `<div class="card" style="margin-top:8px"><div class="eyebrow">${icon('download', 13)} Kamu minta file — pilih formatnya</div><div class="row"><button class="btn sm primary" id="ae-docx">DOCX (persamaan asli)</button><button class="btn sm primary" id="ae-pdf">PDF</button><button class="btn sm ghost" id="ae-md">.md</button></div></div>`;
      const run = async (k) => {
        box.innerHTML = '';
        await doExport(k, md, docMeta, (m, e) => push('ai', m));
      };
      $('#ae-docx').addEventListener('click', () => run('docx'));
      $('#ae-pdf').addEventListener('click', () => run('pdf'));
      $('#ae-md').addEventListener('click', () => run('md'));
      return;
    }
    say(kind === 'docx' ? 'Menyusun DOCX…' : kind === 'pdf' ? 'Menyusun PDF…' : 'Menyimpan…');
    const res = await doExport(kind, md, docMeta, (m) => say(m));
    if (res?.mode === 'print') {
      box.innerHTML = `<div class="card" style="margin-top:8px"><div class="tiny">PDF dibuka di tab cetak (runtime/Word tidak tersedia). Tekan <b>Ctrl+P → Simpan sebagai PDF</b>.</div></div>`;
    } else if (res?.ok) {
      box.innerHTML = `<div class="card" style="margin-top:8px"><div class="tiny" style="color:var(--acc)">✓ ${escapeHtml(res.name || 'file')} terunduh ke folder Downloads.</div></div>`;
    } else {
      box.innerHTML = `<div class="card" style="margin-top:8px"><div class="tiny" style="color:var(--red)">Gagal: ${escapeHtml(res?.error || 'tidak diketahui')}</div><div class="row"><button class="btn sm" id="ae-docx2">Coba DOCX</button><button class="btn sm ghost" id="ae-pdf2">Coba PDF</button></div></div>`;
      $('#ae-docx2')?.addEventListener('click', () => { box.innerHTML = ''; doExport('docx', md, docMeta, (m) => push('ai', m)); });
      $('#ae-pdf2')?.addEventListener('click', () => { box.innerHTML = ''; doExport('pdf', md, docMeta, (m) => push('ai', m)); });
    }
  }
  // Satu pintu ekspor dari chat (dipakai tombol bubble & auto-export).
  async function doExport(kind, markdown, doc, onMsg) {
    try {
      if (kind === 'docx') {
        const r = await exportDocx({ markdown, doc });
        onMsg?.(`DOCX terunduh: ${r.name} (${(r.bytes / 1024).toFixed(0)} KB)`);
        notify(`DOCX terunduh: ${r.name}`);
        return { ok: true, name: r.name, mode: 'docx' };
      }
      if (kind === 'pdf') {
        const r = await exportPdf({ markdown, doc });
        if (r.mode === 'runtime') { onMsg?.(`PDF terunduh: ${r.name} (via ${r.engine})`); notify(`PDF terunduh: ${r.name}`); return { ok: true, name: r.name, mode: 'runtime' }; }
        onMsg?.(`PDF dibuka di tab cetak${r.note ? ` (${String(r.note).slice(0, 80)})` : ''} — Ctrl+P → Simpan sebagai PDF.`);
        return { ok: true, mode: 'print' };
      }
      const blobUrl = URL.createObjectURL(new Blob([markdown], { type: 'text/markdown' }));
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = `${guessTitle(markdown, 'jawaban')}.md`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(blobUrl), 30000);
      onMsg?.(`${a.download} terunduh`);
      return { ok: true, name: a.download, mode: 'md' };
    } catch (e) {
      onMsg?.(`Export gagal: ${e.message}`);
      notify('Export gagal: ' + e.message, 'error');
      return { ok: false, error: e.message };
    }
  }
}

// ---------- Jadikan File: DOCX/PDF dari materi apa pun (rumus jadi persamaan asli) ----------
async function vExport() {
  const prof = (await load('tuton_profile', {})) || {};
  content.innerHTML = `
    <div class="card hero">
      <div class="eyebrow">${icon('download', 13)} Jadikan file · DOCX &amp; PDF</div>
      <div class="s" style="margin-top:0">Tulis/tempel materi (markdown + LaTeX <code class="inline">$…$</code> / <code class="inline">$$…$$</code>) → jadi <b>Word .docx</b> ber-<b>persamaan asli</b> (font & judul sama dengan template) atau <b>PDF</b>. DOCX dirakit lokal di extension; PDF lewat Tuton Runtime + Word bila hidup (kualitas paling rapi), kalau tidak terbuka tab siap Ctrl+P.</div>
      <div class="row"><button class="btn sm ghost" id="ex-check">${icon('refresh', 13)}Cek runtime PDF</button><button class="btn sm ghost" id="ex-md">${icon('file', 13)}Impor .md/.txt</button><input type="file" id="ex-file" hidden accept=".md,.txt,.markdown"></div>
      <div class="tiny" id="ex-runtime"></div>
    </div>
    <div class="sec">Isi dokumen</div>
    <div class="card">
      <textarea id="ex-mdbox" rows="10" placeholder="## Soal 1&#10;&#10;Rata-rata $&#92;bar{x}=&#92;frac{&#92;sum x_i}{n}$&#10;&#10;$$s^2=&#92;frac{1}{n-1}&#92;sum_{i=1}^{n}(x_i-&#92;bar{x})^2$$"></textarea>
      <div class="row" style="margin-top:6px">
        <div style="flex:0 1 90px"><label class="f">Tugas ke-</label><input id="ex-tugas" value="${escapeHtml(prof.tugas || '')}" placeholder="cth: 1"></div>
        <div style="flex:0 1 90px"><label class="f">Sesi</label><input id="ex-sesi" value="${escapeHtml(prof.sesi || '')}" placeholder="cth: 3"></div>
        <div style="flex:1;min-width:140px"><label class="f">Mata kuliah</label><input id="ex-course" value="${escapeHtml(prof.matkul || '')}" placeholder="cth: Bahasa Indonesia"></div>
        <div style="flex:1;min-width:120px"><label class="f">Nama</label><input id="ex-nama" value="${escapeHtml(prof.nama || '')}" placeholder="cth: Fatahillah Mirza Achmadil"></div>
        <div style="flex:1;min-width:100px"><label class="f">NIM</label><input id="ex-nim" value="${escapeHtml(prof.nim || '')}" placeholder="cth: 055752694"></div>
      </div>
      <div class="tiny">Nama/NIM/matkul tersimpan otomatis ke profil saat kamu export — tidak perlu isi ulang lain kali.</div>
    </div>
    <div class="sec">Jadikan</div>
    <div class="card">
      <div class="row">
        <button class="btn primary" id="ex-docx">${icon('file', 14)}DOCX ber-rumus &amp; unduh</button>
        <button class="btn primary" id="ex-pdf">${icon('file', 14)}PDF &amp; unduh</button>
        <button class="btn ghost" id="ex-save">${icon('check', 14)}Simpan profil</button>
      </div>
      <div class="tiny" id="ex-note">Rumus di Word menjadi objek persamaan (bukan gambar) sehingga bisa diedit di Word. PDF lewat Word memakai mesin layout yang sama.</div>
    </div>
    <div class="sec">Bahan cepat</div>
    <div class="card">
      <div class="row">
        <button class="btn sm ghost" id="ex-from-ai">${icon('cpu', 13)}Jawaban AI terakhir</button>
        <button class="btn sm ghost" id="ex-from-soal">${icon('book', 13)}Bank Soal (kuis tersimpan)</button>
        <button class="btn sm ghost" id="ex-from-bmp">${icon('layers', 13)}Ringkasan BMP</button>
      </div>
      <div class="tiny" id="ex-src-note">Ambil materi yang sudah ada supaya tidak perlu tempel ulang.</div>
    </div>`;
  const note = (m, err) => { const el = $('#ex-note'); if (el) { el.textContent = m; el.style.color = err ? 'var(--red)' : 'var(--acc)'; } };
  const srcNote = (m, err) => { const el = $('#ex-src-note'); if (el) { el.textContent = m; el.style.color = err ? 'var(--red)' : 'var(--dim)'; } };
  const mdBox = () => String($('#ex-mdbox')?.value || '').trim();
  const docMeta = () => ({
    tugas: String($('#ex-tugas')?.value || '').trim(),
    sesi: String($('#ex-sesi')?.value || '').trim(),
    course: String($('#ex-course')?.value || '').trim(),
    matkul: String($('#ex-course')?.value || '').trim(),
    nama: String($('#ex-nama')?.value || '').trim(),
    nim: String($('#ex-nim')?.value || '').trim(),
  });
  const rememberProfile = async () => {
    const p = (await load('tuton_profile', {})) || {};
    const m = docMeta();
    await save('tuton_profile', { ...p, nama: m.nama || p.nama || '', nim: m.nim || p.nim || '', matkul: m.course || p.matkul || '', tugas: m.tugas || p.tugas || '', sesi: m.sesi || p.sesi || '' });
  };
  const run = async (kind) => {
    const md = mdBox();
    if (!md) { note('Isi dokumen dulu (atau ambil dari bahan cepat di bawah).', true); return; }
    await rememberProfile();
    const meta = docMeta();
    note(kind === 'docx' ? 'Menyusun DOCX…' : 'Menyusun PDF…');
    try {
      const doc = { ...meta, title: guessTitle(md, 'Jawaban') };
      doc.label = docLabel(doc) || doc.title;
      if (kind === 'docx') {
        const r = await exportDocx({ markdown: md, doc });
        note(`✓ ${r.name} (${(r.bytes / 1024).toFixed(0)} KB) terunduh — cek folder Downloads.`);
        notify(`DOCX terunduh: ${r.name}`);
      } else {
        const r = await exportPdf({ markdown: md, doc });
        if (r.mode === 'runtime') { note(`✓ ${r.name} terunduh (via ${r.engine}).`); notify(`PDF terunduh: ${r.name}`); }
        else { note('Tab siap-cetak dibuka → Ctrl+P → "Simpan sebagai PDF".' + (r.note ? ` Catatan: ${String(r.note).slice(0, 120)}` : ''), true); notify('Tab siap-cetak dibuka'); }
      }
    } catch (e) { note('Gagal: ' + e.message, true); notify('Export gagal: ' + e.message, 'error'); }
  };
  $('#ex-docx')?.addEventListener('click', () => run('docx'));
  $('#ex-pdf')?.addEventListener('click', () => run('pdf'));
  $('#ex-save')?.addEventListener('click', async () => { await rememberProfile(); note('Profil (nama/NIM/matkul) tersimpan — dipakai otomatis untuk export berikutnya.'); notify('Profil tersimpan'); });
  $('#ex-check')?.addEventListener('click', async () => {
    const el = $('#ex-runtime');
    el.textContent = 'Mengecek…';
    const cap = await runtimeCapability();
    el.textContent = cap.ok
      ? `Runtime HIDUP di ${cap.url} · mesin PDF: ${cap.engine === 'none' ? 'tidak ada Word/LibreOffice → PDF via tab cetak' : cap.engine}`
      : `Runtime MATI di ${cap.url} (${cap.reason}) → PDF akan lewat tab siap-cetak. Nyalakan: node router/server.js`;
    el.style.color = cap.ok && cap.engine !== 'none' ? 'var(--acc)' : 'var(--dim)';
  });
  $('#ex-md')?.addEventListener('click', () => $('#ex-file')?.click());
  $('#ex-file')?.addEventListener('change', async () => {
    const f = $('#ex-file').files?.[0];
    if (!f) return;
    $('#ex-mdbox').value = (await f.text()).slice(0, 200000);
    $('#ex-file').value = '';
    note(`Impor ${f.name} (${$('#ex-mdbox').value.length} char).`);
  });
  $('#ex-from-ai')?.addEventListener('click', () => {
    const last = String(globalThis.__lastAiMd || '').trim();
    if (!last) { srcNote('Belum ada jawaban AI di sesi ini — buka AI Agen, tanya, lalu kembali ke sini.', true); return; }
    $('#ex-mdbox').value = last;
    srcNote(`Jawaban AI terakhir dimuat (${last.length} char).`);
  });
  $('#ex-from-soal')?.addEventListener('click', async () => {
    const qc = (await load('tuton_qcache', {})) || {};
    const pkgs = Object.entries(qc).filter(([, v]) => v);
    if (!pkgs.length) { srcNote('Belum ada paket bank soal tersimpan. Buat/impor dulu di Bank Soal.', true); return; }
    const lines = ['# Bank Soal (soal tersimpan)', ''];
    let n = 0;
    for (const [nama, v] of pkgs.slice(0, 8)) {
      lines.push(`## Paket: ${nama}`, '');
      const qs = v.questions || v.quiz || v.items || [];
      for (const q of (Array.isArray(qs) ? qs : []).slice(0, 30)) {
        n++;
        lines.push(`**${n}. ${String(q.q || q.question || q.text || '').slice(0, 300)}**`);
        const opts = q.options || q.choices || [];
        opts.forEach((o, i) => lines.push(`- ${String.fromCharCode(97 + i)}. ${String(o).slice(0, 200)}`));
        const ans = q.answer ?? q.correct ?? q.key;
        if (ans !== undefined) lines.push(`*Kunci: ${Array.isArray(ans) ? ans.join(', ') : ans}*`);
        lines.push('');
      }
    }
    if (n === 0) { srcNote('Paket soal ada tapi tidak ada butir terbaca (format tidak dikenal).', true); return; }
    $('#ex-mdbox').value = lines.join('\n').slice(0, 100000);
    srcNote(`${n} butir soal dimuat dari ${pkgs.length} paket.`);
  });
  $('#ex-from-bmp')?.addEventListener('click', async () => {
    const sum = (await load('tuton_summary', {})) || {};
    const keys = Object.keys(sum);
    if (!keys.length) { srcNote('Belum ada ringkasan BMP. Buat di BMP Studio dulu.', true); return; }
    const lines = ['# Ringkasan BMP', ''];
    for (const k of keys.slice(0, 12)) {
      lines.push(`## ${k}`, '', String(sum[k]?.text || '').slice(0, 6000), '');
    }
    $('#ex-mdbox').value = lines.join('\n').slice(0, 120000);
    srcNote(`${keys.length} ringkasan modul dimuat.`);
  });
}

// ---------- Capture: screenshot (full/visible/custom) + rekam (tab/layar/webcam) + draw ----------
// Hasil: preview + Download + "Kirim ke AI" (masuk lampiran AI Agen otomatis).
async function vCap() {
  content.innerHTML = `
    <div class="sec">Screenshot tab aktif</div>
    <div class="card">
      <div class="row">
        <button class="btn sm" id="cap-full">${icon('file', 13)}Full page</button>
        <button class="btn sm" id="cap-vis">${icon('camera', 13)}Visible area</button>
        <button class="btn sm" id="cap-custom">${icon('crop', 13)}Custom area</button>
      </div>
      <div class="tiny">Custom = drag area di tab (skill SS seleksi), hasilnya di-crop lokal. Full page = scroll-stitch otomatis (max ~15000px, selebihnya dipotong).</div>
      <div id="cap-shot-out"></div>
    </div>
    <div class="sec">Rekam</div>
    <div class="card">
      <div class="row">
        <select id="cap-mode" style="max-width:190px">
          <option value="tab">Tab aktif (audio tab ikut bila ada)</option>
          <option value="screen">Layar / window / app lain</option>
          <option value="cam">Webcam</option>
        </select>
        <button class="btn sm primary" id="cap-rec">${icon('video', 13)}Mulai rekam</button>
      </div>
      <div class="tiny" id="cap-rec-hint">Tab = via tabCapture (aman utk rekam tutorial di tab). Layar = pilih layar/window/app lain via dialog Chrome. Webcam = kamera perangkat.</div>
      <div id="cap-rec-out"></div>
    </div>
    <div class="sec">Draw / whiteboard di tab</div>
    <div class="card">
      <div class="row">
        <input type="color" id="cap-color" value="#00e68a" style="width:44px;padding:2px" title="Warna">
        <input type="range" id="cap-size" min="2" max="12" value="3" style="flex:1" title="Tebal garis">
        <button class="btn sm" id="cap-draw">${icon('pen', 13)}Mulai draw</button>
        <button class="btn sm ghost" id="cap-clear">Hapus coretan</button>
      </div>
      <div class="tiny">Coretan menempel di dokumen (ikut scroll). Klik "Kunci draw" utk mengunci (coretan tetap). Tidak bisa di chrome://, Web Store, PDF viewer.</div>
    </div>`;
  const out = (sel) => $(sel);
  const dl = (dataUrl, filename) => {
    try { chrome.downloads.download({ url: dataUrl, filename, saveAs: false }); }
    catch (e) { notify('Download gagal: ' + e.message, 'error'); }
  };
  const shotCard = (title, dataUrl, name) => {
    const box = out('#cap-shot-out');
    const d = document.createElement('div');
    d.className = 'card';
    d.style.marginTop = '8px';
    d.innerHTML = `<div class="eyebrow">${icon('camera', 13)} ${escapeHtml(title)}</div>
      <img src="${dataUrl}" style="width:100%;border-radius:8px;border:1px solid var(--line)" alt="hasil screenshot">
      <div class="row"><button class="btn sm primary">Download</button><button class="btn sm">Kirim ke AI</button></div>`;
    const [bDl, bAi] = d.querySelectorAll('button');
    bDl.addEventListener('click', () => dl(dataUrl, name));
    bAi.addEventListener('click', async () => {
      try {
        const cur = (await chrome.storage.local.get(['tuton_pendingShot'])).tuton_pendingShot || [];
        cur.push({ name, size: Math.round(dataUrl.length * 0.75), dataUrl, at: Date.now() });
        await chrome.storage.local.set({ tuton_pendingShot: cur.slice(-5) });
        notify('Masuk antrean AI — buka AI Agen, otomatis jadi lampiran');
      } catch (e) { notify('Gagal: ' + e.message, 'error'); }
    });
    box.prepend(d);
  };
  async function tabNow() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error('Tidak ada tab aktif');
    return tab;
  }
  function capBlocked(url) {
    const u = String(url || '');
    if (/^(chrome|edge|about|opera|brave):\/\//.test(u)) return 'Halaman internal browser tidak bisa di-capture via tab API. Pakai mode rekam Layar.';
    if (/^chrome-extension:\/\//.test(u)) return 'Halaman extension/PDF viewer tidak bisa di-capture tab. Download PDF-nya / pakai mode Layar.';
    if (/chromewebstore\.google\.com|microsoftedge\.microsoft\.com/.test(u)) return 'Web Store memblokir. Buka situs targetnya langsung.';
    return null;
  }
  async function ensureToolsCap(id, url) {
    const b = capBlocked(url);
    if (b) throw new Error(b);
    await chrome.scripting.executeScript({ target: { tabId: id }, files: ['src/content/tools.js'] });
    for (let i = 0; i < 3; i++) {
      try { await chrome.tabs.sendMessage(id, { type: 'TUTON_PING' }); return; }
      catch (_) { await new Promise((r) => setTimeout(r, 300)); }
    }
  }
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  out('#cap-vis').addEventListener('click', async () => {
    try {
      const tab = await tabNow();
      const b = capBlocked(tab.url || '');
      if (b) throw new Error(b);
      const url = await chrome.tabs.captureVisibleTab({ format: 'jpeg', quality: 90 });
      shotCard('Visible area · ' + (tab.title || '').slice(0, 40), url, `tuton-visible-${Date.now()}.jpg`);
      notify('Visible area tercapture');
    } catch (e) { notify('Capture gagal: ' + e.message, 'error'); }
  });
  out('#cap-custom').addEventListener('click', async () => {
    try {
      const tab = await tabNow();
      await ensureToolsCap(tab.id, tab.url || '');
      const sel = await chrome.tabs.sendMessage(tab.id, { type: 'TUTON_SHOT_AREA' });
      if (!sel?.ok) throw new Error(sel?.error || 'gagal seleksi');
      const full = await chrome.tabs.captureVisibleTab({ format: 'jpeg', quality: 90 });
      const r = sel.rect;
      const cropped = await new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
          try {
            const sx = Math.round(r.x * r.dpr), sy = Math.round(r.y * r.dpr);
            const sw = Math.round(r.w * r.dpr), sh = Math.round(r.h * r.dpr);
            const c = document.createElement('canvas');
            const k = Math.min(1, 1600 / Math.max(sw, sh));
            c.width = Math.round(sw * k); c.height = Math.round(sh * k);
            c.getContext('2d').drawImage(img, sx, sy, sw, sh, 0, 0, c.width, c.height);
            resolve(c.toDataURL('image/jpeg', 0.85));
          } catch (e) { reject(e); }
        };
        img.onerror = () => reject(new Error('gagal muat screenshot'));
        img.src = full;
      });
      shotCard(`Custom ${Math.round(r.w)}×${Math.round(r.h)}`, cropped, `tuton-custom-${Date.now()}.jpg`);
      notify('Custom area tercapture');
    } catch (e) { notify('Capture gagal: ' + e.message, 'error'); }
  });
  out('#cap-full').addEventListener('click', async () => {
    try {
      const tab = await tabNow();
      const b = capBlocked(tab.url || '');
      if (b) throw new Error(b);
      const [dim] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => ({ sw: document.documentElement.scrollWidth, sh: document.documentElement.scrollHeight, vw: window.innerWidth, vh: window.innerHeight, dpr: window.devicePixelRatio || 1 }),
      }).catch(() => []);
      const d = dim?.result;
      if (!d) throw new Error('tidak bisa baca dimensi halaman');
      if (d.sh > 15000) notify('Halaman sangat panjang — dijahit max ~15000px atas.');
      const H = Math.min(d.sh, 15000);
      const k = Math.min(1, 2000 / d.sw); // batasi lebar max 2000px
      const c = document.createElement('canvas');
      c.width = Math.round(d.sw * k); c.height = Math.round(H * k);
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
      for (let y = 0; y < H; y += d.vh) {
        await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: (yy) => window.scrollTo(0, yy), args: [y] }).catch(() => {});
        await wait(350);
        const url = await chrome.tabs.captureVisibleTab({ format: 'jpeg', quality: 90 });
        const hSlice = Math.min(d.vh, H - y);
        await new Promise((resolve, reject) => {
          const img = new Image();
          img.onload = () => {
            try {
              // sumber: viewport penuh; ambil setinggi slice (dpr-aware)
              const sy = 0;
              ctx.drawImage(img, 0, sy * d.dpr, img.width, hSlice * d.dpr, 0, y * k, c.width, hSlice * k);
              resolve();
            } catch (e) { reject(e); }
          };
          img.onerror = () => reject(new Error('gagal jahit'));
          img.src = url;
        });
      }
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => window.scrollTo(0, 0) }).catch(() => {});
      const out = c.toDataURL('image/jpeg', 0.85);
      shotCard(`Full page ${d.sw}×${H}`, out, `tuton-fullpage-${Date.now()}.jpg`);
      notify('Full page selesai dijahit');
    } catch (e) { notify('Full page gagal: ' + e.message, 'error'); }
  });
  // ---- Rekam ----
  let mediaRec = null, mediaChunks = [], mediaStream = null, recMode = 'tab';
  const recBtn = out('#cap-rec');
  const recOut = out('#cap-rec-out');
  recBtn.addEventListener('click', async () => {
    try {
      if (mediaRec) { // STOP
        const blob = await new Promise((resolve) => {
          mediaRec.onstop = () => resolve(new Blob(mediaChunks, { type: mediaRec.mimeType || 'video/webm' }));
          try { mediaRec.stop(); } catch { resolve(new Blob(mediaChunks, { type: 'video/webm' })); }
        });
        try { mediaStream?.getTracks().forEach((t) => t.stop()); } catch {}
        mediaRec = null; mediaStream = null;
        recBtn.innerHTML = `${icon('video', 13)}Mulai rekam`;
        const url = await new Promise((resolve) => {
          const r = new FileReader();
          r.onload = () => resolve(r.result); r.onerror = () => resolve(null);
          r.readAsDataURL(blob);
        });
        if (url) {
          recOut.innerHTML = `<video src="${url}" controls style="width:100%;border-radius:8px;margin-top:8px"></video><div class="row"><button class="btn sm primary" id="cap-dl">Download .webm (${(blob.size / 1048576).toFixed(1)} MB)</button></div>`;
          out('#cap-dl').addEventListener('click', () => dl(url, `tuton-rekam-${Date.now()}.webm`));
          notify('Rekaman selesai — preview + download di bawah');
        }
        return;
      }
      recMode = out('#cap-mode').value;
      mediaChunks = [];
      if (recMode === 'tab') {
        const tab = await tabNow();
        await ensureToolsCap(tab.id, tab.url || '');
        const r = await chrome.tabs.sendMessage(tab.id, { type: 'TUTON_REC_START' });
        if (!r?.ok) throw new Error(r?.error || 'tabCapture ditolak');
        // Rekam tab: recorder jalan di content (tab tsb). Tandai via polling.
        recBtn.innerHTML = `${icon('stop', 13)}Stop (tab merekam…)`;
        notify('Merekam TAB — klik Stop utk selesai (hasil diambil dari tab)');
        mediaRec = { _tab: tab.id, mimeType: 'video/webm',
          stop() { chrome.tabs.sendMessage(this._tab, { type: 'TUTON_REC_STOP' }).then((res) => {
            mediaRec = null; mediaStream = null;
            recBtn.innerHTML = `${icon('video', 13)}Mulai rekam`;
            if (res?.ok && res.dataUrl) {
              recOut.innerHTML = `<video src="${res.dataUrl}" controls style="width:100%;border-radius:8px;margin-top:8px"></video><div class="row"><button class="btn sm primary" id="cap-dl">Download .webm (${((res.size || 0) / 1048576).toFixed(1)} MB)</button></div>`;
              out('#cap-dl').addEventListener('click', () => dl(res.dataUrl, `tuton-rekam-tab-${Date.now()}.webm`));
            } else notify('Stop gagal: ' + (res?.error || 'unknown'), 'error');
          }); },
        };
        return;
      }
      if (recMode === 'screen') {
        mediaStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true }).catch(() => navigator.mediaDevices.getDisplayMedia({ video: true }));
      } else {
        mediaStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true }).catch(() => navigator.mediaDevices.getUserMedia({ video: true }));
      }
      mediaRec = new MediaRecorder(mediaStream, { mimeType: 'video/webm' });
      mediaRec.ondataavailable = (e) => { if (e.data?.size) mediaChunks.push(e.data); };
      mediaRec.start(1000);
      recBtn.innerHTML = `${icon('stop', 13)}Stop`;
      notify('Merekam ' + (recMode === 'screen' ? 'layar' : 'webcam') + '…');
    } catch (e) { notify('Rekam gagal: ' + e.message, 'error'); }
  });
  // ---- Draw ----
  let capDrawOn = false;
  const capDrawBtn = out('#cap-draw');
  capDrawBtn.addEventListener('click', async () => {
    try {
      const tab = await tabNow();
      await ensureToolsCap(tab.id, tab.url || '');
      if (!capDrawOn) {
        await chrome.tabs.sendMessage(tab.id, { type: 'TUTON_DRAW_START', color: out('#cap-color').value, size: Number(out('#cap-size').value) || 3 });
        capDrawOn = true;
        capDrawBtn.innerHTML = `${icon('stop', 13)}Kunci draw`;
        notify('Draw AKTIF — corat-coret di tab, klik Kunci utk selesai (coretan tetap)');
      } else {
        await chrome.tabs.sendMessage(tab.id, { type: 'TUTON_DRAW_STOP' });
        capDrawOn = false;
        capDrawBtn.innerHTML = `${icon('pen', 13)}Mulai draw`;
        notify('Draw dikunci — coretan tetap di halaman');
      }
    } catch (e) { notify('Draw gagal: ' + e.message, 'error'); }
  });
  out('#cap-clear').addEventListener('click', async () => {
    try {
      const tab = await tabNow();
      await ensureToolsCap(tab.id, tab.url || '');
      await chrome.tabs.sendMessage(tab.id, { type: 'TUTON_DRAW_CLEAR' });
      notify('Coretan dihapus');
    } catch (e) { notify('Gagal: ' + e.message, 'error'); }
  });
}

// ---------- Setting ----------
async function vSetting() {
  const p = await load('tuton_profile', { prodi: '', targetIPK: 3.5, targetSKS: 145 });
  const cfg = await loadAIConfig();
  content.innerHTML = `
    <div class="sec">Profil akademik</div>
    <div class="card">
      <label class="f">Prodi</label><input id="p-prodi" value="${escapeHtml(p.prodi || '')}" placeholder="cth: Sistem Informasi">
      <div class="row"><div style="flex:0 1 90px"><label class="f">Tugas ke-</label><input id="p-tugas" value="${escapeHtml(p.tugas || '')}" placeholder="cth: 1"></div>
      <div style="flex:0 1 90px"><label class="f">Sesi</label><input id="p-sesi" value="${escapeHtml(p.sesi || '')}" placeholder="cth: 3"></div>
      <div style="flex:1;min-width:140px"><label class="f">Mata kuliah</label><input id="p-matkul" value="${escapeHtml(p.matkul || '')}" placeholder="cth: Bahasa Indonesia"></div></div>
      <div class="row"><div style="flex:1;min-width:100px"><label class="f">Nama (untuk kop jawaban)</label><input id="p-nama" value="${escapeHtml(p.nama || '')}" placeholder="cth: Fatahillah Mirza Achmadil"></div>
      <div style="flex:1;min-width:100px"><label class="f">NIM</label><input id="p-nim" value="${escapeHtml(p.nim || '')}" placeholder="cth: 055752694"></div></div>
      <div class="row"><div style="flex:1;min-width:100px"><label class="f">Target IPK</label><input id="p-ipk" type="number" step="0.01" value="${p.targetIPK ?? 3.5}"></div>
      <div style="flex:1;min-width:100px"><label class="f">Target SKS lulus</label><input id="p-sks" type="number" value="${p.targetSKS ?? 145}"></div></div>
      <div class="row"><button class="btn primary block" id="p-save">${icon('check', 14)}Simpan profil</button></div>
    </div>
    <div class="sec">AI Chat · bebas (provider apapun)</div>
    <div class="card">
      <div class="tiny" style="margin-bottom:6px">Chat AI langsung ke provider masing-masing — <b>tidak lewat runtime</b>. Isi base custom apapun (cth. gateway OpenAI-compatible seperti nutaraline), atur path bila gateway-mu pakai prefix berbeda.</div>
      <label class="f">Provider</label><select id="a-prov"><option value="9router">9router lokal</option><option value="openai">OpenAI</option><option value="anthropic">Anthropic</option><option value="custom">Custom (OpenAI-compatible)</option><option value="router">via Tuton Runtime (relay)</option><option value="auto">auto (utama → runtime relay)</option></select>
      <label class="f">Base URL</label><input id="a-url" value="${escapeHtml(cfg.baseUrl || NINE_BASE)}" placeholder=https://api.openai.com/v1 / https://gateway-kamu.tld/v1">
      <div class="row"><div style="flex:1;min-width:100px"><label class="f">Chat path</label><input id="a-chatpath" value="${escapeHtml(cfg.chatPath || '/chat/completions')}" placeholder="/chat/completions" class="mono"></div>
      <div style="flex:1;min-width:100px"><label class="f">Models path</label><input id="a-modelspath" value="${escapeHtml(cfg.modelsPath || '/models')}" placeholder="/models" class="mono"></div></div>
      <label class="f">Model</label>
      <div class="row" style="margin-top:2px"><input id="a-model" value="${escapeHtml(cfg.model || NINE_MODEL)}" placeholder="nura/muse-spark-1.3" style="flex:1;min-width:130px"><button class="btn sm" id="a-models" title="Tarik daftar model live dari provider">${icon('refresh', 13)}Model</button></div>
      <select id="a-models-sel" style="display:none"></select>
      <label class="f">API key ${cfg.apiKey ? '<span class="badge ok">terisi</span>' : '<span class="badge bad">kosong</span>'}${cfg.keySource === 'saved' ? ' <span class="tiny">· key tersimpan otomatis dipakai</span>' : cfg.keySource === 'local' ? ' <span class="tiny">· dari key lokal</span>' : ''}</label><input id="a-key" type="password" value="${escapeHtml(cfg.apiKey || '')}" placeholder="sk-… / sk-ant-… (otomatis dari key lokal bila dikosongkan)">
      <label class="f">Batas token jawaban</label><input id="a-maxtok" type="number" min="300" max="8000" step="100" value="${Number(cfg.maxTokens) || 2000}" title="Minimal 300 — jawaban kepotong biasanya karena nilai ini kekecilan">
      <div class="row"><button class="btn primary" id="a-save">${icon('check', 14)}Simpan</button><button class="btn ghost" id="a-test">${icon('refresh', 14)}Tes chat</button><button class="btn ghost sm" id="a-diag" title="Cek 5 lapis: worker, direct, via worker, key, chat">Diagnosa koneksi</button><button class="btn ghost sm" id="a-keyreset" title="Buang key simpanan, kembali ke key lokal">Reset key</button></div>
      <div class="s" id="a-out"></div>
      <div class="s mono" id="a-diag-out" style="white-space:pre-wrap"></div>
      <div class="tiny">Key otomatis diambil dari <code class="inline">src/ai/key.local.js</code> (tidak di-commit) bila kolom dikosongkan. Ganti provider → Base URL + model ikut berubah (bisa diubah manual).</div>
    </div>
    <div class="sec">Tuton Runtime · background tools (bukan AI)</div>
    <div class="card">
      <div class="tiny" style="margin-bottom:6px">Background service minimalis (<code class="inline">node router/server.js</code>) — <b>hanya untuk kerja berat</b>: baca PDF yg gagal di browser (<code class="inline">/api/read</code>), proxy daftar model, teruskan chat bila provider = relay. <b>Chat AI biasa tidak lewat sini.</b> Laptop: <code class="inline">http://127.0.0.1:3721</code> + token kosong. VPS/HP: <code class="inline">https://domain-kamu</code> + token.</div>
      <label class="f">Runtime URL</label><input id="a-router" value="${escapeHtml(cfg.routerUrl || 'http://127.0.0.1:3721')}" placeholder=http://127.0.0.1:3721 / https://tuton.kamu.id>
      <label class="f">Token runtime (wajib bila runtime di VPS, kosongkan di laptop)</label><input id="a-rttoken" type="password" value="${escapeHtml(cfg.runtimeToken || '')}" placeholder="sama dgn RUNTIME_TOKEN di router/.env server">
      <div class="row"><button class="btn sm" id="a-rttest">Tes runtime</button></div>
      <div class="s mono" id="a-rt-out" style="white-space:pre-wrap"></div>
    </div>
    <div class="sec">Data</div>
    <div class="card">
      <label class="f">ID extension BMP Terbuka (opsional, untuk handshake)</label><input id="d-bmp" value="${escapeHtml(p.bmpExtId || '')}" placeholder="cth: mkgmigiagipmfdlppehhmckfokmpnmlm" class="mono">
      <div class="row"><button class="btn" id="d-export">${icon('download', 14)}Export JSON</button><button class="btn danger" id="d-wipe">${icon('trash', 14)}Hapus semua</button></div>
      <div class="tiny">Backup berisi nilai, tracker, soal, dan setting — tersimpan sebagai file di perangkatmu.</div>
    </div>`;
  $('#a-prov').value = cfg.provider || '9router';
  // Ganti provider -> isi Base URL + model default provider tsb (manual bisa
  // diubah lagi). Custom dikosongkan agar user isi endpoint sendiri.
  const PROVIDER_DEFAULTS = {
    '9router': { base: 'http://127.0.0.1:20128/v1', model: 'nura/muse-spark-1.3' },
    openai: { base: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
    anthropic: { base: 'https://api.anthropic.com/v1', model: 'claude-3-5-haiku-latest' },
    custom: { base: '', model: '' },
    router: { base: '', model: '' },
    auto: { base: 'http://127.0.0.1:20128/v1', model: 'nura/muse-spark-1.3' },
  };
  $('#a-prov').addEventListener('change', () => {
    const d = PROVIDER_DEFAULTS[$('#a-prov').value];
    if (!d) return;
    if (d.base !== undefined) $('#a-url').value = d.base;
    if (d.model !== undefined) $('#a-model').value = d.model;
    $('#a-out').textContent = d.base ? `Preset ${$('#a-prov').selectedOptions[0].textContent} dimuat — isi API key lalu Simpan.` : 'Isi Base URL + model endpoint OpenAI-compatible kamu, lalu Simpan.';
  });
  $('#p-save').addEventListener('click', async () => { const prof = await load('tuton_profile', {}); await save('tuton_profile', { ...prof, tugas: $('#p-tugas')?.value.trim() || prof.tugas || '', sesi: $('#p-sesi')?.value.trim() || prof.sesi || '', matkul: $('#p-matkul')?.value.trim() || prof.matkul || '', prodi: $('#p-prodi').value.trim(), nama: $('#p-nama')?.value.trim() || prof.nama || '', nim: $('#p-nim')?.value.trim() || prof.nim || '', matkul: $('#p-matkul')?.value.trim() || prof.matkul || '', targetIPK: Number($('#p-ipk').value), targetSKS: Number($('#p-sks').value), bmpExtId: document.querySelector('#d-bmp')?.value.trim() || prof.bmpExtId || '' }); notify('Profil tersimpan'); refreshStatus(); });
  $('#a-save').addEventListener('click', async () => {
    // Kolom kosong = PERTAHANKAN key lama (jangan timpa jadi kosong → 401).
    const typed = $('#a-key').value.trim();
    const prev = await loadAIConfig();
    const q = (id) => (document.getElementById(id) || {}).value || '';
    const mt = Math.min(Math.max(Number($('#a-maxtok').value) || 2000, 300), 8000);
    await saveAIConfig({ provider: q('a-prov'), baseUrl: q('a-url').trim().replace(/\/*$/, ''), model: q('a-model').trim(), apiKey: typed || prev.apiKey || '', maxTokens: mt, agentMode: prev.agentMode || 'semi', aiDepth: prev.aiDepth || 'cepat', chatPath: q('a-chatpath').trim() || prev.chatPath || '/chat/completions', modelsPath: q('a-modelspath').trim() || prev.modelsPath || '/models', routerUrl: q('a-router').trim().replace(/\/*$/, ''), runtimeToken: (document.querySelector('#a-rttoken') || {}).value ? document.querySelector('#a-rttoken').value.trim() : (prev.runtimeToken || '') });
    notify(typed ? 'Config AI tersimpan' : 'Config tersimpan (key lama dipertahankan)'); render();
  });
  $('#a-keyreset').addEventListener('click', async () => {
    // Buang key simpanan yang salah → kembali ke key.local.js (yang terbukti jalan).
    const prev = await loadAIConfig();
    await saveAIConfig({ ...prev, apiKey: '' });
    try { await chrome.storage.local.remove(['tuton_key']); } catch { /* abaikan */ }
    notify('Key simpanan dibuang — sekarang pakai key lokal'); render();
  });
  $('#a-models').addEventListener('click', async () => {
    $('#a-out').textContent = 'Menarik daftar model…';
    try {
      const prov = $('#a-prov').value;
      const models = await listModels($('#a-url').value.trim(), $('#a-key').value.trim() || cfg.apiKey, prov, { chatPath: document.querySelector('#a-chatpath')?.value.trim(), modelsPath: document.querySelector('#a-modelspath')?.value.trim() });
      const sel = $('#a-models-sel');
      sel.style.display = ''; sel.innerHTML = models.map((m) => `<option${m === $('#a-model').value.trim() ? ' selected' : ''}>${escapeHtml(m)}</option>`).join('');
      sel.onchange = () => { $('#a-model').value = sel.value; };
      $('#a-out').textContent = `${models.length} model tersedia — pilih dari dropdown di atas, lalu Simpan.`;
    } catch (e) { $('#a-out').textContent = 'Gagal tarik model: ' + e.message; }
  });
  $('#a-test').addEventListener('click', async () => {
    $('#a-out').textContent = 'Mengirim ping…';
    try { const r = await askAI({ messages: [{ role: 'user', content: 'Balas dengan kata: konek' }] }, { provider: $('#a-prov').value, baseUrl: $('#a-url').value.trim(), model: $('#a-model').value.trim(), chatPath: document.querySelector('#a-chatpath')?.value.trim(), modelsPath: document.querySelector('#a-modelspath')?.value.trim(), apiKey: $('#a-key').value.trim() || cfg.apiKey, maxTokens: Math.min(Math.max(Number($('#a-maxtok').value) || 2000, 300), 8000), routerUrl: $('#a-router').value.trim() }); $('#a-out').textContent = 'OK: ' + String(r.content).slice(0, 160); }
    catch (e) { $('#a-out').textContent = 'Gagal: ' + e.message; }
  });
  $('#a-diag').addEventListener('click', async () => {
    const box = $('#a-diag-out');
    box.textContent = 'Mendiagnosa… (5 lapis, ±20 dtk)';
    try {
      const d = await diagConnection($('#a-url').value.trim(), $('#a-key').value.trim() || cfg.apiKey, $('#a-model').value.trim(), { chatPath: document.querySelector('#a-chatpath')?.value.trim(), modelsPath: document.querySelector('#a-modelspath')?.value.trim() });
      const lines = [`Base: ${d.base} · key ${d.keyLen} char · model ${d.model}`, ''];
      for (const s of d.steps) lines.push(`${s.ok ? '✅' : '❌'} ${s.step}\n   ${s.detail}`);
      box.textContent = lines.join('\n');
    } catch (e) { box.textContent = 'Diagnosa gagal total: ' + e.message; }
  });
  $('#a-rttest').addEventListener('click', async () => {
    const box = $('#a-rt-out');
    box.textContent = 'Tes runtime…';
    try {
      const base = $('#a-router').value.trim().replace(/\/*$/, '');
      const tok = document.querySelector('#a-rttoken')?.value.trim() || '';
      const h = tok ? { Authorization: 'Bearer ' + tok } : {};
      const r = await chrome.runtime.sendMessage({ type: 'TUTON_BG_FETCH', req: { url: base + '/health', headers: h, timeoutMs: 15000 } });
      if (!r?.ok) { box.textContent = 'Runtime MATI / tak terjangkau: ' + (r?.error || 'unknown') + '\nNyalakan: node router/server.js (laptop) / cek https+token (VPS).'; return; }
      let j = {};
      try { j = JSON.parse(r.body); } catch {}
      box.textContent = `OK: ${j.service || '?'} · pdf:${j.pdf || '?'} · token:${j.token ? 'wajib' : 'bebas'} · HTTP ${r.status}\nChat AI tetap langsung ke provider (tidak lewat sini) — runtime hanya tools /api/read + /api/models.`;
    } catch (e) { box.textContent = 'Tes runtime gagal: ' + e.message; }
  });
  $('#d-export').addEventListener('click', async () => {
    const keys = ['tuton_grades', 'tuton_profile', 'tuton_tracker', 'tuton_qcache', 'tuton_qseen', 'tuton_qkey', 'tuton_qlog', 'tuton_todo', 'tuton_tasks', 'tuton_notes', 'tuton_summary', 'tuton_genquiz', 'tuton_modtexts', 'tuton_ai', 'tuton_ai_sessions', 'tuton_activity', 'tuton_bmp'];
    const out = {};
    for (const k of keys) out[k] = await load(k, null);
    download(`tuton-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(out, null, 2), 'application/json');
  });
  $('#d-wipe').addEventListener('click', async () => { if (confirm('Hapus SEMUA data lokal?')) { await chrome.storage.local.clear(); notify('Data lokal dihapus'); render(); } });
}

buildNav();
render();
