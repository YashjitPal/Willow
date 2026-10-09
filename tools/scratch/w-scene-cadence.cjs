// How evenly Willow's Scenebuilder puts a playing scene's frames on its canvas: the gaps between
// new pictures on .sb-canvas during playback of a 10-clip scene of 24fps H.264 clips (encoded
// here frame by frame, every frame different, like Veo's MP4s). Then the same with the clip
// videos taken out of the page, the player's old way, for comparison. On the :3101 origin in
// its own headless Chrome.
//   node tools/scratch/w-scene-cadence.cjs [seconds=6]
const fs = require('fs');
const os = require('os');
const path = require('path');
const puppeteer = require('puppeteer-core');

const ORIGIN = 'http://localhost:3101';
const ROOT = '/@fs/C:/Users/Yashjit%202/Workspace/Willow%20Code';
const SECONDS = Number(process.argv[2] || 6);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'willow-scene-cadence-'));
  const browser = await puppeteer.launch({
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: true,
    userDataDir,
    defaultViewport: { width: 1536, height: 826, deviceScaleFactor: 1.25 },
    args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
    protocolTimeout: 600000,
  });
  const page = (await browser.pages())[0];
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.message || e).slice(0, 200)));
  try {
    await page.goto(`${ORIGIN}/media`, { waitUntil: 'networkidle2', timeout: 180000 }).catch(() => {});
    await sleep(2000);
    const seeded = await page.evaluate(async (root) => {
      const mw = await import(`${root}/features/media/src/scenes/mp4-write.ts`);
      const encode = async (hue, secs, fps, w, h) => {
        const chunks = [];
        let description = null;
        let failure = null;
        const enc = new VideoEncoder({
          output: (chunk, meta) => {
            const data = new Uint8Array(chunk.byteLength);
            chunk.copyTo(data);
            chunks.push({ data, timestamp: chunk.timestamp, duration: chunk.duration ?? Math.round(1e6 / fps), key: chunk.type === 'key' });
            if (meta?.decoderConfig?.description && !description) description = new Uint8Array(meta.decoderConfig.description);
          },
          error: (e) => { failure = e; },
        });
        enc.configure({ codec: 'avc1.640028', width: w, height: h, bitrate: 5_000_000, framerate: fps, avc: { format: 'avc' } });
        const c = new OffscreenCanvas(w, h);
        const g = c.getContext('2d');
        const n = Math.round(secs * fps);
        for (let i = 0; i < n; i += 1) {
          g.fillStyle = `hsl(${(hue + i * 5) % 360}, 50%, 30%)`; g.fillRect(0, 0, w, h);
          for (let k = 0; k < 30; k += 1) { g.fillStyle = `hsl(${(hue + k * 12) % 360}, 70%, 60%)`; g.fillRect((k * 97 + i * 11) % w, (k * 53) % h, 80, 80); }
          g.fillStyle = '#fff'; g.font = 'bold 140px sans-serif'; g.fillText(`${hue}:${i}`, 80, 420);
          const frame = new VideoFrame(c, { timestamp: Math.round((i * 1e6) / fps), duration: Math.round(1e6 / fps) });
          enc.encode(frame, { keyFrame: i % (fps * 2) === 0 });
          frame.close();
          if (enc.encodeQueueSize > 8) await new Promise((r) => setTimeout(r, 0));
        }
        await enc.flush();
        enc.close();
        if (failure) throw failure;
        const blob = mw.writeMp4({ width: w, height: h, description, chunks }, null);
        return new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(blob); });
      };
      const reg = await import(`${root}/platform/projects/src/registry.ts`);
      const ms = await import(`${root}/platform/storage/src/media-storage.ts`);
      const sc = await import(`${root}/platform/storage/src/media-scenes.ts`);
      const projectId = 'cadence-test';
      reg.writeProjectRegistry([...reg.readProjectRegistry().filter((p) => p.id !== projectId), { id: projectId, name: 'Cadence test', kind: 'media' }]);
      const now = Date.UTC(2026, 9, 3, 12, 0, 0);
      const videos = [];
      for (let i = 0; i < 10; i += 1) videos.push(await encode(i * 36, 4, 24, 1280, 720));
      const items = videos.map((url, i) => ({ id: `cv-${i}`, kind: 'video', status: 'completed', url, prompt: `clip ${i + 1}`, shortenedPrompt: `Clip ${i + 1}`, modelId: 'veo-3.1-fast', modelName: 'Veo 3.1 Fast', ratio: '16:9', timestamp: now - i * 1000 }));
      await ms.saveProjectMedia(projectId, items);
      const db = await new Promise((res, rej) => { const r = indexedDB.open('WillowMediaDB'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
      const keys = await new Promise((res) => { const tx = db.transaction('project_media', 'readonly'); const q = tx.objectStore('project_media').getAllKeys(); q.onsuccess = () => res(q.result); });
      db.close();
      const key = keys.map(String).find((k) => k.endsWith(`:project:${projectId}`));
      const scope = decodeURIComponent(key.slice('scope:'.length, key.lastIndexOf(':project:')));
      const scene = {
        id: 'cadence-scene', name: 'Ten clips', createdAt: now, updatedAt: now, aspectRatio: '16:9',
        clips: videos.map((_, i) => ({ id: `cc-${i}`, mediaId: `cv-${i}`, trimStart: 0, trimEnd: 4, sourceDuration: 4 })),
      };
      await sc.saveScene(projectId, scene, scope);
      window.__seed = { items, scene };
      return { bytes: videos.reduce((n, v) => n + v.length, 0) };
    }, ROOT);
    console.log('seeded', JSON.stringify(seeded));

    // The app may read a scope the storage default doesn't (a workspace in it): open the project
    // once, see which scope it made, and save the seed there too.
    const items = await page.evaluate(() => window.__seed);
    await page.goto(`${ORIGIN}/media?projectId=cadence-test`, { waitUntil: 'domcontentloaded' }).catch(() => {});
    await sleep(8000);
    const scopes = await page.evaluate(async (root, seed) => {
      const ms = await import(`${root}/platform/storage/src/media-storage.ts`);
      const sc = await import(`${root}/platform/storage/src/media-scenes.ts`);
      const db = await new Promise((res, rej) => { const r = indexedDB.open('WillowMediaDB'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
      const keys = await new Promise((res) => { const tx = db.transaction('project_media', 'readonly'); const q = tx.objectStore('project_media').getAllKeys(); q.onsuccess = () => res(q.result); });
      db.close();
      const found = keys.map(String).filter((k) => k.endsWith(':project:cadence-test')).map((k) => decodeURIComponent(k.slice('scope:'.length, k.lastIndexOf(':project:'))));
      for (const s of found) {
        if ((await ms.loadProjectMedia('cadence-test', s)).length < seed.items.length) await ms.saveProjectMedia('cadence-test', seed.items, s);
        if (!(await sc.listScenes('cadence-test', s)).length) await sc.saveScene('cadence-test', seed.scene, s);
      }
      return found;
    }, ROOT, items);
    console.log('scopes', JSON.stringify(scopes));

    await page.goto(`${ORIGIN}/media?projectId=cadence-test&scene=cadence-scene`, { waitUntil: 'domcontentloaded' }).catch(() => {});
    for (let i = 0; i < 240 && !(await page.$('button[aria-label="Play"]')); i += 1) await sleep(250);
    if (!(await page.$('button[aria-label="Play"]'))) {
      await page.screenshot({ path: path.join(os.tmpdir(), 'scene-cadence-fail.png') });
      console.log('no editor; url', page.url(), 'errors', JSON.stringify(errors.slice(0, 5)));
      console.log('debug', JSON.stringify(await page.evaluate(async (root) => {
        const reg = await import(`${root}/platform/projects/src/registry.ts`);
        const ms = await import(`${root}/platform/storage/src/media-storage.ts`);
        const sc = await import(`${root}/platform/storage/src/media-scenes.ts`);
        const db = await new Promise((res, rej) => { const r = indexedDB.open('WillowMediaDB'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
        const keys = await new Promise((res) => { const tx = db.transaction('project_media', 'readonly'); const q = tx.objectStore('project_media').getAllKeys(); q.onsuccess = () => res(q.result); });
        db.close();
        const key = keys.map(String).find((k) => k.endsWith(':project:cadence-test'));
        const scope = key ? decodeURIComponent(key.slice('scope:'.length, key.lastIndexOf(':project:'))) : null;
        return {
          entry: reg.readProjectRegistry().find((p) => p.id === 'cadence-test') ?? null,
          keys: keys.map(String).slice(0, 6),
          media: scope ? (await ms.loadProjectMedia('cadence-test', scope)).length : null,
          scenes: scope ? (await sc.listScenes('cadence-test', scope)).length : null,
          lsKeys: Object.keys(localStorage).filter((k) => /project|scope|workspace|registry/i.test(k)).slice(0, 12),
        };
      }, ROOT)));
      return;
    }
    await sleep(6000);
    console.log('clip videos in the page:', await page.evaluate(() => document.querySelectorAll('.sb-canvas-box video').length));

    // New pictures on the scene's canvas, timed per animation frame.
    const measure = (secs) => page.evaluate((s) => new Promise((resolve) => {
      const src = document.querySelector('.sb-canvas');
      const tiny = document.createElement('canvas');
      tiny.width = 32; tiny.height = 18;
      const tctx = tiny.getContext('2d', { willReadFrequently: true });
      const changes = [];
      const frames = [];
      const long = [];
      let last = null;
      let prev = performance.now();
      const t0 = prev;
      const tick = (t) => {
        frames.push(t - prev);
        prev = t;
        tctx.drawImage(src, 0, 0, 32, 18);
        const d = tctx.getImageData(0, 0, 32, 18).data;
        let h = 0;
        for (let i = 0; i < d.length; i += 4) h = (Math.imul(h, 31) + d[i] + d[i + 1] * 7 + d[i + 2] * 13) | 0;
        if (h !== last) {
          if (changes.length && t - changes[changes.length - 1] > 51) long.push(`${Math.round(t - changes[changes.length - 1])}ms before ${document.querySelector('.sb-timecode')?.textContent.replace('Current time:', '')}`);
          changes.push(t);
          last = h;
        }
        if (t - t0 < s * 1000) requestAnimationFrame(tick);
        else {
          const gaps = changes.slice(2).map((x, i) => x - changes[i + 1]).sort((a, b) => a - b);
          const q = (p) => gaps[Math.min(gaps.length - 1, Math.floor(p * gaps.length))] ?? 0;
          resolve(`${(changes.length / s).toFixed(1)} new pictures/s (24 expected); gap median ${q(0.5).toFixed(1)}ms p99 ${q(0.99).toFixed(1)}ms max ${(gaps[gaps.length - 1] ?? 0).toFixed(1)}ms; gaps over 51ms (a lost or held frame): ${gaps.filter((g) => g > 51).length}; screen frames over 34ms: ${frames.filter((f) => f > 34).length}${long.length ? `\n      long gaps: ${long.slice(0, 12).join(' | ')}` : ''}`);
        }
      };
      requestAnimationFrame(tick);
    }), secs);

    await page.click('button[aria-label="Play"]');
    await sleep(800);
    console.log('videos in the page  ', await measure(SECONDS));
    // The player's old way: the same videos, out of the document.
    // Taking a playing video out of the document pauses it, so the one that was playing resumes.
    await page.evaluate(() => {
      const host = document.querySelector('.sb-canvas-box video')?.parentElement;
      const playing = [...(host?.querySelectorAll('video') ?? [])].find((v) => !v.paused);
      host?.remove();
      if (playing) void playing.play();
    });
    await sleep(500);
    console.log('videos out of page  ', await measure(SECONDS));
    console.log('errors', JSON.stringify(errors.slice(0, 3)));
  } finally {
    await browser.close();
    try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch { /* still locked */ }
  }
})().catch((e) => { console.error(e); process.exit(1); });
