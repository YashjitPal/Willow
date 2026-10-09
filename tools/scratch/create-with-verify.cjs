/**
 * Create with Gemini, and the cards a saved schedule or skill leaves, end to end in a browser
 * context of its own (own storage, none of the other tabs). Gemini's API is answered here, so
 * nothing leaves the machine: a turn that declares `create_schedule` / `create_skill` gets the
 * call Gemini made in the reference conversations, then Gemini's sentence after it, and
 * Spark's harness gets the same call in its text protocol. Everything else runs for real —
 * the executors, Spark's store, the cards, the shell's surface switches.
 *
 * Flows (default all): chat-schedule, chat-skill, spark-schedule.
 *   node tools/scratch/create-with-verify.cjs [desktop|phone|tablet] [flow,flow]
 */
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');

const BASE = 'http://localhost:3000';
const SIZES = {
  desktop: { width: 1536, height: 826 },
  phone: { width: 390, height: 844, mobile: true },
  tablet: { width: 800, height: 1280, mobile: true },
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const SCHEDULE_ARGS = {
  title: 'Indoor gardening tip',
  frequency: 'Weekly',
  weekdays: ['Saturday'],
  time: '10:00',
  instructions: 'Give me one short gardening tip for indoor plants.',
};
const SKILL_ARGS = {
  name: 'article-key-takeaways',
  description: 'Turn any pasted article or text into three key takeaways and one thought-provoking open question. Use when the user pastes an article, essay, or long text and asks for a summary or key points.',
  instructions: [
    '# Article Key Takeaways',
    '',
    'Extract core insights from any pasted text or article.',
    '',
    '## Workflow',
    '',
    '1. Read the provided text thoroughly.',
    '2. Identify the three most critical, actionable, or high-level insights.',
    "3. Formulate one open-ended, thought-provoking question inspired by the article's themes or implications.",
    '4. Present the output cleanly using bullet points for the takeaways and a distinct section for the question.',
  ].join('\n'),
};
const SPARK_CALL = [
  '*** Work Title: Creating weekly science fact schedule',
  '*** Call: create_schedule',
  JSON.stringify({
    _title: 'Created weekly science fact schedule',
    title: 'Send weekly science fact',
    frequency: 'Weekly',
    weekdays: ['Sunday'],
    time: '19:00',
    instructions: 'Send me one fun science fact. Keep it short and surprising.',
  }),
  '*** End Call',
].join('\n');
const SPARK_FINAL = [
  '*** Final Response',
  'I have scheduled this task for you.',
  '',
  '* **Task:** Send weekly science fact',
  '* **Frequency:** Weekly on Sundays at 7:00 PM',
  '* **Content:** One short, surprising science fact',
].join('\n');

/* ── Gemini, answered locally ─────────────────────────────────────────────── */

const seen = [];
const sse = (events) => events.map((event) => `data: ${JSON.stringify(event)}\r\n\r\n`).join('');
const chunk = (parts, finishReason) => ({
  candidates: [{ content: { role: 'model', parts }, index: 0, ...(finishReason ? { finishReason } : {}) }],
  usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 12, totalTokenCount: 24 },
});
const streamText = (text) => {
  const words = text.split(/(?<=\s)/);
  const third = Math.ceil(words.length / 3);
  const pieces = [0, 1, 2].map((i) => words.slice(i * third, (i + 1) * third).join('')).filter(Boolean);
  return sse(pieces.map((piece, i) => chunk([{ text: piece }], i === pieces.length - 1 ? 'STOP' : undefined)));
};
const streamCall = (name, args) => sse([chunk([{ functionCall: { name, args } }], 'STOP')]);

