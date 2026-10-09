/**
 * Read-only: records how Gemini Spark's remote browser opens and closes on the
 * desktop, in a tab of its own. Opens the task by URL, clicks the header's monitor
 * button and "View remote browser" with the real mouse, then the pane's close
 * button, and for each phase samples the split view every ~10ms (boxes, computed
 * flex/opacity/display) and logs every transition or animation started. Saves
 * screenshots at fixed offsets. Opens and closes a view only.
 *
 *   node tools/scratch/gemini-rb-motion.cjs <task url> <out-prefix>
 */
const puppeteer = require('puppeteer-core');
const fs = require('fs');

const startRecorder = (durationMs) => {
  const describe = (element) => {
    if (!element || !element.tagName) return null;
    const cls = typeof element.className === 'string' ? element.className.trim().split(/\s+/).slice(0, 3).join('.') : '';
    return `${element.tagName.toLowerCase()}${cls ? `.${cls}` : ''}`;
  };
  const boxes = {
    left: '.left-pane',
    right: '.right-pane',
    rightInner: '.right-pane-inner-wrapper',
    side: 'remy-side-panel',
    sideCard: 'remy-side-panel .remy-side-panel',
    panel: 'computer-use-panel',
    viewer: 'computer-use-panel .iframe-container, computer-use-panel vnc-viewer',
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
      animations.push({
        at: Math.round(now),
        type: animation.constructor.name,
        name: animation.transitionProperty || animation.animationName || animation.id || '',
        target: describe(effect && effect.target) + (effect && effect.pseudoElement ? effect.pseudoElement : ''),
        timing: effect ? (({ duration, delay, easing, fill }) => ({ duration, delay, easing, fill }))(effect.getTiming()) : null,
        keyframes: effect ? effect.getKeyframes().map(({ offset, computedOffset, easing, composite, ...props }) => ({ at: computedOffset, ...props })) : null,
      });
    }
    const sample = { t: Math.round(now) };
    for (const [name, selector] of Object.entries(boxes)) {
      const element = document.querySelector(selector);
      if (!element) continue;
      const r = element.getBoundingClientRect();
      const cs = getComputedStyle(element);
      sample[name] = `${r.x.toFixed(1)} ${r.width.toFixed(1)}w o${Number(cs.opacity).toFixed(2)} ${cs.display === 'none' ? 'none' : ''}${cs.transform !== 'none' ? ` ${cs.transform}` : ''}`.trim();
    }
    samples.push(sample);
    if (now < durationMs) setTimeout(tick, 8);
    else window.__motionResult = { animations, samples };
  };
  window.__motionResult = null;
  tick();
};

const computed = () => {
  const pick = (selector, props) => {
    const element = document.querySelector(selector);
    if (!element) return null;
    const cs = getComputedStyle(element);
    const r = element.getBoundingClientRect();
    return { rect: [r.x, r.y, r.width, r.height].map((v) => Math.round(v * 10) / 10), cls: element.className, ...Object.fromEntries(props.map((p) => [p, cs.getPropertyValue(p)])) };
  };
  const props = ['display', 'flex', 'flex-basis', 'flex-grow', 'width', 'min-width', 'max-width', 'opacity', 'visibility', 'padding', 'margin', 'gap', 'transition', 'transform', 'overflow'];
  return {
    split: pick('.split-pane-container', props),
    left: pick('.left-pane', props),
    right: pick('.right-pane', props),
    rightInner: pick('.right-pane-inner-wrapper', props),
    side: pick('remy-side-panel', props),
    sideCard: pick('remy-side-panel .remy-side-panel', props),
    panel: pick('computer-use-panel', props),
  };
};

const clickCenter = async (page, handle) => {
  const box = await handle?.asElement?.()?.boundingBox();
  if (!box) return false;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.up();
  return true;
};

(async () => {
  const url = process.argv[2] || 'https://gemini.google.com/spark/chat/e8f75eb7ea9620e7';
  const prefix = process.argv[3] || 'tools/ui-research/captures/spark/134-remote-browser/motion/desktop';
  fs.mkdirSync(require('path').dirname(prefix), { recursive: true });
  const browser = await puppeteer.connect({ browserURL: 'http://[::1]:9222', defaultViewport: null });
  const page = await browser.newPage();
  const result = {};
  try {
    await page.bringToFront();
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 60_000 });
    const MONITOR = 'button[aria-label="Open remote browser and remote computer menu"]';
    await page.waitForSelector(MONITOR, { timeout: 60_000 });
    await new Promise((resolve) => setTimeout(resolve, 4000));
    result.closedStyles = await page.evaluate(computed);
    let clicked = false;
    for (const candidate of await page.$$(MONITOR)) {
      if (await clickCenter(page, candidate)) { clicked = true; break; }
    }
    if (!clicked) throw new Error('no visible monitor button');
    await page.waitForSelector('[role="menuitem"]', { timeout: 5000 });
    await new Promise((resolve) => setTimeout(resolve, 400));
    const item = await page.evaluateHandle(() => [...document.querySelectorAll('[role="menuitem"]')].find((el) => /view remote browser/i.test(el.textContent || '')));
    await page.evaluate(startRecorder, 1400);
    if (!(await clickCenter(page, item))) throw new Error('no menu item');
    for (const at of [60, 150, 250, 450, 900]) {
      await new Promise((resolve) => setTimeout(resolve, at - (result.lastShot || 0)));
      result.lastShot = at;
      await page.screenshot({ path: `${prefix}-open-${at}.png` });
    }
    await page.waitForFunction(() => window.__motionResult, { timeout: 5000 });
    result.open = await page.evaluate(() => window.__motionResult);
    await new Promise((resolve) => setTimeout(resolve, 800));
    result.openStyles = await page.evaluate(computed);

    const closers = await page.$$('computer-use-panel button[aria-label*="lose"], remy-side-panel button[aria-label*="lose"]');
    let close = null;
    for (const candidate of closers) if (await candidate.boundingBox()) { close = candidate; break; }
    await page.evaluate(startRecorder, 1400);
    result.lastShot = 0;
    if (!(await clickCenter(page, close))) throw new Error('no close button');
    for (const at of [60, 150, 250, 450, 900]) {
      await new Promise((resolve) => setTimeout(resolve, at - (result.lastShot || 0)));
      result.lastShot = at;
      await page.screenshot({ path: `${prefix}-close-${at}.png` });
    }
    await page.waitForFunction(() => window.__motionResult, { timeout: 5000 });
    result.close = await page.evaluate(() => window.__motionResult);
    await new Promise((resolve) => setTimeout(resolve, 800));
    result.afterCloseStyles = await page.evaluate(computed);
    fs.writeFileSync(`${prefix}.json`, JSON.stringify(result, null, 1));
    console.log('saved', `${prefix}.json`);
  } finally {
    await page.close();
    browser.disconnect();
  }
})().catch((e) => { console.error(e.message); process.exit(1); });
