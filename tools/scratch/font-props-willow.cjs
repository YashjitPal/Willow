// One-off: computed font properties of Willow's settings panel labels (:3101), opening the panel
// from the composer chip if it is shut, and shutting it again.
const { session } = require('../../.agents/skills/clone-google-app-ui/scripts/cdp-kit.cjs');

(async () => {
  const w = await session({ tab: 'willow-test', out: 'tools/scratch' });
  const read = () => w.eval(() => {
    const props = ['fontFamily', 'fontSize', 'fontWeight', 'fontFeatureSettings', 'fontVariantNumeric', 'letterSpacing', 'fontKerning'];
    const pick = (text) => {
      const el = [...document.querySelectorAll('span, button')].find((e) => e.childElementCount === 0 && e.textContent.trim() === text && e.getBoundingClientRect().width > 0 && e.getBoundingClientRect().top > 300);
      if (!el) return null;
      const cs = getComputedStyle(el);
      return { width: Math.round(el.getBoundingClientRect().width * 100) / 100, ...Object.fromEntries(props.map((p) => [p, cs[p]])) };
    };
    return { '16:9': pick('16:9'), Image: pick('Image'), x2: pick('x2') };
  });
  const chip = await w.eval(() => { const b = [...document.querySelector('.prompt-container-box').querySelectorAll('button')].find((x) => /x[1-4]\s*$/.test(x.textContent.trim())); const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  let v = await read();
  const opened = !v['16:9'];
  if (opened) { await w.clickAt(chip.x, chip.y); await w.sleep(700); v = await read(); }
  console.log(JSON.stringify(v, null, 1));
  if (opened) { await w.clickAt(chip.x, chip.y); await w.sleep(400); }
  await w.close();
})().catch((e) => { console.error(e); process.exit(1); });
