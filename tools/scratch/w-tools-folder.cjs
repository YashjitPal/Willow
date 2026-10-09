// The Tools folder (Media/Tools/<tool>.tool.json) on the :3101 test origin, in a headless Chrome
// of its own with OPFS standing in for the connected folder; nothing of the user's is touched.
// Walks: opening a template makes your copy and its file; renaming the tool moves the file; Media
// never takes Tools/ for a project; the tools database cleared (localStorage kept), then every
// Willow database and localStorage cleared (the folder kept): the tool comes back from its file,
// whole, and runs; a file put in the folder by hand becomes a tool, and deleting it deletes the
// tool; deleting the tool here deletes its file.
//   node tools/scratch/w-tools-folder.cjs
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

(async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'willow-tools-folder-'));
  const browser = await puppeteer.launch({
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: true,
    userDataDir,
    defaultViewport: { width: 1536, height: 826, deviceScaleFactor: 1.25 },
    args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'],
    protocolTimeout: 300000,
  });
  const page = (await browser.pages())[0];
  const errors = [];
  const IGNORED = [/Invalid DOM property .*stroke-width/, /stroke-width strokeWidth/, /tailwindcss' violates the following Content Security Policy/];
  page.on('pageerror', (e) => errors.push(String(e.message || e).slice(0, 300)));
  page.on('console', (m) => {
    const t = m.text();
    if (m.type() === 'error' && !IGNORED.some((re) => re.test(t))) errors.push(`console: ${t.slice(0, 300)}`);
  });
  const waitFor = async (fn, ms = 20000, poke = false) => {
    const end = Date.now() + ms;
    for (;;) {
      const v = await fn().catch(() => null);
      if (v) return v;
      if (Date.now() > end) return null;
      // What the app sends after a change of its own: a pass now rather than at the next poll.
      if (poke) await page.evaluate(() => window.dispatchEvent(new Event('willow_synced_folders_changed'))).catch(() => {});
      await sleep(poke ? 1000 : 300);
    }
  };
  const evalIn = (fn, ...args) => page.evaluate(fn, ...args);
  /** The files in the folder's Media/Tools, or null while there is none. */
  const toolFiles = () => evalIn(async () => {
    const root = await navigator.storage.getDirectory();
    try {
      const dir = await (await (await root.getDirectoryHandle('willow-test-root')).getDirectoryHandle('Media')).getDirectoryHandle('Tools');
      const out = {};
      for await (const e of dir.values()) if (e.kind === 'file') out[e.name] = await (await e.getFile()).text();
      return out;
    } catch { return null; }
  });
  const mediaFolders = () => evalIn(async () => {
    const root = await navigator.storage.getDirectory();
    const out = [];
    try {
      for await (const e of (await (await root.getDirectoryHandle('willow-test-root')).getDirectoryHandle('Media')).values()) out.push(`${e.kind === 'directory' ? 'dir' : 'file'}:${e.name}`);
    } catch {}
    return out.sort();
  });
  const putFile = (name, text) => evalIn(async (n, t) => {
    const root = await navigator.storage.getDirectory();
    const dir = await (await (await root.getDirectoryHandle('willow-test-root')).getDirectoryHandle('Media')).getDirectoryHandle('Tools');
    const w = await (await dir.getFileHandle(n, { create: true })).createWritable();
    await w.write(t);
    await w.close();
  }, name, text);
  const removeFile = (name) => evalIn(async (n) => {
    const root = await navigator.storage.getDirectory();
    const dir = await (await (await root.getDirectoryHandle('willow-test-root')).getDirectoryHandle('Media')).getDirectoryHandle('Tools');
    await dir.removeEntry(n);
  }, name);
  /** Every project name the registry holds, in every scope. */
  const projectNames = () => evalIn(() => Object.keys(localStorage)
    .filter((k) => k.startsWith('willow_projects_list'))
    .flatMap((k) => { try { return JSON.parse(localStorage.getItem(k)).map((p) => p.name); } catch { return []; } }));
  const fileFor = async (id) => {
    const files = (await toolFiles()) || {};
    for (const [name, text] of Object.entries(files)) {
      try { if (JSON.parse(text).id === id) return { name, text, json: JSON.parse(text) }; } catch {}
    }
    return null;
  };
  const go = (p) => page.goto(`${ORIGIN}${p}`, { waitUntil: 'domcontentloaded', timeout: 180000 }).catch(() => {});
  const clickText = (sel, label) => evalIn((s, l) => {
    const el = [...document.querySelectorAll(s)].find((e) => e.textContent.trim() === l);
    el?.click();
    return !!el;
  }, sel, label);
  const myCreations = () => evalIn(() => {
    const section = [...document.querySelectorAll('.applet-section')].find((s) => s.querySelector('.section-title')?.textContent === 'My creations');
    return section ? [...section.querySelectorAll('.ng-flow-applet-card .applet-name')].map((e) => e.textContent.trim()) : [];
  });
  const openMyTools = async () => {
    await go('/media/tools');
    await waitFor(() => evalIn(() => !!document.querySelector('.ng-flow-applet-manager-page .applet-section')), 120000);
    await clickText('.marketplace-toggles .mat-button-toggle-button', 'My Tools');
    await sleep(600);
  };
  const clearSiteData = (databases, { localStorage: clearLocal }) => evalIn(async (names, wipe) => {
    for (const name of names) {
      await new Promise((r) => { const q = indexedDB.deleteDatabase(name); q.onsuccess = q.onerror = q.onblocked = () => r(); });
    }
    if (wipe) { localStorage.clear(); sessionStorage.clear(); }
  }, databases, clearLocal);

  try {
    // ---- The folder, connected the way a picked folder is: its handle in WillowLocalFS ----------
    await go('/media');
    await sleep(1500);
    await evalIn(async () => {
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
    });
    await go('/media');
    const made = await waitFor(async () => (await toolFiles()) !== null, 60000);
    check('the connected folder gets Media/Tools', !!made, await mediaFolders());

    // ---- A template opened: your copy, and its file ------------------------------------------------
    await openMyTools();
    await clickText('.marketplace-toggles .mat-button-toggle-button', 'Templates');
    await waitFor(() => evalIn(() => document.querySelectorAll('.applet-grid-gallery .ng-flow-applet-card').length > 0), 10000);
    const templateName = await evalIn(() => document.querySelector('.applet-grid-gallery .ng-flow-applet-card .applet-name')?.textContent?.trim());
    await evalIn(() => document.querySelector('.applet-grid-gallery .ng-flow-applet-card .applet-card-main')?.click());
    const opened = await waitFor(() => evalIn(() => (/\/media\/tool\/[0-9a-f-]{20,}/.test(location.pathname) && document.querySelector('.ng-flow-applet-view-page .editable-text-input')?.value) || null), 40000);
    const copyId = await evalIn(() => (location.pathname.match(/\/media\/tool\/([^/?]+)/) || [])[1] || null);
    check('a template opens as your copy', opened === `Remix of ${templateName}` && !!copyId, { opened, copyId });
    const t0 = Date.now();
    let file = await waitFor(() => fileFor(copyId), 40000);
    check(`its file appears in Media/Tools (in ${((Date.now() - t0) / 1000).toFixed(1)}s)`, file?.name === `Remix of ${templateName}.tool.json`, file?.name ?? await toolFiles().then((f) => Object.keys(f || {})));
    check('the file holds the tool: its name, a version with its files, the current one', file && file.json.name === `Remix of ${templateName}` && file.json.versions.length >= 1 && file.json.versions.some((v) => v.id === file.json.versionId && v.files.length > 0), file && { name: file.json.name, versions: file.json.versions.length });

    // ---- Renamed here: the file moves -----------------------------------------------------------
    await evalIn(() => document.querySelector('.applet-view-header button[aria-label="More options"]')?.click());
    await sleep(500);
    await evalIn(() => [...document.querySelectorAll('.sb-menu .sb-menu-item')].find((e) => e.querySelector('.sb-menu-item__label')?.textContent.trim() === 'Rename')?.click());
    await sleep(300);
    await page.keyboard.down('Control'); await page.keyboard.press('a'); await page.keyboard.up('Control');
    await page.keyboard.type('Folder test tool');
    await page.keyboard.press('Enter');
    file = await waitFor(async () => {
      const f = await fileFor(copyId);
      return f?.name === 'Folder test tool.tool.json' ? f : null;
    }, 40000);
    const afterRename = Object.keys((await toolFiles()) || {});
    check('renaming the tool moves its file', !!file && afterRename.length === 1, afterRename);
    const original = file?.text;
    // The control: a folder of Media's own is taken for a project, so the scan has run.
    await evalIn(async () => {
      const root = await navigator.storage.getDirectory();
      await (await (await root.getDirectoryHandle('willow-test-root')).getDirectoryHandle('Media')).getDirectoryHandle('Folder control', { create: true });
    });
    const scanned = await waitFor(async () => ((await projectNames()).includes('Folder control') ? true : null), 60000, true);
    const projects = await projectNames();
    check('Media never takes Tools/ for a project (while it takes a folder of its own for one)', !!scanned && !projects.some((n) => /^tools$/i.test(n)), { projects, media: await mediaFolders() });
    // With a project to open, an address without one gains it, and keeps its page.
    await go('/media/tools');
    const stays = await waitFor(() => evalIn(() => (location.pathname === '/media/tools' && /projectId=/.test(location.search) && document.querySelector('.ng-flow-applet-manager-page') ? location.pathname + location.search : null)), 60000);
    check('/media/tools without a project stays on the Tools page', !!stays, await evalIn(() => location.pathname + location.search));

    // ---- The tools database cleared, localStorage kept --------------------------------------------
    await go('/__no_app__.txt');
    await clearSiteData(['WillowMediaToolsDB'], { localStorage: false });
    await openMyTools();
    let back = await waitFor(async () => ((await myCreations()).includes('Folder test tool') ? true : null), 60000, true);
    check('the tools database cleared: the tool comes back from its file', !!back, await myCreations());
    check('and its file is still there', (await fileFor(copyId))?.name === 'Folder test tool.tool.json', Object.keys((await toolFiles()) || {}));

    // ---- Every Willow database and localStorage cleared, the folder kept: a new browser -----------
    await go('/__no_app__.txt');
    await clearSiteData(['WillowMediaToolsDB', 'WillowMediaDB', 'WillowMediaScenesDB', 'WillowMediaCollectionsDB', 'WillowMediaAgentDB', 'WillowMediaCharactersDB', 'WillowDB'], { localStorage: true });
    await openMyTools();
    back = await waitFor(async () => ((await myCreations()).includes('Folder test tool') ? true : null), 60000, true);
    check('a new browser on the folder: the tool comes back', !!back, await myCreations());
    await sleep(2500);
    check('what came back writes out as the same file', (await fileFor(copyId))?.text === original, (await fileFor(copyId))?.text?.length);
    await go(`/media/tool/${copyId}?fromViewSource=tools`);
    const runs = await waitFor(() => evalIn(() => {
      const name = document.querySelector('.ng-flow-applet-view-page .editable-text-input')?.value;
      const frame = document.querySelector('.ng-flow-applet-view-page iframe');
      const failed = document.querySelector('.compile-error, .applet-error-banner');
      return name === 'Folder test tool' && frame && !failed ? true : null;
    }), 40000);
    check('it opens and runs', !!runs);

    // ---- A file put in the folder by hand, then deleted by hand ------------------------------------
    const handMade = JSON.parse(original);
    handMade.id = 'hand-made-tool';
    handMade.name = 'Imported by hand';
    await putFile('Imported by hand.tool.json', JSON.stringify(handMade, null, 2));
    await openMyTools();
    const imported = await waitFor(async () => ((await myCreations()).includes('Imported by hand') ? true : null), 60000, true);
    check('a file put in the folder by hand becomes a tool', !!imported, await myCreations());
    await removeFile('Imported by hand.tool.json');
    const gone = await waitFor(async () => (!(await myCreations()).includes('Imported by hand') ? true : null), 60000, true);
    check('deleting its file deletes the tool', !!gone, await myCreations());

    // ---- Deleted here: its file goes ---------------------------------------------------------------
    await go(`/media/tool/${copyId}?fromViewSource=tools`);
    await waitFor(() => evalIn(() => !!document.querySelector('.applet-view-header')), 30000);
    await evalIn(() => document.querySelector('.applet-view-header button[aria-label="More options"]')?.click());
    await sleep(500);
    await evalIn(() => [...document.querySelectorAll('.sb-menu .sb-menu-item')].find((e) => e.querySelector('.sb-menu-item__label')?.textContent.trim() === 'Delete')?.click());
    await waitFor(() => evalIn(() => /Deleting this app will delete it/.test(document.body.textContent)), 5000);
    await evalIn(() => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Delete' && b.closest('[role="dialog"]'))?.click());
    const removed = await waitFor(async () => (!(await fileFor(copyId)) ? true : null), 40000);
    check('deleting the tool here deletes its file', !!removed, Object.keys((await toolFiles()) || {}));
    check('Media never took Tools/ for a project', !(await projectNames()).some((n) => /^tools$/i.test(n)), await projectNames());
    check('no page errors', errors.length === 0, errors.slice(0, 8));
  } finally {
    console.log(failures ? `${failures} FAILED` : 'ALL PASSED');
    await browser.close();
    try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch { /* still locked */ }
  }
})().catch((e) => { console.error('FAILED:', e.stack || e.message); process.exit(1); });
