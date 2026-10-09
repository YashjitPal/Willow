/**
 * Read-only follow-ups on Gemini's sent-image preview: the full image's natural size against
 * the size it is shown at (does a small image grow to fill the box?), what Copy says once it
 * has copied, and whether a click on the dark area around the image closes the preview.
 * Copy only writes the clipboard. Its own tab.
 *
 *   node tools/scratch/gemini-sent-image-checks.cjs <chat id> [thumb index]
 */
const puppeteer = require('puppeteer-core');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

(async () => {
  const [chatId, indexArg] = process.argv.slice(2);
  const browser = await puppeteer.connect({ browserURL: 'http://[::1]:9222', defaultViewport: null, protocolTimeout: 90_000 });
  const context = browser.defaultBrowserContext();
  await context.overridePermissions('https://gemini.google.com', ['clipboard-read', 'clipboard-write', 'clipboard-sanitized-write']).catch(() => {});
  const page = await browser.newPage();
  try {
    await page.setViewport({ width: 1536, height: 826 });
    await page.bringToFront();
    await page.goto(`https://gemini.google.com/app/${chatId}`, { waitUntil: 'networkidle2', timeout: 90_000 });
    await sleep(6000);
    const open = async () => {
      const box = await page.evaluate((index) => {
        const img = [...document.querySelectorAll('user-query img')].filter((el) => el.getBoundingClientRect().width > 20)[index];
        img?.scrollIntoView({ block: 'center' });
        const r = img?.getBoundingClientRect();
        return r ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null;
      }, Number(indexArg) || 0);
      await sleep(800);
      await page.mouse.click(box.x, box.y);
      await page.waitForSelector('mat-dialog-container img.image-container', { timeout: 15_000 });
      await sleep(1500);
    };
    await open();
    console.log('preview image:', JSON.stringify(await page.evaluate(() => {
      const img = document.querySelector('mat-dialog-container img.image-container');
      const cs = getComputedStyle(img);
      const container = img.closest('.dialog-container');
      const ccs = getComputedStyle(container);
      const r = img.getBoundingClientRect();
      return {
        natural: [img.naturalWidth, img.naturalHeight],
        shown: [Math.round(r.width * 10) / 10, Math.round(r.height * 10) / 10],
        css: { width: cs.width, height: cs.height, maxWidth: cs.maxWidth, maxHeight: cs.maxHeight, objectFit: cs.objectFit, radius: cs.borderRadius },
        container: { cls: container.className.slice(0, 120), maxWidth: ccs.maxWidth, width: container.getBoundingClientRect().width },
        src: img.src.slice(0, 120),
      };
    })));

    // Copy, and what the snackbar says.
    // A known marker first, so whatever Copy writes is told apart from what was there.
    await page.evaluate(() => navigator.clipboard.writeText('willow-clipboard-marker').catch(() => {}));
    await page.click('mat-dialog-container button[aria-label="More options"], .cdk-overlay-container button[aria-label="More options"]');
    await sleep(800);
    console.log('menu panel:', JSON.stringify(await page.evaluate(() => {
      const panel = [...document.querySelectorAll('.mat-mdc-menu-panel, [role="menu"]')].find((el) => el.getBoundingClientRect().width > 0);
      if (!panel) return null;
      const cs = getComputedStyle(panel);
      const item = panel.querySelector('button, [role="menuitem"]');
      const ir = item.getBoundingClientRect();
      const icon = item.querySelector('mat-icon');
      const label = [...item.querySelectorAll('span')].find((el) => /copy/i.test(el.textContent) && !el.querySelector('span'));
      const rel = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return [r.x - ir.x, r.y - ir.y, r.width, r.height].map((v) => Math.round(v * 10) / 10); };
      const ics = getComputedStyle(item);
      const font = (el) => { if (!el) return null; const s = getComputedStyle(el); return `${s.fontFamily.split(',')[0]} ${s.fontSize}/${s.lineHeight} w${s.fontWeight} ls:${s.letterSpacing} fvs:${s.fontVariationSettings} display:${s.display}`; };
      const name = document.querySelector('.arrow-back-container .title');
      return {
        border: cs.border, outline: cs.outline,
        labelFontFull: font(label),
        nameFont: font(name),
        backdrop: cs.backdropFilter, bg: cs.backgroundColor, radius: cs.borderRadius, padding: cs.padding, minWidth: cs.minWidth, maxWidth: cs.maxWidth,
        item: { padding: ics.padding, radius: ics.borderRadius, bg: ics.backgroundColor, gap: ics.gap, height: ir.height },
        icon: rel(icon), label: rel(label),
        labelFont: label ? `${getComputedStyle(label).fontFamily.split(',')[0]} ${getComputedStyle(label).fontVariationSettings}` : null,
      };
    })));
    // A real click: the clipboard takes writes only inside a user gesture.
    const copyAt = await page.evaluate(() => {
      const item = [...document.querySelectorAll('[role="menuitem"], .mat-mdc-menu-panel button')].find((el) => /copy/i.test(el.textContent || ''));
      const r = item?.getBoundingClientRect();
      return r ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null;
    });
    if (copyAt) await page.mouse.click(copyAt.x, copyAt.y);
    await sleep(700);
    console.log('snackbars:', JSON.stringify(await page.evaluate(() => [...document.querySelectorAll('mat-snack-bar-container, .mat-mdc-snack-bar-container, .mdc-snackbar, simple-snack-bar')]
      .map((el) => { const r = el.getBoundingClientRect(); return `${el.textContent.replace(/\s+/g, ' ').trim()} [${[r.x, r.y, r.width, r.height].map(Math.round)}]`; }))));
    await page.screenshot({ path: 'tools/ui-research/captures/gemini/sent-image/desktop/after-copy.png' });
    await sleep(800);
    console.log('after Copy:', JSON.stringify(await page.evaluate(() => ({
      snackbar: [...document.querySelectorAll('mat-snack-bar-container, .mat-mdc-snack-bar-container, simple-snack-bar, [role="status"], [aria-live]')]
        .map((el) => el.textContent.replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, 4),
      dialogOpen: !!document.querySelector('mat-dialog-container'),
    }))));
    const clip = await page.evaluate(async () => {
      try {
        const items = await navigator.clipboard.read();
        return await Promise.all(items.map(async (item) => Object.fromEntries(await Promise.all(item.types.map(async (type) => {
          const blob = await item.getType(type);
          return [type, type.startsWith('text/') ? (await blob.text()).slice(0, 300) : `${blob.size} bytes`];
        })))));
      } catch (error) { return `unreadable: ${error.message}`; }
    });
    console.log('clipboard holds:', JSON.stringify(clip));

    // A click on the dark area, well away from the image and the header.
    await page.keyboard.press('Escape');
    await sleep(500);
    if (!(await page.evaluate(() => !!document.querySelector('mat-dialog-container')))) {
      console.log('(Escape closed the preview; reopening)');
      await open();
    } else {
      console.log('Escape with the menu closed: the preview is still open');
    }
    const vp = page.viewport();
    await page.mouse.click(60, vp.height - 60);
    await sleep(900);
    console.log('after a click on the dark area, open:', await page.evaluate(() => !!document.querySelector('mat-dialog-container')));
    if (await page.evaluate(() => !!document.querySelector('mat-dialog-container'))) {
      await page.keyboard.press('Escape');
      await sleep(900);
      console.log('after Escape, open:', await page.evaluate(() => !!document.querySelector('mat-dialog-container')));
    }
  } finally {
    await page.close().catch(() => {});
    browser.disconnect();
  }
})().catch((error) => { console.error(error); process.exit(1); });
