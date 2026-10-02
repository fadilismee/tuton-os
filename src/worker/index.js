// src/worker/index.js — Service worker MV3 (module). Tanpa setInterval:
// pomodoro + streak + refresh soal pakai chrome.alarms.
import { load, save } from '../lib/store.js';

const BADGES = [
  { id: 'streak7', name: 'Rajin 7 Hari', desc: 'Streak belajar 7 hari', test: (t) => t.streak >= 7 },
  { id: 'streak30', name: 'Legendaris 30 Hari', desc: 'Streak belajar 30 hari', test: (t) => t.streak >= 30 },
  { id: 'pomo10', name: 'Fokus 10 Sesi', desc: 'Selesaikan 10 pomodoro', test: (t) => (t.pomoTotal || 0) >= 10 },
  { id: 'pomo50', name: 'Fokus 50 Sesi', desc: 'Selesaikan 50 pomodoro', test: (t) => (t.pomoTotal || 0) >= 50 },
  { id: 'quiz1', name: 'Latihan Perdana', desc: 'Selesaikan 1 kuis bank soal', test: (t) => (t.quizTotal || 0) >= 1 },
  { id: 'quiz10', name: 'Petarung Soal', desc: 'Selesaikan 10 kuis', test: (t) => (t.quizTotal || 0) >= 10 },
  { id: 'ipk35', name: 'Cum Laude Track', desc: 'IPK tercatat ≥ 3.50', test: (t) => (t.bestIPK || 0) >= 3.5 },
];

async function defaultTracker() {
  return {
    streak: 0, lastDay: null, freeze: 3,
    xp: 0, level: 1, badges: [],
    pomoWeek: 0, pomoTotal: 0, weekKey: weekKey(),
    focusSec: 0, // akumulasi detik fokus (pomodoro selesai + stopwatch save)
  };
}

function todayKey(d = new Date()) { return d.toISOString().slice(0, 10); }
function weekKey(d = new Date()) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = (t.getUTCDay() + 6) % 7;
  t.setUTCDate(t.getUTCDate() - day + 3);
  const first = new Date(Date.UTC(t.getUTCFullYear(), 0, 4));
  const fday = (first.getUTCDay() + 6) % 7;
  first.setUTCDate(first.getUTCDate() - fday + 3);
  return `${t.getUTCFullYear()}-W${1 + Math.round((t - first) / 6048e5)}`;
}

async function checkBadges(t) {
  t.badges = t.badges || [];
  for (const b of BADGES) {
    if (!t.badges.includes(b.id) && b.test(t)) {
      t.badges.push(b.id);
      await notify('Lencana baru!', `${b.name} — ${b.desc}`);
    }
  }
}

async function notify(title, message) {
  try {
    await chrome.notifications.create({
      type: 'basic', iconUrl: 'assets/icon-48.png', title, message,
    });
  } catch { /* notifikasi opsional */ }
}

chrome.runtime.onInstalled.addListener(async () => {
  const t = (await load('tuton_tracker', null)) || await defaultTracker();
  await save('tuton_tracker', t);
  await chrome.alarms.create('tuton-pomo-tick', { periodInMinutes: 1 });
  await chrome.alarms.create('tuton-day-roll', { periodInMinutes: 60 });
  chrome.contextMenus.create({
    id: 'tuton-ask', title: 'Tanya Tuton AI soal ini', contexts: ['selection', 'page'],
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== 'tuton-ask' || !tab?.id) return;
  await chrome.storage.local.set({ tuton_pendingAsk: { tabId: tab.id, selection: info.selectionText || '' } });
  chrome.sidePanel.open({ windowId: tab.windowId });
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'tuton-pomo-tick') {
    const s = await load('tuton_pomo', null);
    if (s && !s.done && Date.now() >= s.endsAt) {
      s.done = true;
      await save('tuton_pomo', s);
      const t = (await load('tuton_tracker', null)) || await defaultTracker();
      t.pomoTotal = (t.pomoTotal || 0) + 1;
      t.pomoWeek = (t.weekKey === weekKey() ? t.pomoWeek || 0 : 0) + 1;
      t.weekKey = weekKey();
      t.focusSec = (t.focusSec || 0) + (s.mins || 25) * 60;
      await awardFocusXp(t, (s.mins || 25) * 60, s.label || 'Pomodoro');
      await bumpActivity('p');
      await notify(`Selesai: ${s.label || 'Pomodoro'} ${(s.mins || 25)} mnt`, `+${xpFor((s.mins || 25) * 60)} XP tercatat.`);
      chrome.runtime.sendMessage({ type: 'TUTON_POMO_DONE' }).catch(() => {});
    }
    const c = await load('tuton_countdown', null);
    if (c && !c.done && Date.now() >= c.endsAt) {
      c.done = true;
      await save('tuton_countdown', c);
      await notify(`Timer selesai: ${c.label || 'waktu habis'}`, 'Saatnya kembali.');
      chrome.runtime.sendMessage({ type: 'TUTON_TIMER_DONE' }).catch(() => {});
    }
  } else if (alarm.name === 'tuton-day-roll') {
    // hanya reset计数 mingguan saat ganti minggu; streak dijaga oleh check-in
    const t = (await load('tuton_tracker', null)) || await defaultTracker();
    if (t.weekKey !== weekKey()) { t.weekKey = weekKey(); t.pomoWeek = 0; await save('tuton_tracker', t); }
  }
});

