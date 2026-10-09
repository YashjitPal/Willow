/**
 * Records how Willow's remote browser opens and closes on the desktop, the same way
 * `gemini-rb-motion.cjs` records Gemini's: real clicks on the header's monitor button,
 * "View remote browser" and the pane's close button, sampling the split view every
 * ~8ms and logging every transition or animation started. Needs a seeded task with a
 * browser (`spark-rb-seed.cjs answered`) open in the Willow tab, with the pane closed.
 *
 *   node tools/scratch/willow-rb-motion.cjs <out.json>
 */
const puppeteer = require('puppeteer-core');
const fs = require('fs');

const startRecorder = (durationMs) => {
  const describe = (element) => {
    if (!element || !element.tagName) return null;
    const cls = typeof element.className === 'string' ? element.className.trim().split(/\s+/).slice(0, 2).join('.') : '';
    return `${element.tagName.toLowerCase()}${cls ? `.${cls}` : ''}`;
  };
  const boxes = {
    library: '.spark-task-detail__library',
    workspace: '.spark-task-detail__workspace',
    chat: '.spark-task-detail__panel',
    side: '.spark-task-detail__side-panel',
    progress: '.spark-task-detail__progress-panel',
    viewer: '.spark-task-detail__side-panel .spark-remote-browser__viewer',
    monitor: 'button[aria-label="Open remote browser and remote computer menu"]',
    menu: '.spark-task-detail__browser-menu',
  };
  const before = new Set(document.getAnimations());
  const seen = new Set();
  const animations = [];
  const samples = [];
  const t0 = performance.now();
  const tick = () => {
    const now = performance.now() - t0;
    for (const animation of document.getAnimations()) {
      if (before.has(animation) || seen.has(animation)) continue;
      seen.add(animation);
      const effect = animation.effect;
      const timing = effect ? effect.getTiming() : {};
      animations.push(`@${Math.round(now)} ${animation.constructor.name} ${animation.transitionProperty || animation.animationName || ''} on ${describe(effect && effect.target)} ${timing.duration}ms ${timing.easing}${timing.delay ? ` +${timing.delay}` : ''}`);
    }
    const sample = { t: Math.round(now) };
    for (const [name, selector] of Object.entries(boxes)) {
      const element = document.querySelector(selector);
      if (!element) continue;
      const r = element.getBoundingClientRect();
      const cs = getComputedStyle(element);
      sample[name] = `${r.x.toFixed(1)} ${r.width.toFixed(1)}w o${Number(cs.opacity).toFixed(2)}${cs.display === 'none' ? ' none' : ''}${cs.visibility === 'hidden' ? ' hidden' : ''}${cs.scale !== 'none' && cs.scale !== '1' ? ` s${cs.scale}` : ''}`;
    }
    samples.push(sample);
    if (now < durationMs) setTimeout(tick, 8);
    else window.__motionResult = { animations, samples };
  };
  window.__motionResult = null;
  tick();
};

const clickCenter = async (page, handle) => {
  const box = await handle?.boundingBox();
  if (!box) return false;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.up();
  return true;
};

(async () => {
  const out = process.argv[2] || 'tools/ui-research/captures/spark/134-remote-browser/motion/willow-desktop.json';
  const browser = await puppeteer.connect({ browserURL: 'http://[::1]:9222', defaultViewport: null });
  const page = (await browser.pages()).find((p) => p.url().startsWith('http://localhost:3000') && !p.url().includes('/media'));
  if (!page) throw new Error('no willow tab');
  await page.bringToFront();
  const result = {};
  const monitor = await page.$('button[aria-label="Open remote browser and remote computer menu"]');
  if (!(await clickCenter(page, monitor))) throw new Error('no monitor button (is a seeded task open, pane closed?)');
  await page.waitForSelector('.spark-task-detail__browser-menu [role="menuitem"]', { timeout: 5000 });
  await new Promise((resolve) => setTimeout(resolve, 400));
  await page.evaluate(startRecorder, 1200);
  await clickCenter(page, await page.$('.spark-task-detail__browser-menu [role="menuitem"]'));
  await page.waitForFunction(() => window.__motionResult, { timeout: 5000 });
  result.open = await page.evaluate(() => window.__motionResult);
  await new Promise((resolve) => setTimeout(resolve, 600));
  await page.evaluate(startRecorder, 1200);
  if (!(await clickCenter(page, await page.$('button[aria-label="Close remote browser"]')))) throw new Error('no close button');
  await page.waitForFunction(() => window.__motionResult, { timeout: 5000 });
  result.close = await page.evaluate(() => window.__motionResult);
  fs.writeFileSync(out, JSON.stringify(result, null, 1));
  for (const phase of ['open', 'close']) {
    console.log(`== ${phase}`);
    console.log(result[phase].animations.join('\n'));
    let last = '';
    for (const sample of result[phase].samples) {
      const line = ['library', 'chat', 'side', 'progress', 'viewer', 'monitor', 'menu'].map((key) => `${key}=${sample[key] ?? '-'}`).join(' | ');
      if (line !== last) console.log(`t=${sample.t}: ${line}`);
      last = line;
    }
  }
  browser.disconnect();
})().catch((e) => { console.error(e.message); process.exit(1); });
