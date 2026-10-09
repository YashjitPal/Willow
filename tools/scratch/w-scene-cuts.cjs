// What happens around each cut of a playing scene in Willow's Scenebuilder: new pictures on the
// canvas, every clip video's presented frames (requestVideoFrameCallback), long animation frames
// with the scripts in them, and DOM mutations in the editor, on one timeline per cut. Same seed
// as w-scene-cadence.cjs (ten 4s 24fps H.264 clips). On :3101 in its own headless Chrome.
//   node tools/scratch/w-scene-cuts.cjs [seconds=9] [--detail]
const fs = require('fs');
const os = require('os');
const path = require('path');
const puppeteer = require('puppeteer-core');

const ORIGIN = 'http://localhost:3101';
const ROOT = '/@fs/C:/Users/Yashjit%202/Workspace/Willow%20Code';
const SECONDS = Number(process.argv[2] || 9);
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

    // Everything on one clock (performance.now), recorded while the scene plays.
    await page.evaluate(() => {
      const rec = { changes: [], frames: [], loaf: [], rvfc: [], mut: [], longtask: [], firstDraw: {} };
      window.__rec = rec;
      // A new picture is the player drawing a video frame the canvas hasn't shown yet; which frame
      // each video has up comes from requestVideoFrameCallback. Reading the canvas's pixels back
      // instead stalls on the GPU and moves the very timings measured.
      const vids = [...document.querySelectorAll('.sb-canvas-box video')];
      const shown = new Map();
      const ctx = document.querySelector('.sb-canvas').getContext('2d');
      const draw = ctx.drawImage;
      let last = null;
      ctx.drawImage = function (source, ...rest) {
        if (!rec.stop && source instanceof HTMLVideoElement) {
          const index = vids.indexOf(source);
          if (rec.firstDraw[index] === undefined) rec.firstDraw[index] = document.timeline.currentTime;
          const id = `${index}:${shown.get(source) ?? '-'}`;
          // The frame's own time, as rAF gets it: gaps come out in whole screen frames.
          if (id !== last) { rec.changes.push(document.timeline.currentTime); last = id; }
        }
        return draw.call(this, source, ...rest);
      };
      const tick = (t) => {
        rec.frames.push(t);
        if (!rec.stop) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
      vids.forEach((v, i) => {
        const cb = (now, md) => {
          shown.set(v, md.mediaTime);
          rec.rvfc.push({ i, now, mt: md.mediaTime, pf: md.presentedFrames, exp: md.expectedDisplayTime, proc: md.processingDuration });
          if (!rec.stop) v.requestVideoFrameCallback(cb);
        };
        v.requestVideoFrameCallback(cb);
        for (const ev of ['play', 'playing', 'pause', 'waiting', 'seeking', 'seeked', 'stalled', 'ended', 'suspend', 'canplay', 'canplaythrough', 'loadeddata', 'emptied', 'ratechange']) {
          v.addEventListener(ev, () => { if (!rec.stop) rec.rvfc.push({ i, now: performance.now(), ev }); });
        }
      });
      try {
        new PerformanceObserver((l) => {
          for (const e of l.getEntries()) {
            rec.loaf.push({
              start: e.startTime, dur: e.duration, block: e.blockingDuration, render: e.renderStart, style: e.styleAndLayoutStart,
              scripts: (e.scripts || []).map((s) => ({ src: (s.sourceURL || '').split('/').slice(-1)[0].split('?')[0], fn: s.sourceFunctionName, inv: s.invoker, type: s.invokerType, start: s.startTime, dur: s.duration, layout: s.forcedStyleAndLayoutDuration })),
            });
          }
        }).observe({ type: 'long-animation-frame' });
      } catch (e) { rec.loafError = String(e); }
      try {
        new PerformanceObserver((l) => { for (const e of l.getEntries()) rec.longtask.push({ start: e.startTime, dur: e.duration }); }).observe({ type: 'longtask' });
      } catch { /* not there */ }
      const playheadish = (n) => n instanceof Element && /playhead/.test(n.className || '');
      new MutationObserver((recs) => {
        if (rec.stop) return;
        const real = recs.filter((r) => !(r.type === 'attributes' && playheadish(r.target)) && !(r.type === 'characterData'));
        if (!real.length) return;
        const label = (n) => (n instanceof Element ? `${n.tagName.toLowerCase()}.${String(n.className || '').split(' ')[0]}` : n.nodeName);
        rec.mut.push({ t: performance.now(), n: real.length, what: [...new Set(real.map((r) => `${r.type[0]}:${label(r.target)}${r.attributeName ? `[${r.attributeName}]` : ''}`))].slice(0, 8) });
      }).observe(document.querySelector('.sb-editor[role="region"]') || document.body, { subtree: true, childList: true, attributes: true, characterData: true });
    });

    // Start once the editor is done settling (filmstrips, URLs): 3s without a long frame.
    const settledAfter = await page.evaluate(() => new Promise((resolve) => {
      const t0 = performance.now();
      const check = () => {
        const lastLong = window.__rec.loaf.reduce((m, e) => Math.max(m, e.start + e.dur), 0);
        const now = performance.now();
        if (now - Math.max(lastLong, t0) > 3000 || now - t0 > 40000) resolve(Math.round(now - t0));
        else setTimeout(check, 250);
      };
      check();
    }));
    console.log(`settled after ${settledAfter}ms`);
    await page.evaluate(() => { const r = window.__rec; r.changes.length = 0; r.frames.length = 0; r.loaf.length = 0; r.rvfc.length = 0; r.mut.length = 0; r.longtask.length = 0; r.firstDraw = {}; });
    // Chrome's own player log (what chrome://media-internals shows): pipeline states per player.
    const media = [];
    if (process.argv.includes('--media')) {
      const cdp = await page.target().createCDPSession();
      cdp.on('Media.playerPropertiesChanged', (e) => {
        for (const p of e.properties) if (/pipeline_state|url|suspend|idle/i.test(p.name)) media.push({ player: e.playerId, at: Date.now(), name: p.name, value: String(p.value).slice(0, 60) });
      });
      cdp.on('Media.playerEventsAdded', (e) => {
        // Delivered in batches about a second apart: the event's own timestamp (s since epoch) is the time.
        for (const ev of e.events) media.push({ player: e.playerId, at: typeof ev.timestamp === 'number' && ev.timestamp > 1e9 ? ev.timestamp * 1000 : Date.now(), name: 'event', value: String(ev.value).slice(0, 80) });
      });
      cdp.on('Media.playerMessagesLogged', (e) => {
        for (const m of e.messages) if (/suspend|resum|idle|stale/i.test(m.message)) media.push({ player: e.playerId, at: Date.now(), name: m.level, value: m.message.slice(0, 100) });
      });
      await cdp.send('Media.enable');
    }
    const clock = await page.evaluate(() => [Date.now(), performance.now()]);
    await page.click('button[aria-label="Play"]');
    await sleep(SECONDS * 1000);
    const rec = await page.evaluate(() => { window.__rec.stop = true; return window.__rec; });
    if (rec.loafError) console.log('no long-animation-frame:', rec.loafError);

    // A cut is the canvas's first draw from a clip's video.
    const cuts = Object.entries(rec.firstDraw).map(([i, t]) => [Number(i), t]).filter(([i]) => i > 0).sort((a, b) => a[1] - b[1]);
    const gaps = rec.changes.slice(1).map((x, i) => [x, x - rec.changes[i]]);
    const sorted = gaps.slice(1).map(([, g]) => g).sort((a, b) => a - b);
    const q = (p) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] ?? 0;
    const nearCut = (t) => {
      let best = null;
      for (const c of cuts) if (!best || Math.abs(t - c[1]) < Math.abs(t - best[1])) best = c;
      return best ? `${Math.round(t - best[1])}ms from cut ${best[0]}` : 'no cut';
    };
    console.log(`${(rec.changes.length / SECONDS).toFixed(1)} new pictures/s (24 expected); gap median ${q(0.5).toFixed(1)}ms p99 ${q(0.99).toFixed(1)}ms max ${(sorted[sorted.length - 1] ?? 0).toFixed(1)}ms; over 51ms: ${sorted.filter((g) => g > 51).length}; screen frames over 34ms: ${rec.frames.slice(1).filter((t, k) => t - rec.frames[k] > 34).length}`);
    console.log('long gaps:', gaps.slice(1).filter(([, g]) => g > 51).map(([t, g]) => `${Math.round(g)}ms (${nearCut(t)})`).join(' | ') || 'none');
    // The scene's clock against the wall's: 4s clips cut every 4000ms.
    console.log('cuts spaced (ms):', cuts.slice(1).map(([, at], i) => Math.round(at - cuts[i][1])).join(' '));
    // Near a cut (within 400ms) against mid-clip: what the cuts add over the browser's own jitter.
    const playing = gaps.slice(1).filter(([t]) => cuts.length && t > cuts[0][1] - 3500);
    const isNear = ([t]) => cuts.some(([, at]) => Math.abs(t - at) <= 400);
    const stat = (list) => {
      const g = list.map(([, x]) => x);
      return `${g.length} gaps, ${g.filter((x) => x > 51).length} over 51ms, max ${Math.round(Math.max(0, ...g))}ms`;
    };
    console.log(`near cuts (${cuts.length}): ${stat(playing.filter(isNear))}; mid-clip: ${stat(playing.filter((x) => !isNear(x)))}`);
    if (media.length) {
      // Wall-clock CDP events onto the page's clock (to ~ms, via one Date.now/performance.now pair).
      const toPage = (wall) => wall - clock[0] + clock[1];
      const players = [...new Set(media.map((m) => m.player))];
      const start = rec.frames[0] ?? 0;
      console.log(`\nChrome media log since Play (${players.length} players seen):`);
      for (const p of players) {
        const lines = media
          .filter((m) => m.player === p && m.name === 'event' && toPage(m.at) >= start)
          .map((m) => {
            let e;
            try { e = JSON.parse(m.value); } catch { return null; }
            const what = e.event === 'kPipelineStateChange' ? e.pipeline_state : e.event === 'kSeek' ? `seek ${e.seek_target}` : /^k(Play|Pause|Suspended|WebMediaPlayerDestroyed)$/.test(e.event) ? e.event : null;
            return what ? `${what}@${nearCut(toPage(m.at))}` : null;
          })
          .filter(Boolean);
        if (lines.length) console.log(`  ${p.slice(0, 6)}: ${lines.join(' | ')}`);
      }
    }
    if (process.argv.includes('--gaps')) {
      // What else was going on around each long gap.
      for (const [t, g] of playing.filter(([, x]) => x > 51)) {
        const from = t - g - 100;
        const to = t + 100;
        const r = (x) => `${Math.round(x - (t - g))}`;
        const parts = [`${Math.round(g)}ms gap (${nearCut(t)}), times from the gap's start:`];
        for (const e of rec.loaf.filter((x) => x.start + x.dur >= from && x.start <= to)) {
          parts.push(`  long frame ${r(e.start)}..${r(e.start + e.dur)} (${Math.round(e.dur)}ms, blocking ${Math.round(e.block)}, render ${r(e.render)}, layout ${r(e.style)}) ${e.scripts.map((s) => `${Math.round(s.dur)}ms ${s.inv} ${s.src}`).join('; ')}`);
        }
        const ev = rec.rvfc.filter((e) => e.ev && e.now >= from && e.now <= to);
        if (ev.length) parts.push(`  video events: ${ev.map((e) => `${e.ev} v${e.i}@${r(e.now)}`).join(' ')}`);
        const slow = rec.frames.slice(1).map((x, k) => [x, x - rec.frames[k]]).filter(([x, d]) => x >= from && x <= to && d > 20);
        if (slow.length) parts.push(`  screen frames over 20ms: ${slow.map(([x, d]) => `${r(x)}(${Math.round(d)})`).join(' ')}`);
        const vf = rec.rvfc.filter((e) => !e.ev && e.now >= from && e.now <= to);
        parts.push(`  presented: ${vf.map((e) => `v${e.i}:${e.mt.toFixed(3)}@${r(e.now)}`).join(' ')}`);
        for (const m of rec.mut.filter((x) => x.t >= from && x.t <= to)) parts.push(`  dom ${r(m.t)}: ${m.what.join(' ')}`);
        console.log(parts.join('\n'));
      }
    }
    if (!process.argv.includes('--detail')) return;
    for (const [clip, at] of cuts) {
      const from = at - 250;
      const to = at + 450;
      const r = (t) => `${t - at >= 0 ? '+' : ''}${Math.round(t - at)}`;
      console.log(`\n=== cut into clip ${clip} (t0 = the canvas's first draw of it, ${Math.round(at)}ms) ===`);
      console.log('canvas changes (gap before):', gaps.filter(([t]) => t >= from && t <= to).map(([t, g]) => `${r(t)}${g > 51 ? `(${Math.round(g)}!)` : `(${Math.round(g)})`}`).join(' '));
      for (const i of [clip - 1, clip, clip + 1]) {
        const ev = rec.rvfc.filter((e) => e.i === i && e.now >= from && e.now <= to);
        if (!ev.length) continue;
        console.log(`  video ${i}:`, ev.map((e) => (e.ev ? `[${e.ev}@${r(e.now)}]` : `${r(e.now)}:${e.pf}/${e.mt.toFixed(3)}`)).join(' '));
      }
      const loaf = rec.loaf.filter((e) => e.start + e.dur >= from && e.start <= to);
      for (const e of loaf) {
        console.log(`  long frame ${r(e.start)}..${r(e.start + e.dur)} (${Math.round(e.dur)}ms, blocking ${Math.round(e.block)}, render at ${r(e.render)}, style/layout at ${r(e.style)})`);
        for (const s of e.scripts.filter((x) => x.dur > 2)) console.log(`      ${Math.round(s.dur)}ms ${s.type} ${s.inv} ${s.fn || ''} ${s.src} (forced layout ${Math.round(s.layout)})`);
      }
      const lt = rec.longtask.filter((e) => e.start + e.dur >= from && e.start <= to);
      if (lt.length) console.log('  long tasks:', lt.map((e) => `${r(e.start)} ${Math.round(e.dur)}ms`).join(', '));
      const mut = rec.mut.filter((m) => m.t >= from && m.t <= to);
      for (const m of mut) console.log(`  dom ${r(m.t)}: ${m.n} ${m.what.join(' ')}`);
      const slow = rec.frames.slice(1).map((t, k) => [t, t - rec.frames[k]]).filter(([t, d]) => t >= from && t <= to && d > 20);
      if (slow.length) console.log('  screen frames over 20ms:', slow.map(([t, d]) => `${r(t)}(${Math.round(d)})`).join(' '));
    }
    console.log('errors', JSON.stringify(errors.slice(0, 3)));
  } finally {
    await browser.close();
    try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch { /* still locked */ }
  }
})().catch((e) => { console.error(e); process.exit(1); });