// XP proporsional: 100 XP per 25 menit fokus (4 XP/menit, dibulatkan).
function xpFor(sec) { return Math.round((sec / 60) * 4); }

async function awardFocusXp(t, sec, label) {
  const gained = xpFor(sec);
  t.xp = (t.xp || 0) + gained;
  t.level = 1 + Math.floor(t.xp / 1000);
  await logDay(t);
  await checkBadges(t);
  await save('tuton_tracker', t);
  return gained;
}

async function logDay(t) {
  const k = todayKey();
  if (t.lastDay === k) return; // sudah check-in hari ini
  const y = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
  if (t.lastDay === y) t.streak = (t.streak || 0) + 1;
  else if (t.lastDay !== k) t.streak = 1;
  t.lastDay = k;
}

// Activity log untuk heatmap ala GitHub (tuton_activity.days[YYYY-MM-DD]).
async function bumpActivity(kind) {
  try {
    const a = await load('tuton_activity', { days: {} });
    const k = todayKey();
    const d = a.days[k] || { c: 0, p: 0, q: 0, a: 0 };
    if (kind === 'c') d.c = 1; else d[kind] = (d[kind] || 0) + 1;
    a.days[k] = d;
    const keys = Object.keys(a.days).sort();
    while (keys.length > 400) delete a.days[keys.shift()];
    await save('tuton_activity', a);
  } catch { /* activity best-effort */ }
}

chrome.runtime.onMessage.addListener((msg, sender, send) => {
  (async () => {
    if (msg.type === 'TUTON_CHECKIN') {
      const t = (await load('tuton_tracker', null)) || await defaultTracker();
      const before = t.streak || 0;
      await logDay(t);
      await checkBadges(t);
      await save('tuton_tracker', t);
      await bumpActivity('c');
      send({ ok: true, streak: t.streak, added: t.streak > before });
    } else if (msg.type === 'TUTON_POMO_START') {
      const mins = Math.min(Math.max(Number(msg.minutes) || 25, 1), 180);
      const label = String(msg.label || 'Pomodoro').slice(0, 60);
      await save('tuton_pomo', { endsAt: Date.now() + mins * 60e3, done: false, mins, label });
      send({ ok: true, endsAt: Date.now() + mins * 60e3 });
    } else if (msg.type === 'TUTON_POMO_STATE') {
      send({ ok: true, pomo: await load('tuton_pomo', null) });
    } else if (msg.type === 'TUTON_POMO_CANCEL') {
      const s = await load('tuton_pomo', null);
      await save('tuton_pomo', s ? { ...s, done: true, cancelled: true } : null);
      send({ ok: true });
    } else if (msg.type === 'TUTON_FOCUS_SAVE') {
      // stopwatch selesai -> catat detik fokus + XP proporsional
      const sec = Math.max(0, Math.round(Number(msg.seconds) || 0));
      const t = (await load('tuton_tracker', null)) || await defaultTracker();
      t.focusSec = (t.focusSec || 0) + sec;
      let gained = 0;
      if (sec >= 60) gained = await awardFocusXp(t, sec, msg.label || 'Stopwatch');
      await bumpActivity('p');
      send({ ok: true, gained, focusSec: t.focusSec });
    } else if (msg.type === 'TUTON_TIMER_START') {
      const mins = Math.min(Math.max(Number(msg.minutes) || 5, 1), 720);
      const label = String(msg.label || 'Timer').slice(0, 60);
      await save('tuton_countdown', { endsAt: Date.now() + mins * 60e3, done: false, mins, label });
      send({ ok: true });
    } else if (msg.type === 'TUTON_TIMER_STATE') {
      send({ ok: true, timer: await load('tuton_countdown', null) });
    } else if (msg.type === 'TUTON_TIMER_CANCEL') {
      const c = await load('tuton_countdown', null);
      await save('tuton_countdown', c ? { ...c, done: true, cancelled: true } : null);
      send({ ok: true });
    } else if (msg.type === 'TUTON_TRACKER_GET') {
      send({ ok: true, tracker: (await load('tuton_tracker', null)) || await defaultTracker() });
    } else if (msg.type === 'TUTON_QUIZ_DONE') {
      // bank soal selesai -> catat + XP + lencana (skor>=60 dapat XP penuh 50)
      const score = Math.max(0, Math.min(100, Number(msg.score) || 0));
      const t = (await load('tuton_tracker', null)) || await defaultTracker();
      t.quizTotal = (t.quizTotal || 0) + 1;
      t.quizBest = Math.max(t.quizBest || 0, score);
      const gained = score >= 60 ? 50 : 20;
      t.xp = (t.xp || 0) + gained;
      t.level = 1 + Math.floor(t.xp / 1000);
      await logDay(t);
      await checkBadges(t);
      await save('tuton_tracker', t);
      await bumpActivity('q');
      send({ ok: true, gained, quizTotal: t.quizTotal });
    } else if (msg.type === 'TUTON_IPK_SAVED') {
      // IPK tercatat dari menu IPK -> dipakai lencana Cum Laude Track
      const ipk = Number(msg.ipk) || 0;
      const t = (await load('tuton_tracker', null)) || await defaultTracker();
      if (ipk > (t.bestIPK || 0)) t.bestIPK = ipk;
      await checkBadges(t);
      await save('tuton_tracker', t);
      send({ ok: true, bestIPK: t.bestIPK || 0 });
    } else if (msg.type === 'TUTON_BG_FETCH') {
      // Proxy fetch lewat service worker: fetch dari sidepanel/popup ke
      // 127.0.0.1 wajib preflight OPTIONS (header Authorization) dan 9router
      // menjawab OPTIONS dgn 401 tanpa header CORS -> browser blokir
      // ("Failed to fetch"). Dari worker + host_permissions, request sama
      // lolos tanpa preflight. Timeout max 180 dtk.
      // Diperluas utk Tuton Runtime: localhost/127.* SELALU boleh; URL lain
      // (VPS https) boleh bila host-nya sudah diberi izin di manifest
      // (host_permissions) — worker tetap menolak skema non-http(s).
      try {
        const q = msg.req || {};
        const url = String(q.url || '');
        let u;
        try { u = new URL(url); } catch { throw new Error('URL tidak valid'); }
        if (!/^https?:$/.test(u.protocol)) throw new Error('skema URL ditolak (hanya http/https)');
        const isLocal = /^(127\.0\.0\.1|localhost)$/.test(u.hostname);
        if (!isLocal && u.protocol !== 'https:') throw new Error('URL non-lokal wajib https (VPS) — http biasa ditolak demi keamanan token');
        const ctl = new AbortController();
        const ms = Math.min(Math.max(Number(q.timeoutMs) || 90000, 5000), 180000);
        const timer = setTimeout(() => ctl.abort(), ms);
        const r = await fetch(url, {
          method: q.method || 'GET',
          headers: q.headers || {},
          body: q.body ?? null,
          signal: ctl.signal,
        });
        clearTimeout(timer);
        const text = await r.text();
        send({ ok: true, status: r.status, body: text.slice(0, 200000) });
      } catch (e) { send({ ok: false, error: String(e?.message || e) }); }
    } else if (msg.type === 'TUTON_TAB_STREAM') {
      // Rekam tab: content script tidak punya chrome.tabCapture — worker yang
      // punya. Kembalikan streamId agar content bisa getUserMedia({chromeMediaSource:'tab'}).
      // Desktop (layar/app lain) & webcam TIDAK bisa dari extension — hanya
      // dari halaman recorder via getDisplayMedia (lihat vCap). Tab-only di sini.
      try {
        const tabId = sender?.tab?.id;
        if (!tabId) throw new Error('tanpa tab');
        chrome.tabCapture.getMediaStreamId({ targetTabId: tabId }, (streamId) => {
          if (chrome.runtime.lastError || !streamId) send({ ok: false, error: chrome.runtime.lastError?.message || 'tabCapture ditolak' });
          else send({ ok: true, streamId });
        });
        return true; // async via callback
      } catch (e) { send({ ok: false, error: String(e?.message || e) }); }
    } else {
      send({ ok: false, error: 'unknown' });
    }
  })();
  return true;
});
