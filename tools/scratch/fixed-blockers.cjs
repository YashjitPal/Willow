/**
 * Walks up from an element and reports every ancestor that would trap a `position: fixed`
 * descendant (transform, translate/scale/rotate, perspective, filter, backdrop-filter,
 * contain, will-change, container-type, content-visibility) or clip it (overflow).
 *
 *   node tools/scratch/fixed-blockers.cjs willow "<selector>"
 */
const puppeteer = require('puppeteer-core');

(async () => {
  const [which = 'willow', selector] = process.argv.slice(2);
  const browser = await puppeteer.connect({
    browserURL: process.env.SPARK_CDP_URL || 'http://[::1]:9222',
    defaultViewport: null,
    protocolTimeout: 30_000,
  });
  const prefix = which === 'gemini' ? 'https://gemini.google.com' : 'http://localhost:3000';
  const page = (await browser.pages()).find((p) => p.url().startsWith(prefix));
  const out = await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return `no ${sel}`;
    const lines = [];
    for (let n = el; n && n !== document.documentElement; n = n.parentElement) {
      const cs = getComputedStyle(n);
      const traps = [];
      if (cs.transform !== 'none') traps.push(`transform ${cs.transform}`);
      if (cs.translate !== 'none') traps.push(`translate ${cs.translate}`);
      if (cs.scale !== 'none') traps.push(`scale ${cs.scale}`);
      if (cs.rotate !== 'none') traps.push(`rotate ${cs.rotate}`);
      if (cs.perspective !== 'none') traps.push(`perspective ${cs.perspective}`);
      if (cs.filter !== 'none') traps.push(`filter ${cs.filter}`);
      if (cs.backdropFilter && cs.backdropFilter !== 'none') traps.push(`backdrop ${cs.backdropFilter}`);
      if (cs.contain !== 'none') traps.push(`contain ${cs.contain}`);
      if (cs.willChange !== 'auto') traps.push(`will-change ${cs.willChange}`);
      if (cs.containerType && cs.containerType !== 'normal') traps.push(`container ${cs.containerType}`);
      if (cs.contentVisibility && cs.contentVisibility !== 'visible') traps.push(`content-visibility ${cs.contentVisibility}`);
      const anim = cs.animationName !== 'none' ? ` anim ${cs.animationName}` : '';
      if (traps.length || anim) {
        lines.push(`<${n.tagName.toLowerCase()} class="${String(n.className).slice(0, 70)}"> ${traps.join(' | ')}${anim}`);
      }
    }
    return lines.join('\n') || '(no fixed-position traps)';
  }, selector);
  console.log(out);
  await browser.disconnect();
})().catch((e) => { console.error('FAILED', e.message); process.exit(1); });
