// Gems in the workspace's Gems/ folder on the :3101 test origin, in a headless Chrome of its own
// with OPFS standing in for the connected folder; nothing of the user's is touched. Walks: two
// Gems sync from the Gems page; a reload onto Media, which never reads the Gems, deletes no Gem
// file; a Gem deleted in the manager loses its file; a new Gem made with its name gets the file
// back and survives the next change from disk.
//   node tools/scratch/w-gems-folder.cjs
const fs = require('fs');
const os = require('os');
const path = require('path');
const puppeteer = require('puppeteer-core');

const ORIGIN = 'http://localhost:3101';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (label, ok, detail) => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${detail === undefined ? '' : ` :: ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`}`);
};

const gem = (name, instructions, at) => ({
  id: name, name, description: '', instructions, defaultTool: 'none', knowledge: [], hideCitations: false, createdAt: at, updatedAt: at,
});

(async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'willow-gems-folder-'));
  const browser = await puppeteer.launch({
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: true,
    userDataDir,
    defaultViewport: { width: 1536, height: 826, deviceScaleFactor: 1.25 },
    protocolTimeout: 300000,
  });
  const page = (await browser.pages())[0];
  const errors = [];
  const IGNORED = [/Invalid DOM property .*stroke-width/, /stroke-width strokeWidth/];
  page.on('pageerror', (e) => errors.push(String(e.message || e).slice(0, 300)));
  page.on('console', (m) => {
    const t = m.text();
    if (m.type() === 'error' && !IGNORED.some((re) => re.test(t))) errors.push(`console: ${t.slice(0, 300)}`);
  });
  const evalIn = (fn, ...args) => page.evaluate(fn, ...args);
  const go = (p) => page.goto(`${ORIGIN}${p}`, { waitUntil: 'domcontentloaded', timeout: 180000 }).catch(() => {});
  /** Polls `fn`, asking the app for a sync pass between tries as a local change does. */
  const waitFor = async (fn, ms = 30000) => {
    const end = Date.now() + ms;
    for (;;) {
      const v = await fn().catch(() => null);
      if (v) return v;
      if (Date.now() > end) return null;
      await evalIn(() => window.dispatchEvent(new Event('willow_synced_folders_changed'))).catch(() => {});
      await sleep(1000);
    }
  };
  const gemFiles = () => evalIn(async () => {
    const root = await navigator.storage.getDirectory();
    try {
      const dir = await (await root.getDirectoryHandle('willow-test-root')).getDirectoryHandle('Gems');
      const out = {};
      for await (const e of dir.values()) if (e.kind === 'file') out[e.name] = JSON.parse(await (await e.getFile()).text());
      return out;
    } catch { return null; }
  });
  const storedGems = () => evalIn(() => JSON.parse(localStorage.getItem('willow_gems:v1') || '[]').map((g) => g.name).sort());
  const myGems = () => evalIn(() => [...document.querySelectorAll('section[aria-label="My Gems"] .gems-row-title')].map((e) => e.textContent.trim()).sort());

  try {
    // ---- A returning user: two Gems in this browser, the folder connected -------------------------
    await go('/media');
    await sleep(1500);
    await evalIn(async (gems) => {
      localStorage.setItem('willow_gems:v1', JSON.stringify(gems));
      const opfs = await navigator.storage.getDirectory();
      const base = await opfs.getDirectoryHandle('willow-test-root', { create: true });
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
    }, [gem('Writer', 'Write well.', Date.now() - 2000), gem('Coach', 'Coach kindly.', Date.now() - 1000)]);

    await go('/gems');
    const synced = await waitFor(async () => {
      const files = await gemFiles();
      return files && files['Writer.json'] && files['Coach.json'] ? Object.keys(files).sort() : null;
    }, 60000);
    check('the Gems page writes both Gems to Gems/', !!synced, synced ?? await gemFiles());

    // ---- A reload onto a page that never reads the Gems --------------------------------------------
    await go('/media');
    await sleep(4000);
    const kept = await waitFor(async () => {
      const files = await gemFiles();
      return files && Object.keys(files).length >= 2 ? Object.keys(files).sort() : null;
    }, 8000);
    await sleep(3000);
    const after = Object.keys((await gemFiles()) || {}).sort();
    check('a reload onto Media deletes no Gem file', !!kept && after.join() === 'Coach.json,Writer.json', after);
    check('and the browser still has both Gems', (await storedGems()).join() === 'Coach,Writer', await storedGems());

    // ---- Deleted in the manager, then made again with its name -------------------------------------
    await go('/gems');
    await waitFor(async () => ((await myGems()).length === 2 ? true : null), 30000);
    await evalIn(() => document.querySelector('button[aria-label=\'More options for "Writer" Gem\']')?.click());
    await sleep(500);
    await evalIn(() => [...document.querySelectorAll('[role="menuitem"]')].find((e) => e.textContent.includes('Delete'))?.click());
    await sleep(500);
    await evalIn(() => [...document.querySelectorAll('button')].filter((b) => b.textContent.trim() === 'Delete' && !b.closest('[role="menu"]')).pop()?.click());
    const removed = await waitFor(async () => {
      const files = await gemFiles();
      return files && !files['Writer.json'] ? true : null;
    }, 30000);
    check('deleting a Gem deletes its file', !!removed, Object.keys((await gemFiles()) || {}));

    await go('/gems/create');
    await waitFor(() => evalIn(() => !!document.querySelector('#gem-editor-name')), 30000);
    await page.click('#gem-editor-name');
    await page.keyboard.type('Writer');
    await page.click('textarea[placeholder^="Example: You are a horticulturist"]');
    await page.keyboard.type('Write tightly.');
    await sleep(300);
    await evalIn(() => document.querySelector('.gem-editor-save')?.click());
    const rewritten = await waitFor(async () => {
      const files = await gemFiles();
      const file = files && Object.entries(files).find(([, g]) => g.name === 'Writer');
      return file && file[1].instructions === 'Write tightly.' ? file[0] : null;
    }, 30000);
    check('a new Gem named like the deleted one gets its file', !!rewritten, rewritten ?? await gemFiles());

    // ---- A change from disk: the folder's Gems are handed back to the store -----------------------
    await evalIn(async () => {
      const root = await navigator.storage.getDirectory();
      const dir = await (await root.getDirectoryHandle('willow-test-root')).getDirectoryHandle('Gems');
      const w = await (await dir.getFileHandle('From disk.json', { create: true })).createWritable();
      await w.write(JSON.stringify({ name: 'From disk', instructions: 'Hello.' }));
      await w.close();
    });
    await go('/gems');
    const listed = await waitFor(async () => {
      const names = await myGems();
      return names.includes('From disk') ? names : null;
    }, 30000);
    check('after a change from disk the new Gem is still there', !!listed && listed.join() === 'Coach,From disk,Writer', listed ?? await myGems());
    check('and so is its instructions\' file', Object.values((await gemFiles()) || {}).some((g) => g.name === 'Writer' && g.instructions === 'Write tightly.'));
    check('no page errors', errors.length === 0, errors.slice(0, 8));
  } finally {
    console.log(failures ? `${failures} FAILED` : 'ALL PASSED');
    await browser.close();
    try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch { /* still locked */ }
  }
})().catch((e) => { console.error('FAILED:', e.stack || e.message); process.exit(1); });
