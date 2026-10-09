/**
 * Reopening Code chats, in a browser context of its own (own storage, no folder, none
 * of the other tabs). A made-up key lets Code send; model requests never leave this
 * machine: the one for chat A is held open, so A keeps running, and the one for B is
 * refused, so B has ended.
 *
 *   node tools/scratch/code-recents-open.cjs
 *
 * Recents needs a connected folder, so a Recents click is the call it makes for a
 * Code chat (`requestCodeChatOpen`), after checking the chat carries the marker.
 */
const puppeteer = require('puppeteer-core');

const BASE = 'http://localhost:3000';
const SCOPE = 'signed-out::browser';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const callModule = (page, suffix, body, ...args) => page.evaluate(async (part, source, rest) => {
  const url = performance.getEntriesByType('resource').map((entry) => entry.name).reverse()
    .find((entry) => entry.split('?')[0].endsWith(part));
  if (!url) return `module ${part} not loaded`;
  // eslint-disable-next-line no-new-func
  return new Function('mod', 'args', source)(await import(url), rest);
}, suffix, body, args);

const markers = (page) => page.evaluate((scope) => {
  const prefix = `willow_code_chat_state:v2:${encodeURIComponent(scope)}:`;
  return Object.keys(localStorage).filter((key) => key.startsWith(prefix) && JSON.parse(localStorage.getItem(key) || '{}').present)
    .map((key) => decodeURIComponent(key.slice(prefix.length)));
}, SCOPE);

const state = async (page) => ({
  ...(await page.evaluate(() => {
    const visible = (el) => el.getBoundingClientRect().width > 0 && !el.closest('[inert]');
    const shownText = [...document.querySelectorAll('textarea, p, div')].filter(visible).map((el) => el.textContent || '').join(' ');
    const probe = document.querySelector('[data-recents-probe="A"]');
    return {
      chatOnShow: [...document.querySelectorAll('textarea.willow-dictation-textarea')].some(visible),
      landingOnShow: /Let's build some apps/.test(shownText),
      alphaOnShow: shownText.includes('ALPHA'),
      bravoOnShow: shownText.includes('BRAVO'),
      codeHomeA: probe ? (probe.closest('[inert]') ? 'mounted, hidden' : 'on show') : 'gone',
    };
  })),
  running: await callModule(page, '/code-turn-activity.ts', 'return mod.$runningCodeScreens.get();'),
  chats: await callModule(page, '/code-turn-activity.ts', 'return mod.$codeScreenChats.get();'),
});

const clickSidebar = (page, label) => page.evaluate((text) => {
  const row = [...document.querySelectorAll('.sidebar-item-row')]
    .find((el) => el.getBoundingClientRect().width > 0 && !el.closest('[inert]') && el.querySelector('.sidebar-item-label')?.textContent.trim() === text);
  row?.click();
  return Boolean(row);
}, label);

const send = async (page, text) => {
  await page.evaluate(() => {
    const area = [...document.querySelectorAll('textarea')].find((el) => el.getBoundingClientRect().width > 0 && !el.closest('[inert]'));
    area?.focus();
  });
  await page.keyboard.type(text, { delay: 4 });
  await page.keyboard.press('Enter');
};

const open = (page, chatId) => callModule(page, '/code-chat-open-store.ts', 'mod.requestCodeChatOpen(args[0]); return true;', chatId);

(async () => {
  const browser = await puppeteer.connect({ browserURL: process.env.CDP_URL || 'http://[::1]:9222', defaultViewport: null });
  const context = await browser.createBrowserContext();
  try {
    const page = await context.newPage();
    await page.evaluateOnNewDocument(() => {
      performance.setResourceTimingBufferSize(20000);
      if (location.origin === 'http://localhost:3000' && !localStorage.getItem('willow:apiKeys:guest')) {
        localStorage.setItem('willow:apiKeys:guest', JSON.stringify({ gemini: ['zz-not-a-real-key'], openai: [], anthropic: [] }));
      }
    });
    await page.setRequestInterception(true);
    // Refused while B is sent, so B ends; held from A on, so A's turn waits for ever.
    let holdModelRequests = false;
    page.on('request', (request) => {
      if (!/generativelanguage\.googleapis\.com|aiplatform\.googleapis\.com/.test(request.url())) {
        void request.continue();
        return;
      }
      if (holdModelRequests) return;
      void request.abort('failed');
    });
    page.on('pageerror', (error) => console.log(`  [pageerror] ${error.message.slice(0, 160)}`));
    await page.bringToFront();
    await page.goto(`${BASE}/?mode=develop`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('textarea', { visible: true, timeout: 90_000 });
    await sleep(5000);

    console.log('1. chat B, which ends');
    await send(page, 'BRAVO build a counter');
    await sleep(7000);
    const chatB = (await markers(page))[0];
    console.log('   B:', chatB, JSON.stringify(await state(page)));

    console.log('2. New chat, then Code: a fresh Code home');
    await clickSidebar(page, 'New chat');
    await sleep(2500);
    await clickSidebar(page, 'Code');
    await sleep(3500);
    console.log('  ', JSON.stringify(await state(page)));

    console.log('3. chat A, still running');
    holdModelRequests = true;
    await send(page, 'ALPHA build a pomodoro timer');
    await sleep(7000);
    const chatA = (await markers(page)).find((id) => id !== chatB);
    await page.evaluate(() => {
      const area = [...document.querySelectorAll('textarea')].find((el) => el.getBoundingClientRect().width > 0 && !el.closest('[inert]'));
      area?.parentElement?.setAttribute('data-recents-probe', 'A');
    });
    console.log('   A:', chatA, JSON.stringify(await state(page)));

    console.log('4. New chat while A runs: Chat, and A carries on');
    await clickSidebar(page, 'New chat');
    await sleep(3000);
    console.log('  ', JSON.stringify(await state(page)));

    console.log('5. reopen A: the same Code home, still running');
    await open(page, chatA);
    await sleep(3500);
    console.log('  ', JSON.stringify(await state(page)));

    console.log('6. New chat, then open B while A runs: B beside it');
    await clickSidebar(page, 'New chat');
    await sleep(2500);
    await open(page, chatB);
    await sleep(5000);
    console.log('  ', JSON.stringify(await state(page)));

    console.log('7. reopen A: back to it, and the finished B goes');
    await open(page, chatA);
    await sleep(5000);
    console.log('  ', JSON.stringify(await state(page)));
  } finally {
    await context.close();
    browser.disconnect();
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
