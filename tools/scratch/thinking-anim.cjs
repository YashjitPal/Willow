/**
 * Gemini, narrow widths: records the "Thinking steps" panel's close and open motion. With
 * the panel open, taps its close button and samples the panel every frame; then reopens it
 * from the last response's overflow menu and samples again. Prints getAnimations() timing
 * and keyframes plus per-frame box / opacity / transform. Opens and closes UI only.
 */
const http = require('http');
const puppeteer = require('puppeteer-core');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const getJson = (url) => new Promise((resolve) => {
  http.get(url, (res) => {
    let body = '';
    res.on('data', (c) => { body += c; });
    res.on('end', () => { try { resolve(JSON.parse(body)); } catch { resolve(null); } });
  }).on('error', () => resolve(null));
});

const SAMPLER = () => {
  window.__thinkSamples = [];
  window.__thinkAnims = [];
  const t0 = performance.now();
  const seen = new WeakSet();
  const step = () => {
    const t = Math.round(performance.now() - t0);
    const panel = document.querySelector('context-sidebar');
    const container = panel?.querySelector('.container');
    if (panel) {
      for (const a of panel.getAnimations({ subtree: true })) {
        if (seen.has(a)) continue;
        seen.add(a);
        if (/ripple/.test(String(a.effect?.target?.className))) continue;
        const timing = a.effect?.getComputedTiming?.() || {};
        window.__thinkAnims.push(`@${t}ms ${a.constructor.name} ${a.animationName || a.transitionProperty || ''} on ${a.effect?.target?.tagName.toLowerCase()}.${String(a.effect?.target?.className).split(' ').slice(0, 2).join('.')} dur ${timing.duration} delay ${timing.delay} easing ${a.effect?.getTiming?.().easing} keyframes ${JSON.stringify(a.effect?.getKeyframes?.().map(({ offset, computedOffset, composite, ...k }) => ({ ...k, at: computedOffset })))}`);
      }
    }
    const el = container || panel;
    if (el) {
      const b = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      const pcs = getComputedStyle(panel);
      window.__thinkSamples.push(`${t}ms box [${[b.x, b.y, b.width, b.height].map((n) => Math.round(n))}] opacity ${cs.opacity}/${pcs.opacity} transform ${cs.transform}/${pcs.transform}`);
    } else {
      window.__thinkSamples.push(`${t}ms gone`);
    }
    if (t < 900) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
};

(async () => {
  const status = await getJson('http://127.0.0.1:9339/status');
  const scale = status?.scale || 1;
  const browser = await puppeteer.connect({ browserURL: 'http://[::1]:9222', defaultViewport: null, protocolTimeout: 90000 });
  const gemini = (await browser.pages()).find((p) => p.url().startsWith('https://gemini.google.com'));
  await gemini.bringToFront();
  const cdp = await gemini.createCDPSession();
  const tap = async (pt) => {
    const point = { x: pt.x * scale, y: pt.y * scale };
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
    await sleep(60);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  };
  const centre = (sel) => gemini.evaluate((s) => {
    const el = [...document.querySelectorAll(s)].find((e) => e.getBoundingClientRect().width > 0);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }, sel);

  const close = await centre('context-sidebar .close-button');
  if (close) {
    await gemini.evaluate(SAMPLER);
    await tap(close);
    await sleep(1100);
    console.log('CLOSE');
    console.log(await gemini.evaluate(() => [...window.__thinkAnims, ...window.__thinkSamples.filter((_, i) => i % 3 === 0)].join('\n')));
  }

  const more = await gemini.evaluate(async () => {
    const response = [...document.querySelectorAll('model-response')].at(-1);
    const b = [...response.querySelectorAll('button')].find((x) => /more/i.test(x.getAttribute('aria-label') || ''));
    b.scrollIntoView({ block: 'center' });
    await new Promise((r) => setTimeout(r, 300));
    const r = b.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  await tap(more);
  await sleep(800);
  const item = await gemini.evaluate(() => {
    const el = [...document.querySelectorAll('.cdk-overlay-pane [role="menuitem"], .cdk-overlay-pane button')].find((e) => /Show thinking/.test(e.textContent) && e.getBoundingClientRect().width > 0);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  await gemini.evaluate(SAMPLER);
  await tap(item);
  await sleep(1100);
  console.log('OPEN');
  console.log(await gemini.evaluate(() => [...window.__thinkAnims, ...window.__thinkSamples.filter((_, i) => i % 3 === 0)].join('\n')));
  await cdp.detach();
  browser.disconnect();
})();
