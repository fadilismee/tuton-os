// msg-contrast.mjs — uji kontras pesan AI nyata (bold, heading, tabel, kode, rumus)
// di tema gelap & putih. Ini kasus yang dulu rusak: .msg.ai strong pakai #fff.
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

const SAMPLE = `
<div class="msg ai" id="probe">
  <h2>Ringkasan Materi</h2>
  <p>Ini teks <strong>tebal penting</strong> dan <em>miring</em>, plus <code class="inline">inline code</code> dan rumus inline $a^2+b^2=c^2$.</p>
  <ul><li>Poin pertama</li><li>Poin kedua <strong>dengan bold</strong></li></ul>
  <table><thead><tr><th>No</th><th>Nilai</th></tr></thead><tbody><tr><td>1</td><td>90</td></tr><tr><td>2</td><td>85</td></tr></tbody></table>
  <div class="katex-display"><span class="katex">s^2 = (1/(n-1)) Σ (x - x̄)²</span></div>
  <div class="codeblock"><div class="cb-head"><span>python</span><button class="cb-copy">Salin</button></div><pre><code>def rata(x):
    return sum(x) / len(x)</code></pre></div>
  <div class="exp-bar"><span class="exp-lab">Jadikan file</span>
    <span class="exp-mini"><input class="exp-t" value="1" data-meta="tugas"><input class="exp-t" value="3" data-meta="sesi"><input class="exp-c" value="Bahasa Indonesia" data-meta="matkul"></span>
    <button class="btn sm ghost">DOCX</button><button class="btn sm ghost">PDF</button><span class="exp-note">siap</span></div>
  <div class="tiny">Catatan kecil abu-abu sebagai teks bantu.</div>
</div>`;

const AUDIT = `(() => {
  const parse=(c)=>{if(!c||c==='transparent')return null;const m=c.match(/rgba?\\(([^)]+)\\)/);if(!m)return null;const[r,g,b,a=1]=m[1].split(',').map(Number);return{r,g,b,a};};
  const lum=({r,g,b})=>{const f=(v)=>{v/=255;return v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4)};return 0.2126*f(r)+0.7152*f(g)+0.0722*f(b)};
  const ratio=(a,b)=>{const l1=lum(a),l2=lum(b),hi=Math.max(l1,l2),lo=Math.min(l1,l2);return (hi+0.05)/(lo+0.05)};
  const effBg=(el)=>{let n=el;while(n&&n!==document.documentElement){const c=parse(getComputedStyle(n).backgroundColor);if(c&&c.a>0.9)return c;n=n.parentElement;}return parse(getComputedStyle(document.body).backgroundColor)};
  const out=[];
  const probe=document.getElementById('probe');
  for(const el of probe.querySelectorAll('*')){
    const cs=getComputedStyle(el);
    const hasText=[...el.childNodes].some(n=>n.nodeType===3&&n.textContent.trim().length>1);
    if(!hasText) continue;
    const fg=parse(cs.color); if(!fg) continue;
    const bg=parse(cs.backgroundColor); const bgc=(bg&&bg.a>0.9)?bg:effBg(el);
    const cr=ratio(fg,bgc);
    out.push({el:el.tagName.toLowerCase()+(el.className&&typeof el.className==='string'?'.'+el.className.trim().split(/\\s+/)[0]:''),cr:Number(cr.toFixed(2)),fs:cs.fontSize,txt:(el.textContent||'').trim().slice(0,28)});
  }
  return {items:out.sort((a,b)=>a.cr-b.cr)};
})()`;

for (const theme of ['dark', 'light']) {
  // set tema
  const a = await send('Target.createTarget', { url: 'about:blank' });
  const ta = a.result.targetId;
  const at = await send('Target.attachToTarget', { targetId: ta, flatten: true });
  const sa = at.result.sessionId;
  await send('Runtime.enable', {}, sa);
  await send('Page.navigate', { url: `chrome-extension://${extId}/sidepanel/index.html#/ai` }, sa);
  await new Promise((r) => setTimeout(r, 3000));
  await send('Runtime.evaluate', {
    expression: `(async()=>{const c=(await chrome.storage.local.get(['tuton_profile'])).tuton_profile||{};await chrome.storage.local.set({tuton_profile:{...c,theme:${JSON.stringify(theme)}}});return 'ok';})()`,
    awaitPromise: true, returnByValue: true,
  }, sa);
  await send('Page.reload', {}, sa);
  await new Promise((r) => setTimeout(r, 3500));
  await send('Emulation.setDeviceMetricsOverride', { width: 430, height: 980, deviceScaleFactor: 2, mobile: false }, sa);
  await send('Runtime.evaluate', { expression: `document.getElementById('content').insertAdjacentHTML('afterbegin', ${JSON.stringify(SAMPLE)}); 'ok'`, returnByValue: true }, sa);
  await new Promise((r) => setTimeout(r, 1500));
  const res = await send('Runtime.evaluate', { expression: AUDIT, returnByValue: true }, sa);
  const items = res.result?.result?.value?.items || [];
  console.log('='.repeat(66));
  console.log(`TEMA ${theme.toUpperCase()} — kontras node teks di dalam bubble pesan:`);
  for (const it of items) {
    const flag = it.cr < 4.5 ? (it.cr < 3 ? 'GAGAL' : 'kurang') : 'OK   ';
    console.log(`  ${flag} ${String(it.cr).padStart(5)}:1  ${it.fs.padStart(6)}  ${it.el}  "${it.txt}"`);
  }
  const bad = items.filter((i) => i.cr < 4.5);
  console.log(`  -> di bawah 4.5:1: ${bad.length} dari ${items.length}`);
  const b64 = (await send('Page.captureScreenshot', { format: 'png' }, sa)).result?.data;
  if (b64) fs.writeFileSync(path.join(outDir, `pesan-${theme}.png`), Buffer.from(b64, 'base64'));
  await send('Target.closeTarget', { targetId: ta });
}
process.exit(0);