/**
 * Willow's sources panel and chip, with the same mix of sources Gemini's notebook holds:
 * a file already there, two websites, one copied text. Adds the throwaways, measures,
 * screenshots, then removes them.
 *
 *   --keep   leave the added sources in place
 */
const { connect, outPath, sleep, args } = require('../ui-research/scrapers/notebooks/lib.cjs');
const fs = require('fs');

const setValue = `(el, value) => {
  const desc = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value');
  desc.set.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}`;

const openPanel = async (page) => {
  const open = await page.evaluate(() => !!document.querySelector('.nb-src-pane'));
  if (open) return;
  await page.evaluate(() => document.querySelector('.nb-source-chip').click());
  await sleep(700);
};

const closePanel = async (page) => {
  await page.evaluate(() => {
    const scrim = document.querySelector('.nb-sheet-scrim');
    if (scrim) scrim.click();
  });
  await sleep(600);
};

const addWebsite = async (page, url) => {
  await openPanel(page);
  await page.evaluate(() => {
    Array.from(document.querySelectorAll('.nb-src-rail-item')).find((b) => /add websites/i.test(b.textContent)).click();
  });
  await sleep(500);
  await page.evaluate(new Function('setValue', 'url', `
    const field = document.querySelector('.nb-sub textarea, .nb-sub input');
    setValue(field, url);
  `), await page.evaluateHandle(`(${setValue})`), url);
  await sleep(300);
  await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('.nb-sub button')).find((b) => /^(add|insert)$/i.test(b.textContent.trim()));
    if (btn) btn.click();
  });
  await sleep(4000);
  await closePanel(page);
};

const addCopiedText = async (page, title, body) => {
  await openPanel(page);
  await page.evaluate(() => {
    Array.from(document.querySelectorAll('.nb-src-rail-item')).find((b) => /copied text/i.test(b.textContent)).click();
  });
  await sleep(500);
  await page.evaluate(new Function('setValue', 't', 'b', `
    setValue(document.querySelector('.nb-sub input'), t);
    setValue(Array.from(document.querySelectorAll('textarea')).find((x) => /paste text/i.test(x.placeholder)), b);
  `), await page.evaluateHandle(`(${setValue})`), title, body);
  await sleep(300);
  await page.evaluate(() => {
    Array.from(document.querySelectorAll('.nb-sub button')).find((b) => /insert/i.test(b.textContent)).click();
  });
  await sleep(700);
  await closePanel(page);
};

const MEASURE = `() => {
  const rect = (el) => { const r = el.getBoundingClientRect(); return { x: Math.round(r.x * 100) / 100, y: Math.round(r.y * 100) / 100, w: Math.round(r.width * 100) / 100, h: Math.round(r.height * 100) / 100 }; };
  const chip = document.querySelector('.nb-source-chip');
  const out = {
    chip: chip ? {
      label: chip.textContent.trim(),
      rect: rect(chip),
      discs: Array.from(chip.querySelectorAll('.nb-source-chip-icon')).map((d) => {
        const img = d.querySelector('img');
        const cs = getComputedStyle(d);
        return { x: rect(d).x, zIndex: cs.zIndex, margin: cs.marginInlineStart, icon: img ? img.getAttribute('src').replace(/^.*(favicons\\?domain=|file-type-icons\\/)/, '$1').slice(0, 90) : d.textContent };
      }),
    } : null,
  };
  const grid = document.querySelector('.nb-src-tiles');
  if (grid) {
    const cs = getComputedStyle(grid);
    out.grid = { rect: rect(grid), display: cs.display, columns: cs.gridTemplateColumns, gap: cs.gap, paddingBottom: cs.paddingBottom };
    out.tiles = Array.from(grid.querySelectorAll('.nb-src-tile')).map((t) => {
      const cs2 = getComputedStyle(t);
      const icon = t.querySelector('.nb-src-tile-icon');
      const img = t.querySelector('.nb-src-tile-icon img');
      const name = t.querySelector('.nb-src-tile-name');
      const close = t.querySelector('.nb-src-tile-remove');
      return {
        rect: rect(t),
        background: cs2.backgroundColor,
        radius: cs2.borderRadius,
        icon: rect(icon),
        iconSrc: img ? img.getAttribute('src').slice(0, 100) : (icon.textContent || null),
        name: name.textContent,
        nameRect: rect(name),
        nameFont: getComputedStyle(name).fontSize + '/' + getComputedStyle(name).lineHeight + ' ' + getComputedStyle(name).fontVariationSettings,
        close: { rect: rect(close), visibility: getComputedStyle(close).visibility, background: getComputedStyle(close).backgroundColor },
      };
    });
  }
  return out;
}`;

(async () => {
  const flags = args();
  const browser = await connect();
  try {
    const page = (await browser.pages()).find((p) => /localhost:3000\/notebook\//.test(p.url()));
    if (!page) throw new Error('Willow is not on a notebook page');

    await addWebsite(page, 'https://en.wikipedia.org/wiki/The_Life_of_a_Showgirl');
    await addWebsite(page, 'https://ai.google.dev/gemini-api/docs');
    await addCopiedText(page, 'PANEL PROBE text', 'throwaway body');

    // Chip first, panel closed.
    let res = await page.evaluate(new Function('return ' + MEASURE)());
    console.log('=== chip with 4 sources');
    console.log(JSON.stringify(res.chip, null, 2));
    if (res.chip) {
      const r = res.chip.rect;
      fs.writeFileSync(outPath('src-chip/willow-chip-4.png'),
        await page.screenshot({ clip: { x: r.x - 8, y: r.y - 8, width: r.w + 16, height: r.h + 16 } }));
      console.log('saved src-chip/willow-chip-4.png');
    }

    await openPanel(page);
    await sleep(900);
    res = await page.evaluate(new Function('return ' + MEASURE)());
    console.log('\n=== panel');
    console.log(JSON.stringify({ grid: res.grid, tiles: res.tiles }, null, 2));

    const dialog = await page.evaluate(() => {
      const el = document.querySelector('.nb-src') || document.querySelector('[role="dialog"]');
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
    });
    fs.writeFileSync(outPath('src-chip/willow-panel.png'),
      await page.screenshot({ clip: { x: dialog.x - 10, y: dialog.y - 10, width: dialog.w + 20, height: dialog.h + 20 } }));
    console.log('saved src-chip/willow-panel.png');

    if (!flags.keep) {
      for (let i = 0; i < 8; i += 1) {
        const removed = await page.evaluate(() => {
          const tile = Array.from(document.querySelectorAll('.nb-src-tile'))
            .find((t) => /PANEL PROBE|wikipedia|ai\.google\.dev|Showgirl|gemini-api/i.test(t.getAttribute('title') + ' ' + t.textContent));
          if (!tile) return false;
          tile.querySelector('.nb-src-tile-remove').click();
          return true;
        });
        if (!removed) break;
        await sleep(400);
      }
      console.log('\nleft behind:', JSON.stringify(await page.evaluate(() =>
        Array.from(document.querySelectorAll('.nb-src-tile')).map((t) => t.getAttribute('title')))));
      await closePanel(page);
    }
  } finally {
    await browser.disconnect();
  }
})();
