/**
 * Sends one bridge op to the open task's remote-browser frame and prints the reply.
 *
 *   node tools/scratch/rb-frame-call.cjs <op> [args.json]
 */
const puppeteer = require('puppeteer-core');
const fs = require('fs');

(async () => {
  const op = process.argv[2] || 'ping';
  const args = process.argv[3] ? JSON.parse(fs.readFileSync(process.argv[3], 'utf8')) : {};
  const browser = await puppeteer.connect({ browserURL: 'http://[::1]:9222', defaultViewport: null });
  const page = (await browser.pages()).find((p) => p.url().startsWith('http://localhost:3000') && !p.url().includes('/media'));
  const result = await page.evaluate(async (op, args) => {
    const newest = (pattern) => performance.getEntriesByType('resource')
      .filter((entry) => pattern.test(entry.name))
      .sort((a, b) => b.startTime - a.startTime)[0]?.name;
    const store = await import(newest(/\/spark-store\.ts(\?|$)/));
    const runUrl = newest(/\/remote-browser\/run-remote-browser\.ts(\?|$)/);
    const runSource = await (await fetch(runUrl)).text();
    const framesPath = /from\s+["']([^"']*remote-browser-frames\.ts[^"']*)["']/.exec(runSource)?.[1];
    const frames = await import(new URL(framesPath, runUrl).href);
    const taskId = store.sparkState.get().location.taskId;
    const iframe = document.querySelector('.spark-remote-browser__frame');
    const reply = await frames.callRemoteFrame(taskId, op, args).catch((error) => ({ thrown: error.message }));
    if (reply && reply.dataUrl) reply.dataUrl = `${reply.dataUrl.length} chars`;
    return {
      reply,
      state: frames.remoteFrameState(taskId),
      iframe: iframe && { width: iframe.width, height: iframe.height, client: [iframe.clientWidth, iframe.clientHeight], style: iframe.getAttribute('style') },
    };
  }, op, args);
  console.log(JSON.stringify(result, null, 1));
  browser.disconnect();
})().catch((e) => { console.error(e.message); process.exit(1); });
