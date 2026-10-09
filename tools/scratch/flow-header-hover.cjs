// One-off: Flow's header icon button hovered — the state layer (persistent ripple ::before).
const { session } = require('../../.agents/skills/clone-google-app-ui/scripts/cdp-kit.cjs');

(async () => {
  const s = await session({ tab: 'flow', out: 'tools/ui-research/captures/flow/media/collections' });
  await s.hover('button', /^Product help/);
  await s.sleep(700);
  const out = await s.eval(() => {
    const b = [...document.querySelectorAll('button')].find((x) => /^Product help/.test(x.getAttribute('aria-label') || ''));
    const ripple = b.querySelector('.mat-mdc-button-persistent-ripple');
    const before = getComputedStyle(ripple, '::before');
    const cs = getComputedStyle(b);
    return {
      button: { bg: cs.backgroundColor, radius: cs.borderRadius, transition: cs.transition.slice(0, 120) },
      stateLayer: { bg: before.backgroundColor, opacity: before.opacity, radius: before.borderRadius, transition: before.transition.slice(0, 120), inset: [before.top, before.left, before.right, before.bottom].join(' ') },
    };
  });
  console.log(JSON.stringify(out, null, 1));
  const r = await s.eval(() => { const b = [...document.querySelectorAll('button')].find((x) => /^Product help/.test(x.getAttribute('aria-label') || '')).getBoundingClientRect(); return { x: b.x - 10, y: b.y - 10, width: b.width + 20, height: b.height + 20 }; });
  await s.shotRect('header-button-hover', r);
  await s.moveTo(900, 400, 3);
  await s.close();
})().catch((e) => { console.error(e); process.exit(1); });
