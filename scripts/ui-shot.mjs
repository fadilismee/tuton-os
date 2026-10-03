// scripts/ui-shot.mjs — screenshot UI extension nyata via CDP (Chrome sudah jalan).
// Pakai: node scripts/ui-shot.mjs <extDir> <outDir> [hash...]
import fs from 'node:fs';
import path from 'node:path';

const extDir = process.argv[2];
const outDir = process.argv[3];
const routes = process.argv.slice(4);
fs.mkdirSync(outDir, { recursive: true });

const j = async (u) => (await fetch(u)).json();
const ver = await j('http://127.0.0.1:9333/json/version');
const WS = ver.webSocketDebuggerUrl;

let id = 0;
const pending = new Map();
const ws = new WebSocket(WS);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) {
    const { res, rej, t } = pending.get(m.id);
    pending.delete(m.id);
    clearTimeout(t);
    m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
  }
};
const send = (method, params = {}, sessionId) => new Promise((res, rej) => {
  const myId = ++id;
  const t = setTimeout(() => { pending.delete(myId); rej(new Error('timeout ' + method)); }, 30000);
  pending.set(myId, { res, rej, t });
  ws.send(JSON.stringify({ id: myId, method, params, ...(sessionId ? { sessionId } : {}) }));
});

// 1) load unpacked
const load = await send('Extensions.loadUnpacked', { path: extDir.replace(/\\/g, '/') });
const extId = load.id;
console.log('extension id:', extId);

// tunggu service worker muncul (bukti extension hidup)
let alive = false;
for (let i = 0; i < 30; i++) {
  const list = await j('http://127.0.0.1:9333/json/list');
  if (list.some((t) => String(t.url || '').includes(`chrome-extension://${extId}/`))) { alive = true; break; }
  await new Promise((r) => setTimeout(r, 500));
}
console.log('service worker hidup:', alive);

// 2) buka tiap halaman panel + screenshot
const shot = async (url, name, w = 430, h = 980) => {
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  await send('Page.enable', {}, sessionId);
  await send('Runtime.enable', {}, sessionId);
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 2, mobile: false }, sessionId);
  await send('Page.navigate', { url }, sessionId);
  // tunggu konten benar-benar terisi
  let len = 0;
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 400));
    try {
      const r = await send('Runtime.evaluate', {
        expression: '(document.body && document.body.innerText || "").length',
        returnByValue: true,
      }, sessionId);
      len = r.result.value || 0;
      if (len > 120) break;
    } catch { /* belum siap */ }
  }
  await send('Runtime.evaluate', { expression: 'document.fonts && document.fonts.ready', awaitPromise: true }, sessionId).catch(() => {});
  await new Promise((r) => setTimeout(r, 900));
  const metrics = await send('Page.getLayoutMetrics', {}, sessionId);
  const cs = metrics.cssContentSize || { width: w, height: h };
  const height = Math.min(Math.max(cs.height, h), 4000);
  const b64 = (await send('Page.captureScreenshot', {
    format: 'png', captureBeyondViewport: true,
    clip: { x: 0, y: 0, width: w, height, scale: 1 },
  }, sessionId)).data;
  const file = path.join(outDir, name + '.png');
  fs.writeFileSync(file, Buffer.from(b64, 'base64'));
  // teks halaman untuk cek isi
  const txt = await send('Runtime.evaluate', {
    expression: '(document.querySelector("#content")?.innerText || document.body.innerText || "").slice(0,3000)',
    returnByValue: true,
  }, sessionId);
  fs.writeFileSync(path.join(outDir, name + '.txt'), String(txt.result.value || ''), 'utf8');
  await send('Target.closeTarget', { targetId });
  return { file, len, height, text: String(txt.result.value || '') };
};

const panelUrl = `chrome-extension://${extId}/sidepanel/index.html`;
for (const route of routes) {
  const [name, hash = ''] = route.split('=');
  const r = await shot(panelUrl + hash, name);
  console.log(`${name.padEnd(12)} teks=${String(r.len).padStart(4)} tinggi=${r.height} -> ${path.basename(r.file)}`);
  console.log('   isi:', r.text.replace(/\s+/g, ' ').slice(0, 110));
}
console.log('SELESAI. folder:', outDir);
