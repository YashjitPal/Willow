/**
 * Read-only probe of the zero-state glow behind the prompt box, on Gemini or Willow.
 * Prints every glow host's box with its own, ::before and ::after computed styles, and
 * every authored rule and keyframe whose selector or name mentions the glow, with the
 * @media it sits in. Nothing is clicked or typed.
 *
 *   node tools/scratch/gemini-glow-probe.cjs gemini|willow [label] [--goto=/path] [--wait=ms]
 *
 * `willow` is the :3000 tab that is not the user's /media one; --goto only applies to it.
 */
const fs = require('fs');
const path = require('path');
const { session } = require('../../.agents/skills/clone-google-app-ui/scripts/cdp-kit.cjs');

(async () => {
  const args = process.argv.slice(2);
  const flag = (name) => (args.find((a) => a.startsWith(`--${name}=`)) || '').split('=').slice(1).join('=') || null;
  const [tab = 'gemini', label = 'rest'] = args.filter((a) => !a.startsWith('--'));
  const out = path.join('tools/ui-research/captures', tab === 'gemini' ? 'gemini' : 'willow', 'home-glow');
  const target = tab === 'willow' ? (u) => u.startsWith('http://localhost:3000') && !u.includes('/media') : tab;
  const s = await session({ tab: target, out, front: true });
  try {
    if (tab === 'willow' && flag('goto')) await s.goto(`http://localhost:3000${flag('goto')}`);
    await s.sleep(Number(flag('wait') || 600));
    const res = await s.eval(() => {
      const pick = (cs) => ({
        content: cs.content, display: cs.display, position: cs.position, inset: [cs.top, cs.right, cs.bottom, cs.left].join(' '),
        width: cs.width, height: cs.height, maxWidth: cs.maxWidth, maxHeight: cs.maxHeight, aspectRatio: cs.aspectRatio,
        margin: cs.margin, transform: cs.transform, transformOrigin: cs.transformOrigin, rotate: cs.rotate, scale: cs.scale, translate: cs.translate,
        backgroundImage: cs.backgroundImage, backgroundColor: cs.backgroundColor, backgroundSize: cs.backgroundSize, backgroundPosition: cs.backgroundPosition,
        filter: cs.filter, opacity: cs.opacity, mixBlendMode: cs.mixBlendMode, borderRadius: cs.borderRadius, zIndex: cs.zIndex, overflow: cs.overflow,
        maskImage: cs.maskImage || cs.webkitMaskImage, maskSize: cs.maskSize || cs.webkitMaskSize, maskPosition: cs.maskPosition || cs.webkitMaskPosition,
        maskRepeat: cs.maskRepeat || cs.webkitMaskRepeat,
        animation: [cs.animationName, cs.animationDuration, cs.animationTimingFunction, cs.animationDelay, cs.animationFillMode].join(' | '),
        transition: cs.transition, pointerEvents: cs.pointerEvents,
      });
      const hosts = [];
      const seen = new Set();
      for (const el of document.querySelectorAll('[class*="lm-background"], [class*="glow"], [class*="lm-glow"], [class*="zero-state"], [class*="background-gradient"]')) {
        if (seen.has(el)) continue;
        seen.add(el);
        const r = el.getBoundingClientRect();
        const cls = typeof el.className === 'string' ? el.className : el.getAttribute('class');
        hosts.push({
          tag: el.tagName.toLowerCase(), cls, rect: [r.x, r.y, r.width, r.height].map((n) => Math.round(n * 10) / 10),
          self: pick(getComputedStyle(el)), before: pick(getComputedStyle(el, '::before')), after: pick(getComputedStyle(el, '::after')),
        });
      }
      const rules = [];
      const keyframes = [];
      const walk = (list, media) => {
        for (const rule of list) {
          if (rule.type === CSSRule.KEYFRAMES_RULE) {
            if (/lm|glow|bloom|background/i.test(rule.name)) keyframes.push(rule.cssText);
            continue;
          }
          const innerMedia = rule.media ? `${media ? `${media} & ` : ''}${rule.media.mediaText}` : media;
          if (rule.selectorText && /lm-background|glow|lm-glow|bloom/i.test(rule.selectorText)) rules.push({ media: innerMedia, css: rule.cssText });
          if (rule.cssRules && rule.cssRules.length) walk(rule.cssRules, innerMedia);
        }
      };
      for (const sheet of document.styleSheets) {
        try { walk(sheet.cssRules, ''); } catch {}
      }
      const theme = [...document.querySelectorAll('html, body, [class*="theme"]')].slice(0, 6).map((e) => `${e.tagName.toLowerCase()}.${typeof e.className === 'string' ? e.className.trim().split(/\s+/).slice(0, 8).join('.') : ''}`);
      return { url: location.pathname, viewport: [innerWidth, innerHeight, devicePixelRatio], theme, hosts, rules, keyframes };
    });
    fs.mkdirSync(out, { recursive: true });
    fs.writeFileSync(path.join(out, `probe-${label}.json`), JSON.stringify(res, null, 1));
    console.log(`url ${res.url} viewport ${res.viewport.join('x')}`);
    console.log('theme hosts:', res.theme.join(' | '));
    for (const h of res.hosts) {
      console.log(`\n${h.tag}.${(h.cls || '').trim().replace(/\s+/g, '.')} [${h.rect.join(', ')}]`);
      for (const part of ['self', 'before', 'after']) {
        const st = h[part];
        if (part !== 'self' && (st.content === 'none' || st.content === 'normal')) continue;
        const interesting = Object.entries(st).filter(([k, v]) => v && !['none', 'auto', 'normal', '0px', 'visible', 'static', 'rgba(0, 0, 0, 0)', 'auto auto auto auto', '1', ' |  |  |  | ', 'none | 0s | ease | 0s | none'].includes(v));
        console.log(`  ${part}: ${interesting.map(([k, v]) => `${k}=${v}`).join('; ')}`);
      }
    }
    console.log(`\n${res.rules.length} rules:`);
    for (const r of res.rules) console.log(`  [${r.media || 'all'}] ${r.css}`);
    console.log(`\n${res.keyframes.length} keyframes:`);
    for (const k of res.keyframes) console.log(`  ${k}`);
    await s.shot(`glow-${label}`);
  } finally {
    await s.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });
