/* Every computed difference between Flow's selected rail row and an unselected one. */
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
    const active = rail[0];
    const other = rail[1];
    const all = (el) => {
      const cs = getComputedStyle(el);
      const o = {};
      for (let i = 0; i < cs.length; i += 1) o[cs[i]] = cs.getPropertyValue(cs[i]);
      return o;
    };
    const a = all(active);
    const o = all(other);
    const diff = {};
    for (const k of Object.keys(a)) if (a[k] !== o[k]) diff[k] = { active: a[k], other: o[k] };

    /* The classes that differ, and the rules behind them. */
    const ca = new Set((active.getAttribute('class') || '').split(/\s+/));
    const co = new Set((other.getAttribute('class') || '').split(/\s+/));
    const only = [...ca].filter((c) => c && !co.has(c));
    const rules = [];
    for (const sheet of document.styleSheets) {
      let list; try { list = sheet.cssRules; } catch { continue; }
      if (!list) continue;
      for (const r of list) {
        if (r.selectorText && only.some((c) => r.selectorText.includes(c))) {
          rules.push(`${r.selectorText} { ${(r.style && r.style.cssText) || ''} }`);
        }
      }
    }
    /* And the same for the glyph inside each. */
    const ga = active.querySelector('i');
    const go = other.querySelector('i');
    const gdiff = {};
    if (ga && go) {
      const x = getComputedStyle(ga); const y = getComputedStyle(go);
      for (let i = 0; i < x.length; i += 1) {
        const k = x[i];
        if (x.getPropertyValue(k) !== y.getPropertyValue(k)) gdiff[k] = { active: x.getPropertyValue(k), other: y.getPropertyValue(k) };
      }
    }
    return { onlyClasses: only, rules, diff, gdiff };
  });

  console.log('classes only on the selected row:', out.onlyClasses.join(', '));
  console.log('\nrules for those classes:');
  for (const r of out.rules) console.log(`  ${r.replace(/\s+/g, ' ')}`);
  console.log('\nbutton computed differences:');
  for (const [k, v] of Object.entries(out.diff)) console.log(`  ${k.padEnd(28)} active=${v.active}   other=${v.other}`);
  console.log('\nglyph computed differences:');
  for (const [k, v] of Object.entries(out.gdiff)) console.log(`  ${k.padEnd(28)} active=${v.active}   other=${v.other}`);
  await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: false }).catch(() => {});
  await b.disconnect();
})();
