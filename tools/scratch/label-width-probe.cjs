const puppeteer = require('puppeteer-core');
(async () => {
  const browser = await puppeteer.connect({ browserURL: 'http://[::1]:9222', defaultViewport: null });
  const page = (await browser.pages()).find((p) => p.url().startsWith('http://localhost:3000') && !p.url().includes('/media'));
  const out = await page.evaluate(async () => {
    await document.fonts.ready;
    const variants = [
      ['default', ''],
      ['ls .25px', 'letter-spacing:.25px;'],
      ['ls .1px', 'letter-spacing:.1px;'],
      ['wdth100 wght500', 'font-variation-settings:"wdth" 100, "wght" 500;'],
      ['GoogleSansText', 'font-family:"Google Sans Text";'],
      ['GoogleSans', 'font-family:"Google Sans";'],
      ['opsz14', 'font-variation-settings:"opsz" 14, "wght" 500;'],
      ['ROND0 slnt0 wdth100 wght500', 'font-variation-settings:"ROND" 0, "slnt" 0, "wdth" 100, "wght" 500;'],
    ];
    return variants.map(([label, extra]) => {
      const span = document.createElement('span');
      span.textContent = 'Take over task';
      span.style.cssText = `position:fixed;left:-9999px;top:0;white-space:nowrap;font-family:"Google Sans Flex","Google Sans Text","Google Sans",sans-serif;font-size:14px;font-weight:500;${extra}`;
      document.body.appendChild(span);
      const w = span.getBoundingClientRect().width;
      span.remove();
      return `${label}: ${w.toFixed(2)}`;
    });
  });
  console.log(out.join('\n'));
  browser.disconnect();
})();
