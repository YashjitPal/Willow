/**
 * Willow: samples the Thinking steps harness panel (think-panel-mount.cjs, mounted) every
 * frame while it closes and then reopens, printing box, opacity and the right margin.
 * Pairs with thinking-anim.cjs, which records Gemini's.
 */
const puppeteer = require('puppeteer-core');

(async () => {
  const browser = await puppeteer.connect({ browserURL: 'http://[::1]:9222', defaultViewport: null });
  const page = (await browser.pages()).find((p) => p.url().startsWith('http://localhost:3000') && !p.url().includes('/media'));
  await page.bringToFront();
  const dense = process.argv.includes('--dense');
  const run = (action) => page.evaluate(async (which, everyFrame) => {
    const samples = [];
    const t0 = performance.now();
    await new Promise((resolve) => {
      const step = () => {
        const t = Math.round(performance.now() - t0);
        const panel = document.querySelector('aside[aria-label="Thinking steps"]');
        if (panel) {
          const b = panel.getBoundingClientRect();
          const cs = getComputedStyle(panel);
          samples.push(everyFrame
            ? `${t}:${Number(cs.opacity).toFixed(2)}/${panel.style.opacity || '-'}`
            : `${t}ms box [${[b.x, b.y, b.width, b.height].map((n) => Math.round(n))}] opacity ${Number(cs.opacity).toFixed(3)} margin-right ${cs.marginRight}`);
        } else {
          samples.push(everyFrame ? `${t}:gone` : `${t}ms gone`);
        }
        if (t < 600) requestAnimationFrame(step); else resolve();
      };
      requestAnimationFrame(step);
      window.__thinkHarness[which]();
    });
    return everyFrame ? samples.join(' ') : samples.filter((_, i) => i % 3 === 0).join('\n');
  }, action, dense);
  console.log('CLOSE');
  console.log(await run('close'));
  console.log('OPEN');
  console.log(await run('open'));
  browser.disconnect();
})();
