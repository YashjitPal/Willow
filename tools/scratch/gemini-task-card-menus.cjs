/**
 * Read-only: a Gemini chat's scheduled-task card, its "More options" menu and its info
 * popup, in a tab of its own. Opens each and records it, then closes it with Escape;
 * nothing in either is pressed.
 *
 *   node tools/scratch/gemini-task-card-menus.cjs <chat url> <out-prefix>
 */
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const describeOverlay = () => [...document.querySelectorAll('.cdk-overlay-container *')]
  .filter((el) => el.getBoundingClientRect().width > 0)
  .slice(0, 120)
  .map((el) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    const own = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent.trim()).join(' ').trim();
    return {
      el: `${el.tagName.toLowerCase()}.${String(el.className).slice(0, 70)}`,
      icon: el.getAttribute('fonticon') || undefined,
      text: own.slice(0, 120) || undefined,
      rect: [r.x, r.y, r.width, r.height].map((v) => Math.round(v * 10) / 10),
      font: `${cs.fontSize}/${cs.lineHeight} ${cs.fontWeight}`,
      color: cs.color,
      bg: cs.backgroundColor !== 'rgba(0, 0, 0, 0)' ? cs.backgroundColor : undefined,
      radius: cs.borderRadius !== '0px' ? cs.borderRadius : undefined,
      pad: cs.padding !== '0px' ? cs.padding : undefined,
      shadow: cs.boxShadow !== 'none' ? cs.boxShadow : undefined,
    };
  });

(async () => {
  const [url, prefix] = process.argv.slice(2);
  fs.mkdirSync(path.dirname(prefix), { recursive: true });
  const browser = await puppeteer.connect({ browserURL: 'http://[::1]:9222', defaultViewport: null, protocolTimeout: 60_000 });
  const page = await browser.newPage();
  try {
    await page.bringToFront();
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 90_000 });
    await sleep(6000);
    const result = {};
    for (const [name, selector] of [['menu', 'button.task-actions-menu-button'], ['info', 'mat-icon.schedule-info-button']]) {
      const handle = await page.$(selector);
      if (!handle) {
        result[name] = 'not found';
        continue;
      }
      const box = await handle.boundingBox();
      await page.bringToFront();
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      await sleep(900);
      await page.screenshot({ path: `${prefix}-${name}.png` });
      result[name] = await page.evaluate(describeOverlay);
      await page.keyboard.press('Escape');
      await sleep(500);
    }
    fs.writeFileSync(`${prefix}.json`, JSON.stringify(result, null, 1));
    for (const [name, nodes] of Object.entries(result)) {
      console.log(`== ${name}`);
      if (typeof nodes === 'string') console.log(nodes);
      else for (const n of nodes) if (n.text || n.icon) console.log('  ', n.el.padEnd(60), n.icon ?? '', n.text ?? '', JSON.stringify(n.rect), n.font, n.color, n.bg ?? '');
    }
  } finally {
    await page.close().catch(() => {});
    browser.disconnect();
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
