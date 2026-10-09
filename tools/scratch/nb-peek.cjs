/**
 * Read-only look at Willow's notebook registry in the debug Chrome's Willow tab: every
 * scoped `willow_notebooks:v1:*` key with its notebooks (id, title, emoji, sources, chats).
 *
 *   node tools/scratch/nb-peek.cjs
 */
const puppeteer = require('puppeteer-core');

(async () => {
  const browser = await puppeteer.connect({
    browserURL: process.env.SPARK_CDP_URL || 'http://[::1]:9222',
    defaultViewport: null,
    protocolTimeout: 30_000,
  });
  const page = (await browser.pages()).find((p) => p.url().startsWith('http://localhost:3000'));
  const out = await page.evaluate(() => {
    const rows = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith('willow_notebooks')) continue;
      let parsed;
      try { parsed = JSON.parse(localStorage.getItem(key) || 'null'); } catch { parsed = '(unparseable)'; }
      const list = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.notebooks) ? parsed.notebooks : null;
      rows.push(`${key} → ${list ? `${list.length} notebook(s)` : typeof parsed}`);
      for (const nb of list ?? []) {
        rows.push(`  ${nb.id} "${nb.title}" emoji ${nb.emoji ?? '-'} sources ${(nb.sources ?? []).length} chats ${(nb.chatIds ?? []).length} pinned ${Boolean(nb.pinned ?? nb.isPinned)} vertical ${nb.vertical ?? '-'}`);
      }
    }
    return rows.join('\n') || '(no notebook keys)';
  });
  console.log(out);
  await browser.disconnect();
})().catch((e) => { console.error('FAILED', e.message); process.exit(1); });
