/**
 * A Code turn carried on in another tab: tab B waits, tab A sends a Code message from the
 * Code home, A is closed mid-turn, and every open Willow tab's job records, Code resume
 * request and running flag are reported until the turn settles. Then prints the chat file.
 *
 *   node tools/scratch/bg-takeover-code.cjs ["<prompt>"]
 */
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');

const BASE = 'http://localhost:3000/';
const CHATS = 'C:/Users/Yashjit 2/Willow/Chats';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const prompt = process.argv[2]
  || 'Takeover test: in five short bullet points, explain what React state is. Do not create, edit or delete any files.';

const codeState = (page) => page.evaluate(async () => {
  const find = (part) => performance.getEntriesByType('resource').map((entry) => entry.name).reverse().find((entry) => entry.includes(part));
  const jobsUrl = find('/code-turn-jobs.ts');
  const activityUrl = find('/code-turn-activity.ts');
  const jobs = jobsUrl ? await import(jobsUrl) : null;
  const activity = activityUrl ? await import(activityUrl) : null;
  return {
    resume: jobs?.$codeResume.get()?.job.id?.slice(0, 18) ?? null,
    running: activity ? activity.$runningCodeScreens.get() : 'n/a',
    hidden: [...document.querySelectorAll('[inert][aria-hidden="true"]')].map((host) => host.querySelectorAll('*').length),
    jobs: Object.keys(localStorage).filter((key) => key.startsWith('willow:job:code')).map((key) => {
      const job = JSON.parse(localStorage.getItem(key));
      return { owner: job.owner.slice(0, 6), takeovers: job.takeovers, place: job.payload.place };
    }),
    visibility: document.visibilityState,
  };
}).catch((error) => ({ error: error.message.slice(0, 80) }));

const open = async (browser, name, started) => {
  const page = await browser.newPage();
  page.on('console', (message) => {
    const text = message.text();
    if (/\[Auth\] State changed|error|failed/i.test(text) && !/favicon|DevTools/i.test(text)) {
      console.log(`  [${name} console +${((Date.now() - started) / 1000).toFixed(1)}s] ${text.slice(0, 160)}`);
    }
  });
  page.on('pageerror', (error) => console.log(`  [${name} pageerror] ${error.message.slice(0, 200)}`));
  await page.bringToFront();
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('textarea.willow-dictation-textarea', { visible: true, timeout: 90_000 });
  await page.waitForFunction(() => /Let's chat|Hello|Hi,/i.test(document.body.innerText), { timeout: 90_000 })
    .catch(() => console.log(`  ${name}: no signed-in greeting`));
  await sleep(2500);
  return page;
};

(async () => {
  const started = Date.now();
  const browser = await puppeteer.connect({ browserURL: process.env.CDP_URL || 'http://[::1]:9222', defaultViewport: null });
  const b = await open(browser, 'B', started);
  const a = await open(browser, 'A', started);

  await a.bringToFront();
  const clicked = await a.evaluate(() => {
    const row = [...document.querySelectorAll('.sidebar-item-row')]
      .find((el) => el.querySelector('.sidebar-item-label')?.textContent.trim() === 'Code' && el.getBoundingClientRect().width > 0);
    row?.click();
    return Boolean(row);
  });
  console.log('A: opened Code:', clicked);
  await sleep(3500);
  const placeholder = await a.evaluate(() => {
    const area = [...document.querySelectorAll('textarea')].find((candidate) => candidate.getBoundingClientRect().width > 0);
    area?.focus();
    return area?.placeholder ?? null;
  });
  console.log('A: Code prompt box:', placeholder);
  const cdp = await a.createCDPSession();
  await cdp.send('Input.insertText', { text: prompt });
  await sleep(600);
  await a.keyboard.press('Enter');

  let jobSeenAt = 0;
  for (let second = 1; second <= 60; second += 1) {
    await sleep(1000);
    const state = await codeState(a);
    console.log(`A +${second}s`, JSON.stringify(state));
    if (state.jobs?.length && !jobSeenAt) jobSeenAt = second;
    if (jobSeenAt && second - jobSeenAt >= 5) break;
    if (second > 25 && !jobSeenAt) {
      console.log('no Code job appeared in tab A');
      break;
    }
  }
  await a.screenshot({ path: require('node:os').tmpdir() + '/bg-code-a.png' });
  await a.close();
  const closedAt = Date.now();

  let idleFor = 0;
  for (let second = 1; second <= 240; second += 1) {
    await sleep(1000);
    const rows = [];
    for (const page of (await browser.pages()).filter((candidate) => candidate.url().startsWith('http://localhost:3000'))) {
      const state = await Promise.race([codeState(page), sleep(4000).then(() => ({ error: 'no answer' }))]);
      rows.push(`${page === b ? 'B' : page.url().slice(21, 40)}:${JSON.stringify(state)}`);
    }
    console.log(`+${((Date.now() - closedAt) / 1000).toFixed(1)}s`, rows.join('  '));
    const busy = rows.some((row) => /"running":true|"resume":"code|"jobs":\[\{/.test(row));
    idleFor = busy ? 0 : idleFor + 1;
    if (second > 5 && idleFor >= 6) break;
  }
  await b.screenshot({ path: require('node:os').tmpdir() + '/bg-code-b.png' });

  const recent = fs.readdirSync(CHATS)
    .filter((name) => name.endsWith('.json'))
    .map((name) => ({ name, mtime: fs.statSync(path.join(CHATS, name)).mtimeMs }))
    .filter((entry) => entry.mtime > started)
    .sort((x, y) => y.mtime - x.mtime);
  for (const entry of recent.slice(0, 3)) {
    const messages = JSON.parse(fs.readFileSync(path.join(CHATS, entry.name), 'utf8'));
    console.log(`chat file ${entry.name}:`, JSON.stringify(messages.map((message) => ({
      role: message.role, mode: message.willowMode, chars: (message.content || '').length, steps: message.steps?.length ?? 0,
    }))));
  }
  if (!process.argv.includes('--keep')) await b.close();
  browser.disconnect();
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
