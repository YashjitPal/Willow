/* Click a labelled control in Flow by its accessible name. */
const p = require('puppeteer-core');

const LABEL = process.argv[2];

(async () => {
  const b = await p.connect({ browserURL: 'http://127.0.0.1:9222', defaultViewport: null });
  const t = b.targets().find((x) => x.type() === 'page' && x.url().includes('labs.google/fx/tools/flow'));
  const pg = await t.page();
  await pg.bringToFront();
  const cdp = await pg.createCDPSession();
  await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true }).catch(() => {});
  await new Promise((r) => setTimeout(r, 500));
  const found = await pg.evaluate((label) => {
    const nameOf = (x) => (x.getAttribute('aria-label') || x.getAttribute('title') || x.textContent || '')
      .trim().replace(/^[a-z0-9_]+(?=[A-Z])/, '');
    const all = Array.from(document.querySelectorAll('button, [role="button"]'));
    const el = all.find((x) => nameOf(x) === label) || all.find((x) => nameOf(x).includes(label));
    if (!el) return false;
    el.setAttribute('data-clickme', '1');
    return true;
  }, LABEL);
  if (!found) throw new Error(`no control named ${LABEL}`);
  await pg.click('[data-clickme="1"]');
  await new Promise((r) => setTimeout(r, 900));
  await pg.evaluate(() => document.querySelectorAll('[data-clickme]').forEach((e) => e.removeAttribute('data-clickme')));
  console.log(`clicked "${LABEL}"`);
  await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: false }).catch(() => {});
  await b.disconnect();
})();
