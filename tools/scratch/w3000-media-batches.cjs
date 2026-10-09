// Read-only: the user's Media items in the :3000 tab, as batch view sees them — ids, prompts,
// models, ratios, timestamps and batch ids, newest first. Reads IndexedDB; writes nothing,
// clicks nothing, navigates nothing.
//   node tools/scratch/w3000-media-batches.cjs [projectIdFragment]
const puppeteer = require('puppeteer-core');

const want = process.argv[2] || '';

(async () => {
  const browser = await puppeteer.connect({ browserURL: 'http://[::1]:9222', defaultViewport: null });
  const target = browser.targets().find((t) => t.type() === 'page' && /^http:\/\/localhost:3000\/media/.test(t.url()));
  if (!target) throw new Error('no :3000 media tab');
  const page = await target.page();
  const out = await page.evaluate(async (frag) => {
    const db = await new Promise((res, rej) => { const r = indexedDB.open('WillowMediaDB'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    const tx = db.transaction('project_media', 'readonly');
    const store = tx.objectStore('project_media');
    const keys = await new Promise((res) => { const q = store.getAllKeys(); q.onsuccess = () => res(q.result); });
    const records = [];
    for (const key of keys) {
      if (frag && !String(key).includes(frag)) continue;
      const value = await new Promise((res) => { const q = store.get(key); q.onsuccess = () => res(q.result); });
      const items = Array.isArray(value) ? value : value?.items || value?.mediaItems || [];
      records.push({ key: String(key), count: items.length, items: items
        .filter((m) => m && !m.historyParentId && !m.characterId)
        .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
        .slice(0, 80)
        .map((m) => ({ id: String(m.id).slice(0, 34), kind: m.kind, status: m.status, model: m.modelId, ratio: m.ratio, ts: m.timestamp, batch: m.batchId || '', prompt: String(m.prompt || '').slice(0, 50), col: m.collectionId ? 'c' : '' })) });
    }
    db.close();
    return records;
  }, want);
  for (const r of out) {
    console.log(`== ${r.key} (${r.count} items)`);
    let prev;
    for (const m of r.items) {
      const step = prev ? prev.ts - m.ts : '';
      console.log(`${String(step).padStart(9)} ${String(m.ts).padEnd(14)} ${m.kind?.padEnd(5)} ${String(m.model).padEnd(28)} ${String(m.ratio).padEnd(5)} ${m.batch ? 'B ' : '  '}${m.col}${m.status === 'completed' ? '' : `[${m.status}] `}${m.id}  "${m.prompt}"`);
      prev = m;
    }
  }
  await browser.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
