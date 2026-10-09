// What the Tools pages and the Tools folder do after the tools database is cleared, while Media
// has a project: every 2s, the address, the page, My creations, the tools in IndexedDB, the
// folder's files and the engine's records. Headless Chrome of its own on :3101, OPFS as the folder.
//   node tools/scratch/w-tools-folder-diag.cjs
const fs = require('fs');
const os = require('os');
const path = require('path');
const puppeteer = require('puppeteer-core');

const ORIGIN = 'http://localhost:3101';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'willow-tools-diag-'));
  const browser = await puppeteer.launch({
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: true,
    userDataDir,
    defaultViewport: { width: 1536, height: 826, deviceScaleFactor: 1.25 },
    protocolTimeout: 300000,
  });
  const page = (await browser.pages())[0];
  const t0 = Date.now();
  const stamp = () => `+${((Date.now() - t0) / 1000).toFixed(1)}s`;
  page.on('console', (m) => { const t = m.text(); if (/\[tools\]|\[storage\]|synced/i.test(t) || m.type() === 'error') console.log(stamp(), `console.${m.type()}:`, t.slice(0, 300)); });
  page.on('framenavigated', (f) => { if (f === page.mainFrame()) console.log(stamp(), 'navigated', f.url().replace(ORIGIN, '')); });
  const go = (p) => page.goto(`${ORIGIN}${p}`, { waitUntil: 'domcontentloaded', timeout: 180000 }).catch(() => {});
  const snapshot = () => page.evaluate(async () => {
    const section = [...document.querySelectorAll('.applet-section')].find((s) => s.querySelector('.section-title')?.textContent === 'My creations');
    const db = await new Promise((resolve) => { const q = indexedDB.open('WillowMediaToolsDB'); q.onsuccess = () => resolve(q.result); q.onerror = () => resolve(null); });
    let tools = null; let disk = null;
    if (db && db.objectStoreNames.contains('tools')) {
      tools = await new Promise((resolve) => { const q = db.transaction('tools', 'readonly').objectStore('tools').getAll(); q.onsuccess = () => resolve(q.result.map((r) => `${r.key.split(':tool:')[0]}|${r.tool.name}`)); q.onerror = () => resolve('err'); });
      disk = await new Promise((resolve) => { const q = db.transaction('prefs', 'readonly').objectStore('prefs').getAll(); q.onsuccess = () => resolve(q.result.filter((r) => r.key.endsWith(':disk')).map((r) => `${r.key}=${JSON.stringify(r.state)}`)); q.onerror = () => resolve('err'); });
    }
    db?.close();
    let files = null;
    try {
      const root = await navigator.storage.getDirectory();
      const dir = await (await (await root.getDirectoryHandle('willow-test-root')).getDirectoryHandle('Media')).getDirectoryHandle('Tools');
      files = [];
      for await (const e of dir.values()) files.push(e.name);
    } catch {}
    const engine = Object.keys(localStorage).filter((k) => k.startsWith('willow_synced_ids:Media%2FTools')).map((k) => `${decodeURIComponent(k.split(':').slice(2).join(':'))}=${localStorage.getItem(k)}`);
    return {
      url: location.pathname + location.search,
      manager: !!document.querySelector('.ng-flow-applet-manager-page'),
      loading: !!document.querySelector('.flow-loading-host'),
      tab: document.querySelector('.marketplace-toggles .mat-button-toggle-checked .toggle-text')?.textContent,
      creations: section ? [...section.querySelectorAll('.applet-name')].map((e) => e.textContent.trim()) : null,
      tools, disk, files, engine,
    };
  }).catch((e) => ({ error: String(e.message).slice(0, 200) }));

  try {
    await go('/media');
    await sleep(1500);
    await page.evaluate(async () => {
      const opfs = await navigator.storage.getDirectory();
      const base = await opfs.getDirectoryHandle('willow-test-root', { create: true });
      await (await base.getDirectoryHandle('Media', { create: true })).getDirectoryHandle('Folder control', { create: true });
      const db = await new Promise((resolve, reject) => {
        const req = indexedDB.open('WillowLocalFS', 1);
        req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains('handles')) req.result.createObjectStore('handles'); };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      await new Promise((resolve, reject) => {
        const tx = db.transaction('handles', 'readwrite');
        tx.objectStore('handles').put({ handle: base, rootId: 'opfs-test-root' }, 'local_projects_dir');
        tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
      });
      db.close();
    });
    await go('/media/tools');
    await sleep(8000);
    console.log(stamp(), 'before', JSON.stringify(await snapshot()));
    await page.evaluate(() => [...document.querySelectorAll('.marketplace-toggles .mat-button-toggle-button')].find((e) => e.textContent.trim() === 'Templates')?.click());
    await sleep(800);
    await page.evaluate(() => document.querySelector('.applet-grid-gallery .ng-flow-applet-card .applet-card-main')?.click());
    await sleep(8000);
    console.log(stamp(), 'after opening a template', JSON.stringify(await snapshot()));

    await go('/__no_app__.txt');
    console.log(stamp(), 'blank page', JSON.stringify(await page.evaluate(() => ({ title: document.title, app: !!document.querySelector('#root > *') }))));
    const cleared = await page.evaluate(() => new Promise((r) => { const q = indexedDB.deleteDatabase('WillowMediaToolsDB'); q.onsuccess = () => r('deleted'); q.onerror = () => r('error'); q.onblocked = () => r('blocked'); }));
    console.log(stamp(), 'deleteDatabase:', cleared);
    await go('/media/tools');
    for (let i = 0; i < 15; i += 1) {
      await sleep(2000);
      if (i === 2) await page.evaluate(() => [...document.querySelectorAll('.marketplace-toggles .mat-button-toggle-button')].find((e) => e.textContent.trim() === 'My Tools')?.click());
      await page.evaluate(() => window.dispatchEvent(new Event('willow_synced_folders_changed')));
      console.log(stamp(), JSON.stringify(await snapshot()));
    }
    await page.screenshot({ path: path.join(__dirname, '../ui-research/captures/willow/tools/folder-diag.png') });
  } finally {
    await browser.close();
    try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch {}
  }
})().catch((e) => { console.error('FAILED:', e.stack || e.message); process.exit(1); });
