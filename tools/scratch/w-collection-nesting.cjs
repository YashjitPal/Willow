// Collection drag + nesting on the :3101 test origin, own headless Chrome, OPFS standing in for the
// connected folder (Media/Nest Test/ with Alpha/ (2 images), Beta/ (1 image), Images/ (2 images)).
// Walks: a collection over the composer (slot lit, no label, no drop) and over itself, Beta into
// Alpha (preview, label, disk folder moves), reload (reconcile keeps the nesting), Move out of a
// nested collection (lands in the parent), + New collection inside a collection, a marquee with a
// collection in it (selection menu, Copy, New collection's dialog, nesting on disk), reload, and
// the whole tree dragged to Trash (dialog, snackbar, folder gone).
// --shots saves the selection menu and the New collection dialog beside Flow's captures.
//   node tools/scratch/w-collection-nesting.cjs [--shots]
const fs = require('fs');
const os = require('os');
const path = require('path');
const puppeteer = require('puppeteer-core');

const ORIGIN = 'http://localhost:3101';
const SHOTS = process.argv.includes('--shots') && path.resolve('tools/ui-research/captures/flow/media/collections/nesting');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
let lastCheck = 'setup';
const check = (label, ok, detail) => {
  lastCheck = label;
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${detail === undefined ? '' : ` :: ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`}`);
};

(async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'willow-nest-'));
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
  page.on('pageerror', (e) => errors.push(String(e.message || e).slice(0, 300)));
  page.on('console', (m) => { if (m.type() === 'error' && !/Invalid DOM property/.test(m.text())) errors.push(m.text().slice(0, 300)); });
  page.on('requestfailed', (r) => errors.push(`request failed after "${lastCheck}": ${r.url().slice(0, 80)} ${r.failure()?.errorText}`));
  await browser.defaultBrowserContext().overridePermissions(ORIGIN, ['clipboard-read', 'clipboard-write', 'clipboard-sanitized-write']);

  const state = () => page.evaluate(() => ({
    collections: [...document.querySelectorAll('[data-drop-collection]')].map((t) => `${t.querySelector('.ct-title-text')?.textContent}|${(t.querySelector('.ct-counts')?.textContent || '').replace(/\s+/g, '')}`),
    images: [...document.querySelectorAll('.gallery-tile:not([data-drop-collection]) img')].map((i) => i.alt).filter((a, i, all) => a && all.indexOf(a) === i),
    broken: [...document.querySelectorAll('.gallery-tile img')].filter((i) => i.complete && i.getAttribute('src') && i.naturalWidth === 0).map((i) => i.alt.slice(0, 20)),
    search: location.search,
  }));
  const disk = () => page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    const proj = await (await (await root.getDirectoryHandle('willow-test-root')).getDirectoryHandle('Media')).getDirectoryHandle('Nest Test');
    const out = [];
    const walk = async (dir, prefix) => {
      for await (const e of dir.values()) {
        if (e.name.startsWith('.')) continue;
        const p = prefix ? `${prefix}/${e.name}` : e.name;
        if (e.kind === 'directory') { out.push(`${p}/`); await walk(e, p); } else out.push(p);
      }
    };
    await walk(proj, '');
    return out.sort();
  });
  const collectionAt = (name) => page.evaluate((n) => {
    const t = [...document.querySelectorAll('[data-drop-collection]')].find((el) => el.querySelector('.ct-title-text')?.textContent === n);
    if (!t) return null;
    const b = t.getBoundingClientRect();
    return { x: b.x + b.width / 2, y: b.y + b.height / 2, left: b.left, top: b.top, right: b.right, bottom: b.bottom };
  }, name);
  const imageAt = (name) => page.evaluate((n) => {
    const t = [...document.querySelectorAll('.gallery-tile img')].find((el) => el.alt === n)?.closest('.gallery-tile');
    if (!t) return null;
    const b = t.getBoundingClientRect();
    return { x: b.x + b.width / 2, y: b.y + b.height / 2, left: b.left, top: b.top, right: b.right, bottom: b.bottom };
  }, name);
  const waitFor = async (fn, ms = 15000) => {
    const end = Date.now() + ms;
    for (;;) {
      const v = await fn().catch(() => null);
      if (v) return v;
      if (Date.now() > end) return null;
      await sleep(250);
    }
  };
  const during = () => page.evaluate(() => ({
    thumbs: [...document.querySelectorAll('.dg-preview .dg-thumb')].map((t) => ({ w: Math.round(t.getBoundingClientRect().width), h: Math.round(t.getBoundingClientRect().height), img: !!t.querySelector('img,video') })),
    label: document.querySelector('.dg-label')?.textContent || null,
    dropTargets: [...document.querySelectorAll('[data-drop-collection] .ct-container.is-drop-target')].map((c) => c.closest('[data-drop-collection]').querySelector('.ct-title-text')?.textContent),
    slotsLit: [...document.querySelectorAll('.dz-slot.is-active')].map((s) => s.dataset.dropZone),
    trashTarget: !!document.querySelector('.dg-trash-target'),
  }));
  /** Press on `from`, cross the threshold, travel to `to()` (read once the drag is on), report, release. */
  const drag = async (from, to) => {
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x + 12, from.y + 12, { steps: 4 });
    await sleep(250);
    const target = await to();
    await page.mouse.move(target.x, target.y, { steps: 14 });
    await sleep(400);
    const seen = await during();
    await page.mouse.up();
    await sleep(900);
    return seen;
  };
  const attachments = () => page.evaluate(() => document.querySelectorAll('.prompt-container-box img').length);
  const projectUrl = (id, collection) => `${ORIGIN}/media?projectId=${encodeURIComponent(id)}${collection ? `&collection=${encodeURIComponent(collection)}` : ''}`;
  const settle = async () => {
    await waitFor(() => page.evaluate(() => document.querySelectorAll('.gallery-tile').length > 0));
    await sleep(2500);
    await page.mouse.move(1530, 820);
  };

  try {
    // ---- Seed the folder -------------------------------------------------------------------
    await page.goto(`${ORIGIN}/media`, { waitUntil: 'networkidle2', timeout: 180000 }).catch(() => {});
    await page.evaluate(async () => {
      const png = async (color, text) => {
        const c = new OffscreenCanvas(640, 480);
        const g = c.getContext('2d');
        g.fillStyle = color; g.fillRect(0, 0, 640, 480);
        g.fillStyle = '#fff'; g.font = 'bold 64px sans-serif'; g.fillText(text, 40, 260);
        return c.convertToBlob({ type: 'image/png' });
      };
      const root = await navigator.storage.getDirectory();
      const base = await root.getDirectoryHandle('willow-test-root', { create: true });
      const proj = await (await base.getDirectoryHandle('Media', { create: true })).getDirectoryHandle('Nest Test', { create: true });
      const put = async (folder, name, color) => {
        const dir = await proj.getDirectoryHandle(folder, { create: true });
        const w = await (await dir.getFileHandle(name, { create: true })).createWritable();
        await w.write(await png(color, name.replace('.png', '').toUpperCase()));
        await w.close();
        await new Promise((r) => setTimeout(r, 1100));
      };
      await put('Alpha', 'alpha 1.png', '#b3261e');
      await put('Alpha', 'alpha 2.png', '#e8710a');
      await put('Beta', 'beta 1.png', '#1a73e8');
      await put('Images', 'top 1.png', '#188038');
      await put('Images', 'top 2.png', '#9334e6');
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
    await page.goto(`${ORIGIN}/media`, { waitUntil: 'networkidle2' }).catch(() => {});
    const id = await waitFor(() => page.evaluate(async () => {
      const root = await navigator.storage.getDirectory();
      const proj = await (await (await root.getDirectoryHandle('willow-test-root')).getDirectoryHandle('Media')).getDirectoryHandle('Nest Test');
      return JSON.parse(await (await (await proj.getFileHandle('.willow.json')).getFile()).text()).id;
    }), 30000);
    if (!id) throw new Error('project never registered');
    await page.goto(projectUrl(id), { waitUntil: 'domcontentloaded' }).catch(() => {});
    await waitFor(() => page.evaluate(() => document.querySelectorAll('[data-drop-collection]').length >= 2 && document.querySelectorAll('.gallery-tile img').length >= 2), 30000);
    await settle();
    let s = await state();
    check('seeded: Alpha and Beta at the top, two loose images', s.collections.length === 2 && s.images.length === 2, s);

    // ---- A collection over the composer: slot lit, no label, nothing dropped -----------------
    const before = await attachments();
    let seen = await drag(await collectionAt('Alpha'), () => page.evaluate(() => {
      const b = document.querySelector('[data-drop-zone]').getBoundingClientRect();
      return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
    }));
    check('collection over composer: slot lit', seen.slotsLit.length === 1, seen);
    check('collection over composer: no label', seen.label === null, seen.label);
    check('collection over composer: preview is one picture, 128px tall', seen.thumbs.length === 1 && seen.thumbs[0].img && seen.thumbs[0].h === 128, seen.thumbs);
    check('collection over composer: nothing attached on release', (await attachments()) === before);

    // ---- A collection over itself: no target, and the release opens nothing ------------------
    const alpha = await collectionAt('Alpha');
    seen = await drag(alpha, async () => ({ x: alpha.x - 30, y: alpha.y - 20 }));
    check('collection over itself: no target, no label', seen.dropTargets.length === 0 && seen.label === null, seen);
    check('collection over itself: release does not open it', !(await page.evaluate(() => location.search.includes('collection='))), await page.evaluate(() => location.search));

    // ---- Beta into Alpha ----------------------------------------------------------------------
    seen = await drag(await collectionAt('Beta'), () => collectionAt('Alpha'));
    check('Beta over Alpha: "Add to collection", Alpha lit', seen.label === 'Add to collection' && seen.dropTargets.join() === 'Alpha', seen);
    await sleep(1500);
    s = await state();
    check('Beta into Alpha: only Alpha at the top, counting 3 images', s.collections.length === 1 && s.collections[0].startsWith('Alpha|') && /3/.test(s.collections[0]), s.collections);
    let d = await disk();
    check('Beta into Alpha: folder moved on disk', d.includes('Alpha/Beta/beta 1.png') && !d.includes('Beta/'), d);
    // Before any reload: every moved file still shows, inside Alpha and inside Beta.
    await page.mouse.click((await collectionAt('Alpha')).x, (await collectionAt('Alpha')).y);
    await waitFor(() => collectionAt('Beta'));
    await sleep(2500);
    s = await state();
    check('no reload, inside Alpha: nothing broken', s.broken.length === 0 && s.collections[0]?.startsWith('Beta|'), s);
    await page.mouse.click((await collectionAt('Beta')).x, (await collectionAt('Beta')).y);
    await waitFor(() => imageAt('beta 1'));
    await sleep(2500);
    s = await state();
    check('no reload, inside Beta: its moved file shows', s.broken.length === 0 && s.images.join() === 'beta 1', s);
    await page.goto(projectUrl(id), { waitUntil: 'domcontentloaded' }).catch(() => {});
    await waitFor(() => collectionAt('Alpha'));

    // ---- Reload: the reconcile keeps the nesting ---------------------------------------------
    await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
    await waitFor(() => page.evaluate(() => document.querySelectorAll('[data-drop-collection]').length >= 1), 30000);
    await settle();
    s = await state();
    check('reload: still only Alpha at the top', s.collections.length === 1 && s.collections[0].startsWith('Alpha|'), s);
    await page.mouse.click((await collectionAt('Alpha')).x, (await collectionAt('Alpha')).y);
    await waitFor(() => collectionAt('Beta'));
    await settle();
    s = await state();
    check('inside Alpha: Beta (1 image) and Alpha\'s own two images', s.collections.length === 1 && s.collections[0].startsWith('Beta|') && s.images.sort().join() === 'alpha 1,alpha 2', s);

    // ---- Move out of a nested collection lands in its parent ---------------------------------
    await page.mouse.click((await collectionAt('Beta')).x, (await collectionAt('Beta')).y);
    await waitFor(() => imageAt('beta 1'));
    await settle();
    const beta1 = await imageAt('beta 1');
    await page.mouse.move(beta1.x, beta1.y);
    await sleep(600);
    await page.evaluate((n) => {
      const t = [...document.querySelectorAll('.gallery-tile img')].find((el) => el.alt === n).closest('.gallery-tile');
      t.querySelector('button[aria-label="More options"]').click();
    }, 'beta 1');
    await sleep(500);
    const moveOut = await page.evaluate(() => {
      const item = [...document.querySelectorAll('[role="menuitem"]')].find((m) => /Move out of collection/.test(m.textContent));
      item?.click();
      return !!item;
    });
    check('nested tile menu offers Move out of collection', moveOut);
    await sleep(1500);
    d = await disk();
    check('Move out of Beta: the file lands in Alpha, not the top', d.includes('Alpha/beta 1.png') && !d.includes('Images/beta 1.png'), d);

    // ---- + New collection inside a collection nests it and stays ------------------------------
    await page.goBack({ waitUntil: 'domcontentloaded' }).catch(() => {});
    await waitFor(() => imageAt('beta 1'));
    await settle();
    s = await state();
    check('no reload, back in Alpha: the moved-out file shows', s.broken.length === 0 && s.images.includes('beta 1'), s);
    const inAlpha = await page.evaluate(() => location.search);
    await page.click('button[aria-label="Add media menu"]');
    await sleep(500);
    await page.evaluate(() => [...document.querySelectorAll('[role="menuitem"]')].find((m) => /New collection/.test(m.textContent))?.click());
    await waitFor(() => collectionAt('Untitled collection'));
    await sleep(1500);
    s = await state();
    check('+ New collection inside Alpha: made there, view unchanged', s.collections.some((c) => c.startsWith('Untitled collection|')) && s.search === inAlpha, s);
    d = await disk();
    check('+ New collection inside Alpha: folder inside Alpha', d.includes('Alpha/Untitled collection/'), d);

    // ---- Renaming a nested collection renames its folder where it is ---------------------------
    await page.evaluate(() => {
      const t = [...document.querySelectorAll('[data-drop-collection]')].find((el) => el.querySelector('.ct-title-text')?.textContent === 'Untitled collection');
      t.querySelector('button[aria-label="More options"]').click();
    });
    await sleep(500);
    await page.evaluate(() => [...document.querySelectorAll('[role="menuitem"]')].find((m) => /Rename/.test(m.textContent))?.click());
    await waitFor(() => page.evaluate(() => document.activeElement?.matches('.sb-rename input')));
    await page.keyboard.down('Control');
    await page.keyboard.press('KeyA');
    await page.keyboard.up('Control');
    await page.keyboard.type('Gamma');
    await page.keyboard.press('Enter');
    await sleep(1500);
    s = await state();
    d = await disk();
    check('rename a nested collection: its folder renames inside its parent', s.collections.some((c) => c.startsWith('Gamma|')) && d.includes('Alpha/Gamma/') && !d.includes('Alpha/Untitled collection/'), { collections: s.collections, d });

    // ---- A marquee with a collection in it ----------------------------------------------------
    await page.goto(projectUrl(id), { waitUntil: 'domcontentloaded' }).catch(() => {});
    await waitFor(() => collectionAt('Alpha'));
    await settle();
    const a = await collectionAt('Alpha');
    const second = await page.evaluate(() => {
      const tiles = [...document.querySelectorAll('.gallery-tile[data-id]')];
      const t = tiles[1];
      const b = t.getBoundingClientRect();
      return { x: b.x + b.width / 2, y: b.y + b.height / 2, alt: t.querySelector('img')?.alt, bottom: b.bottom };
    });
    const startY = Math.max(a.bottom, second.bottom) + 30;
    await page.mouse.move(a.left + 20, startY);
    await page.mouse.down();
    await page.mouse.move(second.x, second.y, { steps: 16 });
    await sleep(300);
    await page.mouse.up();
    await sleep(500);
    const selected = await page.evaluate(() => ({
      collections: [...document.querySelectorAll('[data-drop-collection]')].filter((t) => getComputedStyle(t.querySelector('.z-\\[38\\]') || t).opacity === '1').map((t) => t.querySelector('.ct-title-text')?.textContent),
      ids: [...document.querySelectorAll('.gallery-tile[data-id]')].map((t) => t.dataset.id),
    }));
    check('marquee: Alpha is selected (white ring)', selected.collections.includes('Alpha'), selected);
    await page.mouse.click(second.x, second.y, { button: 'right' });
    await sleep(600);
    const menu = await page.evaluate(() => [...(document.querySelector('[role="menu"]')?.querySelectorAll('[role="menuitem"], [role="separator"]') || [])].map((m) => {
      if (m.getAttribute('role') === 'separator') return '-';
      const icon = m.querySelector('.sb-menu-item__left > :first-child');
      const label = m.querySelector('.sb-menu-item__label')?.textContent;
      return `${label}(${icon?.textContent || '?'}:${icon?.scrollWidth ?? 0}px${m.className.includes('danger') ? ',danger' : ''})`;
    }));
    check('selection menu: Flow\'s rows', menu.map((m) => m.replace(/\(.*\)/, '')).join(',') === 'New collection,New scene,Download,Copy,-,Move to trash', menu);
    check('selection menu: glyphs render as icons', menu.filter((m) => m !== '-').every((m) => /:(1[6-9]|2[0-4])px/.test(m)), menu);
    if (SHOTS) {
      await sleep(400);
      await page.screenshot({ path: path.join(SHOTS, 'willow-marquee-menu.png') });
      const clip = await page.evaluate(() => {
        const b = document.querySelector('[role="menu"]').getBoundingClientRect();
        return { x: b.x - 8, y: b.y - 8, width: b.width + 16, height: b.height + 16 };
      });
      await page.screenshot({ path: path.join(SHOTS, 'willow-marquee-menu-clip.png'), clip });
    }

    // Copy: the first image onto the clipboard.
    await page.evaluate(() => [...document.querySelectorAll('[role="menuitem"]')].find((m) => /Copy/.test(m.textContent))?.click());
    await sleep(1500);
    const clip = await page.evaluate(async () => {
      try { return (await navigator.clipboard.read()).flatMap((i) => i.types); } catch (e) { return [`error: ${e.message}`]; }
    });
    check('Copy: an image on the clipboard', clip.includes('image/png'), clip);

    // New collection from the selection.
    await page.mouse.click(second.x, second.y, { button: 'right' });
    await sleep(600);
    const row = await page.evaluate(() => {
      const b = [...document.querySelectorAll('[role="menuitem"]')].find((m) => /New collection/.test(m.textContent)).getBoundingClientRect();
      return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
    });
    await page.mouse.click(row.x, row.y);
    await sleep(700);
    const dialog = await page.evaluate(() => {
      const box = document.querySelector('.ie-confirm--icon');
      return box && {
        focusRing: document.activeElement?.matches(':focus-visible') ?? null,
        icon: box.querySelector('.ie-confirm__icon')?.textContent,
        iconWidth: box.querySelector('.ie-confirm__icon > *')?.scrollWidth ?? 0,
        message: box.querySelector('.ie-confirm__message')?.innerText,
        buttons: [...box.querySelectorAll('button')].map((b) => b.textContent.trim()),
      };
    });
    if (SHOTS) {
      await sleep(400);
      await page.screenshot({ path: path.join(SHOTS, 'willow-new-collection-confirm.png') });
    }
    const secondKind = second.alt ? 'image' : 'collection';
    check('New collection: Flow\'s confirmation', !!dialog && !dialog.focusRing && dialog.icon === 'warning' && dialog.iconWidth === 20 && dialog.message === `Do you want to create a collection with:\n1 collection\n1 ${secondKind}` && dialog.buttons.join() === 'Cancel,Create collection', dialog);
    await page.evaluate(() => [...document.querySelectorAll('.ie-confirm--icon button')].find((b) => /Create collection/.test(b.textContent))?.click());
    await sleep(2500);
    s = await state();
    check('New collection: one new collection at the top holding the selection', s.collections.length === 1 && s.collections[0].startsWith('Untitled collection|') && !s.images.includes(second.alt), s);
    d = await disk();
    check('New collection: the tree nests on disk', d.includes('Untitled collection/Alpha/Beta/') && d.includes(`Untitled collection/${second.alt}.png`) && d.includes('Untitled collection/Alpha/alpha 1.png'), d);
    await page.mouse.click((await collectionAt('Untitled collection')).x, (await collectionAt('Untitled collection')).y);
    await waitFor(() => collectionAt('Alpha'));
    await sleep(2500);
    s = await state();
    check('no reload, inside the new collection: Alpha and the image, nothing broken', s.broken.length === 0 && s.collections[0]?.startsWith('Alpha|') && s.images.join() === second.alt, s);
    await page.mouse.click((await collectionAt('Alpha')).x, (await collectionAt('Alpha')).y);
    await waitFor(() => imageAt('alpha 1'));
    await sleep(2500);
    s = await state();
    check('no reload, two levels down: Alpha\'s files show', s.broken.length === 0 && s.images.sort().join() === 'alpha 1,alpha 2,beta 1', s);
    await page.goto(projectUrl(id), { waitUntil: 'domcontentloaded' }).catch(() => {});
    await waitFor(() => collectionAt('Untitled collection'));

    // ---- Reload, then the whole tree to Trash ---------------------------------------------------
    await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
    await waitFor(() => collectionAt('Untitled collection'), 30000);
    await settle();
    s = await state();
    check('reload: the new collection is still the only one at the top', s.collections.length === 1 && s.collections[0].startsWith('Untitled collection|'), s);
    seen = await drag(await collectionAt('Untitled collection'), () => page.evaluate(() => {
      const b = document.querySelector('[data-drop-trash]').getBoundingClientRect();
      return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
    }));
    check('collection over Trash: "Move to trash"', seen.label === 'Move to trash' && seen.trashTarget, seen);
    const trashDialog = await page.evaluate(() => document.querySelector('.ie-confirm__title')?.textContent || null);
    check('collection dropped on Trash: asks first', trashDialog === 'Move collection to trash?', trashDialog);
    await page.evaluate(() => [...document.querySelectorAll('.ie-confirm button')].find((b) => /Move all contents to trash/.test(b.textContent))?.click());
    // What happens on disk and in the grid over the next seconds, change by change.
    const t0 = Date.now();
    let last = '';
    while (Date.now() - t0 < 6000) {
      const now = JSON.stringify({ disk: (await disk()).filter((p) => p.startsWith('Untitled collection')), tiles: (await state()).collections });
      if (now !== last) console.log(`  +${Date.now() - t0}ms ${now}`);
      last = now;
      await sleep(100);
    }
    const snack = await page.evaluate(() => (document.body.innerText.match(/\d+ items? moved to trash/) || [null])[0]);
    check('trash: Flow\'s snackbar counts every tile in the tree', snack === '5 items moved to trash' || snack === '4 items moved to trash', snack);
    s = await state();
    d = await disk();
    check('trash: no collections left, folder gone', s.collections.length === 0 && !d.some((p) => p.startsWith('Untitled collection')), { s, d });
  } finally {
    console.log(`errors: ${errors.length ? errors.join(' | ') : 'none'}`);
    console.log(failures ? `${failures} FAILED` : 'ALL PASSED');
    await browser.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
})().catch((e) => { console.error(e); process.exit(1); });
