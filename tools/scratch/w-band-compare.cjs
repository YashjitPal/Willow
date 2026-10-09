// Willow's collection tile drawn from Flow's own cover pictures, compared pixel by pixel with Flow's
// capture (tools/ui-research/captures/flow/media/collections/band/flow-rest.png). Own headless
// Chrome at the user's 1536x826, DPR 1.25; an OPFS folder holds Media/Band Test/Untitled
// collection/ with the four covers (Flow's slot-0 picture newest, so it is the cover at rest).
// The tile is forced to Flow's size, shot at device pixels, and diffed: whole tile, the title band,
// and the band minus the title text.
//   node tools/scratch/w-band-compare.cjs [size=324]
const fs = require('fs');
const os = require('os');
const path = require('path');
const puppeteer = require('puppeteer-core');

const SIZE = Number(process.argv[2] || 324);
const BAND = path.resolve('tools/ui-research/captures/flow/media/collections/band');

(async () => {
  const browser = await puppeteer.launch({
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: true,
    userDataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'willow-band-')),
    defaultViewport: { width: 1536, height: 826, deviceScaleFactor: 1.25 },
    args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--font-render-hinting=none'],
    protocolTimeout: 300000,
  });
  try {
    const page = (await browser.pages())[0];
    await page.goto('http://localhost:3101/media', { waitUntil: 'networkidle2', timeout: 180000 }).catch(() => {});
    const files = ['flow-cover-1.jpg', 'flow-cover-2.jpg', 'flow-cover-1.jpg', 'flow-cover-0.jpg'].map((f) => fs.readFileSync(path.join(BAND, f)).toString('base64'));
    await page.evaluate(async (list) => {
      const root = await navigator.storage.getDirectory();
      const base = await root.getDirectoryHandle('willow-test-root', { create: true });
      const proj = await (await base.getDirectoryHandle('Media', { create: true })).getDirectoryHandle('Band Test', { create: true });
      const dir = await proj.getDirectoryHandle('Untitled collection', { create: true });
      for (let i = 0; i < list.length; i += 1) {
        const blob = await (await fetch(`data:image/jpeg;base64,${list[i]}`)).blob();
        const h = await dir.getFileHandle(`cover ${i + 1}.jpg`, { create: true });
        const w = await h.createWritable(); await w.write(blob); await w.close();
        await new Promise((r) => setTimeout(r, 1100));
      }
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
    }, files);
    await page.goto('http://localhost:3101/media', { waitUntil: 'networkidle2' }).catch(() => {});
    await new Promise((r) => setTimeout(r, 8000));
    const id = await page.evaluate(async () => {
      const root = await navigator.storage.getDirectory();
      const proj = await (await (await root.getDirectoryHandle('willow-test-root')).getDirectoryHandle('Media')).getDirectoryHandle('Band Test');
      return JSON.parse(await (await (await proj.getFileHandle('.willow.json')).getFile()).text()).id;
    });
    await page.goto(`http://localhost:3101/media?projectId=${encodeURIComponent(id)}`, { waitUntil: 'domcontentloaded' }).catch(() => {});
    for (let i = 0; i < 40; i += 1) {
      await new Promise((r) => setTimeout(r, 500));
      if (await page.evaluate(() => !!document.querySelector('[data-drop-collection] img.ct-thumb.is-active')?.complete)) break;
    }
    await new Promise((r) => setTimeout(r, 2500));
    await page.mouse.move(1530, 820);
    const rect = await page.evaluate((px) => {
      const tile = document.querySelector('[data-drop-collection]');
      tile.style.flexGrow = '0';
      tile.style.flexBasis = `${px}px`;
      tile.style.width = `${px}px`;
      tile.style.height = `${px}px`;
      const b = tile.getBoundingClientRect();
      return { x: b.x, y: b.y, width: b.width, height: b.height, title: tile.querySelector('.ct-title-text')?.textContent, counts: tile.querySelector('.ct-counts')?.textContent };
    }, SIZE);
    const cdp = await page.createCDPSession();
    // The user's screen: 1.25 device pixels per CSS pixel, so the tile is drawn at 405 device px.
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1536, height: 826, deviceScaleFactor: 1.25, mobile: false });
    await new Promise((r) => setTimeout(r, 2000));
    const r2 = await page.evaluate(() => { const b = document.querySelector('[data-drop-collection]').getBoundingClientRect(); return { x: b.x, y: b.y, width: b.width, height: b.height, dpr: devicePixelRatio }; });
    console.log('willow tile', JSON.stringify({ ...rect, ...r2 }));
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', clip: { x: r2.x, y: r2.y, width: r2.width, height: r2.height, scale: 1 } });
    fs.writeFileSync(path.join(BAND, 'willow-rest.png'), Buffer.from(data, 'base64'));
    // Diff against Flow's shot, in the page.
    const flow = fs.readFileSync(path.join(BAND, 'flow-rest.png')).toString('base64');
    const result = await page.evaluate(async (a, b) => {
      const load = async (s) => { const i = new Image(); i.src = `data:image/png;base64,${s}`; await i.decode(); return i; };
      const [A, B] = [await load(a), await load(b)];
      const w = Math.min(A.naturalWidth, B.naturalWidth); const h = Math.min(A.naturalHeight, B.naturalHeight);
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      const g = c.getContext('2d', { willReadFrequently: true });
      g.drawImage(A, 0, 0); const da = g.getImageData(0, 0, w, h).data;
      g.drawImage(B, 0, 0); const db = g.getImageData(0, 0, w, h).data;
      const region = (x0, y0, x1, y1, skip) => {
        let sum = 0; let max = 0; let n = 0;
        for (let y = y0; y < y1; y += 1) for (let x = x0; x < x1; x += 1) {
          if (skip && skip(x, y)) continue;
          const i = (y * w + x) * 4;
          for (let k = 0; k < 3; k += 1) { const d = Math.abs(da[i + k] - db[i + k]); sum += d; if (d > max) max = d; n += 1; }
        }
        return { meanAbsDiff: Math.round((sum / n) * 100) / 100, maxDiff: max };
      };
      // Rows by band: the band starts at the title box (top 180.8 css px at 324 → scaled).
      const s = w / 324;
      const bandTop = Math.round(180.8 * s);
      const rows = [];
      for (let y0 = 0; y0 < h; y0 += Math.round(20 * s)) rows.push(`${Math.round(y0 / s)}px:${region(0, y0, w, Math.min(h, y0 + Math.round(20 * s))).meanAbsDiff}`);
      const diffImg = g.createImageData(w, h);
      for (let i = 0; i < da.length; i += 4) { const d = Math.max(...[0, 1, 2].map((k) => Math.abs(da[i + k] - db[i + k]))); diffImg.data[i] = diffImg.data[i + 1] = diffImg.data[i + 2] = Math.min(255, d * 6); diffImg.data[i + 3] = 255; }
      g.putImageData(diffImg, 0, 0);
      return {
        size: `${w}x${h} (flow ${A.naturalWidth}x${A.naturalHeight}, willow ${B.naturalWidth}x${B.naturalHeight})`,
        whole: region(0, 0, w, h),
        aboveBand: region(0, 0, w, bandTop),
        band: region(0, bandTop, w, h),
        rowsMeanDiff: rows.join(' '),
        diffPng: c.toDataURL('image/png').split(',')[1],
      };
    }, flow, data);
    fs.writeFileSync(path.join(BAND, 'diff-rest-x6.png'), Buffer.from(result.diffPng, 'base64'));
    delete result.diffPng;
    console.log(JSON.stringify(result, null, 1));
  } finally {
    await browser.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });
