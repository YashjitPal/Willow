/**
 * The Media takeover path without a model: tab A starts a Media job (through the app's own
 * module) for a project, optionally naming one of its agent conversations, A is closed, and
 * every Willow tab is watched for the inherited job, the hidden editor it mounts, and the
 * resume settling.
 *
 *   node tools/scratch/bg-takeover-media-sim.cjs <scopeId> [--agent]
 */
const puppeteer = require('puppeteer-core');

const BASE = 'http://localhost:3000/';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const scopeId = process.argv[2];
const withAgent = process.argv.includes('--agent');

const mediaState = (page) => page.evaluate(async () => {
  const find = (part) => performance.getEntriesByType('resource').map((entry) => entry.name).reverse().find((entry) => entry.includes(part));
  const jobs = await import(find('/media-jobs.ts'));
  const background = await import(find('/media-background.ts'));
  return {
    resume: jobs.$mediaResume.get()?.job.payload.projectId ?? null,
    working: background.$mediaWorkRunning.get(),
    hidden: [...document.querySelectorAll('[inert][aria-hidden="true"]')].map((host) => host.querySelectorAll('*').length),
    jobs: Object.keys(localStorage).filter((key) => key.startsWith('willow:job:media')).map((key) => {
      const job = JSON.parse(localStorage.getItem(key));
      return { owner: job.owner.slice(0, 6), takeovers: job.takeovers, agent: job.payload.agentSessionId?.slice(0, 8) ?? null };
    }),
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
  const started = await a.evaluate(async (scope, agent) => {
    const find = (part) => performance.getEntriesByType('resource').map((entry) => entry.name).reverse().find((entry) => entry.includes(part));
    const registry = await import(find('/projects/src/registry.ts'));
    const project = registry.readProjectRegistry().find((entry) => entry.kind === 'media');
    if (!project) return { error: 'no media project' };
    let agentSessionId = null;
    if (agent) {
      const sessions = await import(find('/media-agent-sessions.ts'));
      const list = await sessions.listAgentSessions(project.id, scope).catch(() => []);
      agentSessionId = list[0]?.id ?? null;
    }
    const jobs = await import(find('/media-jobs.ts'));
    window.__simJob = jobs.startMediaWorkJob(undefined, scope, {
      projectId: project.id,
      agentSessionId,
      agentPrompt: null,
      itemIds: [],
      videoDurations: {},
    });
    return { project: project.name, projectId: project.id, agentSessionId, id: window.__simJob.id };
  }, scopeId, withAgent);
  console.log('A started a job:', JSON.stringify(started));
  await sleep(2500);
  await a.close();
  const closedAt = Date.now();
  for (let second = 1; second <= 60; second += 1) {
    await sleep(1000);
    const rows = [];
    let quiet = true;
    for (const page of (await browser.pages()).filter((candidate) => candidate.url().startsWith('http://localhost:3000'))) {
      const state = await Promise.race([mediaState(page), sleep(3000).then(() => ({ error: 'no answer' }))]);
      if (state.jobs?.length || state.resume || state.working || state.hidden?.length || state.error) quiet = false;
      rows.push(`${page === b ? 'B' : page.url().slice(21, 40)}=${JSON.stringify(state)}`);
    }
    console.log(`+${((Date.now() - closedAt) / 1000).toFixed(1)}s`, rows.join('  '));
    if (second > 8 && quiet) break;
  }
  if (!process.argv.includes('--keep')) await b.close();
  browser.disconnect();
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
