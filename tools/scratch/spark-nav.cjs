/*
 * Moves the debug Chrome's Gemini or Willow tab to a Spark route without touching the
 * device emulation the emulator daemon holds on it.
 *
 *   node tools/scratch/spark-nav.cjs gemini home|tasks|schedules|skills|apps|chat:<id>|first-task
 *   node tools/scratch/spark-nav.cjs willow home|tasks|schedules|skills|apps|task:<id>|first-task|
 *                                           schedule-editor|skill-editor
 *
 * Gemini is URL-addressed. Willow keeps Spark's route in a nanostore, so this switches the
 * studio to Spark (the drawer's Chat/Spark tab) and then calls the same `navigateSpark` the
 * UI calls, by importing the very module instance Vite served the app (found through the
 * resource timeline, so the URL — and therefore the module — is identical).
 */
const puppeteer = require('puppeteer-core');

const GEMINI_PATHS = { home: '', tasks: '/tasks', schedules: '/schedules', skills: '/skills', apps: '/apps' };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function gemini(page, route) {
  let path = GEMINI_PATHS[route];
  if (route.startsWith('chat:')) path = `/chat/${route.slice(5)}`;
  if (route === 'first-task') {
    if (!page.url().includes('/spark/tasks')) {
      await page.goto('https://gemini.google.com/spark/tasks', { waitUntil: 'networkidle2', timeout: 45000 }).catch(() => undefined);
      await sleep(2500);
    }
    // Rows are `div[role="option"]` with a click handler, not links.
    const clicked = await page.evaluate(() => {
      const row = [...document.querySelectorAll('.goal-card, [role="option"]')].find((el) => el.getBoundingClientRect().width > 0);
      if (!row) return false;
      row.click();
      return true;
    });
    if (!clicked) throw new Error('no task row on /spark/tasks');
    for (let i = 0; i < 20 && !page.url().includes('/spark/chat/'); i += 1) await sleep(250);
    await sleep(2500);
    return page.url();
  }
  if (path === undefined) throw new Error(`unknown Gemini route ${route}`);
  await page.goto(`https://gemini.google.com/spark${path}`, { waitUntil: 'networkidle2', timeout: 45000 }).catch((err) => console.log('goto:', err.message));
  await sleep(2500);
  return page.url();
}

async function willow(page, route) {
  return page.evaluate(async (target) => {
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    // 1. Studio experience: press the drawer's Spark tab if Spark is not already showing.
    const sparkRoot = () => document.querySelector('.spark-home, .spark-all-tasks, .spark-task-detail, .spark-customise-page, .spark-schedule-editor, .spark-skill-editor, [class*="spark-customise-page"]');
    if (!sparkRoot()) {
      const tab = [...document.querySelectorAll('.studio-sidebar button')].find((b) => (b.textContent || '').trim().startsWith('Spark'));
      if (!tab) return { error: 'no Spark tab in the sidebar' };
      tab.click();
      for (let i = 0; i < 20 && !sparkRoot(); i += 1) await wait(250);
    }
    // 2. The app's own spark-store module instance.
    const url = performance.getEntriesByType('resource').map((entry) => entry.name).find((name) => /\/spark-store\.ts(\?|$)/.test(name));
    if (!url) return { error: 'spark-store module not found in the resource timeline' };
    const store = await import(url);
    const tasks = store.sparkState.get().tasks || [];
    let location;
    if (target === 'home') location = { page: 'home' };
    else if (target === 'tasks') location = { page: 'all-tasks' };
    else if (target === 'schedules') location = { page: 'schedules' };
    else if (target === 'skills') location = { page: 'skills' };
    else if (target === 'apps') location = { page: 'apps' };
    else if (target === 'schedule-editor') location = { page: 'schedule-editor' };
    else if (target === 'skill-editor') location = { page: 'skill-editor', mode: 'manual' };
    else if (target === 'first-task') {
      if (!tasks.length) return { error: 'Willow has no Spark tasks' };
      location = { page: 'task', taskId: tasks[0].id };
    } else if (target.startsWith('task:')) location = { page: 'task', taskId: target.slice(5) };
    else return { error: `unknown Willow route ${target}` };
    if (location.page === 'task') store.ensureSparkTaskBodyLoaded?.(location.taskId);
    store.navigateSpark(location);
    await wait(1200);
    return { location: store.sparkState.get().location, tasks: tasks.slice(0, 8).map((t) => ({ id: t.id, title: t.title, status: t.status })) };
  }, route);
}

(async () => {
  const [app, route] = process.argv.slice(2);
  const browser = await puppeteer.connect({ browserURL: process.env.CDP_URL || 'http://[::1]:9222', defaultViewport: null });
  const prefix = app === 'gemini' ? 'https://gemini.google.com/' : 'http://localhost:3000';
  const page = (await browser.pages()).find((candidate) => candidate.url().startsWith(prefix));
  if (!page) throw new Error(`no ${app} tab`);
  await page.bringToFront();
  const result = app === 'gemini' ? await gemini(page, route) : await willow(page, route);
  console.log(JSON.stringify(result));
  await browser.disconnect();
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
