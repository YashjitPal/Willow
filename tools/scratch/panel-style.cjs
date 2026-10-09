// One-off: Willow's settings panel element — its inline style and the font-family chain from a
// label up to the panel. Opens the panel if shut, then shuts it.
const { session } = require('../../.agents/skills/clone-google-app-ui/scripts/cdp-kit.cjs');

(async () => {
  const w = await session({ tab: 'willow-test', out: 'tools/scratch' });
  const chip = await w.eval(() => { const b = [...document.querySelector('.prompt-container-box').querySelectorAll('button')].find((x) => /x[1-4]\s*$/.test(x.textContent.trim())); const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  const has = () => w.eval(() => !![...document.querySelectorAll('span')].find((e) => e.textContent.trim() === '16:9' && e.getBoundingClientRect().top > 300));
  const opened = !(await has());
  if (opened) { await w.clickAt(chip.x, chip.y); await w.sleep(700); }
  console.log(await w.eval(() => {
    const label = [...document.querySelectorAll('span')].find((e) => e.textContent.trim() === '16:9' && e.getBoundingClientRect().top > 300);
    const chain = [];
    for (let el = label; el && el !== document.body; el = el.parentElement) {
      chain.push(`${el.tagName.toLowerCase()}.${String(el.className).slice(0, 40)} ff=${getComputedStyle(el).fontFamily} style=${(el.getAttribute('style') || '').slice(0, 120)}`);
    }
    return chain.join('\n');
  }));
  if (opened) { await w.clickAt(chip.x, chip.y); await w.sleep(400); }
  await w.close();
})().catch((e) => { console.error(e); process.exit(1); });
