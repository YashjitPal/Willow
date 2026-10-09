// Read-only: lists the characters in the user's localhost:3000 Willow (the debug Chrome) with each
// portrait's and body's stored ratio, status and the picture's real size. Readonly transactions
// only; nothing is clicked, navigated or written.
//   node tools/scratch/willow3000-characters.cjs
const puppeteer = require('puppeteer-core');

(async () => {
  const browser = await puppeteer.connect({ browserURL: 'http://[::1]:9222', defaultViewport: null });
  const page = (await browser.pages()).find((p) => /^http:\/\/localhost:3000\//.test(p.url()));
  if (!page) throw new Error('no localhost:3000 tab');
  const result = await page.evaluate(async () => {
    const open = (name) => new Promise((res, rej) => { const r = indexedDB.open(name); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    const all = (db, store) => new Promise((res, rej) => { const q = db.transaction(store, 'readonly').objectStore(store).getAll(); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); });
    const cdb = await open('WillowMediaCharactersDB');
    const characters = (await all(cdb, 'characters')).map((r) => r.character);
    cdb.close();
    const mdb = await open('WillowMediaDB');
    const projects = await all(mdb, 'project_media');
    mdb.close();
    const items = new Map();
    for (const p of projects) for (const m of (Array.isArray(p) ? p : (p.items || p.media || p.value || []))) if (m && m.id) items.set(m.id, m);
    const size = (url) => new Promise((res) => { if (!url) { res(null); return; } const i = new Image(); i.onload = () => res(`${i.naturalWidth}x${i.naturalHeight}`); i.onerror = () => res('error'); i.src = url; });
    const describe = async (id) => { const m = id && items.get(id); return m ? { ratio: m.ratio, status: m.status, size: await size(m.url), url: (m.url || '').slice(0, 30) } : id ? 'missing' : null; };
    const out = [];
    for (const c of characters) out.push({ name: c.name, portrait: await describe(c.portraitId), body: await describe(c.bodyId) });
    return { keys: projects[0] ? Object.keys(projects[0]) : [], count: characters.length, out };
  });
  console.log(JSON.stringify(result, null, 1));
  await browser.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
