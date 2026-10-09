// One-off: what scrolls at the right edge of the character page (a scrollbar pill showed there in
// the user's screenshot). Reuses w-character-page.cjs's seeded `char-page` project on :3101, opens
// the page with history open at a few window sizes, and lists every element that can scroll.
//   node tools/scratch/w-right-edge-scroll.cjs
const fs = require('fs');
const os = require('os');
const path = require('path');
const puppeteer = require('puppeteer-core');

const ORIGIN = 'http://localhost:3101';
const ROOT = '/@fs/C:/Users/Yashjit%202/Workspace/Willow%20Code';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'willow-edge-'));
  const browser = await puppeteer.launch({
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: true,
    userDataDir,
    defaultViewport: { width: 1536, height: 826, deviceScaleFactor: 1.25 },
    args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'],
    ignoreDefaultArgs: ['--hide-scrollbars'],
    protocolTimeout: 300000,
  });
  const page = (await browser.pages())[0];
  try {
    await page.goto(`${ORIGIN}/media`, { waitUntil: 'networkidle2', timeout: 180000 }).catch(() => {});
    await sleep(2500);
    await page.evaluate(async (root) => {
      const png = async () => {
        const c = new OffscreenCanvas(1376, 774);
        const g = c.getContext('2d');
        g.fillStyle = '#3c4c7d'; g.fillRect(0, 0, 1376, 774);
        const blob = await c.convertToBlob({ type: 'image/png' });
        return new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(blob); });
      };
      const reg = await import(`${root}/platform/projects/src/registry.ts`);
      const ms = await import(`${root}/platform/storage/src/media-storage.ts`);
      const mch = await import(`${root}/platform/storage/src/media-characters.ts`);
      const projectId = 'edge-test';
      reg.writeProjectRegistry([...reg.readProjectRegistry().filter((p) => p.id !== projectId), { id: projectId, name: 'Edge', kind: 'media' }]);
      const prompt = 'A towering humanoid figure carved from translucent violet crystal, its faceted face catching light in shifting prisms. Thin seams of molten gold run along its joints, and a cloak of woven copper wire trails behind it.';
      await ms.saveProjectMedia(projectId, [{ id: 'edge-portrait', kind: 'image', status: 'completed', url: await png(), prompt, modelId: 'gemini-3-pro-image', modelName: 'Nano Banana Pro', ratio: '16:9', timestamp: Date.now(), characterId: 'edge-char' }]);
      const db = await new Promise((res, rej) => { const r = indexedDB.open('WillowMediaDB'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
      const keys = await new Promise((res) => { const tx = db.transaction('project_media', 'readonly'); const q = tx.objectStore('project_media').getAllKeys(); q.onsuccess = () => res(q.result); });
      db.close();
      const key = keys.map(String).find((k) => k.endsWith(`:project:${projectId}`));
      const scope = decodeURIComponent(key.slice('scope:'.length, key.lastIndexOf(':project:')));
      await mch.saveCharacter(projectId, { id: 'edge-char', name: '', createdAt: Date.now(), updatedAt: Date.now(), portraitId: 'edge-portrait', prompt }, scope);
      localStorage.setItem('willow-media-character-history-open', 'true');
    }, ROOT);

    for (const [w, h, dpr] of [[1536, 826, 1.25], [1506, 865, 1.25], [1882, 1081, 1]]) {
      await page.setViewport({ width: w, height: h, deviceScaleFactor: dpr });
      await page.goto(`${ORIGIN}/media/characters?projectId=edge-test&character=edge-char`, { waitUntil: 'domcontentloaded' }).catch(() => {});
      for (let i = 0; i < 60 && !(await page.$('.ce-page .ce-frame__img')); i += 1) await sleep(400);
      await sleep(1500);
      const report = await page.evaluate(() => {
        const box = (el) => { const r = el.getBoundingClientRect(); return [r.x, r.y, r.width, r.height].map((v) => Math.round(v * 10) / 10).join(','); };
        const name = (el) => `${el.tagName.toLowerCase()}${el.className && typeof el.className === 'string' ? `.${el.className.trim().split(/\s+/).slice(0, 3).join('.')}` : ''}`;
        const scrollers = [...document.querySelectorAll('*')].filter((el) => {
          const cs = getComputedStyle(el);
          return /(auto|scroll)/.test(cs.overflowY) && el.scrollHeight > el.clientHeight + 0.5 && el.getBoundingClientRect().width > 0;
        }).map((el) => `${name(el)} [${box(el)}] scroll ${el.scrollHeight}/${el.clientHeight}`);
        const edge = document.elementsFromPoint(innerWidth - 3, innerHeight / 2).slice(0, 4).map(name);
        const root = document.scrollingElement;
        return { scrollers, edge, doc: `${root.scrollHeight}/${root.clientHeight}` };
      });
      console.log(`${w}x${h}@${dpr}`, JSON.stringify(report, null, 1));
    }
  } finally {
    await browser.close();
    try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch { /* locked */ }
  }
})().catch((e) => { console.error(e); process.exit(1); });