const answer = (url, raw) => {
  let body = null;
  try { body = JSON.parse(raw || 'null'); } catch { /* not JSON */ }
  const contents = Array.isArray(body?.contents) ? body.contents : [];
  const last = contents[contents.length - 1];
  const lastParts = Array.isArray(last?.parts) ? last.parts : [];
  const lastText = lastParts.map((part) => part.text || '').join(' ');
  const answered = (name) => lastParts.some((part) => part.functionResponse?.name === name);
  const declares = (name) => raw.includes(`"name":"${name}"`);
  const harness = raw.includes('*** Call:');
  let kind = 'fallback';
  let text = /gardening/i.test(raw) ? 'Indoor Gardening Tips' : /science fact/i.test(raw) ? 'Weekly Science Fact' : /skill/i.test(raw) ? 'Building a New Skill' : 'New chat';
  let bodyOut;
  if (harness && raw.includes('Saved the schedule \\"Send weekly science fact\\"')) { kind = 'spark-final'; bodyOut = streamText(SPARK_FINAL); }
  else if (harness && /science fact/i.test(lastText)) { kind = 'spark-call'; bodyOut = streamText(SPARK_CALL); }
  else if (answered('create_schedule')) { kind = 'chat-schedule-reply'; bodyOut = streamText("I'll have that indoor gardening tip ready for you by 10 AM every Saturday."); }
  else if (answered('create_skill')) { kind = 'chat-skill-reply'; bodyOut = streamText('Done. The skill is saved and active. Whenever you want to use it, just paste an article and ask for the takeaways.'); }
  else if (declares('create_schedule') && /gardening tip/i.test(lastText)) { kind = 'chat-schedule-call'; bodyOut = streamCall('create_schedule', SCHEDULE_ARGS); }
  else if (declares('create_skill') && /three key takeaways/i.test(lastText)) { kind = 'chat-skill-call'; bodyOut = streamCall('create_skill', SKILL_ARGS); }
  seen.push({
    kind,
    url: url.replace(/key=[^&]+/, 'key=…').slice(0, 110),
    declaresLibrary: declares('create_schedule') && declares('create_skill'),
    lastText: lastText.slice(0, 70),
  });
  if (/:streamGenerateContent/.test(url)) {
    return { status: 200, contentType: 'text/event-stream', body: bodyOut ?? streamText(text) };
  }
  return { status: 200, contentType: 'application/json', body: JSON.stringify(chunk([{ text }], 'STOP')) };
};

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

const mockGemini = async (page) => {
  await page.setRequestInterception(true);
  page.on('request', (request) => {
    const url = request.url();
    if (!/generativelanguage\.googleapis\.com|aiplatform\.googleapis\.com/.test(url)) {
      void request.continue();
      return;
    }
    if (request.method() === 'OPTIONS') {
      void request.respond({ status: 204, headers: CORS, body: '' });
      return;
    }
    if (/\/interactions/.test(url)) {
      seen.push({ kind: 'interactions→404', url: url.slice(0, 80) });
      void request.respond({ status: 404, headers: CORS, contentType: 'application/json', body: '{"error":{"code":404,"message":"not here"}}' });
      return;
    }
    if (/\/models(\?|$)/.test(url) && request.method() === 'GET') {
      void request.respond({ status: 200, headers: CORS, contentType: 'application/json', body: '{"models":[]}' });
      return;
    }
    const reply = answer(url, request.postData() || '');
    void request.respond({ status: reply.status, headers: CORS, contentType: reply.contentType, body: reply.body });
  });
};

/* ── Helpers ──────────────────────────────────────────────────────────────── */

// An icon's ligature is text too ("deleteDelete"), so a label is matched at either end.
const clickText = (page, selector, text) => page.evaluate((sel, label) => {
  const el = [...document.querySelectorAll(sel)]
    .find((node) => {
      const content = node.textContent.trim();
      return node.getBoundingClientRect().width > 0 && (content.startsWith(label) || content.endsWith(label));
    });
  el?.click();
  return Boolean(el);
}, selector, text);

const type = async (page, selector, text) => {
  await page.waitForSelector(selector, { visible: true, timeout: 30_000 });
  await page.focus(selector);
  await page.keyboard.type(text, { delay: 18 });
  await sleep(150);
  await page.keyboard.press('Enter');
};

const shot = async (page, file) => {
  await page.bringToFront();
  await page.screenshot({ path: file });
};

const store = (page, fn, ...args) => page.evaluate(async (source, rest) => {
  const find = (pattern) => performance.getEntriesByType('resource')
    .filter((entry) => pattern.test(entry.name))
    .sort((a, b) => b.startTime - a.startTime)[0]?.name;
  const url = find(/\/spark-store\.ts(\?|$)/);
  const spark = url ? await import(url) : null;
  // eslint-disable-next-line no-new-func
  return new Function('spark', 'args', `return (${source})(spark, ...args);`)(spark, rest);
}, fn.toString(), args);

