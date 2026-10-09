/**
 * Frame by frame, how the remote browser's pane opens and closes — in Gemini or in
 * Willow, measured the same way. Times are from the real click (the pointerdown the
 * mouse produced), each sample is one animation frame (what the frame painted), and
 * long tasks are listed so a stall shows as one.
 *
 *   node tools/scratch/rb-motion-frames.cjs gemini [runs] [task url]
 *   node tools/scratch/rb-motion-frames.cjs willow [runs]     (seeded task open, pane closed)
 *
 * Gemini opens in a tab of its own and only opens and closes the view. Results go to
 * tools/ui-research/captures/spark/134-remote-browser/motion/frames-<app>.json.
 */
const puppeteer = require('puppeteer-core');
const fs = require('fs');

const app = process.argv[2] || 'willow';
const runs = Number(process.argv[3] || 2);
const geminiUrl = process.argv[4] || 'https://gemini.google.com/spark/chat/e8f75eb7ea9620e7';

const SELECTORS = {
  gemini: {
    monitor: 'button[aria-label="Open remote browser and remote computer menu"]',
    item: '[role="menuitem"]',
    close: 'remy-side-panel button[aria-label*="lose"], computer-use-panel button[aria-label*="lose"]',
    boxes: {
      list: '.left-pane',
      right: '.right-pane',
      chat: '.right-pane-inner-wrapper',
      side: 'remy-side-panel',
      card: 'remy-side-panel .remy-side-panel',
      viewer: 'computer-use-panel .iframe-container, computer-use-panel vnc-viewer',
    },
  },
  willow: {
    monitor: 'button[aria-label="Open remote browser and remote computer menu"]',
    item: '.spark-task-detail__browser-menu [role="menuitem"]',
    close: 'button[aria-label="Close remote browser"]',
    boxes: {
      list: '.spark-task-detail__library',
      chat: '.spark-task-detail__panel',
      side: '.spark-task-detail__side-panel, .spark-task-detail__progress-panel.is-open',
      card: '.spark-task-detail__side-panel, .spark-task-detail__progress-panel.is-open',
      viewer: '.spark-task-detail__side-panel .spark-remote-browser__viewer',
    },
  },
}[app];

/** In the page: waits for the click, then records every frame for `durationMs`. */
const arm = (boxes, durationMs) => {
  window.__frames = null;
  const longTasks = [];
  const observer = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) longTasks.push({ at: entry.startTime, ms: Math.round(entry.duration) });
  });
  observer.observe({ type: 'longtask' });
  const frames = [];
  let clickAt = null;
  const read = () => {
    const sample = {};
    for (const [name, selector] of Object.entries(boxes)) {
      const element = [...document.querySelectorAll(selector)].find((el) => el.getBoundingClientRect().width > 0) ?? document.querySelector(selector);
      if (!element) continue;
      const r = element.getBoundingClientRect();
      const cs = getComputedStyle(element);
      sample[name] = { x: Math.round(r.x * 10) / 10, w: Math.round(r.width * 10) / 10, o: Math.round(Number(cs.opacity) * 100) / 100, hidden: cs.visibility === 'hidden' || cs.display === 'none' };
    }
    return sample;
  };
  const before = read();
  const step = (frameTime) => {
    frames.push({ t: Math.round(frameTime - clickAt), at: Math.round(performance.now() - clickAt), ...read() });
    if (performance.now() - clickAt < durationMs) requestAnimationFrame(step);
    else {
      observer.disconnect();
      window.__frames = {
        before,
        frames,
        longTasks: longTasks.filter((task) => task.at + task.ms >= clickAt).map((task) => ({ at: Math.round(task.at - clickAt), ms: task.ms })),
      };
    }
  };
  window.addEventListener('pointerdown', (event) => {
    clickAt = event.timeStamp;
    requestAnimationFrame(step);
  }, { capture: true, once: true });
};

const clickCenter = async (page, handle) => {
  const box = await handle?.boundingBox();
  if (!box) return false;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await new Promise((resolve) => setTimeout(resolve, 120));
  await page.mouse.down();
  await page.mouse.up();
  return true;
};

const visible = async (page, selector) => {
  for (const handle of await page.$$(selector)) if (await handle.boundingBox()) return handle;
  return null;
};

const record = async (page, target) => {
  await page.evaluate(arm, SELECTORS.boxes, 900);
  if (!(await clickCenter(page, target))) throw new Error('nothing to click');
  await page.waitForFunction(() => window.__frames, { timeout: 10_000 });
  return page.evaluate(() => window.__frames);
};

(async () => {
  const browser = await puppeteer.connect({ browserURL: 'http://[::1]:9222', defaultViewport: null });
  let page;
  let ownTab = false;
  if (app === 'gemini') {
    page = await browser.newPage();
    ownTab = true;
    await page.bringToFront();
    await page.goto(geminiUrl, { waitUntil: 'networkidle2', timeout: 60_000 });
    await page.waitForSelector(SELECTORS.monitor, { timeout: 60_000 });
    await new Promise((resolve) => setTimeout(resolve, 4000));
  } else {
    page = (await browser.pages()).find((p) => p.url().startsWith('http://localhost:3000') && !p.url().includes('/media'));
    if (!page) throw new Error('no willow tab');
    await page.bringToFront();
  }
  const out = { app, viewport: await page.evaluate(() => `${innerWidth}x${innerHeight}@${devicePixelRatio}`), runs: [] };
  try {
    for (let run = 0; run < runs; run += 1) {
      const monitor = await visible(page, SELECTORS.monitor);
      if (!(await clickCenter(page, monitor))) throw new Error('no visible monitor button');
      await page.waitForSelector(SELECTORS.item, { timeout: 5000 });
      await new Promise((resolve) => setTimeout(resolve, 500));
      const item = await page.evaluateHandle((selector) => [...document.querySelectorAll(selector)].find((el) => /view remote browser/i.test(el.textContent || '')), SELECTORS.item);
      const open = await record(page, item.asElement());
      await new Promise((resolve) => setTimeout(resolve, 1200));
      const close = await record(page, await visible(page, SELECTORS.close));
      await new Promise((resolve) => setTimeout(resolve, 1200));
      out.runs.push({ open, close });
    }
  } finally {
    const file = `tools/ui-research/captures/spark/134-remote-browser/motion/frames-${app}.json`;
    fs.writeFileSync(file, JSON.stringify(out, null, 1));
    console.log('saved', file, out.viewport, `${out.runs.length} runs`);
    if (ownTab) await page.close();
    browser.disconnect();
  }
})().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
