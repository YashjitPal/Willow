// Scenes in the project folder (Media/<project>/Scenes/<name>.json: pointers to the videos by
// place, no copies) on the :3101 test origin, own headless Chrome, OPFS standing in for the
// connected folder: Media/Scene Sync/ with Videos/Cat running.mp4, Videos/Wave.mp4 and a Trips
// collection holding Sunset.mp4.
// Walks: a scene saved in the browser gets its file; renaming the scene renames the file;
// renaming a video in Willow, and the collection holding one, re-points the clips; a fresh
// browser (every Willow database wiped, the folder kept) gets the scene back, its clips on the
// videos' new ids and its tile's poster drawn; a video deleted from the folder leaves its clip
// missing (marked, black, played through) and the file keeps it; put back, the clip plays again.
//   node tools/scratch/w-scene-folder.cjs [--shots]   (--shots: the editor with the missing clip, in %TEMP%)
const fs = require('fs');
const os = require('os');
const path = require('path');
const puppeteer = require('puppeteer-core');

const ORIGIN = 'http://localhost:3101';
const ROOT = '/@fs/C:/Users/Yashjit%202/Workspace/Willow%20Code';
const PROJECT = 'Scene Sync';
const SCENE_ID = 'scene-sync-1';
const SHOTS = process.argv.includes('--shots') && os.tmpdir();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (label, ok, detail) => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${detail === undefined ? '' : ` :: ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`}`);
};

(async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'willow-scene-folder-'));
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
  const waitFor = async (fn, ms = 20000) => {
    const end = Date.now() + ms;
    for (;;) {
      const v = await fn().catch(() => null);
      if (v) return v;
      if (Date.now() > end) return null;
      await sleep(300);
    }
  };
  const disk = () => page.evaluate(async (project) => {
    const root = await navigator.storage.getDirectory();
    const proj = await (await (await root.getDirectoryHandle('willow-test-root')).getDirectoryHandle('Media')).getDirectoryHandle(project);
    const out = [];
    const walk = async (dir, prefix) => {
      for await (const e of dir.values()) {
        if (e.name.startsWith('.')) continue;
        const p = prefix ? `${prefix}/${e.name}` : e.name;
        if (e.kind === 'directory') await walk(e, p);
        else out.push(p);
      }
    };
    await walk(proj, '');
    return out.sort();
  }, PROJECT);
  const sceneFiles = () => page.evaluate(async (project) => {
    const root = await navigator.storage.getDirectory();
    const proj = await (await (await root.getDirectoryHandle('willow-test-root')).getDirectoryHandle('Media')).getDirectoryHandle(project);
    const dir = await proj.getDirectoryHandle('Scenes');
    const out = {};
    for await (const e of dir.values()) if (e.kind === 'file') out[e.name] = await (await e.getFile()).text();
    return out;
  }, PROJECT);
  const sceneFile = async (name) => {
    const f = await sceneFiles().catch(() => ({}));
    return f[name] ? JSON.parse(f[name]) : null;
  };
  /** The scene and the gallery as the browser has them, from IndexedDB, in every scope that holds the project. */
  const stored = (projectId) => page.evaluate(async (root, id, sceneId) => {
    const ms = await import(`${root}/platform/storage/src/media-storage.ts`);
    const sc = await import(`${root}/platform/storage/src/media-scenes.ts`);
    const db = await new Promise((res, rej) => { const r = indexedDB.open('WillowMediaDB'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    const keys = await new Promise((res) => { const tx = db.transaction('project_media', 'readonly'); const q = tx.objectStore('project_media').getAllKeys(); q.onsuccess = () => res(q.result); });
    db.close();
    const scopes = keys.map(String).filter((k) => k.endsWith(`:project:${id}`)).map((k) => decodeURIComponent(k.slice('scope:'.length, k.lastIndexOf(':project:'))));
    const out = [];
    for (const scope of scopes) {
      const media = (await ms.loadProjectMedia(id, scope)).map((m) => ({ id: m.id, fsName: m.fsName, collectionId: m.collectionId }));
      const scene = (await sc.listScenes(id, scope)).find((s) => s.id === sceneId) ?? null;
      out.push({ scope, media, scene: scene && { name: scene.name, fsName: scene.fsName, poster: !!scene.poster, clips: scene.clips.map((c) => ({ mediaId: c.mediaId, file: c.file, thumb: !!c.thumb })) } });
    }
    return out;
  }, ROOT, projectId, SCENE_ID);
  const menu = async (tileSelector, item) => {
    await page.evaluate((sel) => document.querySelector(sel)?.querySelector('button[aria-label="More options"]')?.click(), tileSelector);
    await sleep(500);
    await page.evaluate((label) => [...document.querySelectorAll('[role="menuitem"]')].find((m) => m.textContent.includes(label))?.click(), item);
  };
  const typeName = async (name) => {
    await waitFor(() => page.evaluate(() => document.activeElement?.tagName === 'INPUT'), 5000);
    await page.keyboard.down('Control');
    await page.keyboard.press('KeyA');
    await page.keyboard.up('Control');
    await page.keyboard.type(name);
    await page.keyboard.press('Enter');
  };

  try {
    // ---- The folder: three videos, one of them in a collection -----------------------------
    await page.goto(`${ORIGIN}/media`, { waitUntil: 'networkidle2', timeout: 180000 }).catch(() => {});
    await page.evaluate(async (root, project) => {
      const mw = await import(`${root}/features/media/src/scenes/mp4-write.ts`);
      const encode = async (hue, label) => {
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
        enc.configure({ codec: 'avc1.640028', width: 640, height: 360, bitrate: 1_000_000, framerate: fps, avc: { format: 'avc' } });
        const c = new OffscreenCanvas(640, 360);
        const g = c.getContext('2d');
        for (let i = 0; i < fps * 2; i += 1) {
          g.fillStyle = `hsl(${(hue + i * 3) % 360}, 50%, 35%)`; g.fillRect(0, 0, 640, 360);
          g.fillStyle = '#fff'; g.font = 'bold 72px sans-serif'; g.fillText(`${label} ${i}`, 40, 200);
          const frame = new VideoFrame(c, { timestamp: Math.round((i * 1e6) / fps), duration: Math.round(1e6 / fps) });
          enc.encode(frame, { keyFrame: i % fps === 0 });
          frame.close();
        }
        await enc.flush();
        enc.close();
        return mw.writeMp4({ width: 640, height: 360, description, chunks }, null);
      };
      const opfs = await navigator.storage.getDirectory();
      const base = await opfs.getDirectoryHandle('willow-test-root', { create: true });
      const proj = await (await base.getDirectoryHandle('Media', { create: true })).getDirectoryHandle(project, { create: true });
      const put = async (folder, name, blob) => {
        const dir = await proj.getDirectoryHandle(folder, { create: true });
        const w = await (await dir.getFileHandle(name, { create: true })).createWritable();
        await w.write(blob);
        await w.close();
      };
      await put('Videos', 'Cat running.mp4', await encode(20, 'CAT'));
      await put('Videos', 'Wave.mp4', await encode(200, 'WAVE'));
      await put('Trips', 'Sunset.mp4', await encode(30, 'SUNSET'));
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
    }, ROOT, PROJECT);
    await page.goto(`${ORIGIN}/media`, { waitUntil: 'networkidle2' }).catch(() => {});
    const id = await waitFor(() => page.evaluate(async (project) => {
      const root = await navigator.storage.getDirectory();
      const proj = await (await (await root.getDirectoryHandle('willow-test-root')).getDirectoryHandle('Media')).getDirectoryHandle(project);
      return JSON.parse(await (await (await proj.getFileHandle('.willow.json')).getFile()).text()).id;
    }, PROJECT), 30000);
    if (!id) throw new Error('project never registered');
    const projectUrl = (extra = '') => `${ORIGIN}/media?projectId=${encodeURIComponent(id)}${extra}`;
    await page.goto(projectUrl(), { waitUntil: 'domcontentloaded' }).catch(() => {});
    await waitFor(() => page.evaluate(() => document.querySelectorAll('.gallery-tile[data-id^="disk_video_"]').length >= 2 && !!document.querySelector('[data-drop-collection]')), 40000);
    await sleep(2500);

    // ---- A scene made in the browser gets its file ------------------------------------------
    const before = await stored(id);
    const holding = before.filter((s) => s.media.length >= 3);
    const idOf = (fsName) => holding[0]?.media.find((m) => m.fsName === fsName)?.id;
    check('seeded: the gallery has the three videos', holding.length > 0 && ['Cat running.mp4', 'Wave.mp4', 'Sunset.mp4'].every(idOf), before.map((s) => ({ scope: s.scope, media: s.media.length })));
    await page.evaluate(async (root, projectId, scopes, clips, sceneId) => {
      const sc = await import(`${root}/platform/storage/src/media-scenes.ts`);
      const now = Date.now();
      for (const scope of scopes) await sc.saveScene(projectId, { id: sceneId, name: 'Three clips', createdAt: now, updatedAt: now, aspectRatio: '16:9', clips }, scope);
    }, ROOT, id, holding.map((s) => s.scope), [
      { id: 'k1', mediaId: idOf('Cat running.mp4'), trimStart: 0, trimEnd: 2, sourceDuration: 2 },
      { id: 'k2', mediaId: idOf('Wave.mp4'), trimStart: 0.5, trimEnd: 2, sourceDuration: 2 },
      { id: 'k3', mediaId: idOf('Sunset.mp4'), trimStart: 0, trimEnd: 2, sourceDuration: 2 },
    ], SCENE_ID);
    await page.goto(projectUrl(), { waitUntil: 'domcontentloaded' }).catch(() => {});
    let file = await waitFor(() => sceneFile('Three clips.json'), 30000);
    check('a scene saved in the browser gets its file in Scenes/', !!file, await sceneFiles().then(Object.keys).catch(() => 'no Scenes/'));
    const text = (await sceneFiles().catch(() => ({})))['Three clips.json'] || '';
    check('its clips point at the videos by place', JSON.stringify(file?.clips.map((c) => c.file)) === JSON.stringify(['Videos/Cat running.mp4', 'Videos/Wave.mp4', 'Trips/Sunset.mp4']), file?.clips.map((c) => c.file));
    check('a pointer, not a copy: under 2KB, no pictures', text.length > 0 && text.length < 2048 && !/data:/.test(text), text.length);
    check('trims are in it', file?.clips[1]?.trimStart === 0.5 && file?.clips[1]?.trimEnd === 2, file?.clips[1]);

    // ---- Renaming the scene renames its file -------------------------------------------------
    await waitFor(() => page.$('.sb-scene-tile-host'));
    await menu('.sb-scene-tile-host', 'Rename');
    await typeName('Beach day');
    file = await waitFor(async () => {
      const f = await sceneFiles();
      return f['Beach day.json'] && !f['Three clips.json'] ? JSON.parse(f['Beach day.json']) : null;
    }, 15000);
    check('renaming the scene renames its file', !!file && file.name === 'Beach day', await sceneFiles().then(Object.keys).catch(() => null));

    // ---- A video renamed in Willow: its clip follows -----------------------------------------
    const waveTile = `.gallery-tile[data-id="${idOf('Wave.mp4')}"]`;
    await page.hover(waveTile).catch(() => {});
    await menu(waveTile, 'Rename');
    await typeName('Big wave');
    const renamed = await waitFor(async () => ((await disk()).includes('Videos/Big wave.mp4') ? true : null), 15000);
    file = await waitFor(async () => {
      const f = await sceneFile('Beach day.json');
      return f?.clips[1]?.file === 'Videos/Big wave.mp4' ? f : null;
    }, 15000);
    check('a video renamed in Willow: its file renames and the clip points at the new name', !!renamed && !!file, { disk: await disk(), clips: (await sceneFile('Beach day.json'))?.clips.map((c) => c.file) });

    // ---- The collection holding a video renamed: its clip follows the folder ------------------
    await page.mouse.move(1530, 820);
    const tripsTile = await page.evaluate(() => {
      const t = [...document.querySelectorAll('[data-drop-collection]')].find((el) => el.querySelector('.ct-title-text')?.textContent === 'Trips');
      if (!t) return null;
      t.setAttribute('data-test-trips', '1');
      return true;
    });
    if (tripsTile) {
      await menu('[data-test-trips]', 'Rename');
      await waitFor(() => page.evaluate(() => document.activeElement?.matches('.sb-rename input')), 5000);
      await typeName('Travel');
    }
    file = await waitFor(async () => {
      const f = await sceneFile('Beach day.json');
      return f?.clips[2]?.file === 'Travel/Sunset.mp4' ? f : null;
    }, 20000);
    check('the collection renamed: its folder moves and the clip points into it', !!tripsTile && !!file && (await disk()).includes('Travel/Sunset.mp4'), { disk: await disk(), clips: (await sceneFile('Beach day.json'))?.clips.map((c) => c.file) });

    // ---- A fresh browser: every Willow database gone, the folder kept --------------------------
    await page.goto(`${ORIGIN}/__no_app__.txt`).catch(() => {});
    await page.evaluate(async () => {
      for (const name of ['WillowMediaDB', 'WillowMediaScenesDB', 'WillowMediaCollectionsDB', 'WillowMediaAgentDB', 'WillowMediaCharactersDB', 'WillowDB']) {
        await new Promise((r) => { const q = indexedDB.deleteDatabase(name); q.onsuccess = q.onerror = q.onblocked = () => r(); });
      }
      localStorage.clear();
      sessionStorage.clear();
    });
    await page.goto(`${ORIGIN}/media`, { waitUntil: 'networkidle2' }).catch(() => {});
    await sleep(3000);
    await page.goto(projectUrl(), { waitUntil: 'domcontentloaded' }).catch(() => {});
    const back = await waitFor(() => page.evaluate(() => [...document.querySelectorAll('.sb-scene-tile-host')].some((t) => t.getAttribute('aria-label') === 'Beach day')), 40000);
    check('a fresh browser gets the scene back from its file', !!back, await page.evaluate(() => [...document.querySelectorAll('.sb-scene-tile-host')].map((t) => t.getAttribute('aria-label'))));
    const after = await waitFor(async () => {
      const s = (await stored(id)).find((x) => x.scene && x.media.length >= 3);
      if (!s) return null;
      const places = s.scene.clips.map((c) => s.media.find((m) => m.id === c.mediaId)?.fsName);
      return places.every(Boolean) ? { s, places } : null;
    }, 20000);
    check('its clips play the videos at their places, under the gallery\'s new ids', JSON.stringify(after?.places) === JSON.stringify(['Cat running.mp4', 'Big wave.mp4', 'Sunset.mp4']) && after.s.scene.clips.every((c) => c.mediaId.startsWith('disk_video_')), after && { places: after.places, ids: after.s.scene.clips.map((c) => c.mediaId) });
    const poster = await waitFor(() => page.evaluate(() => !!document.querySelector('.sb-scene-tile-host .sb-scene-tile__poster')), 20000);
    check('its tile gets a poster drawn from the first clip, and the clips thumbnails', !!poster && (await waitFor(async () => (await stored(id)).find((x) => x.scene)?.scene.clips.every((c) => c.thumb), 15000)));

    // ---- A video deleted from the folder: its clip goes missing, the rest plays ---------------
    await page.evaluate(async (project) => {
      const root = await navigator.storage.getDirectory();
      const proj = await (await (await root.getDirectoryHandle('willow-test-root')).getDirectoryHandle('Media')).getDirectoryHandle(project);
      const videos = await proj.getDirectoryHandle('Videos');
      const blob = await (await (await videos.getFileHandle('Cat running.mp4')).getFile()).arrayBuffer();
      const stash = await root.getDirectoryHandle('willow-test-stash', { create: true });
      const w = await (await stash.getFileHandle('cat.mp4', { create: true })).createWritable();
      await w.write(blob);
      await w.close();
      await videos.removeEntry('Cat running.mp4');
    }, PROJECT);
    await page.goto(projectUrl(`&scene=${SCENE_ID}`), { waitUntil: 'domcontentloaded' }).catch(() => {});
    await waitFor(() => page.$('button[aria-label="Play"]'), 40000);
    const marked = await waitFor(() => page.evaluate(() => (document.querySelectorAll('.sb-clip-missing').length === 1 && document.querySelectorAll('.sb-clip').length === 3 && !!document.querySelector('.sb-canvas-missing') ? document.querySelector('.sb-canvas-missing').textContent : null)), 20000);
    check('a video deleted from the folder: its clip is marked missing, the scene keeps all three', !!marked, marked ?? await page.evaluate(() => ({ missing: document.querySelectorAll('.sb-clip-missing').length, clips: document.querySelectorAll('.sb-clip').length })));
    check('the canvas says which file it was', /Video not found/.test(marked || '') && /Videos\/Cat running\.mp4/.test(marked || ''), marked);
    if (SHOTS) {
      await sleep(1500);
      await page.screenshot({ path: path.join(SHOTS, 'scene-missing-clip.png') });
      console.log('shot', path.join(SHOTS, 'scene-missing-clip.png'));
    }
    await sleep(1500);
    await page.click('button[aria-label="Play"]');
    await sleep(3200);
    const timecode = await page.evaluate(() => (document.querySelector('.sb-timecode')?.textContent || '').replace('Current time:', ''));
    const [mm, ss, ff] = timecode.split(':').map(Number);
    const seconds = mm * 60 + ss + ff / 24;
    check('playback runs through the gap and on into the next clips', seconds > 2.4, timecode);
    file = await sceneFile('Beach day.json');
    check('the file keeps the missing clip and its place', file?.clips.length === 3 && file.clips[0].file === 'Videos/Cat running.mp4', file?.clips.map((c) => c.file));

    // ---- Put back, the clip plays again --------------------------------------------------------
    await page.evaluate(async (project) => {
      const root = await navigator.storage.getDirectory();
      const proj = await (await (await root.getDirectoryHandle('willow-test-root')).getDirectoryHandle('Media')).getDirectoryHandle(project);
      const blob = await (await (await (await root.getDirectoryHandle('willow-test-stash')).getFileHandle('cat.mp4')).getFile()).arrayBuffer();
      const w = await (await (await proj.getDirectoryHandle('Videos')).getFileHandle('Cat running.mp4', { create: true })).createWritable();
      await w.write(blob);
      await w.close();
    }, PROJECT);
    await page.goto(projectUrl(`&scene=${SCENE_ID}`), { waitUntil: 'domcontentloaded' }).catch(() => {});
    await waitFor(() => page.$('button[aria-label="Play"]'), 40000);
    const relinked = await waitFor(() => page.evaluate(() => (document.querySelectorAll('.sb-clip').length === 3 && document.querySelectorAll('.sb-clip-missing').length === 0 && !document.querySelector('.sb-canvas-missing') ? true : null)), 20000);
    check('the file put back: the clip finds it again', !!relinked, await page.evaluate(() => ({ missing: document.querySelectorAll('.sb-clip-missing').length, clips: document.querySelectorAll('.sb-clip').length })));
    console.log('Scenes/ at the end:', JSON.stringify(await sceneFiles().then(Object.keys).catch(() => null)));
    console.log('errors', JSON.stringify(errors.slice(0, 5)));
  } finally {
    console.log(`${failures ? `${failures} FAILED` : 'all passed'}`);
    await browser.close();
    try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch { /* still locked */ }
  }
})().catch((e) => { console.error(e); process.exit(1); });
