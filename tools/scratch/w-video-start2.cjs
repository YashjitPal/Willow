// Like w-video-start.cjs, but the way the Scenebuilder has them: ten 24fps H.264 <video>s parked
// in the page at once, each played in turn after a longer park (2s, 6s, ... 30s). For each: how
// long after play() its first new frame is presented (requestVideoFrameCallback), and the
// longest screen frame in the 300ms after (a stall of the whole page, not just that video).
// Some get a "wake" re-seek 1s before play: to 0.001, or with SAME=1 also to where they already
// are (0). :3101, its own headless Chrome.
//   node tools/scratch/w-video-start2.cjs        (SAME=1 for the same-place seeks, 18-36s parks)
const fs = require('fs');
const os = require('os');
const path = require('path');
const puppeteer = require('puppeteer-core');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'willow-start2-'));
  const browser = await puppeteer.launch({
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: true,
    userDataDir,
    defaultViewport: { width: 1536, height: 826, deviceScaleFactor: 1.25 },
    args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
    protocolTimeout: 600000,
  });
  const page = (await browser.pages())[0];
  try {
    await page.goto('http://localhost:3101/media', { waitUntil: 'networkidle2', timeout: 180000 }).catch(() => {});
    await sleep(2000);
    const out = await page.evaluate(async (root, same) => {
      const mw = await import(`${root}/features/media/src/scenes/mp4-write.ts`);
      const fps = 24;
      const encode = async (hue) => {
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
        enc.configure({ codec: 'avc1.640028', width: 1280, height: 720, bitrate: 5_000_000, framerate: fps, avc: { format: 'avc' } });
        const c = new OffscreenCanvas(1280, 720);
        const g = c.getContext('2d');
        for (let i = 0; i < fps * 4; i += 1) {
          g.fillStyle = `hsl(${(hue + i * 7) % 360}, 50%, 30%)`; g.fillRect(0, 0, 1280, 720);
          g.fillStyle = '#fff'; g.font = 'bold 200px sans-serif'; g.fillText(String(i), 100, 450);
          const frame = new VideoFrame(c, { timestamp: Math.round((i * 1e6) / fps), duration: Math.round(1e6 / fps) });
          enc.encode(frame, { keyFrame: i % (fps * 2) === 0 });
          frame.close();
          if (enc.encodeQueueSize > 8) await new Promise((r) => setTimeout(r, 0));
        }
        await enc.flush();
        return URL.createObjectURL(mw.writeMp4({ width: 1280, height: 720, description, chunks }, null));
      };
      const urls = [];
      for (let i = 0; i < 10; i += 1) urls.push(await encode(i * 36));

      const host = document.createElement('div');
      host.style.cssText = 'position:fixed;left:0;top:0;width:2px;height:2px;overflow:hidden;opacity:0.01;pointer-events:none';
      document.body.appendChild(host);
      const frames = [];
      const onFrame = (t) => { frames.push(t); requestAnimationFrame(onFrame); };
      requestAnimationFrame(onFrame);
      const seekTo = (v, s) => new Promise((r) => { v.addEventListener('seeked', r, { once: true }); v.currentTime = s; });
      const videos = await Promise.all(urls.map(async (url) => {
        const v = document.createElement('video');
        v.muted = true; v.playsInline = true; v.preload = 'auto'; v.src = url;
        v.style.cssText = 'position:absolute;left:0;top:0;width:2px;height:2px';
        host.appendChild(v);
        await new Promise((r) => v.addEventListener('loadeddata', r, { once: true }));
        return v;
      }));
      const parkedAt = performance.now();

      const results = [];
      // wake: false, true (a seek to 0.001), or 'same' (a seek to where it already is, 0).
      const plan = same
        ? [[18, 'same'], [20, false], [22, 'same'], [24, false], [26, 'same'], [28, false], [30, 'same'], [32, true], [34, 'same'], [36, false]]
        : [[2, false], [6, false], [6, true], [10, false], [14, true], [18, false], [22, true], [26, false], [30, false], [30, true]];
      for (let k = 0; k < plan.length; k += 1) {
        const [at, wake] = plan[k];
        const v = videos[k];
        const wait = parkedAt + at * 1000 - performance.now() - (wake ? 1000 : 0);
        if (wait > 0) await new Promise((r) => setTimeout(r, wait));
        if (wake) {
          await seekTo(v, wake === 'same' ? 0 : 0.001);
          await new Promise((r) => setTimeout(r, Math.max(0, parkedAt + at * 1000 - performance.now())));
        }
        const result = await new Promise((resolve) => {
          const t0 = performance.now();
          const cb = (now, md) => {
            if (md.mediaTime > 0.01) resolve({ first: now - t0, t0 });
            else v.requestVideoFrameCallback(cb);
          };
          v.requestVideoFrameCallback(cb);
          void v.play();
          setTimeout(() => resolve({ first: null, t0 }), 2000);
        });
        await new Promise((r) => setTimeout(r, 400));
        v.pause();
        const after = frames.filter((t) => t >= result.t0 && t <= result.t0 + 300);
        const worst = after.slice(1).reduce((m, t, i) => Math.max(m, t - after[i]), 0);
        results.push(`${wake === 'same' ? 'same ' : wake ? 'wake ' : 'plain'} parked ${String(Math.round((result.t0 - parkedAt) / 1000)).padStart(2)}s -> first new frame after ${result.first === null ? 'never' : `${Math.round(result.first)}ms`}; longest screen frame in the next 300ms ${Math.round(worst)}ms`);
      }
      return results;
    }, '/@fs/C:/Users/Yashjit%202/Workspace/Willow%20Code', Boolean(process.env.SAME));
    console.log(out.join('\n'));
  } finally {
    await browser.close();
    try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch { /* still locked */ }
  }
})().catch((e) => { console.error(e); process.exit(1); });
