// How long a parked <video> (paused on its first frame, in the page) takes after play() to show
// a new frame, by how long it sat parked, and with a re-seek 0.5s before play ("wake"). A 24fps
// H.264 clip, on the :3101 origin in its own headless Chrome.
//   node tools/scratch/w-video-start.cjs
const fs = require('fs');
const os = require('os');
const path = require('path');
const puppeteer = require('puppeteer-core');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'willow-start-'));
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
    const out = await page.evaluate(async (root) => {
      const mw = await import(`${root}/features/media/src/scenes/mp4-write.ts`);
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
      enc.configure({ codec: 'avc1.640028', width: 1280, height: 720, bitrate: 5_000_000, framerate: fps, avc: { format: 'avc' } });
      const c = new OffscreenCanvas(1280, 720);
      const g = c.getContext('2d');
      for (let i = 0; i < fps * 4; i += 1) {
        g.fillStyle = `hsl(${(i * 7) % 360}, 50%, 30%)`; g.fillRect(0, 0, 1280, 720);
        g.fillStyle = '#fff'; g.font = 'bold 200px sans-serif'; g.fillText(String(i), 100, 450);
        const frame = new VideoFrame(c, { timestamp: Math.round((i * 1e6) / fps), duration: Math.round(1e6 / fps) });
        enc.encode(frame, { keyFrame: i % (fps * 2) === 0 });
        frame.close();
        if (enc.encodeQueueSize > 8) await new Promise((r) => setTimeout(r, 0));
      }
      await enc.flush();
      const url = URL.createObjectURL(mw.writeMp4({ width: 1280, height: 720, description, chunks }, null));

      const host = document.createElement('div');
      host.style.cssText = 'position:fixed;left:0;top:0;width:2px;height:2px;overflow:hidden;opacity:0.01;pointer-events:none';
      document.body.appendChild(host);
      const tiny = document.createElement('canvas');
      tiny.width = 16; tiny.height = 9;
      const t = tiny.getContext('2d', { willReadFrequently: true });
      const hash = (v) => { t.drawImage(v, 0, 0, 16, 9); const d = t.getImageData(0, 0, 16, 9).data; let h = 0; for (let i = 0; i < d.length; i += 4) h = (Math.imul(h, 31) + d[i] + d[i + 1] * 7 + d[i + 2] * 13) | 0; return h; };
      const frame = () => new Promise((r) => requestAnimationFrame(r));
      const seekTo = (v, s) => new Promise((r) => { v.addEventListener('seeked', r, { once: true }); v.currentTime = s; });

      const trial = async (parkSeconds, wake) => {
        const v = document.createElement('video');
        v.muted = true; v.playsInline = true; v.preload = 'auto'; v.src = url;
        v.style.cssText = 'position:absolute;left:0;top:0;width:2px;height:2px';
        host.appendChild(v);
        await new Promise((r) => v.addEventListener('loadeddata', r, { once: true }));
        await seekTo(v, 0);
        if (wake && parkSeconds > 0.5) {
          await new Promise((r) => setTimeout(r, (parkSeconds - 0.5) * 1000));
          await seekTo(v, 0.001);
          await new Promise((r) => setTimeout(r, 500));
        } else {
          await new Promise((r) => setTimeout(r, parkSeconds * 1000));
        }
        await frame();
        const parked = hash(v);
        const t0 = performance.now();
        void v.play();
        let changedAt = null;
        while (performance.now() - t0 < 1500) {
          await frame();
          if (hash(v) !== parked) { changedAt = performance.now() - t0; break; }
        }
        v.pause();
        v.remove();
        return `${wake ? 'wake ' : 'plain'} parked ${String(parkSeconds).padStart(4)}s -> first new frame after ${changedAt === null ? 'never' : `${changedAt.toFixed(0)}ms`}`;
      };
      const results = [];
      for (const [p, w] of [[0.3, false], [2, false], [6, false], [6, true], [12, false], [12, true], [2, false], [6, true]]) results.push(await trial(p, w));
      return results;
    }, '/@fs/C:/Users/Yashjit%202/Workspace/Willow%20Code');
    console.log(out.join('\n'));
  } finally {
    await browser.close();
    try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch { /* still locked */ }
  }
})().catch((e) => { console.error(e); process.exit(1); });
