// The Tools pages on the :3101 test origin, in their own headless Chrome (a fresh profile, so
// nothing of the user's and no API keys: the builder only ever fails, through the debug menu's
// mock errors, and no model is called). Screenshots at Flow's capture size with --shots.
//   node tools/scratch/w-tools.cjs [--shots] [--keep] [--only=manager,template,edit,builder,menu,dock,rail,create,community,notfound]
const fs = require('fs');
const os = require('os');
const path = require('path');
const puppeteer = require('puppeteer-core');

const ORIGIN = 'http://localhost:3101';
const ROOT = '/@fs/C:/Users/Yashjit%202/Workspace/Willow%20Code';
const PROJECT = 'wt-tools';
const SHOTS = process.argv.includes('--shots') ? path.join(__dirname, '../ui-research/captures/willow/tools') : null;
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
const KEEP = process.argv.includes('--keep');
const ONLY = (process.argv.find((a) => a.startsWith('--only=')) || '').slice('--only='.length).split(',').filter(Boolean);
const runs = (step) => !ONLY.length || ONLY.includes(step);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (label, ok, detail) => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${detail === undefined ? '' : ` :: ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`}`);
};

(async () => {
  const userDataDir = KEEP ? path.join(os.tmpdir(), 'willow-tools-probe') : fs.mkdtempSync(path.join(os.tmpdir(), 'willow-tools-'));
  fs.mkdirSync(userDataDir, { recursive: true });
  const browser = await puppeteer.launch({
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: true,
    userDataDir,
    defaultViewport: { width: 1536, height: 826, deviceScaleFactor: 1.25 },
    args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'],
    ignoreDefaultArgs: ['--hide-scrollbars'],
    protocolTimeout: 300000,
  });
  const page = (await browser.pages())[0];
  const errors = [];
  const t0 = Date.now();
  const navigations = [];
  page.on('framenavigated', (f) => { if (f === page.mainFrame()) navigations.push(`+${((Date.now() - t0) / 1000).toFixed(1)}s ${f.url().replace(ORIGIN, '')}`); });
  // Not the Tools pages': Media's own icons spell SVG attributes in kebab case, and a tool's
  // `@import "tailwindcss"` is refused by its frame's CSP exactly as in Flow's runner.
  const IGNORED = [/Invalid DOM property .*stroke-width/, /stroke-width strokeWidth/, /tailwindcss' violates the following Content Security Policy/];
  page.on('pageerror', (e) => errors.push(String(e.message || e).slice(0, 300)));
  page.on('console', (m) => {
    const t = m.text();
    if (m.type() === 'error' && !IGNORED.some((re) => re.test(t))) errors.push(`console: ${t.slice(0, 300)}`);
  });
  const shot = async (name) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${name}.png`) }); };
  const url = () => page.url().replace(ORIGIN, '');
  const waitFor = async (fn, arg, ms = 15000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (await page.evaluate(`!!((${fn})(${JSON.stringify(arg ?? null)}))`).catch(() => false)) return true;
      await sleep(150);
    }
    return false;
  };
  // A reload mid-step (the dev server's) fails that step's checks rather than ending the run.
  const text = (sel) => page.evaluate((s) => document.querySelector(s)?.textContent?.trim() ?? null, sel).catch(() => null);
  const texts = (sel) => page.evaluate((s) => [...document.querySelectorAll(s)].map((e) => e.textContent.trim()), sel).catch(() => []);
  const count = (sel) => page.evaluate((s) => document.querySelectorAll(s).length, sel).catch(() => 0);
  const clickSel = async (sel, index = 0) => {
    const box = await page.evaluate((s, i) => {
      const el = document.querySelectorAll(s)[i];
      el?.scrollIntoView({ block: 'nearest' });
      const r = el?.getBoundingClientRect();
      return r && r.width ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null;
    }, sel, index).catch(() => null);
    if (!box) return false;
    await page.mouse.move(box.x, box.y, { steps: 4 });
    await page.mouse.click(box.x, box.y);
    return true;
  };
  /** Clicks the first element matching `sel` whose text is `label`. */
  const clickText = async (sel, label) => {
    const index = await page.evaluate((s, l) => [...document.querySelectorAll(s)].findIndex((e) => e.textContent.trim() === l), sel, label).catch(() => -1);
    return index >= 0 ? clickSel(sel, index) : false;
  };
  /** A row of the open menu, by its label (a row's text also holds its icon's ligature). */
  const clickMenu = async (label) => {
    const index = await page.evaluate((l) => [...document.querySelectorAll('.sb-menu .sb-menu-item')].findIndex((e) => e.querySelector('.sb-menu-item__label')?.textContent.trim() === l), label).catch(() => -1);
    return index >= 0 ? clickSel('.sb-menu .sb-menu-item', index) : false;
  };
  // A menu scales in for 120ms: a click before it settles lands on the wrong row.
  const openMore = async () => {
    await clickSel('.applet-view-header button[aria-label="More options"]');
    const open = await waitFor(() => document.querySelector('.sb-menu'), null, 3000);
    await sleep(400);
    return open;
  };
  const go = async (p) => {
    await page.goto(`${ORIGIN}${p}${p.includes('?') ? '&' : '?'}projectId=${PROJECT}`, { waitUntil: 'domcontentloaded' }).catch(() => {});
  };
  // A dialog is on screen once its fade has run and nothing covers it: it and every box around it
  // fully opaque, and what the browser finds at its centre is the dialog itself (so it is on top and
  // takes clicks). The Tools' Material dialogs and Media's own confirm, which Delete uses.
  const dialogShown = () => [...document.querySelectorAll('.mat-mdc-dialog-surface, .ie-confirm')].some((e) => {
    for (let el = e; el; el = el.parentElement) if (getComputedStyle(el).opacity !== '1') return false;
    const r = e.getBoundingClientRect();
    if (!r.width || !r.height) return false;
    const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return !!top && e.contains(top);
  });

  try {
    await page.goto(`${ORIGIN}/media`, { waitUntil: 'networkidle2', timeout: 180000 }).catch(() => {});
    await sleep(1500);
    // ---- A project with two pictures, for the media picker ----------------------------------------
    await page.evaluate(async (root, project) => {
      const reg = await import(`${root}/platform/projects/src/registry.ts`);
      const ms = await import(`${root}/platform/storage/src/media-storage.ts`);
      const picture = async (hue, label) => {
        const c = new OffscreenCanvas(640, 360);
        const g = c.getContext('2d');
        g.fillStyle = `hsl(${hue}, 60%, 40%)`; g.fillRect(0, 0, 640, 360);
        g.fillStyle = '#fff'; g.font = 'bold 120px sans-serif'; g.fillText(label, 60, 240);
        const blob = await c.convertToBlob({ type: 'image/png' });
        return new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(blob); });
      };
      reg.writeProjectRegistry([...reg.readProjectRegistry().filter((e) => e.id !== project), { id: project, name: 'Tools test', kind: 'media' }]);
      const now = Date.now();
      await ms.saveProjectMedia(project, [
        { id: 'wt-a', kind: 'image', status: 'completed', url: await picture(200, 'A'), prompt: 'A blue square', modelId: 'upload', modelName: 'Upload', ratio: '16:9', timestamp: now - 2000 },
        { id: 'wt-b', kind: 'image', status: 'completed', url: await picture(20, 'B'), prompt: 'An orange square', modelId: 'upload', modelName: 'Upload', ratio: '16:9', timestamp: now - 1000 },
      ]);
    }, ROOT, PROJECT);
    errors.length = 0;

    if (runs('manager')) {
      await go('/media/tools');
      const up = await waitFor(() => document.querySelector('.ng-flow-applet-manager-page .applet-section'), null, 120000);
      check('the Tools page opens over Media', up, url());
      await clickText('.marketplace-toggles .mat-button-toggle-button', 'My Tools');
      await sleep(800);
      const head = await page.evaluate(() => ({
        title: document.querySelector('.ng-flow-navigation-header .header-title')?.textContent,
        tabs: [...document.querySelectorAll('.marketplace-toggles .toggle-text')].map((e) => e.textContent),
        checked: document.querySelector('.marketplace-toggles .mat-button-toggle-checked .toggle-text')?.textContent,
        sections: [...document.querySelectorAll('.applet-section .section-title')].map((e) => e.textContent),
        create: !!document.querySelector('.create-applet-card'),
        rail: !!document.querySelector('.wt-tools-body > aside'),
      }));
      check('Explore tools with My Tools, Community, Templates', head.title === 'Explore tools' && head.tabs.join('|') === 'My Tools|Community|Templates', head);
      check('My Tools opens first, with My creations and Create New', head.checked === 'My Tools' && head.sections.includes('My creations') && head.create, head);
      check('Media\'s rail is beside the page', head.rail);
      await shot('01-my-tools');
      await clickText('.marketplace-toggles .mat-button-toggle-button', 'Templates');
      await waitFor(() => document.querySelectorAll('.applet-grid-gallery .ng-flow-applet-card').length > 0, null, 5000);
      await sleep(600);
      const templates = await page.evaluate(() => [...document.querySelectorAll('.applet-section')].map((s) => [s.querySelector('.section-title')?.textContent, s.querySelectorAll('.ng-flow-applet-card').length]));
      check('Templates: Image 8, Video 10, Prompting 5, Experimental 11', JSON.stringify(templates) === JSON.stringify([['Image', 8], ['Video', 10], ['Prompting', 5], ['Experimental', 11]]), templates);
      check('Templates has its hero', !!(await text('.ng-flow-applet-hero-banner')), await text('.ng-flow-applet-hero-banner'));
      await shot('02-templates');
      await clickText('.marketplace-toggles .mat-button-toggle-button', 'Community');
      await waitFor(() => /Spotlight/.test(document.querySelector('.applet-section .section-title')?.textContent || ''), null, 5000);
      await sleep(600);
      const community = await page.evaluate(() => [...document.querySelectorAll('.applet-section')].map((s) => [s.querySelector('.section-title')?.textContent, s.querySelectorAll('.ng-flow-applet-card').length]));
      check('Community lists Spotlight creatives first', community[0]?.[0] === 'Spotlight creatives' && community.every(([, n]) => n > 0), community);
      await shot('03-community');
      await clickText('.marketplace-toggles .mat-button-toggle-button', 'My Tools');
      await sleep(300);
    }

    let copyId = null;
    if (runs('template') || runs('edit') || runs('builder') || runs('menu') || runs('dock')) {
      // ---- A template opens as your copy, and runs ---------------------------------------------------
      await go('/media/tools');
      await waitFor(() => document.querySelector('.applet-section'), null, 30000);
      await clickText('.marketplace-toggles .mat-button-toggle-button', 'Templates');
      await waitFor(() => document.querySelectorAll('.applet-grid-gallery .ng-flow-applet-card').length > 0, null, 5000);
      const name = await page.evaluate(() => document.querySelector('.applet-grid-gallery .ng-flow-applet-card .applet-name')?.textContent);
      await clickSel('.applet-grid-gallery .ng-flow-applet-card .applet-card-main');
      const moved = await waitFor(() => /\/media\/tool\/[0-9a-f-]{20,}/.test(location.pathname) && !!document.querySelector('.ng-flow-applet-view-page .editable-text-input'), null, 20000);
      copyId = (url().match(/\/media\/tool\/([^?]+)/) || [])[1] || null;
      const shown = await page.evaluate(() => document.querySelector('.ng-flow-applet-view-page .editable-text-input')?.value);
      check('a template opens as "Remix of …", yours to edit', moved && shown === `Remix of ${name}`, { url: url(), shown, name });
      const loading = await count('.loading-overlay .ng-flow-soupy-overlay');
      check('the Perlin overlay covers the frame while it builds', loading === 1, loading);
      await shot('04-loading');
      const mounted = await waitFor(() => !document.querySelector('.loading-overlay') && document.querySelector('.iframe-container iframe') && !document.querySelector('.iframe-container-hidden'), null, 90000);
      const state = await page.evaluate(() => ({
        error: document.querySelector('.compile-error-text')?.textContent,
        banner: document.querySelector('.banner-message')?.textContent,
        footer: document.querySelector('.footer-disclaimer-text')?.textContent?.trim(),
        right: [...document.querySelectorAll('.applet-view-header .header-right button')].map((b) => b.getAttribute('aria-label') || b.querySelector('.mdc-button__label')?.textContent.trim()),
        toggles: [...document.querySelectorAll('.applet-view-toggles .toggle-text')].map((e) => e.textContent),
      }));
      check('the tool runs (mounted, no compile error)', mounted && !state.error, state);
      check('no runtime error banner', !state.banner, state.banner);
      check('the header: Tool/Edit, Apply to be featured, Favorite, Share, More options, Done', state.toggles.join('|') === 'Tool|Edit' && state.right.join('|') === 'Apply to be featured|Favorite|Share|More options|Done', state);
      check('Willow\'s footer, with credits', state.footer === 'Willow can make mistakes, so double check it. This Tool may consume credits', state.footer);
      await sleep(2500);
      await shot('05-running');
    }

    if (runs('edit') && copyId) {
      // ---- Edit: Preview/Code tabs, the Tool Builder ----------------------------------------------------
      await clickText('.applet-view-toggles .mat-button-toggle-button', 'Edit');
      const editing = await waitFor(() => /mode=EDIT/.test(location.search) && document.querySelector('.sidebar-wrapper.sidebar-visible .ng-flow-applet-chat-sidebar'), null, 5000);
      await sleep(500);
      const edit = await page.evaluate(() => ({
        tabs: [...document.querySelectorAll('.applet-content-tab')].map((e) => `${e.textContent.trim()}${e.classList.contains('applet-content-tab-active') ? '*' : ''}`),
        title: document.querySelector('.header-title')?.textContent,
        empty: document.querySelector('.empty-description')?.textContent,
        placeholder: document.querySelector('.prompt-textarea')?.getAttribute('placeholder'),
        sidebar: document.querySelector('.sidebar-wrapper')?.getBoundingClientRect().width,
      }));
      check('Edit shows Preview/Code and the Tool Builder', editing && edit.tabs.join('|') === 'Preview*|Code' && edit.title === 'Tool Builder', edit);
      check('the builder is empty: "Describe how you want to edit this tool."', edit.empty === 'Describe how you want to edit this tool.' && edit.placeholder === 'What do you want to create?', edit);
      check('the builder is 352px', Math.round(edit.sidebar) === 352, edit.sidebar);
      await shot('06-edit');
      await clickText('.applet-content-tab', 'Code');
      await waitFor(() => document.querySelector('.ng-flow-applet-code-explorer .code-line'), null, 5000);
      const code = await page.evaluate(() => ({
        files: [...document.querySelectorAll('.file-item .file-name')].map((e) => e.textContent).slice(0, 6),
        selected: document.querySelector('.file-item-selected .file-name')?.textContent,
        lines: document.querySelectorAll('.code-line').length,
        colored: document.querySelectorAll('.line-content .hljs-keyword').length,
      }));
      check('Code lists the files and highlights the open one', code.files.length > 0 && code.selected === code.files[0] && code.lines > 5 && code.colored > 0, code);
      await shot('07-code');
      await clickSel('.file-item', 1);
      await sleep(300);
      check('picking a file opens it', (await text('.file-item-selected .file-name')) === code.files[1], await text('.file-item-selected .file-name'));
      await clickText('.applet-content-tab', 'Preview');
      await sleep(300);
    }

    if (runs('builder') && copyId) {
      if (!/mode=EDIT/.test(page.url())) {
        await go(`/media/tool/${copyId}?mode=EDIT`);
        await waitFor(() => document.querySelector('.ng-flow-applet-chat-sidebar'), null, 20000);
      }
      // ---- The builder fails as Flow's does, through the debug menu --------------------------------
      await clickSel('.debug-menu-trigger');
      await waitFor(() => document.querySelector('.wt-debug-menu-header'), null, 3000);
      await sleep(400);
      const menu = await texts('.sb-menu .sb-menu-item__label');
      check('the debug menu lists Flow\'s mock errors', menu[0] === 'None (real BE)' && menu.includes('High Traffic') && menu.length === 13, menu);
      await shot('08-debug-menu');
      await clickMenu('High Traffic');
      await sleep(300);
      check('a picked mock turns the bug red', await page.evaluate(() => document.querySelector('.debug-menu-trigger')?.classList.contains('has-active-mock')));
      await page.click('.prompt-textarea');
      await page.keyboard.type('Make the background darker');
      await page.keyboard.press('Enter');
      await waitFor(() => document.querySelector('.chat-error-card'), null, 10000);
      await sleep(300);
      const failed = await page.evaluate(() => ({
        user: document.querySelector('.user-bubble .message-text')?.textContent,
        error: document.querySelector('.chat-error-card .error-text')?.textContent,
        button: document.querySelector('.chat-error-card .try-again-button')?.textContent.trim(),
      }));
      check('High Traffic shows Flow\'s card with Try again', failed.user === 'Make the background darker' && failed.error === 'Tool Builder is experiencing high demand. Please try again later.' && failed.button === 'Try again', failed);
      await shot('09-error-card');
      await clickSel('.chat-error-card .try-again-button');
      await sleep(300);
      const refill = await page.evaluate(() => ({ value: document.querySelector('.prompt-textarea')?.value, button: !!document.querySelector('.chat-error-card .try-again-button') }));
      check('Try again puts the prompt back and the button goes', refill.value === 'Make the background darker' && !refill.button, refill);
      await clickSel('.debug-menu-trigger');
      await waitFor(() => document.querySelector('.wt-debug-menu-header'), null, 3000);
      await sleep(400);
      await clickMenu('Quota Reached');
      await sleep(300);
      await page.click('.prompt-textarea');
      await page.keyboard.press('Enter');
      await waitFor(() => document.querySelector('.quota-error-card'), null, 10000);
      check('Quota Reached replaces the prompt box with its card', (await text('.quota-error-text')) === "You've reached your Agent quota limit. Come back tomorrow to chat more." && (await count('.prompt-textarea')) === 0, await text('.quota-error-text'));
      await shot('10-quota');
      await clickSel('.header-close-button');
      await waitFor(() => /mode=APP/.test(location.search) && !document.querySelector('.sidebar-wrapper.sidebar-visible'), null, 4000);
      check('Close assistant goes back to the tool', /mode=APP/.test(page.url()), url());
    }

    if (runs('menu') && copyId) {
      if (!page.url().includes(copyId)) {
        await go(`/media/tool/${copyId}`);
        await waitFor(() => document.querySelector('.applet-view-header'), null, 20000);
      }
      // ---- More options -----------------------------------------------------------------------------
      await openMore();
      const items = await texts('.sb-menu .sb-menu-item__label');
      check('More options: Remix tool, Pin, Report | Rename, Edit icon, Edit description | Delete', items.join('|') === 'Remix tool|Pin|Report|Rename|Edit icon|Edit description|Delete', items);
      await shot('11-more-options');
      await clickMenu('Rename');
      await sleep(250);
      const focused = await page.evaluate(() => document.activeElement?.classList.contains('editable-text-input'));
      check('Rename puts the name in editing', focused);
      await page.keyboard.down('Control'); await page.keyboard.press('a'); await page.keyboard.up('Control');
      await page.keyboard.type('Willow test tool');
      await page.keyboard.press('Enter');
      await sleep(300);
      check('Enter saves the new name', (await page.evaluate(() => document.querySelector('.editable-text-input')?.value)) === 'Willow test tool');
      await clickSel('.applet-view-header button[aria-label="Share"]');
      await waitFor(() => document.querySelector('.ng-flow-applet-share-dialog'), null, 3000);
      check('Share opens its dialog, faded in', (await count('.ng-flow-applet-share-dialog')) === 1 && (await waitFor(dialogShown, null, 2000)));
      await shot('12-share');
      await page.keyboard.press('Escape');
      await sleep(300);
      await clickSel('.applet-icon-container.editable');
      await waitFor(() => document.querySelector('.ng-flow-applet-icon-selector-dialog'), null, 3000);
      check('the icon opens Edit icon, faded in', (await count('.ng-flow-applet-icon-selector-dialog')) === 1 && (await waitFor(dialogShown, null, 2000)));
      // The presets in view load (the rest are lazy, below the grid's fold).
      const iconsLoaded = await waitFor(() => {
        const grid = document.querySelector('.grid-container')?.getBoundingClientRect();
        const shown = [...document.querySelectorAll('.icon-card .card-image')].filter((img) => { const r = img.getBoundingClientRect(); return grid && r.bottom > grid.top && r.top < grid.bottom; });
        return shown.length > 0 && shown.every((img) => img.complete && img.naturalWidth > 0);
      }, null, 15000);
      check('every preset icon in view loads', iconsLoaded);
      await shot('13-edit-icon');
      await page.keyboard.press('Escape');
      await sleep(300);
      await clickSel('.apply-to-be-featured-button');
      const featured = await waitFor(dialogShown, null, 5000);
      const look = await page.evaluate(() => ({
        submit: getComputedStyle(document.querySelector('.ng-flow-submit-to-gallery-dialog .submit-button')).backgroundColor,
        backdrop: [...document.querySelector('.cdk-overlay-backdrop')?.classList ?? []].join(' '),
      })).catch(() => null);
      // Flow's own light Submit (its rule wins over the filled button's) and the default dim, unblurred.
      check('Apply to be featured: its dialog on top, Submit light, the page dimmed but not blurred',
        featured && look?.submit === 'rgb(227, 227, 227)' && /cdk-overlay-dark-backdrop/.test(look.backdrop) && !/blurred/.test(look.backdrop), look);
      await shot('21-featured');
      await page.keyboard.press('Escape');
      await sleep(300);
    }

    if (runs('dock') && copyId) {
      if (!page.url().includes(copyId)) {
        await go(`/media/tool/${copyId}`);
        await waitFor(() => document.querySelector('.applet-view-header'), null, 20000);
      }
      await openMore();
      await clickMenu('Pin');
      await waitFor(() => document.querySelector('.sb-snackbar'), null, 3000);
      check('Pin says "Pinned to dock"', /Pinned to dock/.test((await text('.sb-snackbar')) || ''), await text('.sb-snackbar'));
      await sleep(300);
      const dock = await page.evaluate(() => {
        const rail = document.querySelector('.wt-tools-body > aside');
        return {
          toggle: !!rail?.querySelector('button[aria-label="Toggle tools"]'),
          rows: [...(rail?.querySelectorAll('a[aria-label]') ?? [])].map((e) => e.getAttribute('aria-label')),
        };
      });
      check('the rail\'s Tools row gains its dock toggle', dock.toggle, dock);
      if (!dock.rows.includes('Willow test tool')) {
        await clickSel('.wt-tools-body > aside button[aria-label="Toggle tools"]');
        await sleep(300);
      }
      const rows = await page.evaluate(() => [...document.querySelectorAll('.wt-tools-body > aside a[aria-label]')].map((e) => e.getAttribute('aria-label')));
      check('the pinned tool is in the dock', rows.some((r) => r === 'Willow test tool' || /^Remix of/.test(r)), rows);
      await shot('14-dock');
      await clickSel('.wt-tools-body > aside button[aria-label="Unpin"]');
      await sleep(300);
    }

    if (runs('rail')) {
      // ---- From the gallery, as a user gets there: the rail's Tools row, then a dock row ---------
      // (A press on a bare element there starts MediaView's marquee, which swallows the click.)
      // By its link: once there is a dock the row's text also holds the chevron's ligature.
      // Not before the Loading page is gone: it covers the rail while it fades out, and a press on it
      // starts the gallery's marquee.
      const railTools = 'aside a[href^="/media/tools"]';
      const railReady = (sel) => document.querySelector(sel) && !document.querySelector('.flow-loading-host');
      await go('/media');
      await waitFor(railReady, railTools, 120000);
      await sleep(500);
      navigations.push(`+${((Date.now() - t0) / 1000).toFixed(1)}s click Tools`);
      await page.evaluate((sel) => {
        const describe = (el) => (el && el.tagName ? `${el.tagName.toLowerCase()}${typeof el.className === 'string' && el.className ? `.${el.className.split(/\s+/).slice(0, 2).join('.')}` : ''}` : String(el));
        window.__probe = [];
        const r = document.querySelector(sel).getBoundingClientRect();
        const chain = [];
        for (let el = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); el && chain.length < 5; el = el.parentElement) chain.push(describe(el));
        window.__probe.push(`hit ${chain.join(' < ')}`);
        for (const type of ['mousedown', 'mouseup', 'click']) {
          window.addEventListener(type, (e) => window.__probe.push(`${type} on ${describe(e.target)} selecting=${!!document.querySelector('.selecting-mode')}`), true);
          window.addEventListener(type, (e) => window.__probe.push(`${type} bubbled prevented=${e.defaultPrevented}`), false);
        }
      }, railTools).catch(() => {});
      check('the gallery rail\'s Tools row is there to click', await clickSel(railTools));
      const opened = await waitFor(() => location.pathname === '/media/tools' && document.querySelector('.ng-flow-applet-manager-page'), null, 20000);
      const probe = await page.evaluate(() => window.__probe ?? ['(page reloaded)']).catch((e) => [String(e.message)]);
      check('the gallery rail\'s Tools row opens the Tools page', opened, opened ? url() : { navigations: navigations.slice(-8), probe });
      if (copyId) {
        await go('/media');
        await waitFor(railReady, railTools, 60000);
        await sleep(500);
        const dockRow = `aside a[href*="/media/tool/${copyId}"]`;
        if (!(await count(dockRow))) await clickSel('aside button[aria-label="Toggle tools"]');
        await waitFor((sel) => document.querySelector(sel), dockRow, 5000);
        await clickSel(dockRow);
        const toolOpened = await waitFor((id) => location.pathname === `/media/tool/${id}` && document.querySelector('.applet-view-header'), copyId, 20000);
        check('a dock row in the gallery opens its tool', toolOpened, url());
      }
    }

    if (runs('community')) {
      await go('/media/tools');
      await waitFor(() => document.querySelector('.applet-section'), null, 30000);
      await clickText('.marketplace-toggles .mat-button-toggle-button', 'Community');
      await waitFor(() => document.querySelectorAll('.applet-grid-gallery .ng-flow-applet-card').length > 0, null, 5000);
      await clickSel('.applet-grid-gallery .ng-flow-applet-card .applet-card-main');
      const dialog = await waitFor(() => document.querySelector('.ng-flow-community-applet-preview-dialog'), null, 4000);
      check('a community tool asks first, in a dialog on top', dialog && (await waitFor(dialogShown, null, 2000)));
      await sleep(500);
      await shot('15-community-preview');
      await page.keyboard.press('Escape');
      await sleep(300);
    }

    if (runs('create')) {
      await go('/media/create-tool');
      await waitFor(() => document.querySelector('.create-applet-hero-title'), null, 30000);
      await sleep(500);
      const create = await page.evaluate(() => ({
        title: document.querySelector('.ng-flow-navigation-header .header-title')?.textContent,
        hero: [...document.querySelectorAll('.hero-line')].map((e) => e.textContent),
        cards: document.querySelectorAll('.suggestion-card').length,
        placeholder: document.querySelector('.prosemirror-placeholder')?.textContent,
        disclaimer: document.querySelector('.disclaimer-text')?.textContent,
        send: document.querySelector('.generate-icon-button')?.disabled,
      }));
      check('New tool: hero, three suggestions, the prompt', create.title === 'New tool' && create.hero.join(' / ') === 'Start building any creative tool / you can dream by describing it below.' && create.cards === 3 && create.send === true, create);
      check('the prompt\'s placeholder and the credits line', create.placeholder === 'Build a retro pixel effect app with a large upload drop zone and a settings sidebar.' && create.disclaimer === 'Creating tools does not currently cost credits.', create);
      await shot('16-create');
      await clickSel('.suggestion-card');
      await sleep(300);
      const filled = await page.evaluate(() => ({ value: document.querySelector('.wt-rich-input')?.value?.length, send: document.querySelector('.generate-icon-button')?.disabled }));
      check('a suggestion fills the prompt (not sent)', filled.value > 40 && filled.send === false, filled);
      await shot('17-create-filled');
      await page.keyboard.press('Enter');
      const opened = await waitFor(() => /\/media\/tool\/[^?]+\?.*mode=EDIT/.test(location.pathname + location.search), null, 8000);
      await waitFor(() => document.querySelector('.chat-error-card'), null, 15000);
      const made = await page.evaluate(() => ({
        name: document.querySelector('.applet-view-header .applet-name')?.textContent,
        toggles: document.querySelectorAll('.applet-view-toggles').length,
        error: document.querySelector('.chat-error-card .error-text')?.textContent,
        button: document.querySelector('.chat-error-card .try-again-button')?.textContent.trim(),
      }));
      check('sending opens the new tool in Edit, named "Tool" while it builds', opened && made.name === 'Tool' && made.toggles === 0, made);
      check('with no chat model the builder asks for one', /needs a chat model/.test(made.error || '') && made.button === 'Open settings', made);
      await shot('18-create-no-model');
      await go('/media/tools');
      await waitFor(() => document.querySelector('.applet-section'), null, 30000);
      await clickText('.marketplace-toggles .mat-button-toggle-button', 'My Tools');
      await sleep(400);
      const mine = await page.evaluate(() => [...([...document.querySelectorAll('.applet-section')].find((s) => s.querySelector('.section-title')?.textContent === 'My creations')?.querySelectorAll('.ng-flow-applet-card .applet-name') ?? [])].map((e) => e.textContent));
      check('a tool whose first build failed is not in My creations', mine.length === (copyId ? 1 : 0), mine);
    }

    if (runs('notfound')) {
      await go('/media/tool/not-a-tool');
      await waitFor(() => document.querySelector('.not-found-title'), null, 20000);
      check('an unknown tool is "App not found"', (await text('.not-found-title')) === 'App not found');
      await shot('19-not-found');
    }

    if (copyId && runs('menu')) {
      // ---- Delete, last: the confirm, then back --------------------------------------------------
      await go(`/media/tool/${copyId}?fromViewSource=tools`);
      await waitFor(() => document.querySelector('.applet-view-header'), null, 20000);
      await openMore();
      await clickMenu('Delete');
      await waitFor(() => /Deleting this app will delete it/.test(document.body.textContent), null, 3000);
      check('Delete asks in a dialog that fades in', await waitFor(dialogShown, null, 2000));
      await shot('20-delete');
      const confirmed = await page.evaluate(() => {
        const button = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Delete' && b.closest('[role="dialog"]'));
        button?.click();
        return !!button;
      });
      const back = await waitFor(() => location.pathname === '/media/tools', null, 6000);
      check('Delete asks, then goes back to the Tools page', confirmed && back, url());
    }

    check('no page errors on the Tools pages', errors.length === 0, errors.slice(0, 8));
  } catch (e) {
    console.error('FAILED:', e.stack || e.message);
    failures += 1;
  } finally {
    await browser.close();
    if (!KEEP) fs.rmSync(userDataDir, { recursive: true, force: true });
    console.log(`${failures ? `${failures} FAILED` : 'ALL PASSED'}${SHOTS ? ` (shots in ${SHOTS})` : ''}`);
    process.exit(failures ? 1 : 0);
  }
})();
