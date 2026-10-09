/**
 * Read-only: what is inside Gemini Spark's opened file — the Google Docs embed's own
 * header and toolbar — and how its close button closes the side panel. Opens the task in
 * a tab of its own, presses Open, dumps the Docs frame's top 160px (boxes, type, colours),
 * screenshots the pane, then presses the frame's close button and samples the motion.
 * Nothing in the document is clicked or typed into.
 *
 *   node tools/scratch/gemini-file-frame.cjs <task url> <out-prefix>
 */
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const dumpTop = (maxY) => {
  const nodes = [];
  for (const el of document.querySelectorAll('body *')) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0 || r.y > maxY || r.bottom < 0) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none') continue;
    const own = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent.trim()).join(' ').trim();
    nodes.push({
      tag: el.tagName.toLowerCase(),
      cls: (typeof el.className === 'string' ? el.className : '').slice(0, 120),
      id: el.id || undefined,
      aria: el.getAttribute('aria-label') || el.getAttribute('data-tooltip') || undefined,
      text: own.slice(0, 60) || undefined,
      rect: [r.x, r.y, r.width, r.height].map((v) => Math.round(v * 10) / 10),
      font: `${cs.fontSize}/${cs.lineHeight} ${cs.fontWeight} ${cs.fontFamily.split(',')[0]}`,
      color: cs.color,
      bg: cs.backgroundColor !== 'rgba(0, 0, 0, 0)' ? cs.backgroundColor : undefined,
      bgImage: cs.backgroundImage !== 'none' ? cs.backgroundImage.slice(0, 120) : undefined,
      radius: cs.borderRadius !== '0px' ? cs.borderRadius : undefined,
      pad: cs.padding !== '0px' ? cs.padding : undefined,
      border: cs.borderStyle !== 'none' && cs.borderTopWidth !== '0px' ? `${cs.borderTopWidth} ${cs.borderTopColor}` : undefined,
      shadow: cs.boxShadow !== 'none' ? cs.boxShadow : undefined,
    });
    if (nodes.length > 700) break;
  }
  return { url: location.href.slice(0, 160), viewport: [innerWidth, innerHeight], bodyBg: getComputedStyle(document.body).backgroundColor, nodes };
};

const recorder = (durationMs) => {
  const boxes = {
    left: '.left-pane',
    chat: '.right-pane-inner-wrapper',
    side: 'remy-side-panel',
    sideCard: 'remy-side-panel .remy-side-panel',
    frame: 'iframe.embedded-doc-frame',
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
      const target = effect && effect.target;
      animations.push({
        at: Math.round(now),
        name: animation.transitionProperty || animation.animationName || '',
        target: target ? `${target.tagName.toLowerCase()}.${String(target.className).trim().split(/\s+/).slice(0, 3).join('.')}` : null,
        timing: effect ? (({ duration, delay, easing }) => ({ duration, delay, easing }))(effect.getTiming()) : null,
        keyframes: effect ? effect.getKeyframes().map(({ offset, computedOffset, easing, composite, ...props }) => ({ at: computedOffset, ...props })) : null,
      });
    }
    const sample = { t: Math.round(now) };
    for (const [name, selector] of Object.entries(boxes)) {
      const element = document.querySelector(selector);
      if (!element) continue;
      const r = element.getBoundingClientRect();
      const cs = getComputedStyle(element);
      sample[name] = `${r.x.toFixed(1)} ${r.width.toFixed(1)}w o${Number(cs.opacity).toFixed(2)}${cs.display === 'none' ? ' none' : ''}`;
    }
    samples.push(sample);
    if (now < durationMs) setTimeout(tick, 8);
    else window.__motionResult = { animations, samples };
  };
  window.__motionResult = null;
  tick();
};

(async () => {
  const [url, prefix] = process.argv.slice(2);
  if (!url || !prefix) throw new Error('usage: <task url> <out-prefix>');
  fs.mkdirSync(path.dirname(prefix), { recursive: true });
  const browser = await puppeteer.connect({ browserURL: 'http://[::1]:9222', defaultViewport: null });
  const page = await browser.newPage();
  try {
    await page.bringToFront();
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 90_000 });
    const CARD = 'a.remy-output-artifact-card';
    await page.waitForSelector(CARD, { timeout: 60_000 });
    await sleep(3000);
    const card = await page.$(CARD);
    await card.evaluate((el) => el.scrollIntoView({ block: 'center' }));
    await sleep(800);
    const open = await page.$(`${CARD} .open-button-visual`);
    const box = await open.boundingBox();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForSelector('iframe.embedded-doc-frame', { timeout: 20_000 });
    await sleep(7000);
    const frameBox = await (await page.$('iframe.embedded-doc-frame')).boundingBox();
    console.log('frame box:', JSON.stringify(frameBox));
    await page.screenshot({ path: `${prefix}-pane.png`, clip: { x: frameBox.x, y: frameBox.y, width: frameBox.width, height: Math.min(frameBox.height, 420) } });
    const docs = page.frames().find((frame) => /docs\.google\.com\/document/.test(frame.url()));
    if (!docs) throw new Error('no Docs frame');
    const inside = await docs.evaluate(dumpTop, 170);
    fs.writeFileSync(`${prefix}-frame-top.json`, JSON.stringify(inside, null, 1));
    console.log('frame nodes:', inside.nodes.length, 'body bg', inside.bodyBg, 'viewport', inside.viewport);

    // The frame's own close button, in page coordinates.
    const closeRect = await docs.evaluate(() => {
      const candidates = [...document.querySelectorAll('[aria-label], [data-tooltip]')].filter((el) => {
        const label = `${el.getAttribute('aria-label') || ''} ${el.getAttribute('data-tooltip') || ''}`;
        const r = el.getBoundingClientRect();
        return /close/i.test(label) && r.width > 0 && r.y < 80;
      });
      const el = candidates[0];
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height, label: el.getAttribute('aria-label') || el.getAttribute('data-tooltip') };
    });
    console.log('close in frame:', JSON.stringify(closeRect));
    if (closeRect) {
      await page.evaluate(recorder, 1500);
      await page.mouse.click(frameBox.x + closeRect.x + closeRect.w / 2, frameBox.y + closeRect.y + closeRect.h / 2);
      let last = 0;
      for (const at of [80, 200, 330, 500, 1000]) {
        await sleep(at - last);
        last = at;
        await page.screenshot({ path: `${prefix}-close-${at}.png` });
      }
      await page.waitForFunction(() => window.__motionResult, { timeout: 8000 }).catch(() => {});
      fs.writeFileSync(`${prefix}-close-motion.json`, JSON.stringify(await page.evaluate(() => window.__motionResult), null, 1));
      console.log('closed; side panel now:', JSON.stringify(await page.evaluate(() => {
        const side = document.querySelector('remy-side-panel');
        const r = side?.getBoundingClientRect();
        return side ? { cls: side.className, rect: [r.x, r.width] } : null;
      })));
    }
  } finally {
    await page.close().catch(() => {});
    browser.disconnect();
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
