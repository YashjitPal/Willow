// Reordering clips in the Scenebuilder's timeline by drag and drop, on the :3101 test origin in
// its own headless Chrome: a scene of clips of different lengths (so each is known by its width
// and its label), dragged the way a hand drags, with what is on screen sampled during the drag
// and the order checked after the drop. Moves: a clip one slot left, one two slots right, the
// last clip to the front of a timeline wider than the window (it has to scroll), a drop back
// where it started, and a drag out of the window and back. Screenshots with --shots.
//   node tools/scratch/w-scene-reorder.cjs [--shots]
const fs = require('fs');
const os = require('os');
const path = require('path');
const puppeteer = require('puppeteer-core');

const ORIGIN = 'http://localhost:3101';
const ROOT = '/@fs/C:/Users/Yashjit%202/Workspace/Willow%20Code';
const SHOTS = process.argv.includes('--shots') ? fs.mkdtempSync(path.join(os.tmpdir(), 'willow-reorder-shots-')) : null;
const DURATIONS = [3, 2, 4, 2.5, 3.5, 2, 3, 4.5];
const LABELS = 'ABCDEFGH'.split('');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (label, ok, detail) => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${detail === undefined ? '' : ` :: ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`}`);
};

(async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'willow-reorder-'));
  const browser = await puppeteer.launch({
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: true,
    userDataDir,
    defaultViewport: { width: 1536, height: 826, deviceScaleFactor: 1.25 },
    args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
    protocolTimeout: 300000,
  });
  const page = (await browser.pages())[0];
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.message || e).slice(0, 300)));
  const shot = async (name) => {
    if (!SHOTS) return;
    await page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
  };
  try {
    await page.goto(`${ORIGIN}/media`, { waitUntil: 'networkidle2', timeout: 180000 }).catch(() => {});
    await sleep(2000);
    // ---- A project with one scene of eight clips, each of its own length ----------------------
    await page.evaluate(async (root, durations, labels) => {
      const mw = await import(`${root}/features/media/src/scenes/mp4-write.ts`);
      const encode = async (hue, label, secs) => {
        const fps = 24;
        const chunks = [];
        let description = null;
        const enc = new VideoEncoder({
          output: (chunk, meta) => {
            const data = new Uint8Array(chunk.byteLength);
            chunk.copyTo(data);
            chunks.push({ data, timestamp: chunk.timestamp, duration: chunk.duration ?? Math.round(1e6 / fps), key: chunk.type === 'key' });
            if (meta?.decoderConfig?.description && !description) description = new Uint8Array(meta.decoderConfig.description);
          },
          error: () => {},
        });
        enc.configure({ codec: 'avc1.640028', width: 640, height: 360, bitrate: 800_000, framerate: fps, avc: { format: 'avc' } });
        const c = new OffscreenCanvas(640, 360);
        const g = c.getContext('2d');
        for (let i = 0; i < Math.round(secs * fps); i += 1) {
          g.fillStyle = `hsl(${hue}, 55%, ${30 + (i % 24)}%)`; g.fillRect(0, 0, 640, 360);
          g.fillStyle = '#fff'; g.font = 'bold 220px sans-serif'; g.fillText(label, 230, 260);
          const frame = new VideoFrame(c, { timestamp: Math.round((i * 1e6) / fps), duration: Math.round(1e6 / fps) });
          enc.encode(frame, { keyFrame: i % fps === 0 });
          frame.close();
        }
        await enc.flush();
        enc.close();
        const blob = mw.writeMp4({ width: 640, height: 360, description, chunks }, null);
        return new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(blob); });
      };
      const reg = await import(`${root}/platform/projects/src/registry.ts`);
      const ms = await import(`${root}/platform/storage/src/media-storage.ts`);
      const projectId = 'reorder-test';
      reg.writeProjectRegistry([...reg.readProjectRegistry().filter((p) => p.id !== projectId), { id: projectId, name: 'Reorder test', kind: 'media' }]);
      const now = Date.UTC(2026, 9, 3, 12, 0, 0);
      const urls = [];
      for (let i = 0; i < durations.length; i += 1) urls.push(await encode(i * 45, labels[i], durations[i]));
      window.__seed = {
        items: urls.map((url, i) => ({ id: `rv-${labels[i]}`, kind: 'video', status: 'completed', url, prompt: `clip ${labels[i]}`, shortenedPrompt: `Clip ${labels[i]}`, modelId: 'veo-3.1-fast', modelName: 'Veo 3.1 Fast', ratio: '16:9', timestamp: now - i * 1000 })),
        scene: {
          id: 'reorder-scene', name: 'Eight clips', createdAt: now, updatedAt: now, aspectRatio: '16:9',
          clips: urls.map((_, i) => ({ id: `rc-${labels[i]}`, mediaId: `rv-${labels[i]}`, trimStart: 0, trimEnd: durations[i], sourceDuration: durations[i] })),
        },
      };
      await ms.saveProjectMedia(projectId, window.__seed.items);
    }, ROOT, DURATIONS, LABELS);
    const seed = await page.evaluate(() => window.__seed);
    // The app may read a scope the storage default doesn't: open the project once, then seed each.
    await page.goto(`${ORIGIN}/media?projectId=reorder-test`, { waitUntil: 'domcontentloaded' }).catch(() => {});
    await sleep(8000);
    await page.evaluate(async (root, s) => {
      const ms = await import(`${root}/platform/storage/src/media-storage.ts`);
      const sc = await import(`${root}/platform/storage/src/media-scenes.ts`);
      const db = await new Promise((res, rej) => { const r = indexedDB.open('WillowMediaDB'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
      const keys = await new Promise((res) => { const tx = db.transaction('project_media', 'readonly'); const q = tx.objectStore('project_media').getAllKeys(); q.onsuccess = () => res(q.result); });
      db.close();
      const scopes = keys.map(String).filter((k) => k.endsWith(':project:reorder-test')).map((k) => decodeURIComponent(k.slice('scope:'.length, k.lastIndexOf(':project:'))));
      for (const scope of scopes) {
        if ((await ms.loadProjectMedia('reorder-test', scope)).length < s.items.length) await ms.saveProjectMedia('reorder-test', s.items, scope);
        await sc.saveScene('reorder-test', s.scene, scope);
      }
    }, ROOT, seed);
    await page.goto(`${ORIGIN}/media?projectId=reorder-test&scene=reorder-scene`, { waitUntil: 'domcontentloaded' }).catch(() => {});
    for (let i = 0; i < 160 && (await page.evaluate(() => document.querySelectorAll('.sb-tracks .sb-clip').length)) < 8; i += 1) await sleep(250);
    await sleep(4000);

    // Which clip is which: by width, each length being its own.
    const pxPerSecond = await page.evaluate(() => {
      const c = document.querySelector('.sb-tracks .sb-clip');
      return c ? c.getBoundingClientRect().width / 3 : 0;
    });
    const labelOfWidth = (w) => {
      let best = '?';
      let err = Infinity;
      DURATIONS.forEach((d, i) => { const e = Math.abs(d * pxPerSecond - w); if (e < err && !(best !== '?' && e === err)) { err = e; best = LABELS[i]; } });
      return err < 3 ? best : '?';
    };
    // Two clips are 2s long and two 3s... so widths name a clip only up to its length; the stored
    // order says which is which.
    const storedOrder = () => page.evaluate(async (root) => {
      const sc = await import(`${root}/platform/storage/src/media-scenes.ts`);
      const db = await new Promise((res, rej) => { const r = indexedDB.open('WillowMediaScenesDB'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
      const keys = await new Promise((res) => { const tx = db.transaction('scenes', 'readonly'); const q = tx.objectStore('scenes').getAllKeys(); q.onsuccess = () => res(q.result); });
      db.close();
      const key = keys.map(String).find((k) => k.endsWith(':scene:reorder-scene'));
      const scope = decodeURIComponent(key.slice('scope:'.length, key.indexOf(':project:')));
      const scene = (await sc.listScenes('reorder-test', scope)).find((s) => s.id === 'reorder-scene');
      return scene.clips.map((c) => c.id.slice(3)).join('');
    }, ROOT);
    const layout = () => page.evaluate(() => {
      const area = document.querySelector('.sb-timeline__area');
      const clips = [...document.querySelectorAll('.sb-tracks .sb-clip')].map((el) => {
        const r = el.getBoundingClientRect();
        return { x: Math.round(r.left), w: Math.round(r.width), cls: el.className.replace('sb-clip', '').trim(), transform: el.style.transform || '' };
      });
      const preview = document.querySelector('.sb-clip-preview');
      const pr = preview?.getBoundingClientRect();
      let seen = null;
      if (preview && pr) {
        const cs = getComputedStyle(preview);
        const atCenter = document.elementsFromPoint(Math.max(1, pr.left + pr.width / 2), pr.top + pr.height / 2).slice(0, 3).map((e) => `${e.tagName.toLowerCase()}.${String(e.className).split(' ').slice(0, 2).join('.')}`);
        seen = { opacity: cs.opacity, visibility: cs.visibility, display: cs.display, z: cs.zIndex, bg: cs.backgroundColor, imgs: preview.querySelectorAll('img').length, loaded: [...preview.querySelectorAll('img')].filter((i) => i.complete && i.naturalWidth).length, atCenter, parent: preview.parentElement?.tagName };
      }
      return {
        clips,
        preview: pr ? { x: Math.round(pr.left), y: Math.round(pr.top), w: Math.round(pr.width), h: Math.round(pr.height), seen } : null,
        scroll: area ? Math.round(area.scrollLeft) : 0,
        areaWidth: area ? Math.round(area.clientWidth) : 0,
        areaLeft: area ? Math.round(area.getBoundingClientRect().left) : 0,
      };
    });
    const visualOrder = (l) => [...l.clips].sort((a, b) => a.x - b.x).map((c) => (c.cls.includes('is-placeholder') ? '_' : labelOfWidth(c.w))).join('');
    const clipCenter = async (index) => {
      const l = await layout();
      const sorted = l.clips;
      const c = sorted[index];
      const y = await page.evaluate(() => { const r = document.querySelector('.sb-tracks .sb-clip').getBoundingClientRect(); return r.top + r.height / 2; });
      return { x: c.x + c.w / 2, y, w: c.w, left: c.x };
    };

    console.log(`timeline: ${pxPerSecond.toFixed(1)}px a second; stored order ${await storedOrder()}; on screen ${visualOrder(await layout())}`);
    await shot('00-start');

    /** Press on a clip, move in steps to `toX` (a hand's pace), sample midway and at the end, release. */
    const drag = async (from, toX, opts = {}) => {
      const steps = opts.steps ?? 24;
      await page.mouse.move(from.x, from.y);
      await page.mouse.down();
      const samples = [];
      for (let i = 1; i <= steps; i += 1) {
        const x = from.x + ((toX - from.x) * i) / steps;
        await page.mouse.move(x, from.y + Math.min(i, 4) * 2);
        await sleep(opts.pace ?? 30);
        if (i === Math.round(steps / 2) || i === steps) {
          samples.push({ at: i, x: Math.round(x), ...(await layout()) });
          if (i === Math.round(steps / 2)) await shot(`${opts.name || 'drag'}-mid`);
        }
      }
      if (opts.hold) { await sleep(opts.hold); samples.push({ at: 'held', ...(await layout()) }); }
      await shot(`${opts.name || 'drag'}-before-release`);
      await page.mouse.up();
      await sleep(80);
      const dropping = await layout();
      await sleep(700);
      const after = await layout();
      await shot(`${opts.name || 'drag'}-after`);
      return { samples, dropping, after };
    };

    // ---- 1. The second clip one slot left -----------------------------------------------------
    let start = await storedOrder();
    let c1 = await clipCenter(0);
    let c2 = await clipCenter(1);
    let r = await drag(c2, c1.left + 20, { name: '1-left' });
    console.log('  mid:', visualOrder(r.samples[0]), 'preview', JSON.stringify(r.samples[0].preview), 'end:', visualOrder(r.samples[1]));
    // (elementsFromPoint skips a pointer-events: none preview, so whether it is on top is for the shots.)
    check('1. the preview can be seen: visible, opaque enough, with its pictures', !!r.samples[0].preview?.seen && r.samples[0].preview.seen.visibility === 'visible' && r.samples[0].preview.seen.loaded > 0 && Number(r.samples[0].preview.seen.opacity) > 0.5, r.samples[0].preview?.seen);
    check('1. ...and above the editor, not under it', r.samples[0].preview?.seen?.z === '1002', r.samples[0].preview?.seen?.z);
    check('1. clip 2 dragged over clip 1: the preview follows the pointer', !!r.samples[1].preview && Math.abs(r.samples[1].preview.x + (c2.x - c2.left) - r.samples[1].x) < 4, { preview: r.samples[1].preview, pointer: r.samples[1].x });
    check('1. ...and the placeholder sits in the first slot, the first clip moved over', visualOrder(r.samples[1]).startsWith('_'), visualOrder(r.samples[1]));
    let now = await storedOrder();
    check('1. dropped: the order is BACDEFGH', now === `${start[1]}${start[0]}${start.slice(2)}`, { before: start, after: now, screen: visualOrder(r.after) });
    check('1. after the drop nothing is left shifted or lifted', r.after.clips.every((c) => !c.transform) && !r.after.preview, r.after.clips.map((c) => c.transform));

    // ---- 2. The first clip two slots right ----------------------------------------------------
    start = await storedOrder();
    const a = await clipCenter(0);
    const third = await clipCenter(2);
    r = await drag(a, third.left + third.w * 0.75, { name: '2-right' });
    now = await storedOrder();
    check('2. the first clip dropped past the next two: it is third', now === `${start[1]}${start[2]}${start[0]}${start.slice(3)}`, { before: start, after: now, mid: visualOrder(r.samples[0]), end: visualOrder(r.samples[1]) });

    // ---- 3. The last clip to the front: the timeline is wider than the window -----------------
    start = await storedOrder();
    const l0 = await layout();
    console.log(`  timeline: ${l0.clips.reduce((s, c) => s + c.w, 0)}px of clips in a ${l0.areaWidth}px area`);
    await page.evaluate(() => { const area = document.querySelector('.sb-timeline__area'); area.scrollLeft = area.scrollWidth; });
    await sleep(400);
    const last = await clipCenter(7);
    r = await drag(last, l0.areaLeft + 30, { name: '3-to-front', steps: 30, hold: 4000 });
    now = await storedOrder();
    check('3. the last clip, held at the timeline\'s left edge, scrolls it and lands first', now === `${start[7]}${start.slice(0, 7)}`, { before: start, after: now, scrollDuring: r.samples.map((s) => s.scroll), held: r.samples.at(-1) && visualOrder(r.samples.at(-1)) });

    // ---- 4. Dropped back where it started --------------------------------------------------------
    await page.evaluate(() => { document.querySelector('.sb-timeline__area').scrollLeft = 0; });
    await sleep(300);
    start = await storedOrder();
    const b = await clipCenter(1);
    r = await drag(b, b.x + 60, { name: '4-same', steps: 8 });
    now = await storedOrder();
    check('4. moved a little and dropped in its own slot: nothing changes', now === start, { before: start, after: now });
    const selected = await page.evaluate(() => [...document.querySelectorAll('.sb-tracks .sb-clip')].findIndex((c) => c.classList.contains('is-selected')));
    await page.mouse.click((await clipCenter(3)).x, (await clipCenter(3)).y);
    await sleep(300);
    const selectedAfter = await page.evaluate(() => [...document.querySelectorAll('.sb-tracks .sb-clip')].findIndex((c) => c.classList.contains('is-selected')));
    check('4. ...and a click after it still selects a clip', selectedAfter === 3, { selected, selectedAfter });

    // ---- 5. Out of the window and back: the drag carries on ----------------------------------------
    start = await storedOrder();
    const d = await clipCenter(2);
    await page.mouse.move(d.x, d.y);
    await page.mouse.down();
    for (let i = 1; i <= 10; i += 1) { await page.mouse.move(d.x, d.y - i * 60); await sleep(30); }
    const offWindow = await layout();
    for (let i = 1; i <= 10; i += 1) { await page.mouse.move(d.x - i * 12, d.y - 600 + i * 60); await sleep(30); }
    await page.mouse.up();
    await sleep(800);
    const back = await layout();
    check('5. a drag that leaves the timeline keeps its preview, and the drop puts things straight', !!offWindow.preview && back.clips.every((c) => !c.transform) && !back.preview, { offWindow: offWindow.preview, after: visualOrder(back), order: await storedOrder() });

    // ---- 6. A narrow clip dragged slowly across a wide one: one swap, no trading back and forth --
    await page.evaluate(() => { document.querySelector('.sb-timeline__area').scrollLeft = 0; });
    await sleep(300);
    const l6 = await layout();
    const pair = l6.clips.findIndex((c, i) => i + 1 < l6.clips.length && l6.clips[i + 1].w > c.w * 1.25 && l6.clips[i + 1].x + l6.clips[i + 1].w < l6.areaLeft + l6.areaWidth);
    if (pair < 0) {
      check('6. found a narrow clip before a wide one', false, l6.clips.map((c) => c.w));
    } else {
      start = await storedOrder();
      const narrow = await clipCenter(pair);
      const wide = l6.clips[pair + 1];
      await page.mouse.move(narrow.x, narrow.y);
      await page.mouse.down();
      const slots = [];
      const endX = wide.x + wide.w * 0.85;
      for (let i = 1; i <= 40; i += 1) {
        await page.mouse.move(narrow.x + ((endX - narrow.x) * i) / 40, narrow.y + 4);
        await sleep(25);
        slots.push(await page.evaluate(() => [...document.querySelectorAll('.sb-tracks .sb-clip')].sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left).findIndex((c) => c.classList.contains('is-placeholder'))));
      }
      const changes = slots.filter((s, i) => i > 0 && s !== slots[i - 1]).length;
      check('6. dragged right across a wide clip: its slot changes once, and stays', changes === 1 && slots.at(-1) === pair + 1, { slots: slots.join('') });
      // Back the other way, onto the wide clip where it stands now (from the narrow one's old
      // left edge): it trades back.
      for (let i = 1; i <= 20; i += 1) { await page.mouse.move(endX + ((narrow.x - endX) * i) / 20, narrow.y + 4); await sleep(25); }
      const backSlot = await page.evaluate(() => [...document.querySelectorAll('.sb-tracks .sb-clip')].sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left).findIndex((c) => c.classList.contains('is-placeholder')));
      check('6. ...and turned back over it, it trades back', backSlot === pair, backSlot);
      await page.mouse.up();
      await sleep(700);
      check('6. dropped there: the order is as it was', (await storedOrder()) === start, { before: start, after: await storedOrder() });
    }

    // ---- 7. The video view (a gallery video opened in the editor): the same timeline -----------
    const until = async (fn, ms = 20000) => { const end = Date.now() + ms; for (;;) { const v = await fn().catch(() => null); if (v) return v; if (Date.now() > end) return null; await sleep(250); } };
    await page.goto(`${ORIGIN}/media?projectId=reorder-test`, { waitUntil: 'domcontentloaded' }).catch(() => {});
    const tile = await until(() => page.evaluate(() => { const t = document.querySelector('.gallery-tile[data-id="rv-A"]'); if (!t) return null; const r = t.getBoundingClientRect(); return r.width ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null; }), 40000);
    if (tile) {
      // As a hand does: onto the tile first (its hover state), then the click.
      await sleep(2500);
      await page.mouse.move(tile.x, tile.y, { steps: 5 });
      await sleep(400);
      await page.mouse.click(tile.x, tile.y);
    }
    const opened = await until(() => page.evaluate(() => document.querySelectorAll('.sb-editor .sb-tracks .sb-clip').length === 1), 30000);
    const where = await page.evaluate(() => ({ url: location.search, editors: document.querySelectorAll('.sb-editor').length, clips: document.querySelectorAll('.sb-tracks .sb-clip').length, tiles: document.querySelectorAll('.gallery-tile').length, ids: [...document.querySelectorAll('.gallery-tile[data-id]')].map((t) => t.getAttribute('data-id')).slice(0, 10) }));
    if (!opened) {
      if (SHOTS) await page.screenshot({ path: path.join(SHOTS, '7-open-failed.png') });
      else await page.screenshot({ path: path.join(os.tmpdir(), 'reorder-7-open-failed.png') });
    }
    check('7. a gallery video opens in the editor with its one clip', !!opened, { tile, ...where });
    await sleep(1500);
    await page.evaluate(() => document.querySelector('.sb-tracks .sb-add-clip__btn')?.click());
    await sleep(500);
    await page.evaluate(() => [...document.querySelectorAll('[role="menuitem"]')].find((m) => /Add clip$/.test(m.textContent.trim()))?.click());
    const asset = await until(() => page.evaluate(() => { const a = [...document.querySelectorAll('.sb-picker .sb-asset')].find((b) => b.querySelector('.sb-asset__title')?.textContent === 'Clip D'); if (!a) return null; const r = a.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }), 20000);
    if (asset) {
      await page.mouse.click(asset.x, asset.y);
      await sleep(1200);
      await page.evaluate(() => [...document.querySelectorAll('.sb-picker button')].find((b) => b.textContent.trim() === 'Add media')?.click());
    }
    const two = await until(() => page.evaluate(() => document.querySelectorAll('.sb-tracks .sb-clip').length === 2), 20000);
    const pickerState = await page.evaluate(() => ({
      addButtons: document.querySelectorAll('.sb-add-clip__btn').length,
      menuItems: [...document.querySelectorAll('[role="menuitem"]')].map((m) => m.textContent.trim()).slice(0, 8),
      picker: !!document.querySelector('.sb-picker'),
      tabs: [...document.querySelectorAll('.sb-picker [role="tab"]')].map((t) => `${t.textContent.trim()}${t.getAttribute('aria-selected') === 'true' ? '*' : ''}`),
      assets: [...document.querySelectorAll('.sb-picker .sb-asset__title')].map((t) => t.textContent).slice(0, 10),
      clips: document.querySelectorAll('.sb-tracks .sb-clip').length,
    }));
    if (!two) await page.screenshot({ path: path.join(SHOTS || os.tmpdir(), 'reorder-7-add-failed.png') });
    check('7. ...and takes a second clip from the picker', !!two, { asset, ...pickerState });
    if (two) {
      await sleep(1500);
      const widths = () => page.evaluate(() => [...document.querySelectorAll('.sb-tracks .sb-clip')].map((c) => Math.round(c.getBoundingClientRect().width)));
      const before7 = await widths();
      const v1 = await clipCenter(0);
      const v2 = await clipCenter(1);
      r = await drag(v2, v1.left + 20, { name: '7-video-view' });
      const after7 = await widths();
      check('7. in the video view the second clip drags in front of the first', !!r.samples[0].preview?.seen && r.samples[0].preview.seen.z === '1002' && JSON.stringify(after7) === JSON.stringify([before7[1], before7[0]]), { before: before7, after: after7, preview: r.samples[0].preview?.seen?.z });
    }

    console.log('errors', JSON.stringify(errors.slice(0, 5)));
    if (SHOTS) console.log('shots in', SHOTS);
  } finally {
    console.log(failures ? `${failures} FAILED` : 'all passed');
    await browser.close();
    try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch { /* still locked */ }
  }
})().catch((e) => { console.error(e); process.exit(1); });
