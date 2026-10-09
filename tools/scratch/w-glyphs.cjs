// Measures icon ligatures in MY Willow tab's loaded faces: one glyph (<= 26px at 20px) means present.
//   node tools/scratch/w-glyphs.cjs name1,name2,...   [--shot=file.png]
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');

const names = (process.argv[2] || 'side_nav,side_nav_expand').split(',');
const shot = (process.argv.find((a) => a.startsWith('--shot=')) || '').split('=')[1];

(async () => {
  const id = fs.readFileSync(path.join(__dirname, '../ui-research/scrapers/gemini/media-tools-2026/.w-media-tab'), 'utf8').trim();
  const browser = await puppeteer.connect({ browserURL: 'http://[::1]:9222', defaultViewport: null });
  try {
    const target = browser.targets().find((t) => t.type() === 'page' && (t._targetId || t._getTargetInfo().targetId) === id);
    if (!target) throw new Error('my Willow tab is gone');
    const page = await target.page();
    await page.bringToFront();
    const result = await page.evaluate(async (list) => {
      await document.fonts.ready;
      const out = { url: location.href };
      for (const family of ['Luminous Symbols', 'Google Symbols']) {
        try { await document.fonts.load(`400 20px "${family}"`, list.join(' ')); } catch { /* not loaded */ }
        const el = document.createElement('span');
        el.style.cssText = `position:absolute;left:-9999px;font-size:20px;line-height:1;white-space:nowrap;font-feature-settings:"liga";font-family:"${family}"`;
        document.body.appendChild(el);
        out[family] = Object.fromEntries(list.map((n) => { el.textContent = n; return [n, Math.round(el.getBoundingClientRect().width)]; }));
        el.remove();
      }
      const toggle = [...document.querySelectorAll('.luminous-symbols')].find((e) => /^side_nav/.test(e.textContent.trim()));
      out.sidebarToggle = toggle ? { text: toggle.textContent.trim(), width: Math.round(toggle.getBoundingClientRect().width) } : null;
      return out;
    }, names);
    console.log(JSON.stringify(result, null, 1));
    if (shot) {
      await page.screenshot({ path: shot, clip: { x: 0, y: 0, width: 420, height: 120 } });
      console.log('saved', shot);
    }
  } finally { browser.disconnect(); }
})().catch((e) => { console.error(e.message); process.exit(1); });
