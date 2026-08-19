/* Does Flow's rail expand on hover? Measures a row before and while the pointer is over it. */
const p = require('puppeteer-core');

(async () => {
  const b = await p.connect({ browserURL: 'http://127.0.0.1:9222', defaultViewport: null });
  const t = b.targets().find((x) => x.type() === 'page' && x.url().includes('labs.google/fx/tools/flow'));
  const pg = await t.page();
  await pg.bringToFront();
  const cdp = await pg.createCDPSession();
  await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true }).catch(() => {});
  await new Promise((r) => setTimeout(r, 600));

  const snap = () => pg.evaluate(() => {
    const rail = Array.from(document.querySelectorAll('button')).filter((el) => {
      const r = el.getBoundingClientRect();
      return r.left < 320 && r.width >= 32 && r.top > 60 && r.top < innerHeight - 60;
    });
    return rail.slice(0, 4).map((el) => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      const glyph = el.querySelector('i');
      const label = Array.from(el.querySelectorAll('span')).find((s) => /\s|[A-Z]/.test((s.textContent || '').trim()));
      const lcs = label && getComputedStyle(label);
      const lr = label && label.getBoundingClientRect();
      const gr = glyph && glyph.getBoundingClientRect();
      return {
        text: (el.textContent || '').trim().slice(0, 24),
        box: `${Math.round(r.width)}x${Math.round(r.height)}@${Math.round(r.left)},${Math.round(r.top)}`,
        bg: cs.backgroundColor,
        radius: cs.borderTopLeftRadius,
        gap: cs.gap,
        padding: `${cs.paddingLeft}/${cs.paddingRight}`,
        glyphX: gr ? Math.round(gr.left) : null,
        glyphW: gr ? Math.round(gr.width) : null,
        labelVisible: lcs ? (lcs.visibility !== 'hidden' && lr.width > 2 && lcs.clip === 'auto') : null,
        labelFont: lcs ? `${lcs.fontSize}/${lcs.lineHeight} w${lcs.fontWeight}` : null,
        labelX: lr ? Math.round(lr.left) : null,
        iconToLabel: gr && lr ? Math.round(lr.left - (gr.left + gr.width)) : null,
      };
    });
  });

  await pg.mouse.move(700, 500);
  await new Promise((r) => setTimeout(r, 500));
  const before = await snap();
  console.log('=== pointer away');
  for (const r of before) console.log(`  ${r.text.padEnd(26)} ${r.box.padEnd(18)} bg=${r.bg} r=${r.radius} gap=${r.gap} pad=${r.padding} glyph@${r.glyphX} label@${r.labelX} visible=${r.labelVisible} ${r.labelFont} icon->label=${r.iconToLabel}`);

  /* Hover the first rail row. */
  await pg.mouse.move(40, 100);
  await new Promise((r) => setTimeout(r, 900));
  const after = await snap();
  console.log('\n=== pointer over the rail');
  for (const r of after) console.log(`  ${r.text.padEnd(26)} ${r.box.padEnd(18)} bg=${r.bg} r=${r.radius} gap=${r.gap} pad=${r.padding} glyph@${r.glyphX} label@${r.labelX} visible=${r.labelVisible} ${r.labelFont} icon->label=${r.iconToLabel}`);

  await pg.mouse.move(700, 500);
  await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: false }).catch(() => {});
  await b.disconnect();
})();
