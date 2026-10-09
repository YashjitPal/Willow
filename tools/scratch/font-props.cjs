// One-off: computed font properties of the settings panel's "16:9" and "Image" labels, in Flow
// (opens and closes its panel) and in Willow (:3101, the panel must be closed beforehand).
const { session } = require('../../.agents/skills/clone-google-app-ui/scripts/cdp-kit.cjs');

const read = (s) => s.eval(() => {
  const props = ['fontFamily', 'fontSize', 'fontWeight', 'fontStretch', 'fontStyle', 'fontFeatureSettings', 'fontVariantNumeric', 'fontVariationSettings', 'fontOpticalSizing', 'letterSpacing', 'fontKerning', 'textRendering'];
  const pick = (text) => {
    const el = [...document.querySelectorAll('span, button')].find((e) => e.childElementCount === 0 && e.textContent.trim() === text && e.getBoundingClientRect().width > 0 && e.getBoundingClientRect().top > 300);
    if (!el) return null;
    const cs = getComputedStyle(el);
    return { width: Math.round(el.getBoundingClientRect().width * 100) / 100, ...Object.fromEntries(props.map((p) => [p, cs[p]])) };
  };
  return { '16:9': pick('16:9'), Image: pick('Image') };
});

(async () => {
  const f = await session({ tab: 'flow', out: 'tools/scratch' });
  // The chip toggles the panel and Escape leaves it open, so only open it when it is shut.
  if (!(await f.eval(() => !!document.querySelector('flow-prompt-box-settings')))) {
    await f.click('flow-prompt-box button, flow-prompt-box [role="button"]', /Video|Image/);
    await f.sleep(800);
  }
  await f.click('flow-prompt-box-settings button', /Image$/);
  await f.sleep(600);
  console.log('FLOW', JSON.stringify(await read(f), null, 1));
  await f.click('flow-prompt-box-settings button', /Video$/);
  await f.sleep(400);
  // Shut it with the chip, the way it opened.
  await f.click('flow-prompt-box button, flow-prompt-box [role="button"]', /Video|Image/);
  await f.sleep(500);
  console.log('flow panel open after:', await f.eval(() => !!document.querySelector('flow-prompt-box-settings')));
  await f.close();
  const w = await session({ tab: 'willow-test', out: 'tools/scratch' });
  const chip = await w.eval(() => { const b = [...document.querySelector('.prompt-container-box').querySelectorAll('button')].find((x) => /x[1-4]\s*$/.test(x.textContent.trim())); const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  await w.clickAt(chip.x, chip.y);
  await w.sleep(700);
  console.log('WILLOW', JSON.stringify(await read(w), null, 1));
  await w.clickAt(chip.x, chip.y);
  await w.close();
})().catch((e) => { console.error(e); process.exit(1); });
