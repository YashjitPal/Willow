/**
 * Willow (never the media tab): flips the running app to light or back to what it was,
 * in memory only — sets theme-mode's atoms through the page's own module instance and
 * the root/body classes, and never writes `localStorage['willow_theme']`, so a reload
 * restores the user's choice regardless.
 *
 *   node tools/scratch/theme-flip.cjs light
 *   node tools/scratch/theme-flip.cjs restore
 */
const puppeteer = require('puppeteer-core');

(async () => {
  const mode = process.argv[2] || 'light';
  const browser = await puppeteer.connect({ browserURL: 'http://[::1]:9222', defaultViewport: null, protocolTimeout: 60000 });
  const page = (await browser.pages()).find((p) => p.url().startsWith('http://localhost:3000') && !p.url().includes('/media'));
  const result = await page.evaluate(async (want) => {
    const urls = performance.getEntriesByType('resource').map((e) => e.name).filter((n) => n.includes('/platform/core/src/theme-mode.ts'));
    const url = urls[urls.length - 1] || '/@fs/platform/core/src/theme-mode.ts';
    const mod = await import(/* @vite-ignore */ url);
    if (!window.__themeFlipOriginal) {
      window.__themeFlipOriginal = { choice: mod.$themeChoice.get(), resolved: mod.$resolvedTheme.get() };
    }
    const target = want === 'restore' ? window.__themeFlipOriginal : { choice: want, resolved: want };
    mod.$themeChoice.set(target.choice);
    mod.$resolvedTheme.set(target.resolved);
    for (const el of [document.documentElement, document.body]) {
      el.classList.toggle('light-theme', target.resolved === 'light');
      el.classList.toggle('dark-theme', target.resolved !== 'light');
      el.setAttribute('data-theme', target.resolved);
    }
    if (want === 'restore') delete window.__themeFlipOriginal;
    return `${want}: choice ${target.choice}, resolved ${target.resolved}; stored ${localStorage.getItem(mod.THEME_STORAGE_KEY)}`;
  }, mode);
  console.log(result);
  browser.disconnect();
})();
