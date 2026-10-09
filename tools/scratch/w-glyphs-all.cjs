// Reloads MY Willow tab, then checks every icon name in the saved kit lists renders as ONE glyph
// in the live faces (<= 26px wide at 20px). Prints any that do not.
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');

const read = (f) => fs.readFileSync(path.join(__dirname, f), 'utf8').split('\n').filter(Boolean);
const LISTS = {
  'Luminous Symbols': [...read('luminous-kit-names.txt'), 'download'],
  'Google Symbols': [...read('google-kit-names.txt'), 'chat_spark_2', 'record_voice_over', 'voice_over_off',
    'check_box_outline_blank', 'add_circle_outline', 'encryption_shield', 'selection_controls', 'control_point', 'desktop_windows',
    'add_circle', 'circles_add', 'check_box', 'drive_search', 'help_guide', 'open_in_new', 'touch_app', 'buttons', 'launch', 'shield'],
};

(async () => {
  const id = fs.readFileSync(path.join(__dirname, '../ui-research/scrapers/gemini/media-tools-2026/.w-media-tab'), 'utf8').trim();
  const browser = await puppeteer.connect({ browserURL: 'http://[::1]:9222', defaultViewport: null });
  try {
    const target = browser.targets().find((t) => t.type() === 'page' && (t._targetId || t._getTargetInfo().targetId) === id);
    if (!target) throw new Error('my Willow tab is gone');
    const page = await target.page();
    await page.bringToFront();
    await page.reload({ waitUntil: 'domcontentloaded' });
    await new Promise((r) => setTimeout(r, 8000));
    const result = await page.evaluate(async (lists) => {
      await document.fonts.ready;
      const out = {};
      for (const [family, names] of Object.entries(lists)) {
        await document.fonts.load(`400 20px "${family}"`, names.join(' '));
        const el = document.createElement('span');
        el.style.cssText = `position:absolute;left:-9999px;font-size:20px;line-height:1;white-space:nowrap;font-feature-settings:"liga";font-family:"${family}"`;
        document.body.appendChild(el);
        const bad = names.filter((n) => { el.textContent = n; return el.getBoundingClientRect().width > 26; });
        el.remove();
        out[family] = { checked: names.length, notGlyphs: bad };
      }
      const toggle = [...document.querySelectorAll('.luminous-symbols')].find((e) => /^side_nav/.test(e.textContent.trim()));
      out.sidebarToggle = toggle ? `${toggle.textContent.trim()} ${Math.round(toggle.getBoundingClientRect().width)}px` : 'not on screen';
      out.url = location.href;
      return out;
    }, LISTS);
    console.log(JSON.stringify(result, null, 1));
  } finally { browser.disconnect(); }
})().catch((e) => { console.error(e.message); process.exit(1); });
