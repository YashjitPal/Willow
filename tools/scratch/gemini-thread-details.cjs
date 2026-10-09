/*
 * One-off probe of a finished Gemini conversation in the debug Chrome: the user-query
 * container chain, why the bubble's copy/edit row is or is not visible, the scroller's
 * bottom fade, the disclaimer, heading levels (by injecting h1-h3 into the last response
 * and removing them), list bullets, and screenshots of the list and the table.
 *
 *   node tools/scratch/gemini-thread-details.cjs [label]
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const puppeteer = require('puppeteer-core');

(async () => {
  const label = process.argv[2] || 'm390';
  const out = path.join(os.tmpdir(), 'willow-emulator');
  const browser = await puppeteer.connect({ browserURL: process.env.CDP_URL || 'http://[::1]:9222', defaultViewport: null });
  const page = (await browser.pages()).find((candidate) => candidate.url().startsWith('https://gemini.google.com/'));
  const cdp = await page.createCDPSession();
  await page.bringToFront();
  await new Promise((r) => setTimeout(r, 400));

  const data = await page.evaluate(() => {
    const round = (n) => Math.round(n * 100) / 100;
    const rect = (el) => { const r = el.getBoundingClientRect(); return [r.x, r.y, r.width, r.height].map(round); };
    const last = (s) => { const a = document.querySelectorAll(s); return a.length ? a[a.length - 1] : null; };
    const pick = (el, keys, pseudo) => { if (!el) return null; const cs = getComputedStyle(el, pseudo); return Object.fromEntries(keys.map((k) => [k, cs[k]])); };
    const BOX = ['display', 'justifyContent', 'alignItems', 'flexDirection', 'marginTop', 'marginRight', 'marginBottom', 'marginLeft', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'maxWidth', 'width', 'gap', 'rowGap'];
    const res = {};

    const bubble = last('user-query .user-query-bubble-with-background');
    const chain = [];
    for (let el = bubble; el && el.tagName !== 'INFINITE-SCROLLER' && chain.length < 9; el = el.parentElement) {
      chain.push({ tag: el.tagName.toLowerCase(), cls: String(el.className).slice(0, 70), rect: rect(el), box: pick(el, BOX) });
    }
    res.bubbleChain = chain;

    const actions = last('user-query .luminous-actions-container');
    res.userActions = actions && {
      container: { rect: rect(actions), ...pick(actions, ['opacity', 'visibility', 'display', 'justifyContent', 'gap', 'transition']) },
      buttons: [...actions.querySelectorAll('gem-icon-button, button')].map((b) => ({ tag: b.tagName.toLowerCase(), label: b.getAttribute('aria-label'), rect: rect(b), ...pick(b, ['opacity', 'visibility', 'color', 'transition']) })),
      icons: [...actions.querySelectorAll('mat-icon')].map((i) => ({ rect: rect(i), ...pick(i, ['opacity', 'visibility', 'color', 'fontSize']) })),
      hoverRuleHint: 'see opacity/visibility above',
    };

    const scroller = last('infinite-scroller');
    res.scroller = scroller && { rect: rect(scroller), ...pick(scroller, ['maskImage', 'webkitMaskImage', 'paddingTop', 'paddingBottom', 'scrollPaddingTop', 'overflowY', 'scrollbarWidth', 'scrollbarGutter', 'rowGap']) };
    const overlays = [...document.querySelectorAll('*')].filter((el) => {
      const cs = getComputedStyle(el);
      return /gradient/.test(cs.backgroundImage) && el.getBoundingClientRect().height > 0 && el.getBoundingClientRect().bottom > innerHeight - 200;
    }).map((el) => ({ tag: el.tagName.toLowerCase(), cls: String(el.className).slice(0, 60), rect: rect(el), bg: getComputedStyle(el).backgroundImage.slice(0, 160) }));
    res.bottomGradients = overlays;

    const disclaimer = [...document.querySelectorAll('hallucination-disclaimer *')].find((el) => /mistakes/i.test(el.textContent || '') && !el.children.length);
    res.disclaimer = disclaimer && { text: disclaimer.textContent.trim(), rect: rect(disclaimer), ...pick(disclaimer, ['fontSize', 'lineHeight', 'fontWeight', 'fontVariationSettings', 'color', 'letterSpacing', 'textAlign']), parent: pick(disclaimer.parentElement, BOX), parentRect: rect(disclaimer.parentElement) };

    const md = last('model-response .markdown');
    res.headings = {};
    for (const tag of ['h1', 'h2', 'h3', 'h4']) {
      const el = document.createElement(tag);
      el.textContent = 'Probe heading';
      md.prepend(el);
      res.headings[tag] = { rect: rect(el), ...pick(el, ['fontSize', 'lineHeight', 'fontWeight', 'fontVariationSettings', 'letterSpacing', 'color', 'marginTop', 'marginBottom', 'paddingLeft']) };
      el.remove();
    }
    const li = md.querySelector('ul > li');
    res.bullet = li && { li: pick(li, ['listStyleType', 'paddingLeft', 'position']), before: pick(li, ['content', 'position', 'left', 'top', 'width', 'height', 'borderRadius', 'backgroundColor', 'fontSize', 'color', 'transform'], '::before'), marker: pick(li, ['content', 'color', 'fontSize'], '::marker') };
    const oli = md.querySelector('ol > li');
    res.olBullet = oli && { li: pick(oli, ['listStyleType', 'paddingLeft']), before: pick(oli, ['content', 'position', 'left', 'width', 'fontSize', 'color', 'fontVariationSettings'], '::before'), marker: pick(oli, ['content', 'color', 'fontSize'], '::marker') };
    const ul = md.querySelector('ul');
    const ol = md.querySelector('ol');
    const tableBlock = last('model-response table-block, model-response .table-block-component');
    res.positions = { ul: ul && rect(ul), ol: ol && rect(ol), table: tableBlock && rect(tableBlock), scrollTop: scroller?.scrollTop };
    res.tableBlock = tableBlock && { rect: rect(tableBlock), children: [...tableBlock.querySelectorAll('*')].filter((el) => el.children.length === 0 && el.getBoundingClientRect().height > 0 && !el.closest('table')).slice(0, 12).map((el) => ({ tag: el.tagName.toLowerCase(), cls: String(el.className).slice(0, 50), text: (el.textContent || '').trim().slice(0, 30), rect: rect(el) })) };
    return res;
  });
  fs.writeFileSync(path.join(out, `gemini-details-${label}.json`), JSON.stringify(data, null, 1));
  console.log(JSON.stringify(data, null, 1));

  const shoot = async (name, y) => {
    await page.evaluate((top) => { const s = [...document.querySelectorAll('infinite-scroller')].pop(); s.scrollTop = top; }, y);
    await new Promise((r) => setTimeout(r, 500));
    fs.writeFileSync(path.join(out, `gemini-${label}-${name}.png`), Buffer.from((await cdp.send('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
  };
  const original = data.positions.scrollTop;
  if (data.positions.ul) await shoot('lists', original + data.positions.ul[1] - 200);
  if (data.positions.table) await shoot('table', original + data.positions.table[1] - 300);
  await page.evaluate((top) => { const s = [...document.querySelectorAll('infinite-scroller')].pop(); s.scrollTop = top; }, 100000);
  await new Promise((r) => setTimeout(r, 500));
  fs.writeFileSync(path.join(out, `gemini-${label}-bottom.png`), Buffer.from((await cdp.send('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
  await page.evaluate((top) => { const s = [...document.querySelectorAll('infinite-scroller')].pop(); s.scrollTop = top; }, original);
  await cdp.detach();
  await browser.disconnect();
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
