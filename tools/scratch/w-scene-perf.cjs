// How smoothly Willow's Scenebuilder plays a 10-clip scene, on the :3101 test origin in its own
// headless Chrome: frame times over a few seconds of playback, and a CPU profile of the same
// stretch summarised by function and by file.
//   node tools/scratch/w-scene-perf.cjs [clips=10] [seconds=5] [--from-tile] [--clock]
//   --from-tile opens the scene from its gallery tile; --clock samples the scene's clock against the wall's.
const fs = require('fs');
const os = require('os');
const path = require('path');
const puppeteer = require('puppeteer-core');

const ORIGIN = 'http://localhost:3101';
const ROOT = '/@fs/C:/Users/Yashjit%202/Workspace/Willow%20Code';
const CLIPS = Number(process.argv[2] || 10);
const SECONDS = Number(process.argv[3] || 5);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'willow-scene-perf-'));
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
    await sleep(3000);
    const seeded = await page.evaluate(async (root, count) => {
      const png = async (color, text) => {
        const c = new OffscreenCanvas(1280, 720);
        const g = c.getContext('2d');
        g.fillStyle = color; g.fillRect(0, 0, 1280, 720);
        g.fillStyle = '#fff'; g.font = 'bold 120px sans-serif'; g.fillText(text, 100, 380);
        const blob = await c.convertToBlob({ type: 'image/jpeg', quality: 0.85 });
        return new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(blob); });
      };
      // Ten distinct 4s 720p H.264 clips at 24fps, as Veo's are, encoded frame by frame: exactly
      // 4s each. (Recorded off a canvas with MediaRecorder they came out short or empty in a busy
      // headless run, and a short clip ends early, which reads as the scene's clock racing.)
      const mw = await import(`${root}/features/media/src/scenes/mp4-write.ts`);
      const clip = async (hue, seconds) => {
        const fps = 24;
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
        enc.configure({ codec: 'avc1.640028', width: 1280, height: 720, bitrate: 4_000_000, framerate: fps, avc: { format: 'avc' } });
        const c = new OffscreenCanvas(1280, 720);
        const g = c.getContext('2d');
        for (let i = 0; i < seconds * fps; i += 1) {
          const t = i / fps;
          g.fillStyle = `hsl(${hue + t * 20}, 50%, 30%)`; g.fillRect(0, 0, 1280, 720);
          for (let k = 0; k < 40; k += 1) { g.fillStyle = `hsl(${(hue + k * 9) % 360}, 70%, 60%)`; g.fillRect((k * 97 + t * 300) % 1280, (k * 53) % 720, 60, 60); }
          g.fillStyle = '#fff'; g.font = 'bold 140px sans-serif'; g.fillText(`${hue} ${t.toFixed(1)}`, 80, 420);
          const frame = new VideoFrame(c, { timestamp: Math.round(t * 1e6), duration: Math.round(1e6 / fps) });
          enc.encode(frame, { keyFrame: i % (fps * 2) === 0 });
          frame.close();
          if (enc.encodeQueueSize > 8) await new Promise((r) => setTimeout(r, 0));
        }
        await enc.flush();
        enc.close();
        if (failure) throw failure;
        const blob = mw.writeMp4({ width: 1280, height: 720, description, chunks }, null);
        return new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(blob); });
      };
      localStorage.setItem('modelConfig', JSON.stringify({ gemini: { savedModels: [{ id: 'rec-nb2', modelId: 'gemini-3.1-flash-image-preview', name: 'Nano Banana 2' }] }, modelOrder: [] }));
      const reg = await import(`${root}/platform/projects/src/registry.ts`);
      const ms = await import(`${root}/platform/storage/src/media-storage.ts`);
      const sc = await import(`${root}/platform/storage/src/media-scenes.ts`);
      const projectId = 'perf-test';
      reg.writeProjectRegistry([...reg.readProjectRegistry().filter((p) => p.id !== projectId), { id: projectId, name: 'Perf test', kind: 'media' }]);
      const now = Date.UTC(2026, 9, 3, 12, 0, 0);
      const videos = [];
      for (let i = 0; i < count; i += 1) videos.push(await clip(i * 36, 4));
      const items = videos.map((url, i) => ({ id: `pv-${i}`, kind: 'video', status: 'completed', url, prompt: `clip ${i + 1}`, shortenedPrompt: `Clip ${i + 1}`, modelId: 'veo-3.1-fast', modelName: 'Veo 3.1 Fast', ratio: '16:9', timestamp: now - i * 1000 }));
      for (let i = 0; i < 30; i += 1) items.push({ id: `pi-${i}`, kind: 'image', status: 'completed', url: await png(`hsl(${i * 12}, 40%, 30%)`, `IMG ${i}`), prompt: `image ${i}`, modelId: 'gemini-3.1-flash-image', modelName: 'Nano Banana 2', ratio: '16:9', timestamp: now - 100000 - i * 1000 });
      await ms.saveProjectMedia(projectId, items);
      const db = await new Promise((res, rej) => { const r = indexedDB.open('WillowMediaDB'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
      const keys = await new Promise((res) => { const tx = db.transaction('project_media', 'readonly'); const q = tx.objectStore('project_media').getAllKeys(); q.onsuccess = () => res(q.result); });
      db.close();
      const key = keys.map(String).find((k) => k.endsWith(`:project:${projectId}`));
      const scope = decodeURIComponent(key.slice('scope:'.length, key.lastIndexOf(':project:')));
      const scene = {
        id: 'perf-scene', name: 'Ten clips', createdAt: now, updatedAt: now, aspectRatio: '16:9',
        clips: videos.map((_, i) => ({ id: `pc-${i}`, mediaId: `pv-${i}`, trimStart: 0, trimEnd: 3.9, sourceDuration: 3.9 })),
      };
      await sc.saveScene(projectId, scene, scope);
      return { scope, bytes: videos.reduce((n, v) => n + v.length, 0), items, scene };
    }, ROOT, CLIPS);
    console.log('seeded', JSON.stringify({ scope: seeded.scope, bytes: seeded.bytes }));

    // The app may read a scope the storage default doesn't (a workspace in it): open the project
    // once, see which scopes it made, and save the seed in each.
    await page.goto(`${ORIGIN}/media?projectId=perf-test`, { waitUntil: 'domcontentloaded' }).catch(() => {});
    await sleep(8000);
    console.log('scopes', JSON.stringify(await page.evaluate(async (root, seed) => {
      const ms = await import(`${root}/platform/storage/src/media-storage.ts`);
      const sc = await import(`${root}/platform/storage/src/media-scenes.ts`);
      const db = await new Promise((res, rej) => { const r = indexedDB.open('WillowMediaDB'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
      const keys = await new Promise((res) => { const tx = db.transaction('project_media', 'readonly'); const q = tx.objectStore('project_media').getAllKeys(); q.onsuccess = () => res(q.result); });
      db.close();
      const found = keys.map(String).filter((k) => k.endsWith(':project:perf-test')).map((k) => decodeURIComponent(k.slice('scope:'.length, k.lastIndexOf(':project:'))));
      for (const s of found) {
        if ((await ms.loadProjectMedia('perf-test', s)).length < seed.items.length) await ms.saveProjectMedia('perf-test', seed.items, s);
        if (!(await sc.listScenes('perf-test', s)).length) await sc.saveScene('perf-test', seed.scene, s);
      }
      return found;
    }, ROOT, { items: seeded.items, scene: seeded.scene })));

    if (process.argv.includes('--from-tile')) {
      // The way a user gets there: hover the scene's tile in the gallery (its preview plays), click.
      await page.goto(`${ORIGIN}/media?projectId=perf-test`, { waitUntil: 'domcontentloaded' }).catch(() => {});
      for (let i = 0; i < 120 && !(await page.$('.sb-scene-tile-host')); i += 1) await sleep(250);
      await sleep(3000);
      const tile = await page.evaluate(() => { const r = document.querySelector('.sb-scene-tile-host').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
      await page.mouse.move(tile.x, tile.y, { steps: 5 });
      await sleep(2500);
      await page.mouse.click(tile.x, tile.y);
    } else {
      await page.goto(`${ORIGIN}/media?projectId=perf-test&scene=perf-scene`, { waitUntil: 'domcontentloaded' }).catch(() => {});
    }
    for (let i = 0; i < 120 && !(await page.$('button[aria-label="Play"]')); i += 1) await sleep(250);
    await sleep(6000);
    console.log('videos in the page:', JSON.stringify(await page.evaluate(() => {
      const all = [...document.querySelectorAll('video')];
      return { inDom: all.length, playingInDom: all.filter((v) => !v.paused).length, sceneTileVideos: document.querySelectorAll('.sb-scene-tile__video').length };
    })));

    // The profiler's own start-up stalls the page, so it starts before anything is measured.
    const cdp = await page.target().createCDPSession();
    await cdp.send('Profiler.enable');
    await cdp.send('Profiler.setSamplingInterval', { interval: 500 });
    await cdp.send('Profiler.start');
    await sleep(1500);
    // Frame times: every animation frame's gap while playing.
    await page.evaluate(() => {
      window.__gaps = [];
      window.__sample = true;
      let last = performance.now();
      window.__big = [];
      const t0 = performance.now();
      const tick = (t) => {
        if (!window.__sample) return;
        const gap = t - last;
        window.__gaps.push(gap);
        if (gap > 33.4) window.__big.push(`${Math.round(gap)}ms at ${((t - t0) / 1000).toFixed(2)}s, scene ${document.querySelector('.sb-timecode')?.textContent.replace('Current time:', '')}`);
        last = t;
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
      window.__longTasks = 0;
      try { new PerformanceObserver((list) => { window.__longTasks += list.getEntries().length; }).observe({ type: 'longtask', buffered: false }); } catch { /* unsupported */ }
    });
    if (process.argv.includes('--clock')) {
      // The scene's clock against the wall's, and which clip videos are playing, every 300ms.
      await page.evaluate(() => {
        window.__clock = [];
        const t0 = performance.now();
        const vids = [...document.querySelectorAll('.sb-canvas-box video')];
        const id = window.setInterval(() => {
          if (!window.__sample) { window.clearInterval(id); return; }
          const playing = vids.map((v, i) => (v.paused ? null : `v${i}@${v.currentTime.toFixed(2)}${v.ended ? '(ended)' : ''}`)).filter(Boolean).join(',');
          window.__clock.push(`${((performance.now() - t0) / 1000).toFixed(1)}s ${document.querySelector('.sb-timecode')?.textContent.replace('Current time:', '')} [${playing}] d0=${vids[0]?.duration}`);
        }, 300);
      });
    }
    await page.click('button[aria-label="Play"]');
    await sleep(SECONDS * 1000);
    if (process.argv.includes('--clock')) console.log('clock:\n  ' + (await page.evaluate(() => window.__clock)).join('\n  '));
    const { profile } = await cdp.send('Profiler.stop');
    const frames = await page.evaluate(() => { window.__sample = false; return { gaps: window.__gaps, big: window.__big, longTasks: window.__longTasks, time: document.querySelector('.sb-timecode')?.textContent }; });
    console.log('slow frames:', frames.big.join(' | ') || 'none');
    await page.click('button[aria-label="Pause"]').catch(() => {});

    const gaps = frames.gaps.slice(5).sort((a, b) => a - b);
    const pct = (p) => gaps[Math.min(gaps.length - 1, Math.floor(p * gaps.length))];
    console.log(`frames ${gaps.length} in ${SECONDS}s -> ${(gaps.length / SECONDS).toFixed(1)} fps; median ${pct(0.5).toFixed(1)}ms p95 ${pct(0.95).toFixed(1)}ms max ${gaps[gaps.length - 1].toFixed(1)}ms; >33ms ${gaps.filter((g) => g > 33.4).length}; long tasks ${frames.longTasks}; timecode ${frames.time}`);

    // Self time by function and by file.
    const byId = new Map(profile.nodes.map((n) => [n.id, n]));
    const self = new Map();
    const dt = profile.timeDeltas;
    profile.samples.forEach((id, i) => { self.set(id, (self.get(id) || 0) + (dt[i] || 0)); });
    const fn = new Map();
    const file = new Map();
    let total = 0;
    for (const [id, us] of self) {
      const n = byId.get(id);
      const cf = n.callFrame;
      const name = `${cf.functionName || '(anonymous)'} ${cf.url.split('/').pop().split('?')[0]}:${cf.lineNumber + 1}`;
      fn.set(name, (fn.get(name) || 0) + us);
      const f = cf.url ? cf.url.split('?')[0].replace(/^.*\/(node_modules|features|platform|apps)\//, '$1/') : `(${cf.functionName || 'native'})`;
      file.set(f, (file.get(f) || 0) + us);
      total += us;
    }
    const top = (m, k) => [...m].sort((a, b) => b[1] - a[1]).slice(0, k).map(([n, us]) => `${(us / 1000).toFixed(0).padStart(6)}ms ${((us / total) * 100).toFixed(1).padStart(5)}%  ${n}`);
    console.log(`\n-- top functions (self), ${(total / 1000).toFixed(0)}ms sampled --\n${top(fn, 25).join('\n')}`);
    console.log(`\n-- by file --\n${top(file, 15).join('\n')}`);

    // The playhead and timecode still follow playback, now that neither renders through React.
    const read = () => page.evaluate(() => ({
      time: document.querySelector('.sb-timecode')?.textContent.replace('Current time:', ''),
      left: parseFloat(document.querySelector('.sb-playhead')?.style.left || 'NaN'),
      hit: parseFloat(document.querySelector('.sb-playhead-hit')?.style.left || 'NaN'),
      play: document.querySelector('.sb-playback__play')?.getAttribute('aria-label'),
    }));
    const secs = (tc) => { const [m, s, f] = tc.split(':').map(Number); return m * 60 + s + f / 24; };
    let ok = 0;
    let bad = 0;
    const expect = (label, cond, detail) => { if (cond) ok += 1; else bad += 1; console.log(`${cond ? 'PASS' : 'FAIL'} ${label} :: ${JSON.stringify(detail)}`); };
    const paused = await read();
    await sleep(600);
    const still = await read();
    expect('paused: the timecode holds', paused.time === still.time && paused.play === 'Play', { paused, still });
    await page.click('button[aria-label="Play"]');
    await sleep(1200);
    const a = await read();
    await sleep(800);
    const b = await read();
    expect('playing: the timecode advances ~0.8s and the playhead moves right with it', secs(b.time) - secs(a.time) > 0.5 && b.left > a.left && b.hit === b.left, { a, b });
    await page.click('button[aria-label="Pause"]');
    await sleep(300);
    const before = await read();
    await page.click('button[aria-label="Skip to next clip"]');
    await sleep(400);
    const next = await read();
    expect('Skip to next clip lands on the next cut (a multiple of 3.9s)', Math.abs((secs(next.time) / 3.9) - Math.round(secs(next.time) / 3.9)) < 0.05 && secs(next.time) > secs(before.time), { before, next });
    const area = await page.evaluate(() => { const r = document.querySelector('.sb-timeline__area').getBoundingClientRect(); return { x: r.x, y: r.y + 12 }; });
    await page.mouse.click(area.x + 21 + 102 * 1.5, area.y);
    await sleep(400);
    const seeked = await read();
    expect('a click on the ruler seeks there, the playhead with it', Math.abs(seeked.left - (21 + 102 * 1.5 - 8)) < 2 && seeked.time !== next.time, seeked);
    const gallery = () => page.evaluate(() => ({ visibility: getComputedStyle(document.querySelector('main')).visibility, tiles: document.querySelectorAll('main .gallery-tile').length, editor: !!document.querySelector('.sb-editor') }));
    const under = await gallery();
    expect('the gallery is not painted under the editor, and keeps its tiles', under.visibility === 'hidden' && under.tiles > 0 && under.editor, under);
    await page.click('button[aria-label="Back button to go to previous page"]');
    await sleep(1200);
    const back = await gallery();
    expect('Back: the editor goes and the gallery shows again', back.visibility === 'visible' && back.tiles > 0 && !back.editor, back);
    console.log(`${ok} passed, ${bad} failed`);
    console.log('errors', JSON.stringify(errors.slice(0, 3)));
  } finally {
    await browser.close();
    try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch { /* still locked */ }
  }
})().catch((e) => { console.error(e); process.exit(1); });
