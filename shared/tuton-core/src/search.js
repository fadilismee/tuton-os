// @tuton/core — search.js. MURNI: tanpa key, tanpa chrome.*.
// V1: DuckDuckGo Instant Answer (gratis, tanpa key, rate-limit longgar).
// Hasil kaya (10 link + snippet) = V1.5 via API key (Brave/Bing) — belum di sini.
export async function webSearch(q, fetcher) {
  const query = String(q || '').trim();
  if (!query) throw new Error('Kueri kosong.');
  const fx = fetcher || ((url, opt = {}) => fetch(url, { signal: AbortSignal.timeout(opt.timeoutMs || 15000) }).then(async (r) => ({ ok: r.ok, status: r.status, text: () => r.text() })));
  const url = 'https://api.duckduckgo.com/?q=' + encodeURIComponent(query) + '&format=json&no_html=1&skip_disambig=1';
  const r = await fx(url, { timeoutMs: 15000 });
  if (!r.ok) throw new Error(`Search HTTP ${r.status}`);
  const j = JSON.parse(await r.text());
  const related = [...(j.RelatedTopics || [])].flatMap((t) => (t.Topics ? t.Topics : [t]))
    .filter((t) => t.Text && t.FirstURL).slice(0, 8)
    .map((t) => ({ text: t.Text, url: t.FirstURL }));
  return {
    answer: j.AbstractText || '',
    answerUrl: j.AbstractURL || '',
    heading: j.Heading || '',
    related,
  };
}
