/** Brings the Nth Willow tab to the front (unfreezing it) and reports its turns, jobs and title. */
const puppeteer = require('puppeteer-core');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

(async () => {
  const browser = await puppeteer.connect({ browserURL: 'http://[::1]:9222', defaultViewport: null });
  const targets = browser.targets().filter((target) => target.type() === 'page' && target.url().startsWith('http://localhost:3000'));
  const target = targets[Number(process.argv[2] || 0)];
  const cdp = await target.createCDPSession();
  await cdp.send('Target.activateTarget', { targetId: target._targetId }).catch(() => undefined);
  await cdp.send('Page.bringToFront').catch((error) => console.log('bringToFront', error.message));
  await sleep(1500);
  const result = await Promise.race([
    cdp.send('Runtime.evaluate', {
      expression: `(() => {
        const turns = globalThis[Symbol.for('willow.chatTurns')];
        return JSON.stringify({
          title: document.title,
          visibility: document.visibilityState,
          turns: turns ? [...turns.values()].map((r) => ({ chat: r.chatId, status: r.status, chars: r.content.length, thinking: r.thinkingText.length, phase: r.phase })) : 'none',
          jobs: Object.keys(localStorage).filter((k) => k.startsWith('willow:job:')),
          text: document.querySelector('main')?.innerText?.slice(0, 300),
        });
      })()`,
      returnByValue: true,
    }),
    sleep(10_000).then(() => ({ result: { value: 'evaluate timed out' } })),
  ]);
  console.log(result.result?.value ?? JSON.stringify(result));
  browser.disconnect();
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
