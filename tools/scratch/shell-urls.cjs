/**
 * Every main-shell surface has an address: walks Chat, Code, the Media home and Spark
 * with the sidebar, Back and Forward, and reloads, in a browser context of its own
 * (own storage, no folder, none of the other tabs). Model requests are refused here,
 * so a Code chat is made without leaving the machine.
 *
 *   node tools/scratch/shell-urls.cjs
 */
const puppeteer = require('puppeteer-core');

const BASE = 'http://localhost:3000';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const where = (page) => page.evaluate(() => {
  const visible = (el) => el.getBoundingClientRect().width > 0 && !el.closest('[inert]');
  const text = (document.querySelector('main') || document.body).innerText;
  return {
    url: decodeURIComponent(location.pathname) + location.search,
    on: [...document.querySelectorAll('.spark-top-controls, .spark-all-tasks')].some(visible) ? 'Spark'
      : [...document.querySelectorAll('textarea.willow-dictation-textarea')].some(visible) ? 'Chat'
        : /Let's build some apps/.test(text) ? 'Code home'
          : [...document.querySelectorAll('textarea')].some((el) => visible(el) && el.closest('.code-composer, [class*="code"]')) ? 'Code chat'
            : 'other',
  };
});

const clickSidebar = (page, label) => page.evaluate((text) => {
  const row = [...document.querySelectorAll('.sidebar-item-row, button')]
    .find((el) => el.getBoundingClientRect().width > 0 && !el.closest('[inert]')
      && ((el.querySelector('.sidebar-item-label')?.textContent.trim() ?? el.textContent.trim()) === text));
  row?.click();
  return Boolean(row);
}, label);

const step = async (page, label, action, wait = 2500) => {
  const done = await action();
  await sleep(wait);
  console.log(`${label}${done === false ? ' (no control found)' : ''}:`, JSON.stringify(await where(page)));
};

(async () => {
  const browser = await puppeteer.connect({ browserURL: process.env.CDP_URL || 'http://[::1]:9222', defaultViewport: null });
  const context = await browser.createBrowserContext();
  try {
    const page = await context.newPage();
    await page.evaluateOnNewDocument(() => {
      if (location.origin === 'http://localhost:3000' && !localStorage.getItem('willow:apiKeys:guest')) {
        localStorage.setItem('willow:apiKeys:guest', JSON.stringify({ gemini: ['zz-not-a-real-key'], openai: [], anthropic: [] }));
      }
    });
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      if (/generativelanguage\.googleapis\.com|aiplatform\.googleapis\.com/.test(request.url())) void request.abort('failed');
      else void request.continue();
    });
    page.on('pageerror', (error) => console.log(`  [pageerror] ${error.message.slice(0, 160)}`));
    await page.bringToFront();

    await step(page, '1. open /', () => page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' }), 7000);
    await step(page, '2. Code', () => clickSidebar(page, 'Code'), 4000);
    await step(page, '3. Back', () => page.goBack({ waitUntil: 'domcontentloaded' }).then(() => true), 3000);
    await step(page, '4. Forward', () => page.goForward({ waitUntil: 'domcontentloaded' }).then(() => true), 3500);
    await step(page, '5. a Code chat', async () => {
      await page.evaluate(() => [...document.querySelectorAll('textarea')].find((el) => el.getBoundingClientRect().width > 0 && !el.closest('[inert]'))?.focus());
      await page.keyboard.type('Build a tip calculator', { delay: 4 });
      await page.keyboard.press('Enter');
    }, 7000);
    const codeChatUrl = (await where(page)).url;
    await step(page, '6. Media', () => clickSidebar(page, 'Media'), 3500);
    await step(page, '7. Spark', () => page.evaluate(() => {
      const tab = [...document.querySelectorAll('button[aria-pressed]')]
        .find((el) => el.getBoundingClientRect().width > 0 && /^Spark/.test(el.textContent.trim()));
      tab?.click();
      return Boolean(tab);
    }), 5000);
    await step(page, '8. Spark: Tasks', () => clickSidebar(page, 'Tasks'), 3000);
    await step(page, '9. Back', () => page.goBack({ waitUntil: 'domcontentloaded' }).then(() => true), 2500);
    await step(page, '10. Back', () => page.goBack({ waitUntil: 'domcontentloaded' }).then(() => true), 3000);
    await step(page, '11. Back', () => page.goBack({ waitUntil: 'domcontentloaded' }).then(() => true), 4000);
    await step(page, '11b. Back', () => page.goBack({ waitUntil: 'domcontentloaded' }).then(() => true), 4000);
    await step(page, `12. open ${codeChatUrl} in a fresh load`, () => page.goto(`${BASE}${encodeURI(codeChatUrl)}`, { waitUntil: 'domcontentloaded' }).then(() => true), 9000);
    await step(page, '12b. reload it', () => page.reload({ waitUntil: 'domcontentloaded' }).then(() => true), 9000);
    await step(page, '13. open /create', () => page.goto(`${BASE}/create`, { waitUntil: 'domcontentloaded' }).then(() => true), 7000);
    await step(page, '14. open /spark/tasks', () => page.goto(`${BASE}/spark/tasks`, { waitUntil: 'domcontentloaded' }).then(() => true), 7000);
    await step(page, '15. open /app/a chat that is not there', () => page.goto(`${BASE}/app/Not%20here`, { waitUntil: 'domcontentloaded' }).then(() => true), 7000);
    await step(page, '16. open /?mode=develop', () => page.goto(`${BASE}/?mode=develop`, { waitUntil: 'domcontentloaded' }).then(() => true), 7000);
    await step(page, '17. open /projects (Labs off)', () => page.goto(`${BASE}/projects`, { waitUntil: 'domcontentloaded' }).then(() => true), 7000);
    const dotted = await page.goto(`${BASE}/app/v2%2E0%20notes`, { waitUntil: 'domcontentloaded' });
    await sleep(6000);
    console.log('18. a dotted chat name loads the app:', dotted?.status(), JSON.stringify(await where(page)));
  } finally {
    await context.close();
    browser.disconnect();
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
