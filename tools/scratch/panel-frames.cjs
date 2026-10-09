/**
 * Samples a full-screen pane's entrance or exit frame by frame: DOM-clicks a trigger, then
 * records the pane's box, opacity and transform (its own and its first child's) on every
 * animation frame for a while. Only for triggers that open or close UI.
 *
 *   node tools/scratch/panel-frames.cjs gemini|willow "<triggerSelector>" "<paneSelector>" [ms=700] [index=-1]
 */
const puppeteer = require('puppeteer-core');

const ORIGINS = { gemini: 'https://gemini.google.com', willow: 'http://localhost:3000' };

(async () => {
  const [which = 'gemini', trigger, paneSel, msArg = '700', indexArg = '-1'] = process.argv.slice(2);
  const browser = await puppeteer.connect({
    browserURL: process.env.SPARK_CDP_URL || 'http://[::1]:9222',
    defaultViewport: null,
    protocolTimeout: 30_000,
  });
  const page = (await browser.pages()).find((p) => p.url().startsWith(ORIGINS[which]));
  await page.bringToFront();
  const frames = await page.evaluate(async (triggerSel, sel, ms, idx) => {
    const r1 = (n) => Math.round(n * 10) / 10;
    const all = [...document.querySelectorAll(triggerSel)].filter((el) => el.getBoundingClientRect().width > 0);
    const target = all[idx < 0 ? all.length + idx : idx];
    if (!target) return [`no visible ${triggerSel}`];
    const out = [];
    const t0 = performance.now();
    target.click();
    let last = '';
    while (performance.now() - t0 < ms) {
      await new Promise((resolve) => requestAnimationFrame(resolve));
      const pane = document.querySelector(sel);
      let line = 'absent';
      if (pane) {
        const cs = getComputedStyle(pane);
        const r = pane.getBoundingClientRect();
        const child = pane.firstElementChild;
        const ccs = child ? getComputedStyle(child) : null;
        line = `[${[r.x, r.y, r.width, r.height].map(r1).join(',')}] op ${cs.opacity} tf ${cs.transform} vis ${cs.visibility}${child ? ` | child op ${ccs.opacity} tf ${ccs.transform}` : ''}`;
      }
      if (line !== last) out.push(`${Math.round(performance.now() - t0)}ms ${line}`);
      last = line;
    }
    return out;
  }, trigger, paneSel, Number(msArg), Number(indexArg));
  console.log(frames.join('\n'));
  await browser.disconnect();
})().catch((e) => { console.error('FAILED', e.message); process.exit(1); });
