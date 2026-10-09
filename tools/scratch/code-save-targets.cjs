/**
 * Willow (never the media tab): reports whether this tab could autosave a Code project
 * anywhere outside the browser — a Google Drive token in this tab's session, and a stored
 * local-folder handle with granted permission — without printing the token, the folder
 * name or any content. Read-only.
 *
 *   node tools/scratch/code-save-targets.cjs
 */
const puppeteer = require('puppeteer-core');

(async () => {
  const browser = await puppeteer.connect({ browserURL: 'http://[::1]:9222', defaultViewport: null, protocolTimeout: 60000 });
  const page = (await browser.pages()).find((p) => p.url().startsWith('http://localhost:3000') && !p.url().includes('/media'));
  const out = await page.evaluate(async () => {
    const lines = [];
    lines.push(`drive token in this tab: ${sessionStorage.getItem('googleDriveAccessToken') ? 'yes' : 'no'}`);
    const db = await new Promise((resolve) => {
      const req = indexedDB.open('WillowLocalFS');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    });
    if (!db) { lines.push('WillowLocalFS: cannot open'); return lines.join('\n'); }
    lines.push(`WillowLocalFS stores: ${[...db.objectStoreNames].join(', ')}`);
    for (const storeName of db.objectStoreNames) {
      const entries = await new Promise((resolve) => {
        const tx = db.transaction(storeName, 'readonly');
        const store = tx.objectStore(storeName);
        const all = store.getAll();
        const keys = store.getAllKeys();
        tx.oncomplete = () => resolve({ values: all.result, keys: keys.result });
        tx.onerror = () => resolve({ values: [], keys: [] });
      });
      for (let i = 0; i < entries.values.length; i += 1) {
        const value = entries.values[i];
        const handle = value && (value.kind ? value : value.handle);
        if (handle && typeof handle.queryPermission === 'function') {
          let permission = 'unknown';
          try { permission = await handle.queryPermission({ mode: 'readwrite' }); } catch {}
          lines.push(`  ${storeName}[${i}]: directory handle, readwrite permission ${permission}`);
        } else {
          lines.push(`  ${storeName}[${i}]: ${value === null ? 'null' : typeof value}`);
        }
      }
    }
    db.close();
    return lines.join('\n');
  });
  console.log(out);
  browser.disconnect();
})();
