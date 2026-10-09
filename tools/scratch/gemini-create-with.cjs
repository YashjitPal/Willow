/**
 * What Gemini Spark's "Create with Gemini" does, in a tab of its own: opens
 * `/spark/schedules` or `/spark/skills`, presses the button with the real mouse, and
 * records where it lands — the address, the composer's contents and placeholder, the
 * zero state's text, chips and boxes. Sends nothing.
 *
 *   node tools/scratch/gemini-create-with.cjs <schedules|skills> <out-prefix> [phone|tablet] [--keep]
 *
 * `--keep` leaves the tab open (for a follow-up script to drive); it prints its target id.
 */
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');

const SIZES = {
  phone: { width: 390, height: 844 },
  tablet: { width: 800, height: 1280 },
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const snapshot = () => {
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) > 0;
  };
  const describe = (el) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    const own = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent.trim()).join(' ').trim();
    return {
      tag: el.tagName.toLowerCase(),
      cls: (typeof el.className === 'string' ? el.className : '').slice(0, 120),
      testId: el.getAttribute('data-test-id') || undefined,
      aria: el.getAttribute('aria-label') || undefined,
      placeholder: el.getAttribute('placeholder') || el.getAttribute('data-placeholder') || undefined,
      text: own.slice(0, 160) || undefined,
      rect: [r.x, r.y, r.width, r.height].map((v) => Math.round(v * 10) / 10),
      font: `${cs.fontSize}/${cs.lineHeight} ${cs.fontWeight}`,
      color: cs.color,
      bg: cs.backgroundColor !== 'rgba(0, 0, 0, 0)' ? cs.backgroundColor : undefined,
      radius: cs.borderRadius !== '0px' ? cs.borderRadius : undefined,
    };
  };
  const editor = document.querySelector('rich-textarea .ql-editor, .ql-editor, textarea');
  const texts = [...document.querySelectorAll('main *, chat-window *, .chat-container *')]
    .filter((el) => visible(el) && [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()))
    .map(describe)
    .slice(0, 400);
  return {
    url: location.href,
    title: document.title,
    viewport: [innerWidth, innerHeight],
    editor: editor ? { text: editor.innerText, html: editor.innerHTML.slice(0, 600), placeholder: editor.getAttribute('data-placeholder') || editor.getAttribute('placeholder'), classes: editor.className } : null,
    chips: [...document.querySelectorAll('input-area-v2 button, .input-area button, toolbox-drawer button, .leading-actions-wrapper button, .trailing-actions-wrapper button, [class*="chip"]')]
      .filter(visible).map(describe).slice(0, 60),
    sidebar: [...document.querySelectorAll('side-navigation-v2 *, bard-sidenav *, mat-sidenav *')]
      .filter((el) => visible(el) && [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()))
      .map((el) => el.textContent.trim()).filter((t, i, all) => t && all.indexOf(t) === i).slice(0, 40),
    texts,
  };
};

(async () => {
  const args = process.argv.slice(2);
  const keep = args.includes('--keep');
  const [page_, prefix, kind] = args.filter((a) => !a.startsWith('--'));
  if (!['schedules', 'skills'].includes(page_) || !prefix) throw new Error('usage: <schedules|skills> <out-prefix> [phone|tablet] [--keep]');
  fs.mkdirSync(path.dirname(prefix), { recursive: true });
  const browser = await puppeteer.connect({ browserURL: 'http://[::1]:9222', defaultViewport: null, protocolTimeout: 60_000 });
  const page = await browser.newPage();
  try {
    if (kind) {
      const size = SIZES[kind];
      const cdp = await page.createCDPSession();
      const version = (await browser.version()).match(/\/(\d+)/)?.[1] || '141';
      await cdp.send('Emulation.setUserAgentOverride', {
        userAgent: `Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${version}.0.0.0${kind === 'phone' ? ' Mobile' : ''} Safari/537.36`,
      });
      await cdp.send('Emulation.setDeviceMetricsOverride', { width: size.width, height: size.height, deviceScaleFactor: 0, mobile: true, screenWidth: size.width, screenHeight: size.height });
      await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    }
    await page.bringToFront();
    await page.goto(`https://gemini.google.com/spark/${page_}`, { waitUntil: 'networkidle2', timeout: 90_000 });
    await sleep(4000);
    await page.screenshot({ path: `${prefix}-before.png` });
    const button = await page.evaluateHandle(() => [...document.querySelectorAll('button, a, [role="button"]')]
      .find((el) => /create with gemini/i.test(el.textContent || '') && el.getBoundingClientRect().width > 0));
    const element = button.asElement();
    if (!element) throw new Error('no "Create with Gemini" button');
    console.log('button:', await element.evaluate((el) => ({ tag: el.tagName, cls: el.className, href: el.getAttribute('href'), text: el.textContent.trim() })));
    const box = await element.boundingBox();
    if (kind) await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
    else await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    for (const at of [300, 1200, 3500]) {
      await sleep(at === 300 ? 300 : at - 300);
      await page.bringToFront();
      await page.screenshot({ path: `${prefix}-after-${at}.png` });
    }
    const state = await page.evaluate(snapshot);
    fs.writeFileSync(`${prefix}-after.json`, JSON.stringify(state, null, 1));
    console.log('url:', state.url, '| title:', state.title);
    console.log('editor:', JSON.stringify(state.editor));
    console.log('sidebar:', JSON.stringify(state.sidebar));
    console.log('texts:', JSON.stringify(state.texts.map((t) => t.text).filter(Boolean).slice(0, 40)));
    if (keep) console.log('kept tab:', page.target()._targetId);
  } finally {
    if (!keep) await page.close().catch(() => {});
    browser.disconnect();
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
