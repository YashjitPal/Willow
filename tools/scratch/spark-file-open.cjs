/**
 * Willow Spark's created-file "Open", in a browser context of its own (own storage, no
 * folder, none of the other tabs). Seeds a finished task whose run created "We are happy.md"
 * — Gemini's reference task, same text — writes the file into that context's OPFS
 * workspace, and walks it: the card, Open with the real mouse (motion sampled), the side
 * panel's geometry, Close (back to Progress), Open from Progress's Files row, the zoom
 * list, Download, Open in new tab and Print (each caught, nothing leaves the page).
 * `phone` or `tablet` emulates that device instead and taps Open.
 *
 *   node tools/scratch/spark-file-open.cjs [phone|tablet] [out-prefix]
 */
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');

const BASE = 'http://localhost:3000';
const SIZES = {
  phone: { width: 390, height: 844, mobile: true },
  tablet: { width: 800, height: 1280, mobile: true },
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const FILE_TEXT = `# We Are Happy

A collection of joyful moments and simple pleasures:

1. **A Warm Morning**: Sipping a fresh, warm cup of coffee or tea while watching the sunrise on a quiet morning.
2. **Spontaneous Laughter**: Sharing an inside joke with close friends and laughing until your stomach aches.
3. **Reaching a Milestone**: The quiet satisfaction and relief of completing a challenging project or goal you worked hard for.
4. **Unexpected Melodies**: Hearing your favorite song play unexpectedly on the radio or in a public place.
5. **Nature's Comfort**: Walking through a park on a cool, breezy afternoon, listening to leaves rustling and birds singing.
6. **Reconnecting**: Receiving a heartfelt message or call out of the blue from an old friend.
7. **Cozy Evenings**: Curling up under a warm blanket with a great book or movie while it rains outside.
8. **Acts of Kindness**: Experiencing or witnessing an unexpected, genuine act of kindness from a stranger.
`;

const seed = async (page, text) => page.evaluate(async (fileText) => {
  const find = (pattern) => performance.getEntriesByType('resource')
    .filter((entry) => pattern.test(entry.name))
    .sort((a, b) => b.startTime - a.startTime)[0]?.name;
  const storeUrl = find(/\/spark-store\.ts(\?|$)/);
  if (!storeUrl) return { error: 'spark-store not loaded' };
  const store = await import(storeUrl);
  const scope = store.getActiveSparkStorageScope();
  // The file where the harness's OPFS workspace keeps `/workspace/We are happy.md`.
  let dir = await navigator.storage.getDirectory();
  for (const part of ['willow-spark', scope, 'workspace', 'workspace']) dir = await dir.getDirectoryHandle(part, { create: true });
  const write = async (name, contents) => {
    const handle = await dir.getFileHandle(name, { create: true });
    const writable = await handle.createWritable();
    await writable.write(contents);
    await writable.close();
  };
  await write('We are happy.md', fileText);
  await write('index.html', '<!doctype html>\n<html>\n  <body>\n    <h1 id="greeting">Hello from Spark</h1>\n    <script>\n      document.getElementById("greeting").textContent += " (scripts run)";\n      try { localStorage.getItem("x"); document.title = "storage reachable"; } catch { document.title = "storage blocked"; }\n    </script>\n  </body>\n</html>\n');
  const id = 'seed-file-open';
  if (!store.sparkState.get().tasks.some((task) => task.id === id)) {
    store.createSparkTask('can you create a file called "We are happy" and store happy moments about anything and store it in your local computer', {
      id,
      title: 'Creation of Happy Moments File',
      description: 'Created the We are happy file',
      status: 'complete',
      openTask: false,
      progressLabel: 'Done',
      activityTitle: 'Creating We are happy text file',
      response: 'I have created the document **We are happy** and saved it in this browser.\n\nThe document contains a curated collection of uplifting moments and simple daily joys, including morning quietude, shared laughter, personal milestones, and comforting experiences. You can open it below to read it.',
      generatedFiles: [{
        id: 'seed-file-open-1',
        name: 'We are happy.md',
        path: '/workspace/We are happy.md',
        mimeType: 'text/plain',
        createdAt: new Date().toISOString(),
      }, {
        id: 'seed-file-open-2',
        name: 'index.html',
        path: '/workspace/index.html',
        mimeType: 'text/html',
        createdAt: new Date().toISOString(),
      }, {
        id: 'seed-file-open-3',
        name: 'notes from another browser.txt',
        path: '/workspace/notes from another browser.txt',
        mimeType: 'text/plain',
        createdAt: new Date().toISOString(),
      }],
    });
  }
  store.navigateSpark({ page: 'task', taskId: id });
  return { scope, id };
}, text);

const recorder = (durationMs) => {
  const boxes = {
    library: '.spark-task-detail__library',
    chat: '.spark-task-detail__panel',
    side: '.spark-task-detail__side-panel',
    progress: '.spark-task-detail__progress-panel',
    viewer: '.spark-file-viewer',
  };
  const samples = [];
  const t0 = performance.now();
  const tick = () => {
    const now = performance.now() - t0;
    const sample = { t: Math.round(now) };
    for (const [name, selector] of Object.entries(boxes)) {
      const element = document.querySelector(selector);
      if (!element) continue;
      const r = element.getBoundingClientRect();
      const cs = getComputedStyle(element);
      if (cs.display === 'none') continue;
      sample[name] = `${r.x.toFixed(1)} ${r.width.toFixed(1)}w o${Number(cs.opacity).toFixed(2)}`;
    }
    samples.push(sample);
    if (now < durationMs) setTimeout(tick, 8);
    else window.__motion = samples;
  };
  window.__motion = null;
  tick();
};

const geometry = (page) => page.evaluate(() => {
  const box = (selector) => {
    const el = document.querySelector(selector);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return [r.x, r.y, r.width, r.height].map((v) => Math.round(v * 10) / 10);
  };
  const side = document.querySelector('.spark-task-detail__side-panel, .spark-task-detail__browser-overlay-panel');
  const sideBox = side?.getBoundingClientRect();
  const rel = (selector) => {
    const el = document.querySelector(selector);
    if (!el || !sideBox) return null;
    const r = el.getBoundingClientRect();
    return [r.x - sideBox.x, r.y - sideBox.y, r.width, r.height].map((v) => Math.round(v * 10) / 10);
  };
  const text = document.querySelector('.spark-file-viewer__text');
  let firstLine = null;
  if (text && text.firstChild) {
    const range = document.createRange();
    range.setStart(text.firstChild, 0);
    range.setEnd(text.firstChild, 1);
    const r = range.getBoundingClientRect();
    firstLine = sideBox ? [r.x - sideBox.x, r.y - sideBox.y].map((v) => Math.round(v * 10) / 10) : null;
  }
  return {
    viewport: [innerWidth, innerHeight],
    library: box('.spark-task-detail__library'),
    chat: box('.spark-task-detail__panel'),
    side: box('.spark-task-detail__side-panel'),
    overlayPanel: box('.spark-task-detail__browser-overlay-panel'),
    progress: box('.spark-task-detail__progress-panel.is-open'),
    appbar: rel('.spark-file-viewer__appbar'),
    icon: rel('.spark-file-viewer__icon'),
    title: rel('.spark-file-viewer__title'),
    download: rel('.spark-file-viewer__primary'),
    buttons: [...document.querySelectorAll('.spark-file-viewer__icon-button')].map((el) => {
      const r = el.getBoundingClientRect();
      return [r.x - sideBox.x, r.y - sideBox.y, r.width].map((v) => Math.round(v * 10) / 10);
    }),
    toolbar: rel('.spark-file-viewer__toolbar'),
    print: rel('.spark-file-viewer__tool'),
    zoom: rel('.spark-file-viewer__zoom'),
    scroll: rel('.spark-file-viewer__scroll'),
    firstLine,
    textFont: text ? `${getComputedStyle(text).fontSize} / ${getComputedStyle(text).lineHeight} ${getComputedStyle(text).fontFamily.split(',')[0]}` : null,
    textLength: text?.textContent.length ?? 0,
  };
});

(async () => {
  const [kind, prefixArg] = process.argv.slice(2).filter((arg) => !arg.startsWith('--'));
  const size = SIZES[kind];
  const prefix = prefixArg || `tools/ui-research/captures/spark/136-file-open/willow/${kind || 'desktop'}`;
  fs.mkdirSync(path.dirname(prefix), { recursive: true });
  const browser = await puppeteer.connect({ browserURL: process.env.CDP_URL || 'http://[::1]:9222', defaultViewport: null, protocolTimeout: 30_000 });
  const context = await browser.createBrowserContext();
  const opened = [];
  browser.on('targetcreated', (target) => {
    if (target.browserContext() === context && target.type() === 'page') opened.push(target.url());
  });
  try {
    const page = await context.newPage();
    page.on('pageerror', (error) => console.log(`  [pageerror] ${error.message.slice(0, 200)}`));
    if (size) {
      const cdp = await page.createCDPSession();
      const version = (await browser.version()).match(/\/(\d+)/)?.[1] || '141';
      await cdp.send('Emulation.setUserAgentOverride', {
        userAgent: `Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${version}.0.0.0${kind === 'phone' ? ' Mobile' : ''} Safari/537.36`,
      });
      await cdp.send('Emulation.setDeviceMetricsOverride', {
        width: size.width, height: size.height, deviceScaleFactor: 0, mobile: true, screenWidth: size.width, screenHeight: size.height,
      });
      await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    }
    // What the viewer hands the browser, caught instead of done.
    await page.evaluateOnNewDocument(() => {
      window.__caught = [];
      const click = HTMLAnchorElement.prototype.click;
      HTMLAnchorElement.prototype.click = function () {
        if (this.download) {
          window.__caught.push({ kind: 'download', name: this.download, href: this.href.slice(0, 30) });
          return;
        }
        return click.call(this);
      };
      const append = Node.prototype.appendChild;
      Node.prototype.appendChild = function (child) {
        const result = append.call(this, child);
        if (child instanceof HTMLIFrameElement && child.contentWindow) {
          child.contentWindow.print = () => window.__caught.push({ kind: 'print', text: child.contentDocument?.body?.innerText.slice(0, 40), font: child.contentDocument && getComputedStyle(child.contentDocument.body).fontFamily });
        }
        return result;
      };
    });
    await page.goto(`${BASE}/spark`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.spark-top-controls, .spark-home, textarea', { timeout: 90_000 });
    await sleep(5000);
    console.log('seeded:', JSON.stringify(await seed(page, FILE_TEXT)));
    await page.waitForSelector('[data-test-id="spark-generated-file-card"]', { timeout: 30_000 });
    await sleep(2500);
    const card = await page.$('[data-test-id="spark-generated-file-card"]');
    await card.evaluate((el) => el.scrollIntoView({ block: 'center' }));
    await sleep(600);
    await page.bringToFront();
    await page.screenshot({ path: `${prefix}-card.png` });
    console.log('card:', JSON.stringify(await card.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const open = el.querySelector('.spark-task-detail__generated-file-open');
      const o = open.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return { rect: [r.x, r.y, r.width, r.height].map(Math.round), bg: cs.backgroundColor, open: [o.width, o.height].map(Math.round), openText: open.textContent, openBg: getComputedStyle(open).backgroundColor, text: el.textContent };
    })));
    const box = await card.boundingBox();
    if (size) {
      await page.bringToFront();
      await page.touchscreen.tap(box.x + box.width - 60, box.y + box.height / 2);
      await sleep(1500);
      await page.bringToFront();
      await page.screenshot({ path: `${prefix}-opened.png` });
      console.log('opened:', JSON.stringify(await geometry(page)));
      const closed = await page.evaluate(() => {
        const close = document.querySelector('.spark-task-detail__progress-overlay-close');
        close?.click();
        return Boolean(close);
      });
      await sleep(800);
      console.log('closed with the bar button:', closed, 'overlay left:', await page.evaluate(() => Boolean(document.querySelector('.spark-task-detail__progress-overlay'))));
      // The status pill's full-screen Progress, then its Files row.
      await page.evaluate(() => document.querySelector('.spark-task-detail__status-pill')?.click());
      await sleep(800);
      const rows = await page.evaluate(() => [...document.querySelectorAll('button.spark-task-detail__progress-overlay-row')].map((row) => row.textContent));
      await page.evaluate(() => document.querySelector('button.spark-task-detail__progress-overlay-row')?.click());
      await sleep(900);
      console.log('Files rows:', JSON.stringify(rows), '| after the first:', JSON.stringify(await page.evaluate(() => ({
        overlays: [...document.querySelectorAll('.spark-task-detail__progress-overlay')].map((el) => el.getAttribute('aria-label') || 'progress'),
        file: document.querySelector('.spark-file-viewer__scroll')?.getAttribute('aria-label') ?? null,
      }))));
      await page.keyboard.press('Escape');
      await sleep(600);
      console.log('Escape closes it:', !(await page.evaluate(() => Boolean(document.querySelector('.spark-file-viewer')))));
      return;
    }
    await page.mouse.move(box.x + 60, box.y + box.height / 2);
    await sleep(400);
    console.log('card hovered bg:', await card.evaluate((el) => getComputedStyle(el).backgroundColor));
    await page.evaluate(recorder, 1300);
    await page.mouse.move(box.x + box.width - 60, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.up();
    let last = 0;
    for (const at of [80, 200, 330, 500, 1000]) {
      await sleep(at - last);
      last = at;
      await page.screenshot({ path: `${prefix}-open-${at}.png` });
    }
    await page.waitForFunction(() => window.__motion, { timeout: 5000 });
    const motion = await page.evaluate(() => window.__motion);
    fs.writeFileSync(`${prefix}-open-motion.json`, JSON.stringify(motion, null, 1));
    let previous = '';
    for (const sample of motion) {
      const line = ['library', 'chat', 'side', 'viewer'].map((key) => `${key}=${sample[key] ?? '-'}`).join(' | ');
      if (line !== previous && (sample.t % 1 === 0)) console.log(`  t=${String(sample.t).padStart(4)} ${line}`);
      previous = line;
    }
    await sleep(800);
    await page.screenshot({ path: `${prefix}-opened.png` });
    console.log('opened:', JSON.stringify(await geometry(page), null, 0));

    // The actions, caught, one at a time.
    for (const [label, selector] of [
      ['Download', '.spark-file-viewer__primary'],
      ['Open in new tab', '.spark-file-viewer__icon-button[aria-label="Open in new tab"]'],
      ['Print', '.spark-file-viewer__tool[aria-label="Print"]'],
    ]) {
      await page.evaluate((sel) => document.querySelector(sel)?.click(), selector);
      await sleep(1200);
      await page.bringToFront();
      console.log(`${label}:`, JSON.stringify(await page.evaluate(() => window.__caught.splice(0))), '| new tabs:', JSON.stringify(opened.splice(0)));
    }
    for (const target of (await context.pages())) if (target !== page) await target.close();

    // Zoom to 150%, then back. Closing the other tabs can leave this one behind.
    await page.bringToFront();
    await page.click('.spark-file-viewer__zoom');
    await sleep(300);
    await page.screenshot({ path: `${prefix}-zoom-menu.png` });
    await page.evaluate(() => [...document.querySelectorAll('.spark-file-viewer__zoom-option')].find((el) => el.textContent.trim() === '150%')?.click());
    await sleep(400);
    console.log('zoomed:', JSON.stringify(await page.evaluate(() => {
      const pageEl = document.querySelector('.spark-file-viewer__page');
      const text = document.querySelector('.spark-file-viewer__text');
      const range = document.createRange();
      range.selectNodeContents(text);
      return { zoom: getComputedStyle(pageEl).zoom, value: document.querySelector('.spark-file-viewer__zoom-value').textContent, firstLineHeight: Math.round(range.getClientRects()[0].height * 10) / 10 };
    })));
    await page.screenshot({ path: `${prefix}-zoom-150.png` });
    await page.click('.spark-file-viewer__zoom');
    await sleep(200);
    await page.evaluate(() => [...document.querySelectorAll('.spark-file-viewer__zoom-option')].find((el) => el.textContent.trim() === '100%')?.click());

    // Close: Progress takes the panel back at 300px.
    await page.evaluate(recorder, 900);
    await page.click('.spark-file-viewer__icon-button[aria-label="Close"]');
    await sleep(1000);
    const closing = await page.evaluate(() => window.__motion);
    console.log('closed:', JSON.stringify(await geometry(page)));
    console.log('  closing samples:', closing.filter((s, i) => i % 6 === 0).map((s) => `t${s.t} side=${s.side ?? '-'} progress=${s.progress ?? '-'}`).join(' ; '));
    await page.screenshot({ path: `${prefix}-closed.png` });

    // Open again from Progress's Files row.
    await page.evaluate(recorder, 900);
    const fromProgress = await page.evaluate(() => {
      const row = document.querySelector('.spark-task-detail__progress-panel.is-open button.spark-task-detail__progress-panel-file');
      row?.click();
      return Boolean(row);
    });
    await sleep(1000);
    const reopening = await page.evaluate(() => window.__motion);
    console.log('opened from Progress:', fromProgress, JSON.stringify(await geometry(page)));
    console.log('  opening samples:', reopening.filter((s, i) => i % 6 === 0).map((s) => `t${s.t} side=${s.side ?? '-'} viewer=${s.viewer ?? '-'}`).join(' ; '));

    // Another card while one is open: the panel stays, its file changes. A page reads as code,
    // and opens in a new tab as itself, with no way into Willow's storage.
    const openCard = (index) => page.evaluate((i) => {
      const cards = document.querySelectorAll('[data-test-id="spark-generated-file-card"]');
      cards[i]?.click();
      return cards.length;
    }, index);
    console.log('cards:', await openCard(1));
    await sleep(700);
    console.log('html file:', JSON.stringify(await page.evaluate(() => ({
      title: document.querySelector('.spark-file-viewer__title')?.textContent,
      pageClass: document.querySelector('.spark-file-viewer__page')?.className,
      font: getComputedStyle(document.querySelector('.spark-file-viewer__text')).fontFamily.split(',')[0],
      firstLine: document.querySelector('.spark-file-viewer__text')?.textContent.split('\n')[0],
      sides: document.querySelectorAll('.spark-task-detail__side-panel').length,
    }))));
    await page.bringToFront();
    await page.screenshot({ path: `${prefix}-html.png` });
    const tabOpened = new Promise((resolve) => {
      const onTarget = (target) => {
        if (target.browserContext() !== context || target.type() !== 'page') return;
        browser.off('targetcreated', onTarget);
        resolve(target);
      };
      browser.on('targetcreated', onTarget);
    });
    await page.evaluate(() => document.querySelector('.spark-file-viewer__icon-button[aria-label="Open in new tab"]')?.click());
    const tab = await Promise.race([tabOpened, sleep(5000).then(() => null)]);
    if (tab) {
      const tabPage = await tab.page();
      await sleep(1500);
      const inner = tabPage.frames().find((frame) => frame !== tabPage.mainFrame());
      console.log('html in a new tab:', tab.url().slice(0, 40), '| heading:', await inner?.evaluate(() => document.getElementById('greeting')?.textContent), '| storage:', await inner?.evaluate(() => document.title));
      await tabPage.close();
    } else {
      console.log('html in a new tab: no tab opened');
    }
    await page.bringToFront();

    console.log('cards:', await openCard(2));
    // A miss is retried three times, 300ms apart, before it is shown.
    await sleep(1600);
    console.log('missing file:', JSON.stringify(await page.evaluate(() => ({
      title: document.querySelector('.spark-file-viewer__title')?.textContent,
      message: document.querySelector('.spark-file-viewer__missing')?.textContent,
      downloadDisabled: document.querySelector('.spark-file-viewer__primary')?.disabled,
      printDisabled: document.querySelector('.spark-file-viewer__tool')?.disabled,
    }))));
    await page.screenshot({ path: `${prefix}-missing.png` });

    // With the list open again, from the status pill's popover.
    await page.evaluate(() => document.querySelector('.spark-file-viewer__icon-button[aria-label="Close"]')?.click());
    await sleep(800);
    await page.evaluate(() => document.querySelector('.spark-task-detail__library-divider button')?.click());
    await sleep(900);
    await page.evaluate(() => document.querySelector('.spark-task-detail__status-pill')?.click());
    await sleep(500);
    const popoverRows = await page.evaluate(() => [...document.querySelectorAll('button.spark-task-detail__popover-file')].map((row) => row.textContent));
    await page.evaluate(() => document.querySelector('button.spark-task-detail__popover-file')?.click());
    await sleep(1100);
    const fromPopover = await geometry(page);
    console.log('popover Files rows:', JSON.stringify(popoverRows), '| opened:', JSON.stringify({
      library: fromPopover.library, chat: fromPopover.chat, side: fromPopover.side, popover: await page.evaluate(() => Boolean(document.querySelector('.spark-task-detail__progress-popover'))),
    }));
  } finally {
    await context.close();
    browser.disconnect();
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
