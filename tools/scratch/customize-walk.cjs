/**
 * Willow /customize at the current emulator size: walks every screen and overlay a user
 * can reach — the three tabs, a search with no results, the category pages, a
 * connector's details (top and bottom), the skill editor (new and existing), every card
 * menu and the Create menu (bottom sheets below 961px), the disconnect and leave-without-
 * saving dialogs — and scans each for sideways scrolling, anything past the screen edge,
 * or an overlay taller than the screen. Taps with real touch events. Opens and cancels
 * only: never confirms a disconnect, never saves a skill. Customize keeps all of this in
 * React state, so nothing is written anywhere. Prints no page text.
 *
 *   node tools/scratch/customize-walk.cjs [--label=phone] [--shots]
 */
const fs = require('fs');
const http = require('http');
const puppeteer = require('puppeteer-core');

const LABEL = (process.argv.find((a) => a.startsWith('--label=')) || '--label=walk').slice(8);
const SHOTS = process.argv.includes('--shots');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const getJson = (url) => new Promise((resolve) => {
  http.get(url, (res) => {
    let body = '';
    res.on('data', (c) => { body += c; });
    res.on('end', () => { try { resolve(JSON.parse(body)); } catch { resolve(null); } });
  }).on('error', () => resolve(null));
});

const SCAN = () => {
  const W = innerWidth;
  const H = innerHeight;
  const name = (el) => `${el.tagName.toLowerCase()}${typeof el.className === 'string' && el.className.trim() ? `.${el.className.trim().split(/\s+/).slice(0, 4).join('.')}` : ''}`;
  const INTENTIONAL = '.prompts-row, [data-scroll-x], .sr-only, aside.studio-sidebar';
  const visible = (el) => { const cs = getComputedStyle(el); return cs.display !== 'none' && cs.visibility !== 'hidden'; };
  const all = [...document.querySelectorAll('main *'), ...document.querySelectorAll('body > div:not(#root) *')];
  const out = [];
  for (const el of [document.scrollingElement, ...all]) {
    if (!el || !visible(el)) continue;
    const cs = getComputedStyle(el);
    if ((el === document.scrollingElement || /auto|scroll/.test(cs.overflowX)) && el.scrollWidth > el.clientWidth + 1 && el.clientWidth > 0 && !el.matches(INTENTIONAL)) {
      out.push(`scrolls sideways: ${name(el)} ${el.scrollWidth}/${el.clientWidth}`);
    }
  }
  const reported = [];
  for (const el of all) {
    if (!visible(el) || el.closest(INTENTIONAL) || reported.some((p) => p.contains(el))) continue;
    const b = el.getBoundingClientRect();
    if (!b.width || !b.height) continue;
    if (b.right > W + 0.5 || b.left < -0.5) {
      out.push(`past edge: ${name(el)} [${Math.round(b.left)}..${Math.round(b.right)}]`);
      reported.push(el);
    }
  }
  for (const el of document.querySelectorAll('.willow-gdlg-surface, .gemini-bottom-sheet, .customize-card-menu-panel')) {
    const b = el.getBoundingClientRect();
    if (b.top < -0.5 || b.bottom > H + 0.5) out.push(`overlay off screen: ${name(el)} [y ${Math.round(b.top)}..${Math.round(b.bottom)} of ${H}]`);
  }
  return out.slice(0, 10);
};

