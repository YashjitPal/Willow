/**
 * Read-only recon of Gemini Spark's remote browser at phone or tablet size, in a
 * tab of its own (emulation is applied to that tab only, and it is closed after).
 * Opens an existing task, captures the thread, then — with `pane` — taps the
 * header's monitor button and captures the remote browser as Gemini shows it.
 * Nothing is sent or allowed; it only opens and closes views.
 *
 *   node tools/scratch/gemini-rb-narrow.cjs <phone|tablet> "<task title>" <out-prefix> [pane] [scrim] [history]
 */
const puppeteer = require('puppeteer-core');
const fs = require('fs');

const SIZES = {
  phone: { width: 390, height: 844, mobile: true },
  tablet: { width: 800, height: 1280, mobile: true },
};

const dumpScript = () => {
  const pick = (el) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    const own = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent.trim()).join(' ').trim();
    return {
      tag: el.tagName.toLowerCase(),
      cls: (typeof el.className === 'string' ? el.className : '').slice(0, 120),
      aria: el.getAttribute('aria-label') || undefined,
      text: own.slice(0, 80) || undefined,
      rect: [r.x, r.y, r.width, r.height].map((v) => Math.round(v * 100) / 100),
      cs: {
        font: `${cs.fontSize}/${cs.lineHeight} ${cs.fontWeight}`,
        color: cs.color,
        bg: cs.backgroundColor,
        radius: cs.borderRadius,
        pad: cs.padding,
        margin: cs.margin,
        border: cs.border,
        position: cs.position,
        display: cs.display,
        shadow: cs.boxShadow !== 'none' ? cs.boxShadow : undefined,
      },
    };
  };
  const roots = [...document.querySelectorAll('.cdk-overlay-container, remy-confirmation-card, remy-side-panel, computer-use-panel, vnc-viewer, .mobile-side-panel-overlay, .split-pane-container, remy-viewer, [class*="computer-use"], [class*="take-over"], [class*="takeover"], .chat-thread-header, .remy-thread-header, header')];
  const seen = new Set();
  const nodes = [];
  for (const root of roots) {
    for (const el of [root, ...root.querySelectorAll('*')]) {
      if (seen.has(el)) continue;
      seen.add(el);
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      nodes.push(pick(el));
      if (nodes.length > 1500) break;
    }
  }
  return { url: location.href, viewport: [innerWidth, innerHeight], nodes };
};

(async () => {
  const [kind = 'phone', title, prefix = 'tools/ui-research/captures/spark/134-remote-browser/narrow/x', ...flags] = process.argv.slice(2);
  const size = SIZES[kind];
  if (!size || !title) throw new Error('usage: <phone|tablet> "<task title>" <out-prefix> [pane] [scrim] [history]');
  fs.mkdirSync(require('path').dirname(prefix), { recursive: true });
  const browser = await puppeteer.connect({ browserURL: 'http://[::1]:9222', defaultViewport: null });
  const page = await browser.newPage();
  const cdp = await page.createCDPSession();
  const save = async (name) => {
    await page.screenshot({ path: `${prefix}-${name}.png` });
    fs.writeFileSync(`${prefix}-${name}.json`, JSON.stringify(await page.evaluate(dumpScript), null, 1));
    console.log('captured', name);
  };
  try {
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
    await page.goto('https://gemini.google.com/spark/tasks', { waitUntil: 'networkidle2', timeout: 60_000 });
    await new Promise((resolve) => setTimeout(resolve, 2500));
    const opened = await page.evaluate((wanted) => {
      const match = [...document.querySelectorAll('remy-task-list *')].find((el) => (el.textContent || '').trim() === wanted);
      if (!match) return false;
      (match.closest('button, a, [role="button"], .goal-card') || match).click();
      return true;
    }, title);
    if (!opened) throw new Error(`task "${title}" not found`);
    await new Promise((resolve) => setTimeout(resolve, 6000));
    await save('thread');
    if (flags.includes('pane')) {
      const tapped = await page.evaluate(() => {
        const icons = [...document.querySelectorAll('mat-icon, .google-symbols, [fonticon], span, i')]
          .filter((el) => (el.textContent || '').trim() === 'monitor' || el.getAttribute('fonticon') === 'monitor');
        const button = icons.map((icon) => icon.closest('button')).find(Boolean);
        if (!button) return null;
        button.click();
        return button.getAttribute('aria-label') || button.className;
      });
      console.log('monitor button:', tapped);
      if (!tapped) throw new Error('no monitor button in the header');
      await new Promise((resolve) => setTimeout(resolve, 1500));
      await save('pane-menu');
      console.log('menu panel:', JSON.stringify(await page.evaluate(() => [...document.querySelectorAll('.mat-mdc-menu-panel, .mat-mdc-menu-panel .mat-mdc-menu-item, .mat-mdc-menu-panel .mat-mdc-menu-item-text, .mat-mdc-menu-panel mat-icon, .mat-mdc-menu-panel gem-icon')]
        .map((el) => {
          const r = el.getBoundingClientRect();
          const cs = getComputedStyle(el);
          return {
            el: `${el.tagName.toLowerCase()}.${String(el.className).slice(0, 60)}`,
            rect: [r.x, r.y, r.width, r.height].map((v) => Math.round(v * 10) / 10),
            font: `${cs.fontSize}/${cs.lineHeight} ${cs.fontWeight}`,
            color: cs.color, bg: cs.backgroundColor, radius: cs.borderRadius, pad: cs.padding, gap: cs.gap,
            shadow: cs.boxShadow, minWidth: cs.minWidth,
          };
        }))));
      // Gemini's monitor button may open a menu ("View remote browser") rather than the pane.
      const viaMenu = await page.evaluate(() => {
        const item = [...document.querySelectorAll('[role="menuitem"], button')]
          .find((el) => /remote browser|remote computer/i.test(el.textContent || ''));
        if (!item) return false;
        item.click();
        return (item.textContent || '').trim();
      });
      console.log('menu item:', viaMenu);
      await new Promise((resolve) => setTimeout(resolve, 3000));
      await save('pane');
      if (flags.includes('scrim')) {
        const viewer = await page.$('vnc-viewer, .iframe-container, computer-use-panel');
        if (viewer) {
          const box = await viewer.boundingBox();
          await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
          await new Promise((resolve) => setTimeout(resolve, 800));
          await save('pane-tap');
        }
      }
      if (flags.includes('history')) {
        const previous = await page.evaluate(() => {
          const button = [...document.querySelectorAll('button')].find((el) => /previous/i.test(el.getAttribute('aria-label') || ''));
          if (!button) return false;
          button.click();
          return true;
        });
        console.log('previous:', previous);
        await new Promise((resolve) => setTimeout(resolve, 1200));
        await save('pane-history');
      }
    }
  } finally {
    await page.close();
    browser.disconnect();
  }
})().catch((e) => { console.error(e.message); process.exit(1); });
