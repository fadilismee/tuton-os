// verify-ui.mjs — verifikasi akhir UI: color-scheme aktif, sisa masalah, screenshot.
import fs from 'node:fs';
import path from 'node:path';
const outDir = process.argv[2];
const extId = process.argv[3];
fs.mkdirSync(outDir, { recursive: true });

const ver = await (await fetch('http://127.0.0.1:9333/json/version')).json();
const ws = new WebSocket(ver.webSocketDebuggerUrl);
await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
let id = 0; const p = new Map();
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && p.has(m.id)) { p.get(m.id)(m); p.delete(m.id); } };
const send = (method, params = {}, sessionId) => new Promise((res) => {
  const i = ++id; p.set(i, res); ws.send(JSON.stringify({ id: i, method, params, ...(sessionId ? { sessionId } : {}) }));
  setTimeout(() => res({ __timeout: method }), 30000);
});

const open = async (hash, w = 430, h = 980) => {
  const ct = await send('Target.createTarget', { url: 'about:blank' });
  const t = ct.result.targetId;
  const at = await send('Target.attachToTarget', { targetId: t, flatten: true });
  const s = at.result.sessionId;
  await send('Page.enable', {}, s); await send('Runtime.enable', {}, s);
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 2, mobile: false }, s);
  await send('Page.navigate', { url: `chrome-extension://${extId}/sidepanel/index.html${hash}` }, s);
  for (let i = 0; i < 20; i++) { await new Promise((r) => setTimeout(r, 500)); const rr = await send('Runtime.evaluate', { expression: '(document.body.innerText||"").length', returnByValue: true }, s); if ((rr.result?.result?.value || 0) > 200) break; }
  await new Promise((r) => setTimeout(r, 1200));
  return { s, t };
};

for (const theme of ['dark', 'light']) {
  const o = await open('#/setting');
  await send('Runtime.evaluate', { expression: `(async()=>{const c=(await chrome.storage.local.get(['tuton_profile'])).tuton_profile||{};await chrome.storage.local.set({tuton_profile:{...c,theme:${JSON.stringify(theme)}}});return 'ok';})()`, awaitPromise: true, returnByValue: true }, o.s);
  await send('Target.closeTarget', { targetId: o.t });

  for (const [name, hash] of [['dashboard', '#/dashboard'], ['ai', '#/ai']]) {
    const oo = await open(hash);
    const chk = await send('Runtime.evaluate', {
      expression: `(() => {
        const cs = getComputedStyle(document.documentElement);
        const body = getComputedStyle(document.body);
        // elemen yang warnanya sama dengan latarnya (teks tak terlihat)
        const inv = [];
        const parse=(c)=>{const m=String(c).match(/rgba?\\(([^)]+)\\)/);if(!m)return null;const[r,g,b,a=1]=m[1].split(',').map(Number);return{r,g,b,a}};
        const lum=({r,g,b})=>{const f=(v)=>{v/=255;return v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4)};return 0.2126*f(r)+0.7152*f(g)+0.0722*f(b)};
        const ratio=(a,b)=>{const l1=lum(a),l2=lum(b),hi=Math.max(l1,l2),lo=Math.min(l1,l2);return (hi+0.05)/(lo+0.05)};
        for (const el of document.querySelectorAll('body *')) {
          const st = getComputedStyle(el);
          if (st.display === 'none' || st.visibility === 'hidden') continue;
          const hasText = [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim().length > 1);
          if (!hasText) continue;
          const fg = parse(st.color); if (!fg) continue;
          let n = el, bg = null;
          while (n && n !== document.documentElement) { const c = parse(getComputedStyle(n).backgroundColor); if (c && c.a > 0.9) { bg = c; break; } n = n.parentElement; }
          if (!bg) bg = parse(body.backgroundColor);
          if (bg && ratio(fg, bg) < 2.5) inv.push(el.tagName + '.' + (typeof el.className === 'string' ? el.className.split(' ')[0] : '') + ' ' + ratio(fg, bg).toFixed(2) + ' "' + el.textContent.trim().slice(0, 24) + '"');
        }
        return JSON.stringify({ colorScheme: cs.colorScheme, bodyBg: body.backgroundColor, bodyColor: body.color, invisible: inv.slice(0, 8), invisibleCount: inv.length });
      })()`, returnByValue: true,
    }, oo.s);
    const v = JSON.parse(chk.result?.result?.value || '{}');
    console.log(`[${theme}] ${name}: color-scheme=${v.colorScheme} bg=${v.bodyBg} text=${v.bodyColor} teks-tak-terlihat=${v.invisibleCount}`);
    if (v.invisibleCount) v.invisible.forEach((x) => console.log('   !!', x));
    const b64 = (await send('Page.captureScreenshot', { format: 'png' }, oo.s)).result?.data;
    if (b64) fs.writeFileSync(path.join(outDir, `${theme}-${name}.png`), Buffer.from(b64, 'base64'));
    await send('Target.closeTarget', { targetId: oo.t });
  }
}
console.log('screenshot ->', outDir);
process.exit(0);