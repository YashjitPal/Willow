/**
 * Drives the open task's remote browser through Spark's computer-use driver in the
 * Willow tab — the same calls the browser agent makes — with no model involved.
 *
 *   node tools/scratch/rb-driver-test.cjs <out-dir> '<json actions>'
 *
 * Actions are `{ "name": "<computer-use action>", "args": {...} }`, e.g.
 *   '[{"name":"navigate","args":{"url":"https://html.duckduckgo.com/html/"}}]'
 * After each action it settles, screenshots, and saves `driver-<n>.jpg`.
 */
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');

(async () => {
  const out = process.argv[2] || 'tools/ui-research/captures/spark/134-remote-browser/willow';
  const spec = process.argv[3] || '[]';
  const actions = JSON.parse(spec.endsWith('.json') ? fs.readFileSync(spec, 'utf8') : spec);
  const browser = await puppeteer.connect({ browserURL: 'http://[::1]:9222', defaultViewport: null });
  const page = (await browser.pages()).find((p) => p.url().startsWith('http://localhost:3000') && !p.url().includes('/media'));
  if (!page) throw new Error('no willow tab');
  const results = await page.evaluate(async (list) => {
    const newest = (pattern) => performance.getEntriesByType('resource')
      .filter((entry) => pattern.test(entry.name))
      .sort((a, b) => b.startTime - a.startTime)[0]?.name;
    // Vite stamps `?t=` on hot-updated modules, even across reloads, and the resource
    // timeline stops at 250 entries, so read the live URL out of the importer's source.
    const importedBy = async (importerUrl, file) => {
      const source = await (await fetch(importerUrl)).text();
      const match = new RegExp(`["']([^"']*/${file.replace('.', '\\.')}(?:\\?[^"']*)?)["']`).exec(source);
      return match ? new URL(match[1], importerUrl).href : null;
    };
    const storeUrl = newest(/\/spark-store\.ts(\?|$)/);
    const workspaceUrl = newest(/\/SparkWorkspace\.tsx(\?|$)/);
    const runUrl = newest(/\/remote-browser\/run-remote-browser\.ts(\?|$)/)
      || (workspaceUrl && await importedBy(workspaceUrl, 'run-remote-browser.ts'));
    if (!runUrl || !storeUrl) return { error: `modules not found (store ${Boolean(storeUrl)}, workspace ${Boolean(workspaceUrl)})` };
    const run = await import(runUrl);
    const store = await import(storeUrl);
    const location = store.sparkState.get().location;
    if (location.page !== 'task') return { error: 'no task open' };
    const driver = run.createRemoteBrowserDriver(location.taskId);
    const log = [];
    for (const action of list) {
      const started = performance.now();
      const result = await driver.execute(action);
      const executed = performance.now();
      await driver.settle(['navigate', 'search', 'go_back', 'go_forward'].includes(action.name));
      const settled = performance.now();
      const shot = await driver.screenshot();
      const shotAt = performance.now();
      log.push({
        action: action.name,
        result,
        url: driver.url(),
        ms: `${Math.round(shotAt - started)} (act ${Math.round(executed - started)}, settle ${Math.round(settled - executed)}, shot ${Math.round(shotAt - settled)})`,
        shot: `data:${shot.mimeType};base64,${shot.data}`,
      });
    }
    return { taskId: location.taskId, log };
  }, actions);
  if (!results || results.error) throw new Error(results ? results.error : 'no result from the page');
  if (!results.log.length) console.log(`no actions ran (${actions.length} given) for ${results.taskId}`);
  results.log.forEach((entry, index) => {
    const file = path.join(out, `driver-${index + 1}.jpg`);
    fs.writeFileSync(file, Buffer.from(entry.shot.split(',')[1], 'base64'));
    console.log(`${index + 1}. ${entry.action} -> ${JSON.stringify(entry.result)} | ${entry.url} | ${entry.ms}ms | ${file}`);
  });
  browser.disconnect();
})().catch((e) => { console.error(e.message); process.exit(1); });
