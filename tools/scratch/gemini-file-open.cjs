/**
 * Read-only recon of what Gemini Spark's "Open" on a created file does, in a tab of its
 * own. Opens a task by URL, records the file card at rest and hovered, presses Open with
 * the real mouse, samples the split view through the motion, and dumps every element that
 * appeared (or a new tab, if one opened). Then closes what opened. Views only: nothing is
 * typed, sent or deleted.
 *
 *   node tools/scratch/gemini-file-open.cjs <task url> <out-prefix> [phone|tablet]
 */
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');

const SIZES = {
  phone: { width: 390, height: 844, mobile: true },
  tablet: { width: 800, height: 1280, mobile: true },
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Every element's box and type, for one subtree.
const dump = (selectorOrNew, limit = 900) => {
  const pick = (el) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    const own = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent.trim()).join(' ').trim();
    return {
      tag: el.tagName.toLowerCase(),
      cls: (typeof el.className === 'string' ? el.className : String(el.className?.baseVal ?? '')).slice(0, 140),
      id: el.id || undefined,
      testId: el.getAttribute('data-test-id') || undefined,
      aria: el.getAttribute('aria-label') || undefined,
      role: el.getAttribute('role') || undefined,
      text: own.slice(0, 100) || undefined,
      src: el.getAttribute('src')?.slice(0, 220) || undefined,
      href: el.getAttribute('href')?.slice(0, 220) || undefined,
      rect: [r.x, r.y, r.width, r.height].map((v) => Math.round(v * 100) / 100),
      cs: {
        font: `${cs.fontSize}/${cs.lineHeight} ${cs.fontWeight} ${cs.fontFamily.split(',')[0]}`,
        fvs: cs.fontVariationSettings !== 'normal' ? cs.fontVariationSettings : undefined,
        ls: cs.letterSpacing !== 'normal' ? cs.letterSpacing : undefined,
        color: cs.color,
        bg: cs.backgroundColor !== 'rgba(0, 0, 0, 0)' ? cs.backgroundColor : undefined,
        bgImage: cs.backgroundImage !== 'none' ? cs.backgroundImage.slice(0, 160) : undefined,
        radius: cs.borderRadius !== '0px' ? cs.borderRadius : undefined,
        pad: cs.padding !== '0px' ? cs.padding : undefined,
        margin: cs.margin !== '0px' ? cs.margin : undefined,
        border: cs.borderStyle !== 'none' ? `${cs.borderTopWidth} ${cs.borderStyle} ${cs.borderTopColor}` : undefined,
        outline: cs.outlineStyle !== 'none' ? `${cs.outlineWidth} ${cs.outlineStyle} ${cs.outlineColor}` : undefined,
        position: cs.position !== 'static' ? cs.position : undefined,
        display: cs.display,
        flex: cs.display.includes('flex') ? `${cs.flexDirection} ${cs.alignItems} ${cs.justifyContent} gap:${cs.gap}` : undefined,
        flexItem: cs.flex !== '0 1 auto' ? cs.flex : undefined,
        overflow: cs.overflow !== 'visible' ? cs.overflow : undefined,
        shadow: cs.boxShadow !== 'none' ? cs.boxShadow : undefined,
        opacity: cs.opacity !== '1' ? cs.opacity : undefined,
        transition: cs.transitionDuration !== '0s' ? `${cs.transitionProperty} ${cs.transitionDuration} ${cs.transitionTimingFunction}` : undefined,
        cursor: cs.cursor !== 'auto' ? cs.cursor : undefined,
        z: cs.zIndex !== 'auto' ? cs.zIndex : undefined,
      },
    };
  };
  const nodes = [];
  const roots = selectorOrNew === '__new__'
    ? [...document.querySelectorAll('*')].filter((el) => !window.__before.has(el) && !(el.parentElement && !window.__before.has(el.parentElement) && el.parentElement !== document.body))
    : [...document.querySelectorAll(selectorOrNew)];
  const seen = new Set();
  for (const root of roots) {
    for (const el of [root, ...root.querySelectorAll('*')]) {
      if (seen.has(el)) continue;
      seen.add(el);
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0 && el.tagName !== 'IFRAME') continue;
      nodes.push(pick(el));
      if (nodes.length >= limit) return { url: location.href, viewport: [innerWidth, innerHeight], nodes, truncated: true };
    }
  }
  return { url: location.href, viewport: [innerWidth, innerHeight], nodes };
};

const recorder = (boxes, durationMs) => {
  const describe = (element) => {
    if (!element || !element.tagName) return null;
    const cls = typeof element.className === 'string' ? element.className.trim().split(/\s+/).slice(0, 3).join('.') : '';
    return `${element.tagName.toLowerCase()}${cls ? `.${cls}` : ''}`;
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
      sample[name] = `${r.x.toFixed(1)},${r.y.toFixed(1)} ${r.width.toFixed(1)}x${r.height.toFixed(1)} o${Number(cs.opacity).toFixed(2)}${cs.display === 'none' ? ' none' : ''}${cs.transform !== 'none' ? ` ${cs.transform}` : ''}`;
    }
    samples.push(sample);
    if (now < durationMs) setTimeout(tick, 8);
    else window.__motionResult = { animations, samples };
  };
  window.__motionResult = null;
  tick();
};

const BOXES = {
  left: '.left-pane',
  right: '.right-pane',
  rightInner: '.right-pane-inner-wrapper',
  chat: '.chat-container, .remy-chat-pane, chat-window',
  side: 'remy-side-panel',
  sideCard: 'remy-side-panel .remy-side-panel',
  viewer: 'remy-viewer',
  overlay: '.mobile-side-panel-overlay',
  iframe: 'remy-side-panel iframe, remy-viewer iframe, .mobile-side-panel-overlay iframe',
};

(async () => {
  const [url, prefix, kind] = process.argv.slice(2);
  if (!url || !prefix) throw new Error('usage: <task url> <out-prefix> [phone|tablet]');
  fs.mkdirSync(path.dirname(prefix), { recursive: true });
  const browser = await puppeteer.connect({ browserURL: 'http://[::1]:9222', defaultViewport: null });
  const page = await browser.newPage();
  const opened = [];
  const onTarget = async (target) => {
    if (target.opener() === page.target()) opened.push(target);
  };
  browser.on('targetcreated', onTarget);
  const save = async (name, selector) => {
    await page.screenshot({ path: `${prefix}-${name}.png` });
    if (selector) fs.writeFileSync(`${prefix}-${name}.json`, JSON.stringify(await page.evaluate(dump, selector), null, 1));
    console.log('captured', name);
  };
  try {
    if (kind) {
      const size = SIZES[kind];
      const cdp = await page.createCDPSession();
      const version = (await browser.version()).match(/\/(\d+)/)?.[1] || '141';
      const phone = kind === 'phone';
      await cdp.send('Emulation.setUserAgentOverride', {
        userAgent: `Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${version}.0.0.0${phone ? ' Mobile' : ''} Safari/537.36`,
        userAgentMetadata: {
          brands: [{ brand: 'Chromium', version }, { brand: 'Google Chrome', version }],
          fullVersion: `${version}.0.0.0`, platform: 'Android', platformVersion: '14.0.0', architecture: '', model: '', mobile: phone,
        },
      });
      await cdp.send('Emulation.setDeviceMetricsOverride', {
        width: size.width, height: size.height, deviceScaleFactor: 0, mobile: size.mobile,
        screenWidth: size.width, screenHeight: size.height,
      });
      await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    }
    await page.bringToFront();
    await page.evaluateOnNewDocument(() => {
      window.__opens = [];
      const original = window.open;
      window.open = function (...args) {
        window.__opens.push(args.map(String));
        return original.apply(this, args);
      };
    });
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 90_000 });
    const CARD = 'a.remy-output-artifact-card, .remy-output-artifact-card';
    await page.waitForSelector(CARD, { timeout: 60_000 });
    await sleep(3500);
    const card = await page.$(CARD);
    await card.evaluate((el) => el.scrollIntoView({ block: 'center' }));
    await sleep(1200);
    await save('card', CARD);
    const cardBox = await card.boundingBox();
    // Hover: the pointer onto the card's middle, then onto the button.
    if (!kind) {
      await page.mouse.move(cardBox.x + 40, cardBox.y + cardBox.height / 2);
      await sleep(500);
      await save('card-hover', CARD);
      const button = await page.$(`${CARD} .open-button-visual, ${CARD} [data-test-id="open-button"]`);
      const buttonBox = await button?.boundingBox();
      if (buttonBox) {
        await page.mouse.move(buttonBox.x + buttonBox.width / 2, buttonBox.y + buttonBox.height / 2);
        await sleep(500);
        await save('button-hover', CARD);
      }
    }
    fs.writeFileSync(`${prefix}-before-split.json`, JSON.stringify(await page.evaluate(dump, '.split-pane-container, .mobile-side-panel-overlay', 400), null, 1));
    await page.evaluate(() => { window.__before = new WeakSet(document.querySelectorAll('*')); });
    await page.evaluate(recorder, BOXES, 1600);
    const target = await page.$(`${CARD} .open-button-visual, ${CARD} [data-test-id="open-button"]`) || card;
    const box = await target.boundingBox();
    if (kind) await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
    else {
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.up();
    }
    let last = 0;
    for (const at of [80, 200, 330, 500, 1000]) {
      await sleep(at - last);
      last = at;
      await page.screenshot({ path: `${prefix}-open-${at}.png` });
    }
    await page.waitForFunction(() => window.__motionResult, { timeout: 8000 }).catch(() => {});
    const motion = await page.evaluate(() => window.__motionResult);
    fs.writeFileSync(`${prefix}-open-motion.json`, JSON.stringify(motion, null, 1));
    await sleep(2500);
    console.log('window.open calls:', JSON.stringify(await page.evaluate(() => window.__opens)));
    console.log('new tabs:', opened.map((t) => t.url()));
    await save('opened', '__new__');
    fs.writeFileSync(`${prefix}-opened-split.json`, JSON.stringify(await page.evaluate(dump, '.split-pane-container, .mobile-side-panel-overlay, .cdk-overlay-container', 1500), null, 1));
    console.log('url now:', page.url());
    // Every iframe on the page, with its address, size and what it is in.
    console.log('iframes:', JSON.stringify(await page.evaluate(() => [...document.querySelectorAll('iframe')].map((f) => {
      const r = f.getBoundingClientRect();
      return { src: (f.getAttribute('src') || '').slice(0, 200), rect: [r.x, r.y, r.width, r.height].map(Math.round), in: f.parentElement?.className?.slice?.(0, 80) };
    })), null, 1));
    for (const tab of opened) {
      const tabPage = await tab.page().catch(() => null);
      if (tabPage) await tabPage.close().catch(() => {});
    }
  } finally {
    browser.off('targetcreated', onTarget);
    await page.close().catch(() => {});
    browser.disconnect();
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
