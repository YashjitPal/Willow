/**
 * Read-only: opens a Gemini address in a tab of its own, waits for it to settle, scrolls
 * the thread to its end, and saves a screenshot plus a dump of the last turn (boxes, type,
 * colours, links) and of every element whose tag or class names a schedule or a skill.
 *
 *   node tools/scratch/gemini-open-capture.cjs <url | /task row pattern/> <out-prefix> [phone|tablet] [--scroll=<selector>] [--click=<selector>]
 *
 * `--click` presses the last visible match first (a "See more", say): a view, not a change.
 */
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');

const SIZES = { phone: { width: 390, height: 844 }, tablet: { width: 800, height: 1280 } };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

(async () => {
  const args = process.argv.slice(2);
  const flags = Object.fromEntries(args.filter((a) => a.startsWith('--')).map((a) => a.slice(2).split('=')));
  const [url, prefix, kind] = args.filter((a) => !a.startsWith('--'));
  fs.mkdirSync(path.dirname(prefix), { recursive: true });
  const browser = await puppeteer.connect({ browserURL: 'http://[::1]:9222', defaultViewport: null, protocolTimeout: 90_000 });
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
    if (url.startsWith('/')) {
      // A Spark task by its list row: the newest row matching the pattern.
      await page.goto('https://gemini.google.com/spark/tasks', { waitUntil: 'networkidle2', timeout: 90_000 });
      await sleep(3000);
      const opened = await page.evaluate((source) => {
        const row = [...document.querySelectorAll('.goal-card')].find((el) => new RegExp(source, 'i').test(el.textContent || ''));
        row?.click();
        return row ? row.textContent.trim().slice(0, 80) : null;
      }, url.replace(/^\/|\/$/g, ''));
      if (!opened) throw new Error(`no task row matches ${url}`);
      console.log('opened row:', opened);
    } else {
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 90_000 });
    }
    await sleep(7000);
    if (flags.click) {
      // Every match, last first: the newest card is the one at the end of the thread.
      const clicked = await page.evaluate((selector) => {
        const all = [...document.querySelectorAll(selector)].filter((el) => el.getBoundingClientRect().width > 0);
        all.at(-1)?.scrollIntoView({ block: 'center' });
        all.at(-1)?.click();
        return all.length;
      }, flags.click);
      console.log(`clicked ${flags.click}:`, clicked);
      await sleep(1200);
    }
    if (flags.scroll) {
      await page.evaluate((selector) => [...document.querySelectorAll(selector)].at(-1)?.scrollIntoView({ block: 'center' }), flags.scroll);
      await sleep(1200);
    } else if (!flags.click) {
      await page.evaluate(() => {
        for (const el of document.querySelectorAll('*')) {
          const cs = getComputedStyle(el);
          if (/(auto|scroll)/.test(cs.overflowY) && el.scrollHeight > el.clientHeight + 40) el.scrollTop = el.scrollHeight;
        }
      });
      await sleep(1500);
    }
    await page.bringToFront();
    await page.screenshot({ path: `${prefix}.png` });
    const dump = await page.evaluate(() => {
      const pick = (el) => {
        const r = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        const own = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent.trim()).join(' ').trim();
        return {
          tag: el.tagName.toLowerCase(),
          cls: (typeof el.className === 'string' ? el.className : String(el.className?.baseVal ?? '')).slice(0, 140),
          testId: el.getAttribute('data-test-id') || undefined,
          aria: el.getAttribute('aria-label') || undefined,
          href: el.getAttribute('href')?.slice(0, 200) || undefined,
          src: el.getAttribute('src')?.slice(0, 200) || undefined,
          text: own.slice(0, 200) || undefined,
          rect: [r.x, r.y, r.width, r.height].map((v) => Math.round(v * 100) / 100),
          cs: {
            font: `${cs.fontSize}/${cs.lineHeight} ${cs.fontWeight} ${cs.fontFamily.split(',')[0]}`,
            fvs: cs.fontVariationSettings !== 'normal' ? cs.fontVariationSettings : undefined,
            color: cs.color,
            bg: cs.backgroundColor !== 'rgba(0, 0, 0, 0)' ? cs.backgroundColor : undefined,
            radius: cs.borderRadius !== '0px' ? cs.borderRadius : undefined,
            pad: cs.padding !== '0px' ? cs.padding : undefined,
            margin: cs.margin !== '0px' ? cs.margin : undefined,
            border: cs.borderStyle !== 'none' && cs.borderTopWidth !== '0px' ? `${cs.borderTopWidth} ${cs.borderStyle} ${cs.borderTopColor}` : undefined,
            display: cs.display,
            flex: cs.display.includes('flex') ? `${cs.flexDirection} ${cs.alignItems} ${cs.justifyContent} gap:${cs.gap}` : undefined,
            shadow: cs.boxShadow !== 'none' ? cs.boxShadow : undefined,
            opacity: cs.opacity !== '1' ? cs.opacity : undefined,
          },
        };
      };
      const turns = [...document.querySelectorAll('.conversation-container')];
      const last = turns.at(-1) ?? null;
      const nodes = [];
      if (last) for (const el of [last, ...last.querySelectorAll('*')]) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) continue;
        nodes.push(pick(el));
        if (nodes.length > 1200) break;
      }
      const named = [...document.querySelectorAll('*')].filter((el) => {
        const label = `${el.tagName} ${typeof el.className === 'string' ? el.className : ''}`.toLowerCase();
        return /schedul|skill|automation|routine/.test(label) && el.getBoundingClientRect().width > 0;
      }).slice(0, 300).map(pick);
      return { url: location.href, viewport: [innerWidth, innerHeight], text: last?.innerText?.slice(0, 5000) ?? null, html: last?.outerHTML?.slice(0, 60000) ?? null, nodes, named };
    });
    fs.writeFileSync(`${prefix}.json`, JSON.stringify(dump, null, 1));
    console.log('address:', dump.url);
    console.log('last turn:\n', dump.text);
    console.log('named:', [...new Set(dump.named.map((n) => `${n.tag}.${n.cls.split(' ')[0]}`))].join(', '));
  } finally {
    await page.close().catch(() => {});
    browser.disconnect();
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
