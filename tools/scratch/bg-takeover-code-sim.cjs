/**
 * The Code takeover path without a model: tab A starts a Code job (through the app's own
 * module) for an inbox Code chat that ends on the user's message, A is closed, and tab B is
 * watched adopting the job, mounting a hidden Code home, opening the chat and sending the
 * message again. Without a signed-in key the re-sent turn fails fast, which still shows the
 * whole path up to the send.
 *
 *   node tools/scratch/bg-takeover-code-sim.cjs <chatId>
 */
const puppeteer = require('puppeteer-core');

const BASE = 'http://localhost:3000/';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const chatId = process.argv[2];

const codeState = (page) => page.evaluate(async () => {
  const find = (part) => performance.getEntriesByType('resource').map((entry) => entry.name).reverse().find((entry) => entry.includes(part));
  const jobs = await import(find('/code-turn-jobs.ts'));
  const activity = await import(find('/code-turn-activity.ts'));
  return {
    resume: jobs.$codeResume.get()?.job.payload.place ?? null,
    running: activity.$runningCodeScreens.get(),
    hidden: [...document.querySelectorAll('[inert][aria-hidden="true"]')].map((host) => host.querySelectorAll('*').length),
    jobs: Object.keys(localStorage).filter((key) => key.startsWith('willow:job:code')).map((key) => {
      const job = JSON.parse(localStorage.getItem(key));
      return { owner: job.owner.slice(0, 6), takeovers: job.takeovers };
    }),
    sidebarText: [...document.querySelectorAll('[inert][aria-hidden="true"]')].map((host) => host.innerText.slice(0, 120).replace(/\s+/g, ' ')),
  };
}).catch((error) => ({ error: error.message.slice(0, 120) }));

const open = async (browser) => {
  const page = await browser.newPage();
  page.on('pageerror', (error) => console.log(`  [pageerror] ${error.message.slice(0, 200)}`));
  await page.bringToFront();
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('textarea.willow-dictation-textarea', { visible: true, timeout: 90_000 });
  await sleep(3500);
  return page;
};

(async () => {
  const browser = await puppeteer.connect({ browserURL: process.env.CDP_URL || 'http://[::1]:9222', defaultViewport: null });
  const b = await open(browser);
  const a = await open(browser);
  const started = await a.evaluate(async (id) => {
    const listKey = Object.keys(localStorage).find((key) => key.startsWith('willow_local_chats:')
      && (localStorage.getItem(key) || '').includes(id));
    if (!listKey) return { error: 'chat not in any scope list' };
    const scopeId = decodeURIComponent(listKey.slice('willow_local_chats:'.length));
    const url = performance.getEntriesByType('resource').map((entry) => entry.name).reverse().find((entry) => entry.includes('/code-turn-jobs.ts'));
    const jobs = await import(url);
    window.__simJob = jobs.startCodeTurnJob(undefined, scopeId, {
      place: { target: 'chat', chatId: id },
      mode: 'build',
      tool: null,
      selectedModelId: localStorage.getItem('selectedModelId') || '',
    });
    return { scopeId, id: window.__simJob.id };
  }, chatId);
  console.log('A started a job:', JSON.stringify(started));
  await sleep(2500);
  console.log('B before A closes:', JSON.stringify(await codeState(b)));
  await a.close();
  const closedAt = Date.now();
  for (let second = 1; second <= 45; second += 1) {
    await sleep(700);
    const rows = [];
    let quiet = true;
    for (const page of (await browser.pages()).filter((candidate) => candidate.url().startsWith('http://localhost:3000'))) {
      const state = await Promise.race([codeState(page), sleep(3000).then(() => ({ error: 'no answer' }))]);
      if (state.jobs?.length || state.resume || state.running || state.hidden?.length) quiet = false;
      rows.push(`${page === b ? 'B' : page.url().slice(21, 40)}=${JSON.stringify(state)}`);
    }
    console.log(`+${((Date.now() - closedAt) / 1000).toFixed(1)}s`, rows.join('  '));
    if (second > 8 && quiet) break;
  }
  await b.bringToFront();
  await b.screenshot({ path: require('node:os').tmpdir() + '/bg-code-sim-b.png' });
  if (!process.argv.includes('--keep')) await b.close();
  browser.disconnect();
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
