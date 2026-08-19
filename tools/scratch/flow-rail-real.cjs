/* Find Flow's *visible* rail labels wherever they live, and measure the real row. */
const p = require('puppeteer-core');

(async () => {
  const b = await p.connect({ browserURL: 'http://127.0.0.1:9222', defaultViewport: null });
  const t = b.targets().find((x) => x.type() === 'page' && x.url().includes('labs.google/fx/tools/flow'));
  const pg = await t.page();
  await pg.bringToFront();
  const cdp = await pg.createCDPSession();
  await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true }).catch(() => {});
  await new Promise((r) => setTimeout(r, 700));

  const out = await pg.evaluate(() => {
    const r2 = (v) => Math.round(v * 100) / 100;
    const visible = (el) => {
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return cs.visibility !== 'hidden' && cs.display !== 'none' && cs.clip === 'auto' && r.width > 2 && r.height > 2;
    };
    /* Any element in the left 320px whose own text is one of the rail's visible words. */
    const words = ['All Media', 'Images', 'Videos', 'Characters', 'Scenes', 'Favorites', 'Uploads', 'Tools'];
    const hits = [];
    for (const el of document.querySelectorAll('*')) {
      const own = Array.from(el.childNodes).filter((n) => n.nodeType === 3).map((n) => n.textContent.trim()).filter(Boolean).join(' ');
      if (!words.includes(own)) continue;
      const r = el.getBoundingClientRect();
      if (r.left > 340) continue;
      const cs = getComputedStyle(el);
      hits.push({
        text: own,
        tag: el.tagName.toLowerCase(),
        cls: (el.getAttribute('class') || '').slice(0, 44),
        rect: { x: r2(r.left), y: r2(r.top), w: r2(r.width), h: r2(r.height) },
        visible: visible(el),
        font: `${cs.fontSize}/${cs.lineHeight} w${cs.fontWeight}`,
        color: cs.color,
        letterSpacing: cs.letterSpacing,
      });
    }

    /* For the visible ones, describe the row container that holds icon + label. */
    const rows = [];
    for (const h of hits.filter((x) => x.visible)) {
      const el = Array.from(document.querySelectorAll('*')).find((n) => {
        const own = Array.from(n.childNodes).filter((c) => c.nodeType === 3).map((c) => c.textContent.trim()).filter(Boolean).join(' ');
        return own === h.text && Math.abs(n.getBoundingClientRect().left - h.rect.x) < 1;
      });
      if (!el) continue;
      let row = el;
      for (let i = 0; i < 5 && row.parentElement; i += 1) {
        row = row.parentElement;
        if (row.querySelector('i, svg')) break;
      }
      const rcs = getComputedStyle(row);
      const rr = row.getBoundingClientRect();
      const glyph = row.querySelector('i, svg');
      const gr = glyph && glyph.getBoundingClientRect();
      rows.push({
        text: h.text,
        row: { x: r2(rr.left), y: r2(rr.top), w: r2(rr.width), h: r2(rr.height) },
        bg: rcs.backgroundColor,
        radius: rcs.borderTopLeftRadius,
        padding: `${rcs.paddingTop} ${rcs.paddingRight} ${rcs.paddingBottom} ${rcs.paddingLeft}`,
        gap: rcs.gap,
        cls: (row.getAttribute('class') || '').slice(0, 44),
        glyphBox: gr ? `${r2(gr.width)}x${r2(gr.height)}@${r2(gr.left)}` : null,
        iconToLabel: gr ? r2(h.rect.x - (gr.left + gr.width)) : null,
        labelFont: h.font,
        labelColor: h.color,
      });
    }
    return { hits, rows };
  });

  console.log('elements whose own text is a rail word:');
  for (const h of out.hits) console.log(`  "${h.text}" <${h.tag}> ${h.rect.w}x${h.rect.h}@${h.rect.x},${h.rect.y} visible=${h.visible} ${h.font} ${h.color} ls=${h.letterSpacing}  ${h.cls}`);
  console.log('\nrows around the visible labels:');
  for (const r of out.rows) {
    console.log(`  "${r.text}" row ${r.row.w}x${r.row.h}@${r.row.x},${r.row.y} bg=${r.bg} radius=${r.radius} pad=${r.padding} gap=${r.gap}`);
    console.log(`      glyph ${r.glyphBox}  icon->label=${r.iconToLabel}px  label ${r.labelFont} ${r.labelColor}  ${r.cls}`);
  }
  await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: false }).catch(() => {});
  await b.disconnect();
})();