(async () => {
  const scale = (await getJson('http://127.0.0.1:9339/status'))?.scale || 1;
  const browser = await puppeteer.connect({ browserURL: 'http://[::1]:9222', defaultViewport: null, protocolTimeout: 60000 });
  const page = (await browser.pages()).find((p) => p.url().startsWith('http://localhost:3000') && !p.url().includes('/media'));
  await page.bringToFront();
  const cdp = await page.createCDPSession();
  let shotIndex = 0;

  const tapAt = async (x, y) => {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x * scale, y: y * scale }] });
    await sleep(50);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  };
  /** Taps the index-th visible match (optionally the one whose text matches). */
  const tapEl = async (selector, { index = 0, text = null, settle = 700, scroll = true } = {}) => {
    const pt = await page.evaluate(async (sel, idx, txt, doScroll) => {
      const els = [...document.querySelectorAll(sel)].filter((e) => {
        const r = e.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && (!txt || e.textContent.trim() === txt);
      });
      const el = els[idx];
      if (!el) return null;
      if (doScroll) {
        el.scrollIntoView({ block: 'center' });
        await new Promise((r) => setTimeout(r, 250));
      }
      const r = el.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    }, selector, index, text, scroll);
    if (!pt) return false;
    await tapAt(pt.x, pt.y);
    await sleep(settle);
    return true;
  };
  const exists = (sel) => page.evaluate((s) => [...document.querySelectorAll(s)].some((e) => e.getBoundingClientRect().width > 0), sel);
  const waitFor = async (sel, ms = 4000) => {
    for (let t = 0; t < ms; t += 150) {
      if (await exists(sel)) return true;
      await sleep(150);
    }
    return false;
  };
  const scrollRoot = (where) => page.evaluate((w) => {
    const root = document.querySelector('.customize-page-root');
    if (root) root.scrollTop = w === 'bottom' ? root.scrollHeight : 0;
  }, where);
  const typeInto = async (selector, text) => {
    await tapEl(selector, { settle: 200 });
    await cdp.send('Input.insertText', { text });
    await sleep(400);
  };
  const report = async (state) => {
    const issues = await page.evaluate(SCAN);
    console.log(`[${LABEL}] ${state}: ${issues.length ? issues.join(' | ') : 'ok'}`);
    if (SHOTS) {
      shotIndex += 1;
      const slug = state.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase();
      const data = await cdp.send('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(`${process.env.TEMP}/cz-${LABEL}-${String(shotIndex).padStart(2, '0')}-${slug}.png`, Buffer.from(data.data, 'base64'));
    }
  };
  const firstRow = () => page.evaluate(() => {
    const el = document.querySelector('.customize-page-root :is(.customize-nav-buttons, .customize-category-top-nav, .top-nav-bar, .manager-header)');
    if (!el) return 'none';
    const b = el.getBoundingClientRect();
    const btn = el.querySelector('button');
    const bb = btn && btn.getBoundingClientRect();
    return `.${el.className.split(' ')[0]} y ${Math.round(b.y * 10) / 10} h ${Math.round(b.height * 10) / 10}${bb ? `, first button [${Math.round(bb.x)},${Math.round(bb.y * 10) / 10}]` : ''}`;
  });
  const closeSheet = async () => {
    await tapEl('.gemini-bottom-sheet-backdrop', { scroll: false, settle: 400 });
    // The backdrop's centre can sit under a tall sheet; tap near the top instead.
    if (await exists('.gemini-bottom-sheet:not(.is-leaving)')) {
      await tapAt(20, 20);
      await sleep(400);
    }
  };
  const goTab = async (label) => {
    await scrollRoot('top');
    await tapEl('.customize-nav-button', { text: label, scroll: false });
    await waitFor('.customize-card');
    await sleep(300);
  };

  if (new URL(page.url()).pathname !== '/customize') {
    await page.evaluate(() => { history.pushState({}, '', '/customize'); dispatchEvent(new PopStateEvent('popstate')); });
    await sleep(2000);
  }
  // Back out of any sub-page a previous run left open.
  for (let guard = 0; guard < 3; guard++) {
    if (await exists('.willow-gdlg-pill--text')) await tapEl('.willow-gdlg-pill--text', { scroll: false });
    if (!(await tapEl('.customize-category-back-button, .back-button, .back-to-skills-btn', { scroll: false }))) break;
    if (await exists('.willow-gdlg-surface')) await tapEl('.willow-gdlg-pill:not(.willow-gdlg-pill--text)', { scroll: false });
  }
  await goTab('Discover');

  // ── Discover ──
  console.log(`[${LABEL}] discover first ${await firstRow()}`);
  await report('discover');
  await scrollRoot('bottom');
  await sleep(300);
  await report('discover bottom');
  await scrollRoot('top');
  await typeInto('.customize-search-input', 'zzzz');
  await report('discover no results');
  await tapEl('.customize-search-clear', { scroll: false, settle: 300 });

  await tapEl('.customize-category-header', { index: 0 });
  await waitFor('.customize-category-top-nav');
  console.log(`[${LABEL}] category first ${await firstRow()}`);
  await report('discover category');
  await typeInto('.customize-category-page-header .customize-search-input', 'zzzz');
  await report('discover category no results');
  await tapEl('.customize-category-back-button', { scroll: false });

  await tapEl('.customize-card', { text: null, index: 0 });
  await sleep(300);
  console.log(`[${LABEL}] discover card first ${await firstRow()}`);
  await report('discover card editor');
  await tapEl('.back-to-skills-btn, .back-button', { scroll: false });

  // ── Connectors ──
  await goTab('Connectors');
  await report('connectors');
  await tapEl('.customize-card .more-button', { index: 0 });
  await waitFor('.gemini-bottom-sheet, .customize-card-menu-panel');
  await report('connectors card menu');
  // Matched on the label: an item's full text starts with its icon's ligature.
  if (await exists('.gemini-bottom-sheet')) {
    await tapEl('.gemini-sheet-item-label', { text: 'Disconnect', scroll: false });
  } else {
    await tapEl('.customize-card-menu-item-label', { text: 'Disconnect', scroll: false });
  }
  await waitFor('.willow-gdlg-surface');
  await report('disconnect dialog');
  await tapEl('.willow-gdlg-pill--text', { scroll: false });
  await sleep(300);

  await tapEl('.customize-card', { index: 0 });
  await waitFor('.top-nav-bar');
  console.log(`[${LABEL}] connector detail first ${await firstRow()}`);
  await report('connector detail');
  await tapEl('.overflow-menu-button', { scroll: false });
  await waitFor('.gemini-bottom-sheet, .customize-card-menu-panel');
  await report('connector detail menu');
  if (await exists('.gemini-bottom-sheet')) await closeSheet();
  else await tapAt(10, 300);
  await scrollRoot('bottom');
  await sleep(300);
  await report('connector detail bottom');
  await scrollRoot('top');
  await tapEl('.back-button', { scroll: false });

  // The second active connector carries starter prompts and a capabilities list.
  await tapEl('.customize-card', { index: 1 });
  await waitFor('.prompts-row');
  console.log(`[${LABEL}] prompts ${await page.evaluate(() => {
    const row = document.querySelector('.prompts-row');
    if (!row) return 'none';
    const b = row.getBoundingClientRect();
    const cards = [...row.querySelectorAll('.prompt-card')].map((c) => { const r = c.getBoundingClientRect(); return `${Math.round(r.x)}+${Math.round(r.width)}x${Math.round(r.height)}`; });
    return `row [${Math.round(b.x)}..${Math.round(b.right)}] scroll ${row.scrollWidth}/${row.clientWidth}, cards ${cards.join(' ')}`;
  })}`);
  await report('connector detail with prompts');
  await scrollRoot('bottom');
  await sleep(300);
  await report('connector detail with prompts bottom');
  await scrollRoot('top');
  await tapEl('.back-button', { scroll: false });

  await tapEl('.customize-category-header', { index: 1 });
  await waitFor('.customize-category-top-nav');
  await report('connectors all');
  await tapEl('.customize-category-back-button', { scroll: false });

  // ── Skills ──
  await goTab('Skills');
  await report('skills');
  await tapEl('.customize-create-button', { scroll: false });
  await waitFor('.gemini-bottom-sheet, .customize-create-menu-panel');
  await report('skills create menu');
  if (await exists('.gemini-bottom-sheet')) {
    await tapEl('.gemini-sheet-item-label', { text: 'Create manually', scroll: false });
  } else {
    await tapEl('.customize-create-menu-text', { text: 'Create manually', scroll: false });
  }
  await waitFor('.manager-header');
  console.log(`[${LABEL}] skill editor first ${await firstRow()}`);
  await report('new skill editor');
  await typeInto('.editor-title-input', 'x');
  await tapEl('.back-to-skills-btn', { scroll: false });
  await waitFor('.willow-gdlg-surface');
  await report('leave without creating dialog');
  await tapEl('.willow-gdlg-pill:not(.willow-gdlg-pill--text)', { scroll: false });
  await sleep(400);

  await waitFor('.customize-card');
  await tapEl('.customize-card .more-button', { index: 0 });
  await waitFor('.gemini-bottom-sheet, .customize-card-menu-panel');
  await report('skill card menu');
  if (await exists('.gemini-bottom-sheet')) await closeSheet();
  else await tapAt(10, 300);

  await tapEl('.customize-card', { index: 0 });
  await waitFor('.manager-header');
  await report('skill editor');
  await tapEl('.manager-header .overflow-menu-button', { scroll: false });
  await waitFor('.gemini-bottom-sheet, .customize-card-menu-panel');
  await report('skill editor menu');
  if (await exists('.gemini-bottom-sheet')) await closeSheet();
  else await tapAt(10, 300);
  await tapEl('.back-to-skills-btn', { scroll: false });

  await tapEl('.customize-category-header', { text: null, index: 0 });
  await waitFor('.customize-category-top-nav');
  await report('skills active');
  await tapEl('.customize-category-back-button', { scroll: false });
  await scrollRoot('bottom');
  await sleep(300);
  await report('skills bottom');

  await goTab('Discover');
  await cdp.detach();
  browser.disconnect();
})();
