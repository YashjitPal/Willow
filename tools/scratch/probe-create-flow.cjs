/** What the notebooks list and create surface offer, in a window of our own. */
const { connect, openOwnWindow, sleep } = require('../ui-research/scrapers/notebooks/lib.cjs');

(async () => {
  const browser = await connect();
  let page = null;
  try {
    page = await openOwnWindow(browser, 'http://localhost:3000/notebooks/view');
    await sleep(5000);
    console.log(JSON.stringify(await page.evaluate(() => ({
      url: location.href,
      buttons: Array.from(document.querySelectorAll('button')).map((b) => (b.textContent || '').trim().slice(0, 40)).filter(Boolean).slice(0, 40),
      nbClasses: Array.from(new Set(Array.from(document.querySelectorAll('[class*="nb-"]')).map((e) => e.className.toString().split(/\s+/)[0]))).slice(0, 40),
      bodyStart: document.body.innerText.slice(0, 200),
    })), null, 2));

    // The "New notebook" entry, then whatever the create surface shows.
    await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('button, a')).find((b) => /new notebook/i.test(b.textContent || ''));
      if (btn) btn.click();
    });
    await sleep(2500);
    console.log(JSON.stringify(await page.evaluate(() => ({
      url: location.href,
      inputs: Array.from(document.querySelectorAll('input, textarea')).map((i) => ({ type: i.type, placeholder: i.placeholder, cls: i.className.toString().slice(0, 60) })),
      buttons: Array.from(document.querySelectorAll('button')).map((b) => ({ text: (b.textContent || '').trim().slice(0, 30), aria: b.getAttribute('aria-label') })).slice(0, 25),
      bodyStart: document.body.innerText.slice(0, 300),
    })), null, 2));
  } finally {
    if (page) await page.close();
    await browser.disconnect();
  }
})();
