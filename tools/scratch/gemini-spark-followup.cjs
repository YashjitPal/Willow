/**
 * Sends one message in a Gemini Spark task and records what comes back, in a tab of its
 * own: opens the task (by `/spark/chat/<id>` address, or the newest task whose list row
 * matches a pattern), types the message into the follow-up box, sends it, and screenshots
 * the thread every few seconds until the run settles. Then dumps the thread's last turn
 * and every element whose tag or class names a schedule or a skill.
 *
 * This writes to the Gemini account (it sends a message); it deletes nothing.
 *
 *   node tools/scratch/gemini-spark-followup.cjs <task address | /row pattern/> "<message>" <out-prefix> [phone|tablet] [--wait=180]
 */
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');

const SIZES = { phone: { width: 390, height: 844 }, tablet: { width: 800, height: 1280 } };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const dumpTurn = () => {
  const pick = (el) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    const own = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent.trim()).join(' ').trim();
    return {
      tag: el.tagName.toLowerCase(),
      cls: (typeof el.className === 'string' ? el.className : String(el.className?.baseVal ?? '')).slice(0, 140),
      testId: el.getAttribute('data-test-id') || undefined,
      aria: el.getAttribute('aria-label') || undefined,
      href: el.getAttribute('href')?.slice(0, 160) || undefined,
      src: el.getAttribute('src')?.slice(0, 160) || undefined,
      text: own.slice(0, 160) || undefined,
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
        gridCols: cs.display.includes('grid') ? cs.gridTemplateColumns : undefined,
      },
    };
  };
  const turns = [...document.querySelectorAll('.conversation-container, remy-chat-turn, [class*="chat-turn"], message-content, .response-container')];
  const last = turns.at(-1)?.closest('.conversation-container') ?? turns.at(-1) ?? null;
  const nodes = [];
  if (last) for (const el of [last, ...last.querySelectorAll('*')]) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;
    nodes.push(pick(el));
    if (nodes.length > 900) break;
  }
  const named = [...document.querySelectorAll('*')].filter((el) => {
    const label = `${el.tagName} ${typeof el.className === 'string' ? el.className : ''}`.toLowerCase();
    return /schedul|skill|automation|routine/.test(label) && el.getBoundingClientRect().width > 0;
  }).slice(0, 200).map(pick);
  return { url: location.href, viewport: [innerWidth, innerHeight], text: last?.innerText?.slice(0, 4000) ?? null, nodes, named };
};

(async () => {
  const args = process.argv.slice(2);
  const flags = Object.fromEntries(args.filter((a) => a.startsWith('--')).map((a) => a.slice(2).split('=')));
  const [target, message, prefix, kind] = args.filter((a) => !a.startsWith('--'));
  if (!target || !message || !prefix) throw new Error('usage: <task address | /row pattern/> "<message>" <out-prefix> [phone|tablet]');
  fs.mkdirSync(path.dirname(prefix), { recursive: true });
  const browser = await puppeteer.connect({ browserURL: 'http://[::1]:9222', defaultViewport: null, protocolTimeout: 90_000 });
  const page = await browser.newPage();
  const shot = async (name) => {
    await page.bringToFront();
    await page.screenshot({ path: `${prefix}-${name}.png` });
  };
  try {
    if (kind) {
      const size = SIZES[kind];
      const cdp = await page.createCDPSession();
      await cdp.send('Emulation.setDeviceMetricsOverride', { width: size.width, height: size.height, deviceScaleFactor: 0, mobile: true, screenWidth: size.width, screenHeight: size.height });
      await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    }
    await page.bringToFront();
    if (target.startsWith('http')) {
      await page.goto(target, { waitUntil: 'networkidle2', timeout: 90_000 });
    } else {
      const pattern = new RegExp(target.replace(/^\/|\/$/g, ''), 'i');
      await page.goto('https://gemini.google.com/spark/tasks', { waitUntil: 'networkidle2', timeout: 90_000 });
      await sleep(3000);
      const opened = await page.evaluate((source) => {
        const wanted = new RegExp(source, 'i');
        const row = [...document.querySelectorAll('.goal-card, remy-task-list [role="button"], remy-task-list a, remy-task-list button')]
          .find((el) => wanted.test(el.textContent || ''));
        if (!row) return null;
        row.click();
        return row.textContent.trim().slice(0, 80);
      }, pattern.source);
      if (!opened) throw new Error(`no task row matches ${pattern}`);
      console.log('opened row:', opened);
    }
    await sleep(5000);
    console.log('task:', page.url());
    await shot('0-before');
    // The task view has two boxes: the list's "Describe a task" (a new task) and the
    // thread's "Ask a follow-up". This one sends a follow-up.
    await page.waitForSelector('.ql-editor', { timeout: 30_000 });
    const editor = await page.evaluateHandle(() => {
      const editors = [...document.querySelectorAll('.ql-editor')].filter((el) => el.getBoundingClientRect().width > 0);
      return editors.find((el) => /follow-up/i.test(el.getAttribute('data-placeholder') || '')) ?? editors.at(-1);
    });
    console.log('typing into:', await editor.evaluate((el) => el.getAttribute('data-placeholder')));
    await editor.asElement().click();
    await sleep(300);
    await page.keyboard.type(message, { delay: 12 });
    await sleep(500);
    await page.keyboard.press('Enter');
    const started = Date.now();
    const limit = Number(flags.wait || 180) * 1000;
    let index = 1;
    let settledFor = 0;
    let lastText = '';
    while (Date.now() - started < limit) {
      await sleep(4000);
      const state = await page.evaluate(() => ({
        busy: Boolean([...document.querySelectorAll('button')].find((b) => /stop/i.test(b.getAttribute('aria-label') || '') && b.getBoundingClientRect().width > 0)),
        text: (document.querySelectorAll('.conversation-container, message-content').length
          ? [...document.querySelectorAll('.conversation-container, message-content')].at(-1).innerText : '').slice(-400),
        pill: document.querySelector('.remy-plan-pill, [class*="status-pill"]')?.textContent?.trim() ?? null,
      }));
      if (index <= 30) await shot(`${index}`);
      index += 1;
      if (!state.busy && state.text === lastText) settledFor += 4000;
      else settledFor = 0;
      lastText = state.text;
      console.log(`  ${Math.round((Date.now() - started) / 1000)}s busy=${state.busy} pill=${state.pill} | ${state.text.replace(/\s+/g, ' ').slice(-140)}`);
      if (settledFor >= 12_000) break;
    }
    await shot('done');
    const dump = await page.evaluate(dumpTurn);
    fs.writeFileSync(`${prefix}-done.json`, JSON.stringify(dump, null, 1));
    console.log('final address:', dump.url);
    console.log('last turn text:\n', dump.text);
    console.log('named elements:', [...new Set(dump.named.map((n) => `${n.tag}.${n.cls.split(' ')[0]}`))].join(', '));
  } finally {
    await page.close().catch(() => {});
    browser.disconnect();
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
