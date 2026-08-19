/**
 * Read-only: open a window of our own on Willow and report what notebooks exist and how
 * many sources each has, so a panel check can use one that already has several rather
 * than writing to the user's data.
 */
const { connect, openOwnWindow, sleep } = require('../ui-research/scrapers/notebooks/lib.cjs');

(async () => {
  const browser = await connect();
  let page = null;
  try {
    page = await openOwnWindow(browser, 'http://localhost:3000/notebooks/view');
    await sleep(4000);
    const info = await page.evaluate(() => {
      const out = { keys: [], notebooks: [] };
      for (let i = 0; i < localStorage.length; i += 1) {
        const k = localStorage.key(i);
        if (/notebook/i.test(k)) out.keys.push(k);
      }
      for (const k of out.keys) {
        try {
          const parsed = JSON.parse(localStorage.getItem(k));
          const list = Array.isArray(parsed) ? parsed : parsed && parsed.notebooks;
          if (!Array.isArray(list)) continue;
          for (const n of list) {
            out.notebooks.push({
              key: k,
              id: n.id,
              title: n.title,
              sources: (n.sources || []).map((s) => ({ kind: s.kind, title: s.title, url: s.url, mimeType: s.mimeType })),
            });
          }
        } catch { /* not ours */ }
      }
      return out;
    });
    console.log(JSON.stringify(info, null, 2));
  } finally {
    if (page) await page.close();
    await browser.disconnect();
  }
})();
