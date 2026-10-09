/**
 * Walks the Willow permission card's UI states in the Willow tab (no answers given):
 * hover on the select and Allow, the select's menu open and closed, and the plan's
 * chevron when there is one. Saves crops and prints the boxes.
 *
 *   node tools/scratch/willow-card-interact.cjs <out-dir>
 */
const puppeteer = require('puppeteer-core');
const path = require('path');

(async () => {
  const out = process.argv[2] || 'tools/ui-research/captures/spark/134-remote-browser/willow';
  const browser = await puppeteer.connect({ browserURL: 'http://[::1]:9222', defaultViewport: null });
  const page = (await browser.pages()).find((p) => p.url().startsWith('http://localhost:3000') && !p.url().includes('/media'));
  if (!page) throw new Error('no willow tab');
  await page.bringToFront();
  const box = (selector) => page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  }, selector);
  const card = await box('.spark-browser-card');
  if (!card) throw new Error('no card on screen');
  const clip = { x: card.x - 8, y: card.y - 8, width: card.w + 16, height: card.h + 120 };
  const shot = async (name) => page.screenshot({ path: path.join(out, `card-${name}.png`), clip });

  await page.mouse.move(5, 5);
  await new Promise((r) => setTimeout(r, 300));
  await shot('rest');

  const select = await box('.spark-browser-card__select');
  await page.mouse.move(select.x + select.w / 2, select.y + select.h / 2, { steps: 4 });
  await new Promise((r) => setTimeout(r, 350));
  await shot('hover-select');

  await page.mouse.click(select.x + select.w / 2, select.y + select.h / 2);
  await new Promise((r) => setTimeout(r, 400));
  await shot('menu-open');
  const menu = await box('.spark-browser-card__menu');
  const option = await box('.spark-browser-card__option');
  console.log('menu', JSON.stringify(menu), 'option', JSON.stringify(option), 'select', JSON.stringify(select));
  await page.keyboard.press('Escape');
  await new Promise((r) => setTimeout(r, 300));
  console.log('menu after Escape', JSON.stringify(await box('.spark-browser-card__menu')));

  const allow = await page.evaluate(() => {
    const button = [...document.querySelectorAll('.spark-browser-card__button')].find((b) => /^Allow$/.test(b.textContent.trim()));
    const r = button.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  });
  await page.mouse.move(allow.x + allow.w / 2, allow.y + allow.h / 2, { steps: 4 });
  await new Promise((r) => setTimeout(r, 350));
  await shot('hover-allow');

  const chevron = await box('.spark-browser-card__chevron');
  if (chevron) {
    const detail = await box('.spark-browser-card__detail');
    await page.mouse.move(detail.x + 40, detail.y + detail.h / 2, { steps: 4 });
    await new Promise((r) => setTimeout(r, 300));
    await shot('hover-plan');
    await page.mouse.click(chevron.x + chevron.w / 2, chevron.y + chevron.h / 2);
    await new Promise((r) => setTimeout(r, 400));
    await shot('plan-open');
    console.log('plan open', JSON.stringify(await box('.spark-browser-card__plan')));
    await page.mouse.click(chevron.x + chevron.w / 2, chevron.y + chevron.h / 2);
    await new Promise((r) => setTimeout(r, 300));
  }
  const buttons = await page.evaluate(() => [...document.querySelectorAll('.spark-browser-card__button')].map((b) => Math.round(b.getBoundingClientRect().width * 10) / 10));
  console.log('buttons', JSON.stringify(buttons), 'chevron', JSON.stringify(chevron));
  await page.mouse.move(5, 5);
  browser.disconnect();
})().catch((e) => { console.error(e.message); process.exit(1); });
