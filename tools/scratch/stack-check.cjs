/**
 * Drive the real UI to a 3-source notebook, measure the stacked chip against Gemini's
 * rules, screenshot it, then remove the two throwaway sources so the notebook is left as
 * it was found.
 */
const { connect, outPath, sleep } = require('../ui-research/scrapers/notebooks/lib.cjs');
const fs = require('fs');

const MEASURE = `() => {
  const chip = document.querySelector('.nb-source-chip');
  if (!chip) return { error: 'no chip' };
  const r = chip.getBoundingClientRect();
  const discs = Array.from(chip.querySelectorAll('.nb-source-chip-icon')).map((d) => {
    const dr = d.getBoundingClientRect();
    const cs = getComputedStyle(d);
    const img = d.querySelector('img');
    return {
      x: Math.round(dr.x * 10) / 10,
      w: Math.round(dr.width * 10) / 10,
      margin: cs.marginInlineStart,
      zIndex: cs.zIndex,
      bg: cs.backgroundColor,
      icon: img ? img.getAttribute('src').split('/').pop() : (d.textContent || '(glyph)'),
    };
  });
  return {
    text: chip.textContent.trim(),
    rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width * 10) / 10, h: Math.round(r.height) },
    bg: getComputedStyle(chip).backgroundColor,
    discs,
  };
}`;

const addText = async (page, title, body) => {
  await page.evaluate(() => document.querySelector('.nb-source-chip').click());
  await sleep(500);
  await page.evaluate(() => {
    Array.from(document.querySelectorAll('.nb-src-rail-item'))
      .find((b) => /copied text/i.test(b.textContent)).click();
  });
  await sleep(500);
  await page.evaluate((t, b) => {
    const setValue = (el, value) => {
      const proto = Object.getPrototypeOf(el);
      const desc = Object.getOwnPropertyDescriptor(proto, 'value');
      desc.set.call(el, value);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    };
    setValue(document.querySelector('.nb-sub input'), t);
    setValue(Array.from(document.querySelectorAll('textarea')).find((x) => /paste text/i.test(x.placeholder)), b);
  }, title, body);
  await sleep(300);
  await page.evaluate(() => {
    Array.from(document.querySelectorAll('.nb-sub button')).find((b) => /insert/i.test(b.textContent)).click();
  });
  await sleep(600);
  await page.evaluate(() => {
    const scrim = document.querySelector('.nb-sheet-scrim');
    if (scrim) scrim.click();
  });
  await sleep(500);
};

(async () => {
  const browser = await connect();
  try {
    const page = (await browser.pages()).find((p) => /localhost:3000\/notebook\//.test(p.url()));
    if (!page) throw new Error('not on a notebook page');

    await addText(page, 'STACK PROBE A', 'throwaway a');
    await addText(page, 'STACK PROBE B', 'throwaway b');

    const measured = await page.evaluate(new Function('return ' + MEASURE)());
    console.log('=== stacked chip');
    console.log(JSON.stringify(measured, null, 2));

    if (!measured.error) {
      const gaps = measured.discs.slice(1).map((d, i) => Math.round((d.x - measured.discs[i].x) * 10) / 10);
      console.log(`\ndisc pitch: ${gaps.join(', ')}  (expect 16 — 20px wide, pulled 4px left)`);
      console.log(`z-order:    ${measured.discs.map((d) => d.zIndex).join(', ')}  (expect descending, leftmost on top)`);
      const r = measured.rect;
      const buf = await page.screenshot({ clip: { x: r.x - 8, y: r.y - 8, width: r.w + 16, height: r.h + 16 } });
      fs.writeFileSync(outPath('src-chip/willow-chip-stacked.png'), buf);
      console.log('saved src-chip/willow-chip-stacked.png');
    }

    // Put the notebook back.
    await page.evaluate(() => document.querySelector('.nb-source-chip').click());
    await sleep(500);
    for (let i = 0; i < 6; i += 1) {
      const removed = await page.evaluate(() => {
        const row = Array.from(document.querySelectorAll('.nb-src-row'))
          .find((r) => /STACK PROBE/.test(r.textContent));
        if (!row) return false;
        row.querySelector('.nb-src-row-remove').click();
        return true;
      });
      if (!removed) break;
      await sleep(400);
    }
    const left = await page.evaluate(() =>
      Array.from(document.querySelectorAll('.nb-src-row')).map((r) => r.textContent.trim().slice(0, 40)));
    console.log('\nsources left behind:', JSON.stringify(left));
    await page.evaluate(() => {
      const scrim = document.querySelector('.nb-sheet-scrim');
      if (scrim) scrim.click();
    });
  } finally {
    await browser.disconnect();
  }
})();
