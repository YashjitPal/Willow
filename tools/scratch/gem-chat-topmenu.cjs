/** Gemini gem chat at narrow width: opens the top-bar three-dot menu, lists its rows, Escape. Never picks one. */
const puppeteer = require('puppeteer-core');

(async () => {
  const browser = await puppeteer.connect({ browserURL: 'http://[::1]:9222', defaultViewport: null, protocolTimeout: 60000 });
  const gemini = (await browser.pages()).find((p) => p.url().startsWith('https://gemini.google.com'));
  await gemini.bringToFront();
  const target = await gemini.evaluate(() => {
    const buttons = [...document.querySelectorAll('button')].filter((b) => {
      const r = b.getBoundingClientRect();
      return r.width > 0 && r.top < 70 && r.left > innerWidth - 60;
    });
    const b = buttons[0];
    if (!b) return null;
    const r = b.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2, label: b.getAttribute('aria-label'), box: [r.x, r.y, r.width, r.height].map((n) => Math.round(n * 10) / 10) };
  });
  if (!target) { console.log('no trigger'); browser.disconnect(); return; }
  console.log('trigger', target.label, target.box);
  await gemini.mouse.click(target.x, target.y);
  await new Promise((r) => setTimeout(r, 900));
  console.log(await gemini.evaluate(() => {
    const pane = [...document.querySelectorAll('.cdk-overlay-pane')].find((p) => p.getBoundingClientRect().width > 0);
    if (!pane) return 'no menu';
    const b = pane.getBoundingClientRect();
    const rows = [...pane.querySelectorAll('[role="menuitem"], button')].filter((r) => r.getBoundingClientRect().width > 0);
    return `pane [${[b.x, b.y, b.width, b.height].map((n) => Math.round(n * 10) / 10)}]\n${rows.map((r) => {
      const rb = r.getBoundingClientRect();
      const icon = r.querySelector('mat-icon');
      return `  [${[rb.x, rb.y, rb.width, rb.height].map((n) => Math.round(n * 10) / 10)}] ${icon?.getAttribute('fonticon') || icon?.textContent.trim() || ''} "${r.innerText.trim().replace(/\n/g, ' ')}" disabled=${r.disabled || r.getAttribute('aria-disabled')}`;
    }).join('\n')}`;
  }));
  await gemini.keyboard.press('Escape');
  await new Promise((r) => setTimeout(r, 400));
  browser.disconnect();
})();
