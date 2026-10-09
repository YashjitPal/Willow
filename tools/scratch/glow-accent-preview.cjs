/**
 * Willow (never the media tab): paints the home glow with a given accent, in page memory
 * only (the custom properties on the glow host; React restores them on its next render, and
 * nothing is saved), then screenshots the screen. `reset` drops the override.
 *
 *   node tools/scratch/glow-accent-preview.cjs "rgb(0, 140, 103)" <label>
 *   node tools/scratch/glow-accent-preview.cjs reset
 */
const path = require('path');
const { session } = require('../../.agents/skills/clone-google-app-ui/scripts/cdp-kit.cjs');

(async () => {
  const [accent = 'reset', label = 'preview'] = process.argv.slice(2);
  const s = await session({
    tab: (u) => u.startsWith('http://localhost:3000') && !u.includes('/media'),
    out: path.join('tools/ui-research/captures/willow/home-glow'),
    front: true,
  });
  try {
    const applied = await s.eval((value) => {
      const host = document.querySelector('.willow-gemini-home-glow');
      if (!host) return 'no glow host';
      if (value === 'reset') {
        host.style.removeProperty('--willow-home-glow-desktop-accent');
        return 'reset';
      }
      host.style.setProperty('--willow-home-glow-desktop-accent', value);
      host.style.setProperty('--willow-home-glow-mobile-accent', value);
      return getComputedStyle(host.querySelector('.willow-home-glow-layer'), '::before').backgroundColor;
    }, accent);
    console.log(`accent: ${applied}`);
    if (accent !== 'reset') {
      await s.sleep(400);
      await s.shot(`accent-${label}`);
    }
  } finally {
    await s.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });
