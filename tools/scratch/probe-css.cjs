// Computed styles of elements on a template copy's page, by selector:
//   PROBE_PATH=/media/tool/<id>?mode=EDIT PROBE_SEL=".editable-text-input,.header-title" node tools/scratch/w-tools-probe.cjs tools/scratch/probe-css.cjs
module.exports = async ({ page, goTarget, sleep, waitFor }) => {
  const props = (process.env.PROBE_PROPS || 'fontSize,lineHeight,fontWeight,fontFamily,letterSpacing,width,height,padding,color,backgroundColor').split(',');
  await goTarget(process.env.PROBE_PATH || '/media/tools');
  await waitFor((sel) => document.querySelector(sel.split(',')[0]), process.env.PROBE_SEL, 60000);
  await sleep(Number(process.env.PROBE_WAIT || 1500));
  const action = process.env.PROBE_ACTION_FILE ? require('fs').readFileSync(process.env.PROBE_ACTION_FILE, 'utf8') : process.env.PROBE_ACTION;
  if (action) { await page.evaluate(action); await sleep(1200); }
  const out = await page.evaluate((sels, keys) => sels.split(',').flatMap((s) => [...document.querySelectorAll(s)].slice(0, 6).map((e) => {
    const cs = getComputedStyle(e);
    const r = e.getBoundingClientRect();
    return `${s} [${Math.round(r.x)},${Math.round(r.y)},${Math.round(r.width)},${Math.round(r.height)}] ${keys.map((k) => `${k}=${cs[k]}`).join(' ')}`;
  })), process.env.PROBE_SEL, props);
  console.log(out.join('\n'));
};
