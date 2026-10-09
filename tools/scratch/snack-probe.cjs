/**
 * Shows Willow's notebook snackbar without the destructive action that normally raises
 * it: imports the already-loaded NotebookSnackbar module by its dev-server URL (so it is
 * the same instance the page renders) and calls `showNotebookSnack`, then measures the
 * host, surface and label. The notebook page must be open.
 *
 *   node tools/scratch/snack-probe.cjs ["message"]
 */
const puppeteer = require('puppeteer-core');

(async () => {
  const [message = 'Deleted from Electrochemistry'] = process.argv.slice(2);
  const browser = await puppeteer.connect({ browserURL: 'http://[::1]:9222', defaultViewport: null });
  const page = (await browser.pages()).find((p) => p.url().startsWith('http://localhost:3000'));
  if (!page) throw new Error('no willow tab');
  await page.bringToFront();
  const out = await page.evaluate(async (text) => {
    // Hot updates leave several URLs for the module; only the page's own instance renders.
    const candidates = [...new Set(performance.getEntriesByType('resource')
      .map((e) => e.name)
      .filter((name) => /NotebookSnackbar\.tsx/.test(name)))];
    const base = candidates[0]?.split('?')[0];
    if (base) candidates.push(base);
    let entry = null;
    for (const url of candidates.reverse()) {
      const mod = await import(/* @vite-ignore */ url);
      mod.showNotebookSnack(text, 6000);
      await new Promise((r) => setTimeout(r, 300));
      if (document.querySelector('.nb-snack')) { entry = url; break; }
    }
    if (!entry) return `no instance rendered; tried ${candidates.join(', ')}`;
    const r1 = (n) => Math.round(n * 10) / 10;
    const box = (el) => {
      if (!el) return 'none';
      const b = el.getBoundingClientRect();
      return `[${[b.x, b.y, b.width, b.height].map(r1)}]`;
    };
    const snack = document.querySelector('.nb-snack');
    const label = document.querySelector('.nb-snack-label');
    const cs = snack && getComputedStyle(snack);
    const ls = label && getComputedStyle(label);
    return [
      `module ${entry}`,
      `host ${box(document.querySelector('.nb-snack-host'))}`,
      `snack ${box(snack)} bg ${cs?.backgroundColor} color ${cs?.color} r ${cs?.borderRadius} shadow ${cs?.boxShadow}`,
      `label ${box(label)} ${ls?.fontSize}/${ls?.lineHeight} fvs ${ls?.fontVariationSettings}`,
      `viewport ${innerWidth}x${innerHeight}`,
    ].join('\n');
  }, message);
  console.log(out);
  browser.disconnect();
})();
