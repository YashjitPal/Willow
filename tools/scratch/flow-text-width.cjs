// One-off: width of "Images" in Flow's page at a few font settings (a detached span, removed again),
// to read the filter panel's label font from its measured 40.06px.
const { session } = require('../../.agents/skills/clone-google-app-ui/scripts/cdp-kit.cjs');

(async () => {
  const s = await session({ tab: 'flow', out: 'tools/scratch' });
  console.log(JSON.stringify(await s.eval(() => {
    const out = {};
    for (const family of ['"Google Sans Text"', '"Google Sans"', 'Roboto']) {
      for (const size of [11.008, 12, 13, 14]) {
        for (const weight of [400, 500]) {
          const el = document.createElement('span');
          el.textContent = 'Images';
          el.style.cssText = `position:absolute;visibility:hidden;font-family:${family};font-size:${size}px;font-weight:${weight};white-space:nowrap`;
          document.body.appendChild(el);
          out[`${family} ${size} ${weight}`] = Math.round(el.getBoundingClientRect().width * 100) / 100;
          el.remove();
        }
      }
    }
    const label = [...document.querySelectorAll('.mdc-label')].find((e) => e.textContent.trim() === 'Images');
    out.liveLabelFont = label ? getComputedStyle(label).font : 'panel closed';
    return out;
  }), null, 1));
  await s.close();
})().catch((e) => { console.error(e); process.exit(1); });