const describe = (page, selectors) => page.evaluate((list) => Object.fromEntries(list.map(([name, selector]) => {
  const el = document.querySelector(selector);
  if (!el) return [name, null];
  const r = el.getBoundingClientRect();
  const cs = getComputedStyle(el);
  return [name, {
    rect: [r.x, r.y, r.width, r.height].map((v) => Math.round(v * 10) / 10),
    font: `${cs.fontSize}/${cs.lineHeight} ${cs.fontWeight}`,
    color: cs.color,
    ...(cs.backgroundColor !== 'rgba(0, 0, 0, 0)' ? { bg: cs.backgroundColor } : {}),
    ...(cs.borderTopWidth !== '0px' ? { border: `${cs.borderTopWidth} ${cs.borderTopColor}` } : {}),
    ...(cs.borderRadius !== '0px' ? { radius: cs.borderRadius } : {}),
    text: el.textContent.trim().replace(/\s+/g, ' ').slice(0, 60),
  }];
})), selectors);

/** The reply's last line of text above `selector`, and the first action button below it. */
const spacing = (page, selector) => page.evaluate((sel) => {
  const items = document.querySelector(sel);
  if (!items) return null;
  const r = items.getBoundingClientRect();
  const round = (v) => Math.round(v * 10) / 10;
  const textAbove = [...document.querySelectorAll('p, li, h1, h2, h3, h4')]
    .filter((el) => !items.contains(el) && el.getBoundingClientRect().bottom <= r.top + 1 && el.getBoundingClientRect().width > 0)
    .map((el) => el.getBoundingClientRect().bottom)
    .sort((a, b) => b - a)[0];
  const buttonBelow = [...document.querySelectorAll('button')]
    .filter((el) => !items.contains(el) && el.getBoundingClientRect().top >= r.bottom - 1 && el.getBoundingClientRect().width > 0)
    .map((el) => el.getBoundingClientRect().top)
    .sort((a, b) => a - b)[0];
  return {
    textBottom: textAbove === undefined ? null : round(textAbove),
    cardTop: round(r.top),
    cardBottom: round(r.bottom),
    actionsTop: buttonBelow === undefined ? null : round(buttonBelow),
    textToCard: textAbove === undefined ? null : round(r.top - textAbove),
    cardToActions: buttonBelow === undefined ? null : round(buttonBelow - r.bottom),
  };
}, selector);

/**
 * Gives this context a connected folder, so chats are saved and named as they are with the
 * user's: the folder is a directory in the context's own OPFS, stored where the folder
 * picker's choice would be. Gone with the context.
 */
