/**
 * The file viewer's zoom list with the real mouse, in a browser context of its own: opens
 * the seeded task's file (`spark-file-open.cjs` seeds the same task), then presses the zoom
 * control several times — once straight after Print, whose frame takes focus — and reports
 * whether the list opened each time.
 *
 *   node tools/scratch/spark-file-zoom-check.cjs
 */
const puppeteer = require('puppeteer-core');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

(async () => {
  const browser = await puppeteer.connect({ browserURL: 'http://[::1]:9222', defaultViewport: null, protocolTimeout: 30_000 });
  const context = await browser.createBrowserContext();
  try {
    const page = await context.newPage();
    await page.evaluateOnNewDocument(() => {
      const append = Node.prototype.appendChild;
      Node.prototype.appendChild = function (child) {
        const result = append.call(this, child);
        if (child instanceof HTMLIFrameElement && child.contentWindow) child.contentWindow.print = () => {};
        return result;
      };
    });
    await page.goto('http://localhost:3000/spark', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.spark-top-controls, textarea', { timeout: 90_000 });
    await sleep(5000);
    await page.evaluate(async () => {
      const url = performance.getEntriesByType('resource').filter((e) => /\/spark-store\.ts(\?|$)/.test(e.name)).sort((a, b) => b.startTime - a.startTime)[0].name;
      const store = await import(url);
      let dir = await navigator.storage.getDirectory();
      for (const part of ['willow-spark', store.getActiveSparkStorageScope(), 'workspace', 'workspace']) dir = await dir.getDirectoryHandle(part, { create: true });
      const writable = await (await dir.getFileHandle('zoom.txt', { create: true })).createWritable();
      await writable.write('Zoom me.\n');
      await writable.close();
      store.createSparkTask('make a file', {
        id: 'seed-zoom', title: 'Zoom check', status: 'complete', openTask: false, response: 'Done.',
        generatedFiles: [{ id: 'seed-zoom-1', name: 'zoom.txt', path: '/workspace/zoom.txt', mimeType: 'text/plain', createdAt: new Date().toISOString() }],
      });
      store.navigateSpark({ page: 'task', taskId: 'seed-zoom' });
    });
    await page.waitForSelector('[data-test-id="spark-generated-file-card"]', { timeout: 30_000 });
    await sleep(1500);
    await page.click('[data-test-id="spark-generated-file-card"]');
    await page.waitForSelector('.spark-file-viewer__zoom', { timeout: 10_000 });
    await sleep(600);
    const expanded = () => page.$eval('.spark-file-viewer__zoom', (el) => el.getAttribute('aria-expanded'));
    const results = [];
    for (const label of ['first', 'again (closes)', 'third']) {
      await page.bringToFront();
      await page.click('.spark-file-viewer__zoom');
      await sleep(300);
      results.push(`${label}: ${await expanded()}`);
    }
    await page.click('.spark-file-viewer__zoom');
    await sleep(200);
    await page.click('.spark-file-viewer__tool[aria-label="Print"]');
    await sleep(400);
    await page.bringToFront();
    await page.click('.spark-file-viewer__zoom');
    await sleep(300);
    results.push(`after Print: ${await expanded()}`);
    const option = await page.evaluateHandle(() => [...document.querySelectorAll('.spark-file-viewer__zoom-option')].find((el) => el.textContent.trim() === '150%'));
    if (option.asElement()) await option.asElement().click();
    await sleep(300);
    results.push(`picked 150%: ${await page.$eval('.spark-file-viewer__zoom-value', (el) => el.textContent)}, list ${await expanded()}`);
    console.log(results.join('\n'));
  } finally {
    await context.close();
    browser.disconnect();
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
