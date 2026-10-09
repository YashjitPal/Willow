/** Prints the element (and three ancestors) whose visible text is exactly the given label, in a fresh Willow tab. */
const puppeteer = require('puppeteer-core');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

(async () => {
  const label = process.argv[2] || 'New chat';
  const browser = await puppeteer.connect({ browserURL: 'http://[::1]:9222', defaultViewport: null });
  const page = await browser.newPage();
  await page.bringToFront();
  await page.goto('http://localhost:3000/', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('textarea.willow-dictation-textarea', { visible: true, timeout: 90_000 });
  await sleep(1500);
  console.log(JSON.stringify(await page.evaluate((text) => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const hits = [];
    while (walker.nextNode()) {
      if (walker.currentNode.textContent.trim() !== text) continue;
      let el = walker.currentNode.parentElement;
      const chain = [];
      for (let depth = 0; el && depth < 4; depth += 1, el = el.parentElement) {
        chain.push(`${el.tagName.toLowerCase()}${el.getAttribute('role') ? `[role=${el.getAttribute('role')}]` : ''}${el.getAttribute('aria-label') ? `[aria-label=${el.getAttribute('aria-label')}]` : ''}.${String(el.className).slice(0, 40)}`);
      }
      hits.push(chain);
    }
    return hits;
  }, label), null, 1));
  await page.close();
  browser.disconnect();
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
