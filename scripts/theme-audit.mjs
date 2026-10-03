// theme-audit.mjs — audit tema gelap & putih dengan mengubah profil lebih dulu.
import fs from 'node:fs';
import path from 'node:path';

const outDir = process.argv[2];
const extId = process.argv[3];
const theme = process.argv[4] || 'dark';
fs.mkdirSync(outDir, { recursive: true });

const AUDIT = JSON.parse(fs.readFileSync(path.join(path.dirname(process.argv[2]), 'audit-js.json'), 'utf8'));

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

const routes = process.argv.slice(5);
const results = {};

// 1) set tema lewat halaman panel sekali
{
  const ct = await send('Target.createTarget', { url: 'about:blank' });
  const t = ct.result.targetId;
  const at = await send('Target.attachToTarget', { targetId: t, flatten: true });
  const s = at.result.sessionId;
  await send('Runtime.enable', {}, s);
  await send('Page.navigate', { url: `chrome-extension://${extId}/sidepanel/index.html#/setting` }, s);
  await new Promise((r) => setTimeout(r, 3000));
  const set = await send('Runtime.evaluate', {
    expression: `(async () => {
      const cur = (await chrome.storage.local.get(['tuton_profile'])).tuton_profile || {};
      await chrome.storage.local.set({ tuton_profile: { ...cur, theme: ${JSON.stringify(theme)} } });
      return JSON.stringify((await chrome.storage.local.get(['tuton_profile'])).tuton_profile.theme);
    })()`, awaitPromise: true, returnByValue: true,
  }, s);
  console.log('tema diset ->', set.result?.result?.value);
  await send('Target.closeTarget', { targetId: t });
}

for (const r of routes) {
  const [name, hash = ''] = r.split('=');
  const ct = await send('Target.createTarget', { url: 'about:blank' });
  const t = ct.result.targetId;
  const at = await send('Target.attachToTarget', { targetId: t, flatten: true });
  const s = at.result.sessionId;
  await send('Page.enable', {}, s);
  await send('Runtime.enable', {}, s);
  await send('Emulation.setDeviceMetricsOverride', { width: 430, height: 980, deviceScaleFactor: 2, mobile: false }, s);
  await send('Page.navigate', { url: `chrome-extension://${extId}/sidepanel/index.html${hash}` }, s);
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 500));
    const rr = await send('Runtime.evaluate', { expression: '(document.body.innerText||"").length', returnByValue: true }, s);
    if ((rr.result?.result?.value || 0) > 200) break;
  }
  await new Promise((r) => setTimeout(r, 1200));
  const a = await send('Runtime.evaluate', { expression: AUDIT, returnByValue: true }, s);
  const val = a.result?.result?.value || {};
  results[name] = val;
  console.log('='.repeat(68));
  console.log(`${theme.toUpperCase()} ${name}  bodyBg=${val.bodyBg} color=${val.bodyColor}`);
  console.log(`  hitung: terang=${val.counts?.light} kontras<3.2=${val.counts?.lowcontrast} meluber=${val.counts?.overflow} lebar>panel=${val.counts?.wide}`);
  (val.light || []).slice(0, 6).forEach((x) => console.log(`  TERANG: ${x.el} bg=${x.bg} ${x.w}x${x.h}`));
  (val.lowcontrast || []).slice(0, 8).forEach((x) => console.log(`  KONTRAS ${x.ratio}: ${x.el} "${x.txt}" fg=${x.color} bg=${x.bg}`));
  (val.overflow || []).slice(0, 6).forEach((x) => console.log(`  MELUBER: ${x.el} ${x.scrollW}>${x.clientW} "${x.txt}"`));
  // simpan screenshot
  const b64 = (await send('Page.captureScreenshot', { format: 'png' }, s)).result?.data;
  if (b64) fs.writeFileSync(path.join(outDir, `${theme}-${name}.png`), Buffer.from(b64, 'base64'));
  await send('Target.closeTarget', { targetId: t });
}
fs.writeFileSync(path.join(outDir, `audit-${theme}.json`), JSON.stringify(results, null, 1), 'utf8');
console.log('json ->', path.join(outDir, `audit-${theme}.json`));
process.exit(0);