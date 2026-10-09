/**
 * Clicks "View remote browser" in the Willow tab and lists every frame for the
 * next 700ms (time, gap to the previous frame, side-panel width, whether the viewer
 * is up) plus the long tasks, so stalls in the pane's growth show. Then closes the
 * pane the same way. Needs a seeded task with a browser in the Willow tab, pane
 * closed.
 *
 *   node tools/scratch/willow-open-frames.cjs
 */
const puppeteer = require('puppeteer-core');

const recordFrames = (label, click) => new Promise((resolve) => {
  const longTasks = [];
  const observer = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) longTasks.push(`${Math.round(entry.startTime - t0)}+${Math.round(entry.duration)}`);
  });
  observer.observe({ type: 'longtask' });
  const frames = [];
  const t0 = performance.now();
  let last = t0;
  const step = (now) => {
    const side = document.querySelector('.spark-task-detail__side-panel') || document.querySelector('.spark-task-detail__progress-panel.is-open');
    frames.push(`${Math.round(now - t0)}(${Math.round(now - last)}) ${side ? side.getBoundingClientRect().width.toFixed(0) : '-'}${document.querySelector('.spark-task-detail__side-panel .spark-remote-browser__viewer') ? 'v' : ''}`);
    last = now;
    if (now - t0 < 700) requestAnimationFrame(step);
    else {
      observer.disconnect();
      const gaps = frames.map((f) => Number(/\((\d+)\)/.exec(f)[1])).slice(1);
      resolve(`== ${label}: ${frames.length} frames, max gap ${Math.max(...gaps)}ms, gaps over 34ms: ${gaps.filter((g) => g > 34).join(', ') || 'none'}\nlong tasks (start+duration): ${longTasks.join(', ') || 'none'}\n${frames.join('  ')}`);
    }
  };
  document.querySelector(click).click();
  setTimeout(() => requestAnimationFrame(step), 0);
});

(async () => {
  const browser = await puppeteer.connect({ browserURL: 'http://[::1]:9222', defaultViewport: null });
  const page = (await browser.pages()).find((p) => p.url().startsWith('http://localhost:3000') && !p.url().includes('/media'));
  if (!page) throw new Error('no willow tab');
  await page.bringToFront();
  const monitor = await page.$('button[aria-label="Open remote browser and remote computer menu"]');
  const box = await monitor?.boundingBox();
  if (!box) throw new Error('no monitor button (is a seeded task open, pane closed?)');
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForSelector('.spark-task-detail__browser-menu [role="menuitem"]');
  await new Promise((resolve) => setTimeout(resolve, 400));
  console.log(await page.evaluate(recordFrames, 'open', '.spark-task-detail__browser-menu [role="menuitem"]'));
  await new Promise((resolve) => setTimeout(resolve, 800));
  console.log(await page.evaluate(recordFrames, 'close', 'button[aria-label="Close remote browser"]'));
  browser.disconnect();
})().catch((e) => { console.error(e.message); process.exit(1); });
