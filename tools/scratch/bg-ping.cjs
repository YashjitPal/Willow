/** Pings every Willow tab's main thread; a tab that does not answer is hung or behind a dialog. */
const puppeteer = require('puppeteer-core');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

(async () => {
  const browser = await puppeteer.connect({ browserURL: 'http://[::1]:9222', defaultViewport: null });
  const root = await browser.target().createCDPSession();
  const { targetInfos } = await root.send('Target.getTargets');
  for (const info of targetInfos.filter((target) => target.type === 'page' && target.url.startsWith('http://localhost:3000'))) {
    const { sessionId } = await root.send('Target.attachToTarget', { targetId: info.targetId, flatten: true });
    const session = browser._connection.session(sessionId);
    const started = Date.now();
    const answer = await Promise.race([
      session.send('Runtime.evaluate', { expression: 'document.visibilityState + " " + (globalThis[Symbol.for("willow.chatTurns")]?.size ?? "none")', returnByValue: true })
        .then((result) => result.result.value),
      sleep(5000).then(() => 'NO ANSWER'),
    ]);
    const history = await Promise.race([
      session.send('Page.getNavigationHistory').then((result) => result.entries.length),
      sleep(3000).then(() => 'n/a'),
    ]);
    console.log(info.targetId.slice(0, 8), `${Date.now() - started}ms`, answer, `history=${history}`, info.url.slice(21, 60));
    if (process.argv.includes('--dismiss') && answer === 'NO ANSWER') {
      const dismissed = await session.send('Page.handleJavaScriptDialog', { accept: false }).then(() => 'dismissed a dialog', (error) => error.message);
      console.log('  ', dismissed);
    }
    await root.send('Target.detachFromTarget', { sessionId }).catch(() => undefined);
  }
  browser.disconnect();
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
