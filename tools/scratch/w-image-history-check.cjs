// One-off: the image editor's history column after ImageHistory moved to Flow's rule (a version made
// from a prompt shows its prompt, ingredients, Flag output and Reuse prompt; an upload shows none).
// Seeds a generated image with one edit, and an upload, on :3101 in a headless Chrome.
//   node tools/scratch/w-image-history-check.cjs
const fs = require('fs');
const os = require('os');
const path = require('path');
const puppeteer = require('puppeteer-core');

const ORIGIN = 'http://localhost:3101';
const ROOT = '/@fs/C:/Users/Yashjit%202/Workspace/Willow%20Code';
const OUT = path.resolve('tools/ui-research/captures/flow/media/willow/image-history');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (label, ok, detail) => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${detail === undefined ? '' : ` :: ${JSON.stringify(detail)}`}`);
};

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'willow-imghist-'));
  const browser = await puppeteer.launch({
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: true,
    userDataDir,
    defaultViewport: { width: 1536, height: 826, deviceScaleFactor: 1.25 },
    args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'],
    protocolTimeout: 300000,
  });
  const page = (await browser.pages())[0];
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.message || e).slice(0, 300)));
  try {
    await page.goto(`${ORIGIN}/media`, { waitUntil: 'networkidle2', timeout: 180000 }).catch(() => {});
    await sleep(3000);
    await page.evaluate(async (root) => {
      const png = async (color, text) => {
        const c = new OffscreenCanvas(1280, 720);
        const g = c.getContext('2d');
        g.fillStyle = color; g.fillRect(0, 0, 1280, 720);
        g.fillStyle = '#fff'; g.font = 'bold 120px sans-serif'; g.fillText(text, 80, 400);
        const blob = await c.convertToBlob({ type: 'image/png' });
        return new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(blob); });
      };
      const reg = await import(`${root}/platform/projects/src/registry.ts`);
      const ms = await import(`${root}/platform/storage/src/media-storage.ts`);
      const projectId = 'img-hist';
      reg.writeProjectRegistry([...reg.readProjectRegistry().filter((p) => p.id !== projectId), { id: projectId, name: 'Img Hist', kind: 'media' }]);
      const now = Date.UTC(2026, 9, 2, 12, 0, 0);
      const root0 = await png('#24304f', 'ROOT');
      await ms.saveProjectMedia(projectId, [
        { id: 'gen-edit', kind: 'image', status: 'completed', url: await png('#5a3a5a', 'EDIT'), prompt: 'make the sky pink', modelId: 'gemini-3.1-flash-image', modelName: 'Nano Banana 2', ratio: '16:9', timestamp: now, historyGroupId: 'gen-root', historyParentId: 'gen-root', attachments: [{ id: 'gen-root', url: root0, name: 'a calm lake at dawn', kind: 'image' }] },
        { id: 'gen-root', kind: 'image', status: 'completed', url: root0, prompt: 'a calm lake at dawn', modelId: 'gemini-3.1-flash-image', modelName: 'Nano Banana 2', ratio: '16:9', timestamp: now - 1000, historyGroupId: 'gen-root' },
        { id: 'upload-1', kind: 'image', status: 'completed', url: await png('#2f4f3f', 'UPLOAD'), prompt: 'holiday photo', modelId: 'upload', modelName: 'Upload', ratio: '16:9', timestamp: now - 2000 },
      ]);
    }, ROOT);

    // The gallery shows an image's newest version in its original's place, so either id may be the tile's.
    const openEditor = async (ids) => {
      await page.goto(`${ORIGIN}/media?projectId=img-hist`, { waitUntil: 'domcontentloaded' }).catch(() => {});
      let id = null;
      for (let i = 0; i < 150 && !id; i += 1) {
        id = await page.evaluate((list) => list.find((x) => document.querySelector(`.gallery-tile[data-id="${x}"] img`)) || null, ids);
        if (!id) await sleep(400);
      }
      console.log('tiles', JSON.stringify(await page.evaluate(() => [...document.querySelectorAll('.gallery-tile')].map((t) => t.dataset.id))));
      if (!id) throw new Error(`no tile for ${ids.join(' / ')}`);
      await sleep(1500);
      await page.click(`.gallery-tile[data-id="${id}"]`);
      for (let i = 0; i < 100 && !(await page.$('.ie-page .ie-history .sb-step')); i += 1) await sleep(300);
      await sleep(1500);
    };
    const steps = () => page.evaluate(() => [...document.querySelectorAll('.ie-page .ie-history .sb-step')].map((s) => ({
      prompt: s.querySelector('.sb-prompt-row__text')?.textContent || null,
      chips: s.querySelectorAll('.ie-chip').length,
      buttons: [...s.querySelectorAll('.sb-hotbar button')].map((b) => b.getAttribute('aria-label')),
      promptWidth: s.querySelector('.sb-prompt-row') ? Math.round(s.querySelector('.sb-prompt-row').getBoundingClientRect().width) : null,
    })));

    await openEditor(['gen-edit', 'gen-root']);
    const generated = await steps();
    console.log(JSON.stringify(generated));
    check('generated root: its prompt, Flag output and Reuse prompt', generated[0]?.prompt === 'a calm lake at dawn' && generated[0].buttons.join('|') === 'Save to projects|Download|Flag output|Reuse prompt', generated[0]);
    check('edit: its source as the one ingredient chip, its prompt, all four buttons', generated[1]?.prompt === 'make the sky pink' && generated[1].chips === 1 && generated[1].buttons.length === 4, generated[1]);
    check('a short prompt row hugs its text', generated[1]?.promptWidth < 200, generated[1]?.promptWidth);
    await page.screenshot({ path: path.join(OUT, 'generated.png') });

    await openEditor(['upload-1']);
    const upload = await steps();
    check('upload: no prompt, no chips, only Save to projects and Download', upload.length === 1 && upload[0].prompt === null && upload[0].chips === 0 && upload[0].buttons.join('|') === 'Save to projects|Download', upload);
    await page.screenshot({ path: path.join(OUT, 'upload.png') });
    check('no page errors', errors.length === 0, errors.slice(0, 5));
  } finally {
    await browser.close();
    try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch { /* locked */ }
  }
  console.log(failures ? `\n${failures} FAILED` : '\nALL PASS');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
