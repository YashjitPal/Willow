/**
 * Read-only: whether Willow's tab has a local folder connected — the IndexedDB databases it
 * keeps, any stored directory handle and its permission state, and the sidebar's Recents.
 *
 *   node tools/scratch/folder-state.cjs
 */
const puppeteer = require('puppeteer-core');

(async () => {
  const browser = await puppeteer.connect({
    browserURL: process.env.SPARK_CDP_URL || 'http://[::1]:9222',
    defaultViewport: null,
    protocolTimeout: 30_000,
  });
  const page = (await browser.pages()).find((p) => p.url().startsWith('http://localhost:3000'));
  const out = await page.evaluate(async () => {
    const lines = [];
    const dbs = indexedDB.databases ? await indexedDB.databases() : [];
    lines.push(`databases: ${dbs.map((db) => db.name).join(', ') || '(none)'}`);
    for (const { name } of dbs) {
      if (!name) continue;
      const db = await new Promise((resolve) => {
        const request = indexedDB.open(name);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => resolve(null);
      });
      if (!db) continue;
      for (const store of db.objectStoreNames) {
        const values = await new Promise((resolve) => {
          try {
            const request = db.transaction(store, 'readonly').objectStore(store).getAll(undefined, 50);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => resolve([]);
          } catch { resolve([]); }
        });
        const handles = values.flatMap((value) => {
          const found = [];
          const visit = (v, depth) => {
            if (!v || depth > 3) return;
            if (typeof FileSystemDirectoryHandle !== 'undefined' && v instanceof FileSystemDirectoryHandle) found.push(v);
            else if (typeof v === 'object') Object.values(v).forEach((child) => visit(child, depth + 1));
          };
          visit(value, 0);
          return found;
        });
        for (const handle of handles) {
          let permission = 'unknown';
          try { permission = await handle.queryPermission({ mode: 'readwrite' }); } catch { /* ignore */ }
          lines.push(`handle in ${name}/${store}: "${handle.name}" permission ${permission}`);
        }
      }
      db.close();
    }
    const recents = [...document.querySelectorAll('*')].filter((el) => el.childElementCount === 0 && /^Recents?$/.test(el.textContent.trim())).length;
    lines.push(`sidebar "Recent(s)" labels: ${recents}`);
    return lines.join('\n');
  });
  console.log(out);
  await browser.disconnect();
})().catch((e) => { console.error('FAILED', e.message); process.exit(1); });
