// ui-audit.mjs — audit UI lewat computed style (tanpa perlu mata):
//  1) elemen dengan background TERANG di tema gelap (glaring/putih)
//  2) teks dengan kontras rendah (< 3.0) vs latar efektifnya
//  3) elemen meluber (scrollWidth > clientWidth) & keluar dari lebar panel
//  4) ukuran/posisi elemen yang bertumpuk di header/aksi
import fs from 'node:fs';
import path from 'node:path';

const outDir = process.argv[2];
const extId = process.argv[3];
const routes = process.argv.slice(4);
fs.mkdirSync(outDir, { recursive: true });

const ver = await (await fetch('http://127.0.0.1:9333/json/version')).json();
const ws = new WebSocket(ver.webSocketDebuggerUrl);
await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
let id = 0; const p = new Map();
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && p.has(m.id)) { p.get(m.id)(m); p.delete(m.id); } };
const send = (method, params = {}, sessionId) => new Promise((res) => {
  const i = ++id; p.set(i, res);
  ws.send(JSON.stringify({ id: i, method, params, ...(sessionId ? { sessionId } : {}) }));
  setTimeout(() => res({ __timeout: method }), 30000);
});

const AUDIT_JS = `(() => {
  const parse = (c) => {
    if (!c || c === 'transparent' || c === 'rgba(0, 0, 0, 0)') return null;
    const m = c.match(/rgba?\\(([^)]+)\\)/); if (!m) return null;
    const [r, g, b, a = 1] = m[1].split(',').map(Number);
    return { r, g, b, a };
  };
  const lum = ({ r, g, b }) => {
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const ratio = (a, b) => { const l1 = lum(a), l2 = lum(b); const hi = Math.max(l1, l2), lo = Math.min(l1, l2); return (hi + 0.05) / (lo + 0.05); };
  const effBg = (el) => {
    let n = el;
    while (n && n !== document.documentElement) {
      const c = parse(getComputedStyle(n).backgroundColor);
      if (c && c.a > 0.9) return c;
      n = n.parentElement;
    }
    return parse(getComputedStyle(document.body).backgroundColor) || { r: 9, g: 11, b: 13 };
  };
  const desc = (el) => {
    const cls = (el.className && typeof el.className === 'string') ? '.' + el.className.trim().split(/\\s+/).slice(0, 2).join('.') : '';
    const tid = el.id ? '#' + el.id : '';
    return el.tagName.toLowerCase() + tid + cls;
  };
  const light = [], lowcontrast = [], overflow = [], wide = [];
  const panelW = document.documentElement.clientWidth;
  for (const el of document.querySelectorAll('body *')) {
    const cs = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) continue;
    if (cs.visibility === 'hidden' || cs.display === 'none') continue;
    const bg = parse(cs.backgroundColor);
    // 1) background terang (glaring) di tema gelap
    if (bg && bg.a > 0.5 && lum(bg) > 0.45) {
      light.push({ el: desc(el), bg: cs.backgroundColor, w: Math.round(rect.width), h: Math.round(rect.height), y: Math.round(rect.y) });
    }
    // 2) kontras teks
    const hasText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length > 1);
    if (hasText) {
      const fg = parse(cs.color);
      if (fg) {
        const bgc = bg && bg.a > 0.9 ? bg : effBg(el);
        const cr = ratio(fg, bgc);
        if (cr < 3.2) lowcontrast.push({ el: desc(el), color: cs.color, bg: 'rgb(' + bgc.r + ',' + bgc.g + ',' + bgc.b + ')', ratio: Number(cr.toFixed(2)), fs: cs.fontSize, txt: (el.textContent || '').trim().slice(0, 32) });
      }
    }
    // 3) meluber horizontal
    if (el.scrollWidth > el.clientWidth + 2 && el.clientWidth > 0 && cs.overflowX !== 'auto' && cs.overflowX !== 'scroll') {
      overflow.push({ el: desc(el), scrollW: el.scrollWidth, clientW: el.clientWidth, txt: (el.textContent || '').trim().slice(0, 30) });
    }
    // 4) lebih lebar dari panel
    if (rect.width > panelW + 2) wide.push({ el: desc(el), w: Math.round(rect.width), panelW });
  }
  const uniq = (arr, k) => { const s = new Set(); return arr.filter((x) => { const v = x.el + '|' + (x.txt || x.bg || ''); if (s.has(v)) return false; s.add(v); return true; }); };
  return {
    panelW, panelH: document.documentElement.clientHeight,
    bodyBg: getComputedStyle(document.body).backgroundColor,
    bodyColor: getComputedStyle(document.body).color,
    light: uniq(light, 'el').slice(0, 25),
    lowcontrast: uniq(lowcontrast, 'el').slice(0, 25),
    overflow: uniq(overflow, 'el').slice(0, 20),
    wide: uniq(wide, 'el').slice(0, 10),
    counts: { light: light.length, lowcontrast: lowcontrast.length, overflow: overflow.length, wide: wide.length },
  };
})()`;

const audit = async (name, hash, w = 430, h = 980) => {
  const ct = await send('Target.createTarget', { url: 'about:blank' });
  const targetId = ct.result.targetId;
  const at = await send('Target.attachToTarget', { targetId, flatten: true });
  const s = at.result.sessionId;
  await send('Page.enable', {}, s);
  await send('Runtime.enable', {}, s);
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false }, s);
  await send('Page.navigate', { url: `chrome-extension://${extId}/sidepanel/index.html${hash}` }, s);
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 500));
    const r = await send('Runtime.evaluate', { expression: '(document.body.innerText||"").length', returnByValue: true }, s);
    if ((r.result?.result?.value || 0) > 200) break;
  }
  await new Promise((r) => setTimeout(r, 1000));
  const res = await send('Runtime.evaluate', { expression: AUDIT_JS, returnByValue: true }, s);
  await send('Target.closeTarget', { targetId });
  return res.result?.result?.value || { error: JSON.stringify(res).slice(0, 300) };
};

const all = {};
for (const r of routes) {
  const [name, hash = ''] = r.split('=');
  const a = await audit(name, hash);
  all[name] = a;
  console.log('='.repeat(70));
  console.log(`${name}  panel=${a.panelW}x${a.panelH}  body bg=${a.bodyBg} color=${a.bodyColor}`);
  console.log(`  hitung: terang=${a.counts?.light} kontras<3.2=${a.counts?.lowcontrast} meluber=${a.counts?.overflow} lebar>panel=${a.counts?.wide}`);
  if (a.light?.length) { console.log('  -- ELEMEN TERANG (glaring):'); a.light.forEach((x) => console.log(`     ${x.el} bg=${x.bg} ${x.w}x${x.h} @y=${x.y}`)); }
  if (a.lowcontrast?.length) { console.log('  -- KONTRAS RENDAH:'); a.lowcontrast.forEach((x) => console.log(`     ${x.el} ratio=${x.ratio} ${x.fs} "${x.txt}" fg=${x.color} bg=${x.bg}`)); }
  if (a.overflow?.length) { console.log('  -- MELUBER:'); a.overflow.forEach((x) => console.log(`     ${x.el} ${x.scrollW}>${x.clientW} "${x.txt}"`)); }
  if (a.wide?.length) { console.log('  -- LEBIH LEBAR DARI PANEL:'); a.wide.forEach((x) => console.log(`     ${x.el} ${x.w}px > ${x.panelW}px`)); }
}
fs.writeFileSync(path.join(outDir, 'audit.json'), JSON.stringify(all, null, 1), 'utf8');
console.log('\njson ->', path.join(outDir, 'audit.json'));
process.exit(0);