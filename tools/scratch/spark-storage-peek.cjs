/**
 * Summarise what Willow's Spark store holds in localStorage: per `willow:spark:*` key,
 * the task / schedule / skill counts and the first few titles.
 *
 *   node tools/scratch/spark-storage-peek.cjs
 */
const puppeteer = require('puppeteer-core');

(async () => {
  const browser = await puppeteer.connect({
    browserURL: process.env.SPARK_CDP_URL || 'http://[::1]:9222',
    defaultViewport: null,
    protocolTimeout: 20_000,
  });
  const page = (await browser.pages()).find((p) => p.url().startsWith('http://localhost:3000'));
  if (!page) throw new Error('no Willow tab');
  const report = await page.evaluate(() => Object.keys(localStorage)
    .filter((k) => k.startsWith('willow:spark'))
    .map((key) => {
      let state;
      try {
        state = JSON.parse(localStorage.getItem(key));
      } catch {
        return { key, note: 'not JSON' };
      }
      const titles = (list) => (Array.isArray(list) ? list.map((x) => x.title || x.name || x.id) : null);
      return {
        key,
        bytes: (localStorage.getItem(key) || '').length,
        tasks: titles(state?.tasks),
        schedules: titles(state?.schedules),
        skills: titles(state?.skills),
      };
    }));
  for (const entry of report) {
    console.log(`${entry.key} (${entry.bytes ?? '?'} bytes)${entry.note ? ' ' + entry.note : ''}`);
    for (const field of ['tasks', 'schedules', 'skills']) {
      if (entry[field]) console.log(`   ${field} ${entry[field].length}: ${entry[field].slice(0, 16).join(' | ')}`);
    }
  }
  await browser.disconnect();
})().catch((e) => { console.error('FAILED', e.message); process.exit(1); });
