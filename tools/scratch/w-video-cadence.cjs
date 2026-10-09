// How evenly a playing <video> reaches a canvas through drawImage, measured as the gaps between
// changes of the drawn picture (a moving test clip changes every source frame). Three ways:
//   detached   the video is in no document (the Scenebuilder player's way)
//   attached   the same, but the video sits in the page, invisible
//   rvfc       drawn from requestVideoFrameCallback, once per new frame, video in the page
// On the :3101 origin in its own headless Chrome.
//   node tools/scratch/w-video-cadence.cjs [seconds=4]
const fs = require('fs');
const os = require('os');
const path = require('path');
const puppeteer = require('puppeteer-core');

const SECONDS = Number(process.argv[2] || 4);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'willow-cadence-'));
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
    const result = await page.evaluate(async (seconds, root) => {
      // An H.264 MP4 like Veo's: 24fps, 720p, every frame different, encoded frame by frame so
      // the clip itself has no dropped or doubled frames.
      const mw = await import(`${root}/features/media/src/scenes/mp4-write.ts`);
      const encode = async (secs, fps, w, h) => {
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
        enc.configure({ codec: 'avc1.640028', width: w, height: h, bitrate: 6_000_000, framerate: fps, avc: { format: 'avc' } });
        const c = new OffscreenCanvas(w, h);
        const g = c.getContext('2d');
        const n = Math.round(secs * fps);
        for (let i = 0; i < n; i += 1) {
          g.fillStyle = `hsl(${(i * 7) % 360}, 50%, 30%)`; g.fillRect(0, 0, w, h);
          for (let k = 0; k < 30; k += 1) { g.fillStyle = `hsl(${(k * 12) % 360}, 70%, 60%)`; g.fillRect((k * 97 + i * 11) % w, (k * 53) % h, 80, 80); }
          g.fillStyle = '#fff'; g.font = 'bold 160px sans-serif'; g.fillText(String(i), 80, 420);
          const frame = new VideoFrame(c, { timestamp: Math.round((i * 1e6) / fps), duration: Math.round(1e6 / fps) });
          enc.encode(frame, { keyFrame: i % (fps * 2) === 0 });
          frame.close();
          if (enc.encodeQueueSize > 8) await new Promise((r) => setTimeout(r, 0));
        }
        await enc.flush();
        enc.close();
        if (failure) throw failure;
        return mw.writeMp4({ width: w, height: h, description, chunks }, null);
      };
      const url = URL.createObjectURL(await encode(seconds + 2, 24, 1280, 720));

      const measure = async (mode) => {
        const v = document.createElement('video');
        v.muted = true; v.playsInline = true; v.preload = 'auto'; v.src = url;
        if (mode !== 'detached') {
          v.style.cssText = 'position:fixed;left:0;top:0;width:2px;height:2px;opacity:0.01;pointer-events:none';
          document.body.appendChild(v);
        }
        await new Promise((res) => v.addEventListener('loadeddata', res, { once: true }));
        const big = document.createElement('canvas');
        big.width = 1920; big.height = 1080;
        const bctx = big.getContext('2d');
        const tiny = document.createElement('canvas');
        tiny.width = 32; tiny.height = 18;
        const tctx = tiny.getContext('2d', { willReadFrequently: true });
        const changes = [];
        let last = null;
        const sample = (t) => {
          tctx.drawImage(big, 0, 0, 32, 18);
          const d = tctx.getImageData(0, 0, 32, 18).data;
          let h = 0;
          for (let i = 0; i < d.length; i += 4) h = (Math.imul(h, 31) + d[i] + d[i + 1] * 7 + d[i + 2] * 13) | 0;
          if (h !== last) { changes.push(t); last = h; }
        };
        await v.play();
        const t0 = performance.now();
        await new Promise((res) => {
          if (mode === 'rvfc') {
            const onFrame = (now) => {
              bctx.drawImage(v, 0, 0, 1920, 1080);
              sample(performance.now());
              if (performance.now() - t0 < seconds * 1000) v.requestVideoFrameCallback(onFrame); else res();
            };
            v.requestVideoFrameCallback(onFrame);
          } else {
            const tick = (t) => {
              bctx.drawImage(v, 0, 0, 1920, 1080);
              sample(t);
              if (t - t0 < seconds * 1000) requestAnimationFrame(tick); else res();
            };
            requestAnimationFrame(tick);
          }
        });
        v.pause();
        v.remove();
        const gaps = changes.slice(2).map((t, i) => t - changes[i + 1]).sort((a, b) => a - b);
        const q = (p) => gaps[Math.min(gaps.length - 1, Math.floor(p * gaps.length))] ?? 0;
        return `${mode.padEnd(9)} ${(changes.length / seconds).toFixed(1).padStart(5)} new pictures/s; gap median ${q(0.5).toFixed(1)}ms p90 ${q(0.9).toFixed(1)}ms p99 ${q(0.99).toFixed(1)}ms max ${(gaps[gaps.length - 1] ?? 0).toFixed(1)}ms; gaps >50ms: ${gaps.filter((g) => g > 50).length}`;
      };
      const out = [];
      for (const mode of ['detached', 'attached', 'rvfc', 'detached']) out.push(await measure(mode));
      return out;
    }, SECONDS, '/@fs/C:/Users/Yashjit%202/Workspace/Willow%20Code');
    console.log(result.join('\n'));
  } finally {
    await browser.close();
    try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch { /* still locked */ }
  }
})().catch((e) => { console.error(e); process.exit(1); });
