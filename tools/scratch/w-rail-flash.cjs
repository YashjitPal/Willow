// The video editor's switch from one video to another through its header's rail, frame by frame,
// on the :3101 test origin, in the responsive harness's headless Chrome and seeded project
// (tools/scratch/w-responsive.cjs seeds it). Every animation frame from the click on, it records
// whether the editor was there, whole (its rail drawn), and whether its picture was black: the
// canvas unpainted with no poster over it. Then it counts the black frames, and the rail's blank
// thumbnails.
//   node tools/scratch/w-rail-flash.cjs [--from=Tall city] [--to=Waves] [--to-image=Snow peaks]
const os = require('os');
const path = require('path');
const puppeteer = require('puppeteer-core');

const ORIGIN = 'http://localhost:3101';
const arg = (name, fallback) => (process.argv.find((a) => a.startsWith(`--${name}=`)) || `--${name}=${fallback}`).slice(name.length + 3);
const FROM = arg('from', 'Tall city');
const TO = arg('to', 'Waves');
const TO_IMAGE = arg('to-image', 'Snow peaks');
// Slows the page this many times over for the switch, as a slower machine or a longer, heavier
// video would: the seeded clips are two seconds of 640x360, ready almost at once.
const CPU = Number(arg('cpu', '1')) || 1;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const browser = await puppeteer.launch({
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: true,
    userDataDir: path.join(os.tmpdir(), 'willow-responsive-profile'),
    defaultViewport: { width: 1536, height: 826, deviceScaleFactor: 1 },
    args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
    protocolTimeout: 300000,
  });
  const page = (await browser.pages())[0];
  page.setDefaultTimeout(120000);
  try {
    await page.goto(`${ORIGIN}/media`, { waitUntil: 'domcontentloaded', timeout: 180000 });
    const projectId = await page.evaluate(async () => {
      const root = await navigator.storage.getDirectory();
      const proj = await (await (await root.getDirectoryHandle('willow-test-root')).getDirectoryHandle('Media')).getDirectoryHandle('Responsive');
      return JSON.parse(await (await (await proj.getFileHandle('.willow.json')).getFile()).text()).id;
    });
    await page.goto(`${ORIGIN}/media?projectId=${encodeURIComponent(projectId)}`, { waitUntil: 'domcontentloaded', timeout: 180000 });
    await page.waitForFunction(() => !document.querySelector('.flow-loading-host') && document.querySelectorAll('.gallery-tile').length > 3, { timeout: 120000 });
    await sleep(1500);

    const run = async (label, targetLabel) => {
      // Open FROM afresh each time, and let it settle: scene built, first frame painted.
      await page.evaluate(() => document.querySelector('.sb-back-btn')?.click());
      await sleep(800);
      const opened = await page.evaluate((name) => {
        const tile = [...document.querySelectorAll('.gallery-tile[data-id^="disk_video_"]')].find((t) => t.textContent.includes(name.split(' ')[0].toUpperCase()) || t.getAttribute('aria-label') === name);
        (tile ?? document.querySelector('.gallery-tile[data-id^="disk_video_"]'))?.click();
        return !!tile;
      }, FROM);
      await page.waitForFunction(() => document.querySelector('.sb-editor .sb-rail__thumb.is-active') && !document.querySelector('.sb-canvas-poster'), { timeout: 30000 }).catch(() => null);
      await sleep(2500);
      const before = await page.evaluate(() => document.querySelector('.sb-editor .sb-title')?.textContent?.trim());

      await page.evaluate((recordMs) => {
        const frames = [];
        window.__flash = frames;
        const t0 = performance.now();
        const sample = () => {
          const editor = document.querySelector('.sb-editor');
          const whole = !!document.querySelector('.sb-editor .sb-header__center');
          const canvas = document.querySelector('.sb-editor .sb-canvas');
          const poster = !!document.querySelector('.sb-canvas-poster');
          const image = document.querySelector('.sb-editor .ie-read-only-image, .sb-editor .ie-image-container img');
          let painted = null;
          if (canvas) {
            try {
              const [r, g, b, a] = canvas.getContext('2d').getImageData(canvas.width / 2, canvas.height / 2, 1, 1).data;
              painted = a > 0 && r + g + b > 30;
            } catch { painted = null; }
          }
          const imageShown = image ? image.complete && image.naturalWidth > 0 : null;
          const blank = !editor || !whole || (canvas ? !painted && !poster : imageShown === false);
          frames.push({ t: Math.round(performance.now() - t0), editor: !!editor, whole, painted, poster, imageShown, blank, placeholders: document.querySelectorAll('.sb-rail__placeholder').length });
          if (performance.now() - t0 < recordMs) requestAnimationFrame(sample);
        };
        requestAnimationFrame(sample);
      }, 2500 * Math.min(CPU, 3));
      // A video other than the open one, when the target names a video.
      const target = targetLabel === TO ? [TO, 'Tall city', 'Cat running', 'Waves'].find((name) => name !== before) : targetLabel;
      const cdp = await page.target().createCDPSession();
      if (CPU > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU });
      const clicked = await page.evaluate((name) => {
        const thumb = [...document.querySelectorAll('.sb-rail__thumb')].find((b) => b.getAttribute('aria-label') === name);
        thumb?.click();
        return !!thumb;
      }, target);
      await sleep(2700 * Math.min(CPU, 3));
      if (CPU > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
      const frames = await page.evaluate(() => window.__flash);
      const after = await page.evaluate(() => document.querySelector('.sb-editor .sb-title')?.textContent?.trim() ?? document.querySelector('.sb-editor input')?.value);
      const blank = frames.filter((f) => f.blank);
      const spans = [];
      for (const f of frames) {
        const last = spans.at(-1);
        if (f.blank && last && last.open) last.end = f.t;
        else if (f.blank) spans.push({ start: f.t, end: f.t, open: true });
        else if (last) last.open = false;
      }
      console.log(`${label}: ${before} -> ${after} (opened tile ${opened}, clicked ${clicked})`);
      console.log(`  frames ${frames.length}, black ${blank.length}, black spans ${JSON.stringify(spans.map((s) => [s.start, s.end]))}`);
      console.log(`  states: ${JSON.stringify([...new Set(frames.map((f) => `${f.editor ? 'E' : '-'}${f.whole ? 'W' : '-'}${f.painted ? 'P' : f.painted === false ? 'p' : '.'}${f.poster ? 'O' : '-'}${f.imageShown ? 'I' : f.imageShown === false ? 'i' : '.'}`))])}`);
      console.log(`  most blank rail thumbnails at once: ${Math.max(...frames.map((f) => f.placeholders))}`);
    };

    await run('video to video', TO);
    await run('video to image', TO_IMAGE);
  } catch (e) {
    console.error('FAILED:', e.stack || e.message);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();
