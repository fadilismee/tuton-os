// popup.js — navigasi klik-pertama: ringkasan + 6 tombol cepat + footer legal.
// Semua tombol logic-nya jalan: sidebar/float/deep-link AI-Soal-Tracker-Export,
// check-in (worker + fallback lokal), status AI (direct lalu worker), theme,
// footer legal (baca dari storage agar konsisten dgn sidepanel).
import { cumulative } from './src/lib/gpa.js';

const $ = (id) => document.getElementById(id);

const LEGAL = {
  keamanan: 'Tuton OS berjalan lokal-first.\n\n- API key milikmu disimpan di chrome.storage.local perangkat ini (atau key.local.js yang tidak di-commit). Tidak dikirim ke mana pun kecuali ke provider AI yang kamu pilih di Setting.\n- Token runtime hanya dipakai ke URL runtime milikmu (laptop/VPS).\n- Tidak ada telemetri, pelacakan, atau server wajib. Semua fitur inti jalan tanpa internet kecuali chat AI dan search.',
  privasi: 'Data akademik (nilai, tracker, soal, chat, persona) tersimpan di perangkatmu.\n\n- Tidak ada akun, tidak ada analitik, tidak ada iklan pihak ketiga.\n- File yang kamu lampirkan dibaca di memori tab dan hanya teks hasil ekstrak yang dikirim ke AI.\n- Export JSON ada di Setting > Data. Hapus semua = chrome.storage.local.clear().',
  hakcipta: 'Tuton OS adalah karya opensource. Kode pihak ketiga tetap milik pemiliknya (Mozilla pdf.js, Tesseract, pdf-lib, KaTeX, pola BMP Terbuka GPL-3.0).\n\n- Materi modul UT milik Universitas Terbuka — gunakan untuk belajar pribadi.\n- Jangan mengunggah ulang materi berhak cipta ke layanan publik tanpa izin.',
  syarat: 'Dengan memakai Tuton OS kamu setuju:\n\n1. Bertanggung jawab atas API key dan token milikmu.\n2. Tidak memakai extension untuk kecurangan akademik yang melanggar aturan kampus.\n3. Memahami jawaban AI bisa salah — selalu verifikasi ke modul resmi.\n4. Developer tidak bertanggung jawab atas nilai atau keputusan akademikmu.',
  grup: 'Belajar bareng lebih cepat.\n\n- Grup Telegram/Discord resmi: (segera diumumkan di zerotime.web.id).\n- Bagikan template soal, paket bank soal, dan tips — jangan bagikan API key.\n- Butuh bantuan? Tulis di grup dengan format: [MK] + screenshot error + langkah yang sudah dicoba.',
  bagikan: 'Bantu temanmu pakai juga:\n\n- Fork / star repo GitHub dan kirim pull request.\n- Salin link repo ini ke teman sekelas.\n- Semua fitur inti gratis dan opensource — tidak ada paywall.',
  donasi: 'Tuton OS gratis. Kalau terbantu, traktir kopi biar update terus.\n\n- Scan QRIS di popup Dukung Creator (muncul berkala, bisa ditutup kapan saja).\n- QRIS a.n. fadilismee.\n- Dibuat oleh zerotime.web.id.',
};

async function openSide(hash) {
  try {
    const w = await chrome.windows.getCurrent();
    await chrome.sidePanel.open({ windowId: w.id });
    if (hash) {
      // arahkan sidepanel yg baru dibuka ke halaman tujuan
      setTimeout(() => chrome.runtime.sendMessage({ type: 'TUTON_GOTO', hash }).catch(() => {}), 400);
    }
    window.close();
  } catch (e) {
    $('status').textContent = 'Gagal buka sidebar: ' + e.message;
  }
}

$('open-side').addEventListener('click', () => openSide(''));
$('go-ai').addEventListener('click', () => openSide('#/ai'));
$('go-soal').addEventListener('click', () => openSide('#/soal'));
$('go-tracker').addEventListener('click', () => openSide('#/tracker'));
$('go-export').addEventListener('click', () => openSide('#/export'));

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
    // Fallback lokal bila worker belum aktif: catat streak di storage langsung.
    try {
      const k = new Date().toISOString().slice(0, 10);
      const t = (await chrome.storage.local.get(['tuton_tracker'])).tuton_tracker || {};
      if (t.lastDay !== k) {
        const y = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
        t.streak = t.lastDay === y ? (t.streak || 0) + 1 : 1;
        t.lastDay = k;
        await chrome.storage.local.set({ tuton_tracker: t });
        $('st-streak').textContent = `${t.streak}h`;
        $('checkin-txt').textContent = `Streak ${t.streak} hari (lokal)`;
      } else {
        $('checkin-txt').textContent = 'Sudah check-in';
      }
      $('checkin').disabled = true;
    } catch {
      $('status').textContent = 'Worker belum aktif — reload extension.';
    }
  }
});

// Footer legal: judul + isi sama dgn sidepanel, dibaca via alert-less inline.
$('foot-links').innerHTML = ['Keamanan', 'Privasi', 'Hak cipta', 'Syarat', 'Grup', 'Bagikan', 'Donasi']
  .map((t) => `<button data-l="${t}">${t}</button>`).join('');
$('foot-links').querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
  const key = { Keamanan: 'keamanan', Privasi: 'privasi', 'Hak cipta': 'hakcipta', Syarat: 'syarat', Grup: 'grup', Bagikan: 'bagikan', Donasi: 'donasi' }[b.textContent];
  const body = LEGAL[key] || '';
  // popup kecil tidak muat modal — tampilkan isi ringkas di status (klik lagi tutup)
  const st = $('status');
  if (st.dataset.legal === key) { st.dataset.legal = ''; paintStatus(); return; }
  st.dataset.legal = key;
  st.textContent = `${b.textContent}: ${body.split('\n')[0]} (selengkapnya di sidebar > footer)`;
}));

let statusCache = '';
async function paintStatus() {
  if (!statusCache) return;
  $('status').innerHTML = statusCache;
}

(async () => {
  try {
    const s = await chrome.storage.local.get(['tuton_profile', 'tuton_tracker', 'tuton_grades', 'tuton_ai']);
    const p = s.tuton_profile || {};
    if ((p.theme || 'dark') === 'light') document.body.classList.add('light');
    const t = s.tuton_tracker || {};
    let ipk = '–';
    try {
      const g = s.tuton_grades || { semesters: [] };
      if (g.semesters.length) ipk = cumulative(g.semesters).ipk.toFixed(2);
    } catch (_) {}
    $('st-ipk').textContent = ipk;
    $('st-streak').textContent = `${t.streak || 0}h`;
    $('st-level').textContent = `Lv${t.level || 1}`;
    statusCache = p.prodi
      ? `${p.prodi} · target IPK <b>${p.targetIPK ?? '–'}</b>`
      : 'Belum setup — buka sidebar, isi profil di Setting.';
    $('status').innerHTML = statusCache;
    // cek AI: GET models TANPA header auth (publik, tanpa preflight).
    // Kalau gagal, fallback via worker TUTON_BG_FETCH.
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