const connectFolder = async (page) => {
  await page.goto(`${BASE}/app`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('textarea', { visible: true, timeout: 90_000 });
  await sleep(2500);
  const result = await page.evaluate(async () => {
    const url = performance.getEntriesByType('resource').map((entry) => entry.name).find((name) => /\/adapters\/local-disk\.ts(\?|$)/.test(name));
    if (!url) return 'local-disk not loaded';
    const disk = await import(url);
    const root = await navigator.storage.getDirectory();
    const folder = await root.getDirectoryHandle('Willow test folder', { create: true });
    const permission = await folder.queryPermission({ mode: 'readwrite' });
    const rootId = await disk.storeDirectoryHandle(folder);
    return `stored as ${rootId} (permission ${permission})`;
  });
  console.log('folder:', result);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('textarea', { visible: true, timeout: 90_000 });
  await sleep(4000);
};

/* ── Flows ────────────────────────────────────────────────────────────────── */

const flows = {
  async 'chat-schedule'(page, out) {
    await page.goto(`${BASE}/app`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('textarea', { visible: true, timeout: 90_000 });
    await sleep(4000);
    await type(page, 'textarea', 'Every Saturday at 10 AM, send me one short gardening tip for indoor plants.');
    await page.waitForSelector('[data-test-id="chat-scheduled-action"]', { visible: true, timeout: 30_000 });
    await sleep(2500);
    console.log('chat address:', JSON.stringify(await page.evaluate(() => ({
      url: decodeURIComponent(location.pathname),
      historyLength: history.length,
      chatLists: Object.keys(localStorage).filter((key) => key.startsWith('willow_local_chats:')).map((key) => `${key.slice(0, 60)} = ${localStorage.getItem(key).slice(0, 80)}`),
    }))));
    const card = await page.$('[data-test-id="chat-scheduled-action"]');
    await card.evaluate((el) => el.scrollIntoView({ block: 'center' }));
    await sleep(500);
    await shot(page, `${out}-chat-schedule.png`);
    console.log('chat schedule card:', JSON.stringify(await describe(page, [
      ['reply', '.chat-created-items'],
      ['card', '.chat-scheduled-action'],
      ['icon', '.chat-scheduled-action__icon'],
      ['when', '.chat-scheduled-action__when'],
      ['info', '.chat-scheduled-action__info'],
      ['title', '.chat-scheduled-action__title'],
      ['prompt', '.chat-scheduled-action__prompt'],
      ['actions', '.chat-scheduled-action__actions'],
      ['switch', '.chat-scheduled-action__switch'],
      ['more', '.chat-scheduled-action__more'],
    ]), null, 1));
    console.log('text → card → action row:', JSON.stringify(await spacing(page, '.chat-created-items')));
    console.log('Spark schedules now:', JSON.stringify(await store(page, (spark) => spark.sparkState.get().schedules.map((s) => ({
      id: s.id, title: s.title, frequency: s.frequency, weekdays: s.weekdays, time: s.time, enabled: s.enabled, nextRunAt: s.nextRunAt,
    })))));

    // The info note.
    await page.click('.chat-scheduled-action__info');
    await sleep(400);
    await shot(page, `${out}-chat-schedule-info.png`);
    console.log('info note:', JSON.stringify(await describe(page, [['note', '.chat-scheduled-action-info'], ['icon', '.chat-scheduled-action__info']])));
    await page.keyboard.press('Escape');
    await sleep(300);

    // The switch, both ways.
    await page.click('.chat-scheduled-action__switch');
    await sleep(400);
    const off = await store(page, (spark) => spark.sparkState.get().schedules[0]?.enabled);
    await shot(page, `${out}-chat-schedule-off.png`);
    console.log('switched off → Spark enabled =', off, '| icon:', JSON.stringify(await describe(page, [['icon', '.chat-scheduled-action__icon'], ['switch', '.chat-scheduled-action__switch']])));
    await page.click('.chat-scheduled-action__switch');
    await sleep(400);
    console.log('switched on → Spark enabled =', await store(page, (spark) => spark.sparkState.get().schedules[0]?.enabled));

    // The menu.
    await page.click('.chat-scheduled-action__more');
    await sleep(400);
    await shot(page, `${out}-chat-schedule-menu.png`);
    console.log('menu:', JSON.stringify(await describe(page, [
      ['menu', '.chat-scheduled-action-menu'],
      ['edit', '.chat-scheduled-action-menu__item:nth-child(1)'],
      ['delete', '.chat-scheduled-action-menu__item:nth-child(2)'],
      ['more', '.chat-scheduled-action__more'],
    ])));

    // Delete, cancelled first.
    await clickText(page, '.chat-scheduled-action-menu__item', 'Delete');
    await sleep(600);
    await shot(page, `${out}-chat-schedule-delete-dialog.png`);
    console.log('delete dialog:', await page.evaluate(() => document.querySelector('.willow-gdlg-host')?.textContent.trim().replace(/\s+/g, ' ').slice(0, 160)));
    await clickText(page, '.willow-gdlg-host button', 'Cancel');
    await sleep(500);
    console.log('after Cancel, schedules =', await store(page, (spark) => spark.sparkState.get().schedules.length));

    // Edit opens Spark's editor.
    await page.click('.chat-scheduled-action__more');
    await sleep(300);
    await clickText(page, '.chat-scheduled-action-menu__item', 'Edit');
    await sleep(2500);
    await shot(page, `${out}-chat-schedule-edit.png`);
    console.log('Edit →', JSON.stringify(await page.evaluate(() => ({
      url: decodeURIComponent(location.pathname),
      fields: [...document.querySelectorAll('input, textarea')].filter((el) => el.getBoundingClientRect().width > 0).map((el) => el.value).filter(Boolean).slice(0, 4),
    }))));

    // Back to the chat, and Delete for real.
    await page.goBack();
    await sleep(3500);
    console.log('Back →', JSON.stringify(await page.evaluate(() => ({
      url: decodeURIComponent(location.pathname),
      cards: document.querySelectorAll('[data-test-id="chat-scheduled-action"]').length,
      text: document.querySelector('main')?.innerText.replace(/\s+/g, ' ').slice(0, 200) ?? null,
    }))));
    await page.waitForSelector('[data-test-id="chat-scheduled-action"]', { visible: true, timeout: 20_000 });
    await page.click('.chat-scheduled-action__more');
    await sleep(300);
    await clickText(page, '.chat-scheduled-action-menu__item', 'Delete');
    await sleep(500);
    await clickText(page, '.willow-gdlg-host button', 'Delete');
    await sleep(900);
    await shot(page, `${out}-chat-schedule-deleted.png`);
    console.log('after Delete: schedules =', await store(page, (spark) => spark.sparkState.get().schedules.length),
      '| card:', await page.evaluate(() => document.querySelector('[data-test-id="chat-scheduled-action"]')?.textContent.trim()));
  },

  async 'chat-skill'(page, out) {
    await page.goto(`${BASE}/spark/skills`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.spark-page-actions', { visible: true, timeout: 90_000 });
    await sleep(3000);
    await shot(page, `${out}-skills-before.png`);
    const t0 = Date.now();
    await clickText(page, '.spark-page-actions button', 'Create with Gemini');
    for (const at of [300, 1200, 3500]) {
      await sleep(Math.max(0, at - (Date.now() - t0)));
      await shot(page, `${out}-skills-after-${at}.png`);
      console.log(`  ${at}ms:`, JSON.stringify(await page.evaluate(() => ({
        url: decodeURIComponent(location.pathname),
        user: [...document.querySelectorAll('[data-message-role="user"], .user-message, [class*="user-bubble"]')].map((el) => el.textContent.trim()).slice(-1)[0] ?? null,
        body: document.querySelector('main')?.innerText.replace(/\s+/g, ' ').slice(0, 220) ?? document.body.innerText.slice(0, 220),
      }))));
    }
    await sleep(1500);
    await type(page, 'textarea', 'A skill that turns any article I paste into three key takeaways and one open question to think about.');
    await page.waitForSelector('[data-test-id="chat-created-skill"]', { visible: true, timeout: 30_000 });
    await sleep(2500);
    const card = await page.$('[data-test-id="chat-created-skill"]');
    await card.evaluate((el) => el.scrollIntoView({ block: 'center' }));
    await sleep(500);
    await shot(page, `${out}-chat-skill.png`);
    console.log('skill card:', JSON.stringify(await describe(page, [
      ['wrap', '.chat-created-items'],
      ['card', '.chat-created-skill .willow-confirmation-card'],
      ['title', '.chat-created-skill .willow-confirmation-card__title'],
      ['body', '.chat-created-skill .willow-confirmation-card__body'],
      ['toggle', '.chat-created-skill .willow-confirmation-card__toggle'],
    ]), null, 1));
    console.log('text → card → action row:', JSON.stringify(await spacing(page, '.chat-created-items')));
    await clickText(page, '.chat-created-skill button', 'See more');
    await sleep(500);
    await shot(page, `${out}-chat-skill-expanded.png`);
    console.log('Spark skills now:', JSON.stringify(await store(page, (spark) => spark.sparkState.get().skills.map((s) => ({ name: s.name, source: s.source, enabled: s.enabled })))));
    console.log('chat title:', await page.evaluate(() => document.title));
  },

  async 'spark-schedule'(page, out) {
    await page.goto(`${BASE}/spark/schedules`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.spark-page-actions', { visible: true, timeout: 90_000 });
    await sleep(3000);
    await shot(page, `${out}-schedules-before.png`);
    const t0 = Date.now();
    await clickText(page, '.spark-page-actions button', 'Create with Gemini');
    for (const at of [300, 1200, 3500]) {
      await sleep(Math.max(0, at - (Date.now() - t0)));
      await shot(page, `${out}-schedules-after-${at}.png`);
      console.log(`  ${at}ms:`, JSON.stringify(await page.evaluate(() => ({
        url: decodeURIComponent(location.pathname),
        collapsed: !!document.querySelector('.spark-task-detail.is-library-collapsed, .spark-task-detail--library-collapsed, [data-library-collapsed="true"]'),
        library: (() => { const el = document.querySelector('.spark-task-detail__library'); if (!el) return null; const r = el.getBoundingClientRect(); return [Math.round(r.x), Math.round(r.width)]; })(),
        text: document.querySelector('.spark-task-detail__panel')?.innerText.replace(/\s+/g, ' ').slice(0, 260) ?? null,
      }))));
    }
    await type(page, 'textarea[placeholder="Ask a follow-up"]', 'Every Sunday at 7 PM, send me one fun science fact.');
    await page.waitForSelector('[data-test-id="spark-created-schedule"]', { visible: true, timeout: 45_000 });
    await sleep(3000);
    const card = await page.$('[data-test-id="spark-created-schedule"]');
    await card.evaluate((el) => el.scrollIntoView({ block: 'center' }));
    await sleep(500);
    await shot(page, `${out}-spark-created.png`);
    console.log('spark card:', JSON.stringify(await describe(page, [
      ['wrap', '[data-test-id="spark-created-schedule"]'],
      ['card', '[data-test-id="spark-created-schedule"] .willow-confirmation-card'],
      ['title', '[data-test-id="spark-created-schedule"] .willow-confirmation-card__title'],
      ['body', '[data-test-id="spark-created-schedule"] .willow-confirmation-card__body'],
      ['disclaimer', '[data-test-id="spark-created-schedule"] .willow-confirmation-card__disclaimer'],
    ]), null, 1));
    const opened = await clickText(page, 'button', 'Thoughts');
    await sleep(900);
    await page.evaluate(() => document.querySelector('[data-test-id="spark-created-schedule"]')?.closest('section, article, div')?.scrollIntoView({ block: 'start' }));
    await sleep(400);
    await shot(page, `${out}-spark-thoughts.png`);
    console.log('Thoughts opened:', opened, '| rows:', JSON.stringify(await page.evaluate(() => [...document.querySelectorAll('[class*="timeline"], [class*="thought"]')]
      .filter((el) => el.children.length <= 4 && /Created/.test(el.textContent))
      .map((el) => el.textContent.trim().replace(/\s+/g, ' ').slice(0, 80))
      .slice(0, 6))));
    console.log('Spark schedules now:', JSON.stringify(await store(page, (spark) => spark.sparkState.get().schedules.map((s) => ({ title: s.title, frequency: s.frequency, weekdays: s.weekdays, time: s.time, taskId: s.taskId, enabled: s.enabled })))));
  },
};

(async () => {
  const args = process.argv.slice(2);
  const kind = SIZES[args[0]] ? args[0] : 'desktop';
  const chosen = (args.find((arg) => !SIZES[arg]) || Object.keys(flows).join(',')).split(',');
  const size = SIZES[kind];
  const outDir = 'tools/ui-research/captures/spark/137-create-with-gemini/willow';
  fs.mkdirSync(outDir, { recursive: true });
  const browser = await puppeteer.connect({ browserURL: process.env.CDP_URL || 'http://[::1]:9222', defaultViewport: null, protocolTimeout: 60_000 });
  const context = await browser.createBrowserContext();
  try {
    const page = await context.newPage();
    page.on('pageerror', (error) => console.log(`  [pageerror] ${error.message.slice(0, 200)}`));
    page.on('console', (message) => {
      if (message.type() === 'error' && !/favicon|Failed to load resource/.test(message.text())) console.log(`  [console.error] ${message.text().slice(0, 200)}`);
    });
    await page.evaluateOnNewDocument(() => {
      if (location.origin !== 'http://localhost:3000') return;
      if (!localStorage.getItem('willow:apiKeys:guest')) {
        localStorage.setItem('willow:apiKeys:guest', JSON.stringify({ gemini: ['zz-not-a-real-key'], openai: [], anthropic: [] }));
      }
    });
    await mockGemini(page);
    if (size.mobile) {
      const cdp = await page.createCDPSession();
      const version = (await browser.version()).match(/\/(\d+)/)?.[1] || '150';
      await cdp.send('Emulation.setUserAgentOverride', {
        userAgent: `Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${version}.0.0.0${kind === 'phone' ? ' Mobile' : ''} Safari/537.36`,
      });
      await cdp.send('Emulation.setDeviceMetricsOverride', {
        width: size.width, height: size.height, deviceScaleFactor: 0, mobile: true, screenWidth: size.width, screenHeight: size.height,
      });
      await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    } else {
      await page.setViewport({ width: size.width, height: size.height });
    }
    await connectFolder(page);
    for (const name of chosen) {
      console.log(`\n== ${name} (${kind})`);
      try {
        await flows[name](page, path.join(outDir, kind));
      } catch (error) {
        console.log(`  FAILED: ${error.message.split('\n')[0]}`);
        await shot(page, path.join(outDir, `${kind}-${name}-failed.png`)).catch(() => {});
      }
      console.log('  model calls:', JSON.stringify(seen.splice(0)));
    }
  } finally {
    await context.close();
    browser.disconnect();
  }
})().catch((error) => { console.error(error); process.exit(1); });
