/* How Flow marks the selected rail tab: it is not a background on the button itself. */
const p = require('puppeteer-core');

(async () => {
  const b = await p.connect({ browserURL: 'http://127.0.0.1:9222', defaultViewport: null });
  const t = b.targets().find((x) => x.type() === 'page' && x.url().includes('labs.google/fx/tools/flow'));
  const pg = await t.page();
  await pg.bringToFront();
  const cdp = await pg.createCDPSession();
  await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true }).catch(() => {});
  await new Promise((r) => setTimeout(r, 600));

  const out = await pg.evaluate(() => {
    const rail = Array.from(document.querySelectorAll('button')).filter((el) => {
      const r = el.getBoundingClientRect();
      return Math.abs(r.left - 20) < 2 && r.width === 40 && r.top > 60;
    });
    return rail.map((el) => {
      const cs = getComputedStyle(el);
      /* Every descendant that paints something, plus the button's own pseudo-elements. */
      const painted = Array.from(el.querySelectorAll('*')).map((c) => {
        const ccs = getComputedStyle(c);
        return {
          tag: c.tagName.toLowerCase(),
          cls: (c.getAttribute('class') || '').slice(0, 50),
          bg: ccs.backgroundColor,
          opacity: ccs.opacity,
          w: Math.round(c.getBoundingClientRect().width),
          h: Math.round(c.getBoundingClientRect().height),
        };
      }).filter((c) => c.bg !== 'rgba(0, 0, 0, 0)');
      const pseudo = ['::before', '::after'].map((ps) => {
        const pcs = getComputedStyle(el, ps);
        return pcs.content && pcs.content !== 'none'
          ? { ps, content: pcs.content, bg: pcs.backgroundColor, w: pcs.width, h: pcs.height }
          : null;
      }).filter(Boolean);
      return {
        text: (el.textContent || '').trim().slice(0, 28),
        y: Math.round(el.getBoundingClientRect().top),
        ownBg: cs.backgroundColor,
        color: cs.color,
        ariaCurrent: el.getAttribute('aria-current'),
        dataState: el.getAttribute('data-state') || el.getAttribute('data-selected') || el.getAttribute('data-active'),
        cls: (el.getAttribute('class') || '').slice(0, 70),
        paintedChildren: painted,
        pseudo,
      };
    });
  });

  for (const r of out) {
    console.log(`\n"${r.text}" y=${r.y}`);
    console.log(`   ownBg=${r.ownBg} color=${r.color} aria-current=${r.ariaCurrent} state=${r.dataState}`);
    console.log(`   class=${r.cls}`);
    for (const c of r.paintedChildren) console.log(`   painted child <${c.tag}> ${c.w}x${c.h} bg=${c.bg} opacity=${c.opacity}  ${c.cls}`);
    for (const ps of r.pseudo) console.log(`   ${ps.ps} content=${ps.content} bg=${ps.bg} ${ps.w}x${ps.h}`);
  }
  await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: false }).catch(() => {});
  await b.disconnect();
})();
