/** Every open Willow tab's chat turns, background job records and visibility, once. */
const puppeteer = require('puppeteer-core');

(async () => {
  const browser = await puppeteer.connect({ browserURL: 'http://[::1]:9222', defaultViewport: null });
  const targets = browser.targets().filter((target) => target.type() === 'page' && target.url().startsWith('http://localhost:3000'));
  console.log('targets', targets.map((target) => target.url().slice(21, 80)));
  for (const [index, target] of targets.entries()) {
    const page = await Promise.race([target.page(), new Promise((resolve) => setTimeout(() => resolve(null), 8000))]);
    if (!page) { console.log(index, 'attach timed out', target.url()); continue; }
    const timeout = new Promise((resolve) => setTimeout(() => resolve({ error: 'evaluate timed out' }), 8000));
    const state = await Promise.race([timeout, page.evaluate(() => {
      const turns = globalThis[Symbol.for('willow.chatTurns')];
      return {
        url: location.pathname + location.search,
        visibility: document.visibilityState,
        turnMap: turns ? turns.size : 'none',
        turns: turns ? [...turns.values()].map((record) => ({
          turn: record.turnId.slice(0, 8), chat: record.chatId, status: record.status,
          chars: record.content.length, thinking: record.thinkingText.length, phase: record.phase,
        })) : [],
        jobs: Object.keys(localStorage).filter((key) => key.startsWith('willow:job:')).map((key) => {
          const job = JSON.parse(localStorage.getItem(key));
          return { id: job.id, kind: job.kind, owner: job.owner.slice(0, 6), takeovers: job.takeovers, age: Math.round((Date.now() - job.heartbeatAt) / 1000), payload: job.payload.chatId ?? job.payload.taskId };
        }),
      };
    }).catch((error) => ({ error: error.message }))]);
    console.log(index, JSON.stringify(state));
  }
  browser.disconnect();
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
