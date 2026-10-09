// Repro: what clicking a video tile shows, and for how long. Own headless Chrome; an OPFS folder
// stands in for the user's connected folder. Makes a 5s test clip in the page (WebCodecs + the
// app's mp4-write), writes N copies to Media/Open Test/Videos, opens the project, clicks a video
// tile, then samples the editor every 100ms: is the scene built (timeline/canvas present) or is it
// the empty black editor, plus screenshots and any page errors.
//   node tools/scratch/w-video-open.cjs [videos=8]
const fs = require('fs');
const os = require('os');
const path = require('path');
const puppeteer = require('puppeteer-core');

const N = Number(process.argv[2] || 8);
const ROOT = '/@fs/C:/Users/Yashjit 2/Workspace/Willow Code/features/media/src/scenes/';
const OUT = path.join(os.tmpdir(), 'willow-perf', 'video-open');

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await puppeteer.launch({
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: true,
    userDataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'willow-open-')),
    defaultViewport: { width: 1536, height: 826, deviceScaleFactor: 1.25 },
    args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
    protocolTimeout: 600000,
  });
  const errors = [];
  try {
    const page = (await browser.pages())[0];
    page.on('pageerror', (e) => errors.push(`pageerror: ${String(e).slice(0, 300)}`));
    page.on('console', (m) => { if (m.type() === 'error' && !/Invalid DOM property/.test(m.text())) errors.push(`console: ${m.text().slice(0, 300)}`); });
    await page.goto('http://localhost:3101/media', { waitUntil: 'networkidle2', timeout: 180000 }).catch(() => {});
    await page.evaluate(async (base, n) => {
      const { writeMp4 } = await import(encodeURI(`${base}mp4-write.ts`));
      const W = 1280; const H = 720; const FPS = 24; const SR = 48000; const SECS = 5;
      const vChunks = []; let vDesc = null;
      const venc = new VideoEncoder({ output: (c, m) => { const d = new Uint8Array(c.byteLength); c.copyTo(d); vChunks.push({ data: d, timestamp: c.timestamp, duration: c.duration, key: c.type === 'key' }); if (m?.decoderConfig?.description && !vDesc) vDesc = new Uint8Array(m.decoderConfig.description); }, error: (e) => { throw e; } });
      venc.configure({ codec: 'avc1.640028', width: W, height: H, bitrate: 3e6, framerate: FPS, avc: { format: 'avc' } });
      const cv = new OffscreenCanvas(W, H); const g = cv.getContext('2d');
      for (let i = 0; i < SECS * FPS; i += 1) {
        const grad = g.createLinearGradient(0, 0, W, H);
        grad.addColorStop(0, `hsl(${(i * 3) % 360} 70% 40%)`); grad.addColorStop(1, `hsl(${(i * 3 + 120) % 360} 70% 50%)`);
        g.fillStyle = grad; g.fillRect(0, 0, W, H);
        g.fillStyle = '#fff'; g.font = '120px sans-serif'; g.fillText(`frame ${i}`, 80 + i * 4, 400);
        const f = new VideoFrame(cv, { timestamp: Math.round((i / FPS) * 1e6), duration: Math.round(1e6 / FPS) });
        venc.encode(f, { keyFrame: i % FPS === 0 }); f.close();
      }
      await venc.flush(); venc.close();
      const pcm = new Float32Array(SECS * SR);
      for (let s = 0; s < pcm.length; s += 1) pcm[s] = 0.2 * Math.sin((2 * Math.PI * 440 * s) / SR);
      const aChunks = []; let aDesc = null;
      const aenc = new AudioEncoder({ output: (c, m) => { const d = new Uint8Array(c.byteLength); c.copyTo(d); aChunks.push({ data: d, timestamp: c.timestamp, duration: c.duration }); if (m?.decoderConfig?.description && !aDesc) aDesc = new Uint8Array(m.decoderConfig.description); }, error: (e) => { throw e; } });
      aenc.configure({ codec: 'mp4a.40.2', sampleRate: SR, numberOfChannels: 2, bitrate: 128000 });
      for (let at = 0; at < pcm.length; at += 1024) {
        const k = Math.min(1024, pcm.length - at);
        const planar = new Float32Array(k * 2); planar.set(pcm.subarray(at, at + k), 0); planar.set(pcm.subarray(at, at + k), k);
        const ad = new AudioData({ format: 'f32-planar', sampleRate: SR, numberOfFrames: k, numberOfChannels: 2, timestamp: Math.round((at / SR) * 1e6), data: planar });
        aenc.encode(ad); ad.close();
      }
      await aenc.flush(); aenc.close();
      const clip = writeMp4({ width: W, height: H, description: vDesc, chunks: vChunks }, { sampleRate: SR, channels: 2, description: aDesc, chunks: aChunks });
      const root = await navigator.storage.getDirectory();
      const base0 = await root.getDirectoryHandle('willow-test-root', { create: true });
      const proj = await (await base0.getDirectoryHandle('Media', { create: true })).getDirectoryHandle('Open Test', { create: true });
      const vids = await proj.getDirectoryHandle('Videos', { create: true });
      for (let i = 0; i < n; i += 1) {
        const h = await vids.getFileHandle(`test clip ${i + 1}.mp4`, { create: true });
        const w = await h.createWritable(); await w.write(clip); await w.close();
      }
      const db = await new Promise((resolve, reject) => {
        const req = indexedDB.open('WillowLocalFS', 1);
        req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains('handles')) req.result.createObjectStore('handles'); };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      await new Promise((resolve, reject) => {
        const tx = db.transaction('handles', 'readwrite');
        tx.objectStore('handles').put({ handle: base0, rootId: 'opfs-test-root' }, 'local_projects_dir');
        tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
      });
      db.close();
    }, ROOT, N);
    await page.goto('http://localhost:3101/media', { waitUntil: 'networkidle2' }).catch(() => {});
    await new Promise((r) => setTimeout(r, 8000));
    const id = await page.evaluate(async () => {
      const root = await navigator.storage.getDirectory();
      const proj = await (await (await root.getDirectoryHandle('willow-test-root')).getDirectoryHandle('Media')).getDirectoryHandle('Open Test');
      return JSON.parse(await (await (await proj.getFileHandle('.willow.json')).getFile()).text()).id;
    });
    await page.goto(`http://localhost:3101/media?projectId=${encodeURIComponent(id)}`, { waitUntil: 'domcontentloaded' }).catch(() => {});
    for (let i = 0; i < 40; i += 1) {
      await new Promise((r) => setTimeout(r, 500));
      if ((await page.evaluate(() => document.querySelectorAll('main video').length)) >= N) break;
    }
    await new Promise((r) => setTimeout(r, 2000));
    const box = await page.evaluate(() => {
      const r = document.querySelector('main video').closest('.gallery-tile').getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    });
    if (process.argv.includes('--fail-chunk')) {
      // As the dev server answers while a file in the editor's import graph is mid-edit.
      await page.setRequestInterception(true);
      page.on('request', (req) => {
        if (req.url().includes('/scenes/SceneBuilder.tsx')) req.respond({ status: 500, contentType: 'text/plain', body: 'Internal server error' });
        else req.continue();
      });
    }
    await page.mouse.move(box.x, box.y, { steps: 5 });
    await new Promise((r) => setTimeout(r, 300));
    const t0 = Date.now();
    await page.mouse.click(box.x, box.y);
    const samples = [];
    for (let i = 0; i < 60; i += 1) {
      const st = await page.evaluate(() => {
        const ed = document.querySelector('.sb-editor');
        if (!document.getElementById('root')?.childElementCount) return 'APP UNMOUNTED (empty #root)';
        if (!ed) return 'no editor';
        const built = !!ed.querySelector('.sb-timeline, canvas');
        const canvas = ed.querySelector('canvas');
        return `${built ? 'scene built' : 'EMPTY (black, back arrow only)'}${canvas ? ` canvas ${canvas.width}x${canvas.height}` : ''}`;
      });
      samples.push(`${Date.now() - t0}ms ${st}`);
      if ([1, 5, 15, 30].includes(i)) fs.writeFileSync(path.join(OUT, `after-${String(Date.now() - t0).padStart(5, '0')}ms.png`), await page.screenshot());
      if (/scene built|UNMOUNTED/.test(st) && i > 15) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    const collapsed = samples.filter((s, i) => i === 0 || s.replace(/^\d+ms /, '') !== samples[i - 1].replace(/^\d+ms /, ''));
    console.log(collapsed.join('\n'));
    if (process.argv.includes('--twice')) {
      // Back to the gallery, then another video: the editor's code is loaded now, so it renders at
      // once, before that video's scene has been built.
      await page.keyboard.press('Escape');
      await new Promise((r) => setTimeout(r, 1500));
      const second = await page.evaluate(() => {
        const r = [...document.querySelectorAll('main video')][1].closest('.gallery-tile').getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      });
      await page.mouse.move(second.x, second.y, { steps: 5 });
      await new Promise((r) => setTimeout(r, 300));
      const t2 = Date.now();
      await page.mouse.click(second.x, second.y);
      const again = [];
      for (let i = 0; i < 40; i += 1) {
        again.push(`${Date.now() - t2}ms ${await page.evaluate(() => {
          if (!document.getElementById('root')?.childElementCount) return 'APP UNMOUNTED (empty #root)';
          const ed = document.querySelector('.sb-editor');
          if (!ed) return document.querySelector('main') ? 'gallery (no editor)' : 'no gallery, no editor';
          return ed.querySelector('.sb-timeline, canvas') ? 'scene built' : 'EMPTY (black, back arrow only)';
        })}`);
        await new Promise((r) => setTimeout(r, 50));
      }
      console.log('second video:');
      console.log(again.filter((s, i) => i === 0 || s.replace(/^\d+ms /, '') !== again[i - 1].replace(/^\d+ms /, '')).join('\n'));
      fs.writeFileSync(path.join(OUT, 'second-open.png'), await page.screenshot());
    }
    if (process.argv.includes('--hmr-app')) {
      // What the dev server does to every open page when App.tsx is saved: the module re-runs with a
      // new timestamp and Fast Refresh applies it. Done here in this page only, by importing it so.
      await page.evaluate(() => { document.querySelector('main')?.setAttribute('data-before-hmr', '1'); });
      const t1 = Date.now();
      await page.evaluate(async () => { await import(`/src/app/App.tsx?t=${Date.now()}`); });
      const after = [];
      for (let i = 0; i < 30; i += 1) {
        after.push(`${Date.now() - t1}ms ${await page.evaluate(() => {
          const root = document.getElementById('root');
          const main = document.querySelector('main');
          const editor = document.querySelector('.sb-editor');
          const black = root && root.firstElementChild && !main && !editor;
          return `${main ? (main.hasAttribute('data-before-hmr') ? 'same gallery' : 'NEW gallery (remounted)') : 'no gallery'} | ${editor ? 'editor open' : 'editor gone'}${black ? ' | BLACK fallback' : ''}`;
        })}`);
        await new Promise((r) => setTimeout(r, 100));
      }
      console.log('after App.tsx hot update:');
      console.log(after.filter((s, i) => i === 0 || s.replace(/^\d+ms /, '') !== after[i - 1].replace(/^\d+ms /, '')).join('\n'));
      fs.writeFileSync(path.join(OUT, 'after-app-hmr.png'), await page.screenshot());
    }
    console.log('snackbar:', await page.evaluate(() => [...document.querySelectorAll('[class*="snack"]')].map((e) => e.textContent.trim()).filter(Boolean).slice(0, 1).join(' ') || 'none'));
    console.log('errors:', errors.length ? `\n${errors.join('\n')}` : 'none');
    fs.writeFileSync(path.join(OUT, 'final.png'), await page.screenshot());
  } finally {
    await browser.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });
