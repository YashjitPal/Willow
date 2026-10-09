const puppeteer = require('puppeteer-core');
(async () => {
  const browser = await puppeteer.connect({ browserURL: 'http://[::1]:9222', defaultViewport: null });
  const page = (await browser.pages()).find((p) => p.url().startsWith('http://localhost:3000') && !p.url().includes('/media'));
  const out = await page.evaluate(async () => {
    const probe = [['luminous-symbols', 'expand_more'], ['luminous-symbols', 'expand_less'], ['luminous-symbols', 'close'], ['google-symbols', 'monitor'], ['google-symbols', 'cloud'], ['google-symbols', 'chevron_left'], ['google-symbols', 'youtube_live'], ['google-symbols', 'web_traffic']];
    await document.fonts.ready;
    return probe.map(([cls, name]) => {
      const span = document.createElement('span');
      span.className = cls;
      span.textContent = name;
      span.style.cssText = 'position:fixed;left:-9999px;top:0;font-size:20px;white-space:nowrap;';
      document.body.appendChild(span);
      const w = span.getBoundingClientRect().width;
      span.remove();
      return `${cls} ${name}: ${w.toFixed(1)}px ${w < 30 ? 'ok' : 'MISSING'}`;
    });
  });
  console.log(out.join('\n'));
  browser.disconnect();
})();
