/**
 * Read-only: where Gemini declares the glow tokens (--bard-color-lm-glow-*, the surface and
 * outline-variant it pairs them with), per selector and @media, so the light-theme values
 * can be read without switching the account's theme. Also fetches Gemini's glow_mask.svg
 * and compares it with Willow's apps/studio/public/glow-mask.svg.
 *
 *   node tools/scratch/gemini-glow-tokens.cjs
 */
const fs = require('fs');
const path = require('path');
const { session } = require('../../.agents/skills/clone-google-app-ui/scripts/cdp-kit.cjs');

(async () => {
  const s = await session({ tab: 'gemini', out: 'tools/ui-research/captures/gemini/home-glow' });
  try {
    const res = await s.eval(async () => {
      const names = /--bard-color-lm-glow|--gem-sys-color--outline-variant$|--lumi-sys-color--surface$|--gem-sys-motion--easing-standard$/;
      const found = [];
      const walk = (list, media) => {
        for (const rule of list) {
          const innerMedia = rule.media ? `${media ? `${media} & ` : ''}${rule.media.mediaText}` : media;
          if (rule.style) {
            for (let i = 0; i < rule.style.length; i += 1) {
              const prop = rule.style[i];
              if (prop.startsWith('--') && names.test(prop)) {
                found.push({ media: innerMedia, selector: rule.selectorText, prop, value: rule.style.getPropertyValue(prop).trim() });
              }
            }
          }
          if (rule.cssRules && rule.cssRules.length) walk(rule.cssRules, innerMedia);
        }
      };
      for (const sheet of document.styleSheets) {
        try { walk(sheet.cssRules, ''); } catch {}
      }
      const resolved = {};
      const body = getComputedStyle(document.body);
      for (const n of ['--bard-color-lm-glow-chat', '--bard-color-lm-glow-bloom', '--gem-sys-color--outline-variant', '--lumi-sys-color--surface']) {
        resolved[n] = body.getPropertyValue(n).trim();
      }
      const mask = await (await fetch('https://www.gstatic.com/gemini/spark/glow_mask.svg')).text();
      return { found, resolved, mask };
    });
    const local = fs.readFileSync(path.join('apps', 'studio', 'public', 'glow-mask.svg'), 'utf8');
    console.log('resolved on body:', JSON.stringify(res.resolved));
    const seen = new Set();
    for (const f of res.found) {
      const key = `${f.media}|${f.selector}|${f.prop}|${f.value}`;
      if (seen.has(key)) continue;
      seen.add(key);
      console.log(`[${f.media || 'all'}] ${f.selector.slice(0, 140)}  ${f.prop}: ${f.value}`);
    }
    console.log(`\nmask: gemini ${res.mask.length} chars, willow ${local.length} chars, identical: ${res.mask.trim() === local.trim()}`);
    fs.writeFileSync(path.join('tools/ui-research/captures/gemini/home-glow', 'glow_mask.svg'), res.mask);
  } finally {
    await s.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });
