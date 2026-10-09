/**
 * CPU-profiles the Willow tab around one "View remote browser" click and prints,
 * per 10ms of the main thread, the app functions (components, hooks, effects,
 * callbacks from our sources) that ran in it, by inclusive time. Needs a seeded
 * task with a browser in the Willow tab, pane closed.
 *
 *   node tools/scratch/willow-open-components.cjs [fromMs] [toMs]
 */
const puppeteer = require('puppeteer-core');

const fromMs = Number(process.argv[2] || 0);
const toMs = Number(process.argv[3] || 900);

(async () => {
  const browser = await puppeteer.connect({ browserURL: 'http://[::1]:9222', defaultViewport: null });
  const page = (await browser.pages()).find((p) => p.url().startsWith('http://localhost:3000') && !p.url().includes('/media'));
  if (!page) throw new Error('no willow tab');
  await page.bringToFront();
  const monitor = await page.$('button[aria-label="Open remote browser and remote computer menu"]');
  const box = await monitor.boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForSelector('.spark-task-detail__browser-menu [role="menuitem"]');
  await new Promise((resolve) => setTimeout(resolve, 400));
  const cdp = await page.createCDPSession();
  await cdp.send('Profiler.enable');
  await cdp.send('Profiler.setSamplingInterval', { interval: 200 });
  await cdp.send('Profiler.start');
  const clickedAt = await page.evaluate(() => {
    document.querySelector('.spark-task-detail__browser-menu [role="menuitem"]').click();
    return performance.timeOrigin + performance.now();
  });
  await new Promise((resolve) => setTimeout(resolve, toMs + 200));
  const { profile } = await cdp.send('Profiler.stop');
  const byId = new Map(profile.nodes.map((node) => [node.id, node]));
  const parentOf = new Map();
  for (const node of profile.nodes) for (const child of node.children || []) parentOf.set(child, node.id);
  const isApp = (frame) => frame.url && !frame.url.includes('/node_modules/') && !frame.url.includes('/.vite/deps/') && /\.(tsx?|jsx?)(\?|$)/.test(frame.url);
  const buckets = new Map();
  let t = profile.startTime;
  // The profile clock and the page clock differ; anchor on the first busy sample after start.
  let anchor = null;
  profile.samples.forEach((id, index) => {
    t += profile.timeDeltas[index];
    const frame = byId.get(id).callFrame;
    if (['(idle)', '(program)', '(garbage collector)'].includes(frame.functionName)) return;
    if (anchor === null) anchor = t;
    const at = (t - anchor) / 1000;
    if (at < fromMs || at > toMs) return;
    const bucket = Math.floor(at / 10) * 10;
    const entry = buckets.get(bucket) || { samples: 0, app: new Map() };
    buckets.set(bucket, entry);
    entry.samples += 1;
    const seen = new Set();
    for (let cursor = id; cursor; cursor = parentOf.get(cursor)) {
      const callFrame = byId.get(cursor).callFrame;
      if (!isApp(callFrame)) continue;
      const key = `${callFrame.functionName || '(anonymous)'} ${callFrame.url.split('/').pop().split('?')[0]}:${callFrame.lineNumber + 1}`;
      if (seen.has(key)) continue;
      seen.add(key);
      entry.app.set(key, (entry.app.get(key) || 0) + 1);
    }
  });
  void clickedAt;
  for (const [bucket, entry] of [...buckets].sort((a, b) => a[0] - b[0])) {
    const top = [...entry.app].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([key, n]) => `${key} ${(n * 0.2).toFixed(1)}`).join(' | ');
    console.log(`${String(bucket).padStart(4)}ms busy ${(entry.samples * 0.2).toFixed(1).padStart(4)}: ${top}`);
  }
  browser.disconnect();
})().catch((e) => { console.error(e.message); process.exit(1); });
