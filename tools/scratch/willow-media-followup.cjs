/**
 * A generated image and the follow-up that changes it, end to end in a browser context of its
 * own with Gemini's API answered here. "Draw a cat" gets a `generate_image` call and, after the
 * image, a sentence — which has to show under the image. "Make it cuter" gets a call with
 * `use_previous_image`, and the image model's request has to carry the first image; the chat
 * model's request has to say what it made before.
 *
 *   node tools/scratch/willow-media-followup.cjs [desktop|phone]
 */
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');

const BASE = process.env.WILLOW_URL || 'http://localhost:3000';
const SIZES = { desktop: { width: 1536, height: 826 }, phone: { width: 390, height: 844, mobile: true } };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const IMAGE_B64 = fs.readFileSync(path.resolve('tools/scratch/image_2ddbdb.jpg')).toString('base64');
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' };

const sse = (parts) => `data: ${JSON.stringify({ candidates: [{ content: { role: 'model', parts }, finishReason: 'STOP', index: 0 }] })}\r\n\r\n`;
const seen = [];

const answer = (url, raw) => {
  let body = null;
  try { body = JSON.parse(raw || 'null'); } catch { /* not JSON */ }
  if (/:generateContent/.test(url) && /"responseModalities":\["IMAGE"\]/.test(raw)) {
    const parts = body?.contents?.[0]?.parts ?? [];
    seen.push({ kind: 'image model', prompt: parts.find((p) => p.text)?.text, inputImages: parts.filter((p) => p.inlineData).length });
    return { type: 'application/json', body: JSON.stringify({ candidates: [{ content: { role: 'model', parts: [{ inlineData: { mimeType: 'image/jpeg', data: IMAGE_B64 } }] }, finishReason: 'STOP' }] }) };
  }
  if (/:streamGenerateContent/.test(url)) {
    const contents = body?.contents ?? [];
    const last = contents[contents.length - 1];
    const lastParts = last?.parts ?? [];
    const lastText = lastParts.map((p) => p.text || '').join(' ');
    const answered = lastParts.some((p) => p.functionResponse?.name === 'generate_image');
    const remembers = raw.includes('[You made an image here, from the prompt: A fluffy orange cat');
    if (answered && /draw a dog/i.test(JSON.stringify(contents.filter((c) => c.role === 'user').slice(-2)))) {
      seen.push({ kind: 'chat: after the dog' });
      return { type: 'text/event-stream', body: sse([{ text: 'Hope you like it!' }]) };
    }
    if (answered) {
      seen.push({ kind: 'chat: after the image' });
      return { type: 'text/event-stream', body: sse([{ text: 'Here you go! Let me know if you would like any changes.' }]) };
    }
    if (/draw a dog/i.test(lastText)) {
      seen.push({ kind: 'chat: draw a dog' });
      return { type: 'text/event-stream', body: sse([{ text: "Sure, here's a dog for you." }, { functionCall: { name: 'generate_image', args: { prompt: 'A happy golden retriever in a park' } } }]) };
    }
    if (/add a tiny hat/i.test(lastText)) {
      seen.push({ kind: 'chat: edit an older image', attachedImages: lastParts.filter((p) => p.inlineData || p.fileData).length });
      return { type: 'text/event-stream', body: sse([{ functionCall: { name: 'generate_image', args: { prompt: 'The same orange cat wearing a tiny hat', use_previous_image: true } } }]) };
    }
    if (/make it cuter/i.test(lastText)) {
      seen.push({ kind: 'chat: make it cuter', historyRemembersTheCat: remembers });
      return { type: 'text/event-stream', body: sse([{ functionCall: { name: 'generate_image', args: { prompt: 'A cuter, fluffier orange kitten with big eyes on a sunny windowsill', use_previous_image: true } } }]) };
    }
    if (/draw a cat/i.test(lastText)) {
      seen.push({ kind: 'chat: draw a cat' });
      return { type: 'text/event-stream', body: sse([{ functionCall: { name: 'generate_image', args: { prompt: 'A fluffy orange cat sitting on a sunny windowsill', aspect_ratio: '1:1' } } }]) };
    }
    return { type: 'text/event-stream', body: sse([{ text: 'Okay.' }]) };
  }
  return { type: 'application/json', body: JSON.stringify({ candidates: [{ content: { role: 'model', parts: [{ text: 'Orange Cat' }] }, finishReason: 'STOP' }] }) };
};

const layout = (page, index) => page.evaluate((i) => {
  const turns = [...document.querySelectorAll('img')].filter((img) => img.closest('.gm-image') && img.getBoundingClientRect().width > 100);
  const img = turns[i];
  if (!img) return { image: null };
  const r = img.getBoundingClientRect();
  const texts = [...document.querySelectorAll('p')].filter((p) => /Here you go/.test(p.textContent || ''));
  const t = texts[i]?.getBoundingClientRect();
  return {
    image: [r.x, r.y, r.width, r.height].map(Math.round),
    text: t ? [t.x, t.y, t.width, t.height].map(Math.round) : null,
    textUnderImage: t ? t.top >= r.bottom : null,
    gap: t ? Math.round(t.top - r.bottom) : null,
  };
}, index);

(async () => {
  const kind = SIZES[process.argv[2]] ? process.argv[2] : 'desktop';
  const size = SIZES[kind];
  const out = 'tools/ui-research/captures/gemini/media-tools-2026/follow-up';
  fs.mkdirSync(out, { recursive: true });
  const browser = await puppeteer.connect({ browserURL: process.env.CDP_URL || 'http://[::1]:9222', defaultViewport: null, protocolTimeout: 60_000 });
  const context = await browser.createBrowserContext();
  try {
    const page = await context.newPage();
    page.on('pageerror', (error) => console.log(`  [pageerror] ${error.message.slice(0, 200)}`));
    await page.evaluateOnNewDocument((origin) => {
      if (location.origin !== origin) return;
      if (!localStorage.getItem('willow:apiKeys:guest')) localStorage.setItem('willow:apiKeys:guest', JSON.stringify({ gemini: ['zz-not-a-real-key'], openai: [], anthropic: [] }));
      if (!localStorage.getItem('modelConfig')) {
        localStorage.setItem('modelConfig', JSON.stringify({
          gemini: {
            model: 'gemini-3.8-flash',
            thinkingLevel: 3,
            baseUrl: 'https://generativelanguage.googleapis.com',
            savedModels: [
              { id: 'default-flash-38', name: 'Gemini 3.8 Flash', thinkingLevel: 3, thinkingLabel: 'High', modelId: 'gemini-3.8-flash' },
              { id: 'test-image', name: 'Nano Banana Pro', thinkingLevel: 0, modelId: 'gemini-3-pro-image' },
            ],
          },
        }));
      }
    }, new URL(BASE).origin);
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      const url = request.url();
      if (!/generativelanguage\.googleapis\.com/.test(url)) { void request.continue(); return; }
      if (request.method() === 'OPTIONS') { void request.respond({ status: 204, headers: CORS, body: '' }); return; }
      if (/\/interactions/.test(url)) { void request.respond({ status: 404, headers: CORS, contentType: 'application/json', body: '{}' }); return; }
      if (/\/models(\?|$)/.test(url) && request.method() === 'GET') { void request.respond({ status: 200, headers: CORS, contentType: 'application/json', body: '{"models":[]}' }); return; }
      const reply = answer(url, request.postData() || '');
      // The first reply after an image waits, so the image is on screen alone before text comes under it.
      const hold = seen.filter((entry) => entry.kind === 'chat: after the image').length === 1 && seen[seen.length - 1].kind === 'chat: after the image' ? 3000 : 0;
      setTimeout(() => { void request.respond({ status: 200, headers: CORS, contentType: reply.type, body: reply.body }); }, hold);
    });
    if (size.mobile) {
      const cdp = await page.createCDPSession();
      await cdp.send('Emulation.setDeviceMetricsOverride', { width: size.width, height: size.height, deviceScaleFactor: 0, mobile: true, screenWidth: size.width, screenHeight: size.height });
      await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    } else {
      await page.setViewport({ width: size.width, height: size.height });
    }
    await page.bringToFront();
    page.setDefaultNavigationTimeout(120_000);
    await page.goto(`${BASE}/app`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('textarea', { visible: true, timeout: 90_000 });
    await sleep(2500);
    // A folder in the context's own OPFS, stored where the folder picker's choice would be,
    // so the chat is saved and comes back after a reload.
    console.log('folder:', await page.evaluate(async () => {
      const url = performance.getEntriesByType('resource').map((entry) => entry.name).find((name) => /\/adapters\/local-disk\.ts(\?|$)/.test(name));
      if (!url) return 'local-disk not loaded';
      const disk = await import(url);
      const folder = await (await navigator.storage.getDirectory()).getDirectoryHandle('Willow test folder', { create: true });
      return `stored as ${await disk.storeDirectoryHandle(folder)}`;
    }));
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('textarea', { visible: true, timeout: 90_000 });
    await sleep(4000);

    const send = async (text) => {
      await page.focus('textarea');
      await page.keyboard.type(text, { delay: 15 });
      await page.keyboard.press('Enter');
    };

    await send('Draw a cat');
    try {
      await page.waitForSelector('.gm-image__img.is-loaded', { timeout: 30_000 });
    } catch (error) {
      await page.screenshot({ path: path.join(out, `${kind}-stuck.png`) });
      console.log('the image never loaded; requests so far:', JSON.stringify(seen), await page.evaluate(() => document.querySelector('.gm-image')?.outerHTML.slice(0, 400) ?? 'no .gm-image'));
      throw error;
    }
    await sleep(500);
    await page.evaluate(() => {
      window.__firstImage = document.querySelector('.gm-image__img');
      window.__imageAnimations = 0;
      document.addEventListener('animationstart', (event) => { if (event.target.classList?.contains('gm-image__img')) window.__imageAnimations += 1; }, true);
    });
    await page.waitForFunction(() => [...document.querySelectorAll('p')].some((p) => /Here you go/.test(p.textContent || '')), { timeout: 30_000 });
    await sleep(600);
    console.log('the image under new text:', JSON.stringify(await page.evaluate(() => ({
      sameElement: window.__firstImage.isConnected,
      zoomsReplayed: window.__imageAnimations,
      nowShown: document.querySelector('.gm-image__img')?.className,
      opacity: getComputedStyle(document.querySelector('.gm-image__img')).opacity,
    }))));
    await sleep(2500);
    const first = await layout(page, 0);
    console.log('turn 1:', JSON.stringify(first));
    await page.screenshot({ path: path.join(out, `${kind}-turn1.png`) });

    await send('Make it cuter');
    await page.waitForFunction(() => [...document.querySelectorAll('p')].filter((p) => /Here you go/.test(p.textContent || '')).length >= 2, { timeout: 30_000 });
    await sleep(2500);
    const second = await layout(page, 1);
    console.log('turn 2:', JSON.stringify(second));
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.screenshot({ path: path.join(out, `${kind}-turn2.png`) });

    await send('Draw a dog');
    await page.waitForFunction(() => [...document.querySelectorAll('p')].some((p) => /Hope you like it/.test(p.textContent || '')), { timeout: 30_000 });
    await sleep(2500);
    const third = await page.evaluate(() => {
      const imgs = [...document.querySelectorAll('img')].filter((img) => img.closest('.gm-image') && img.getBoundingClientRect().width > 100);
      const r = imgs[imgs.length - 1].getBoundingClientRect();
      const at = (re) => [...document.querySelectorAll('p')].filter((p) => re.test(p.textContent || '')).pop()?.getBoundingClientRect();
      const before = at(/Sure, here's a dog/);
      const after = at(/Hope you like it/);
      const joined = [...document.querySelectorAll('p')].some((p) => /dog for you\.Hope/.test(p.textContent || ''));
      return {
        image: [Math.round(r.top), Math.round(r.bottom)],
        before: before ? [Math.round(before.top), Math.round(before.bottom)] : null,
        after: after ? [Math.round(after.top), Math.round(after.bottom)] : null,
        beforeAbove: before ? before.bottom <= r.top : null,
        afterUnder: after ? after.top >= r.bottom : null,
        gapAbove: before ? Math.round(r.top - before.bottom) : null,
        gapUnder: after ? Math.round(after.top - r.bottom) : null,
        joined,
      };
    });
    console.log('turn 3:', JSON.stringify(third));
    await page.screenshot({ path: path.join(out, `${kind}-turn3.png`) });

    await sleep(2000);
    console.log('before reload at', await page.evaluate(() => location.pathname));
    await page.reload({ waitUntil: 'domcontentloaded' });
    try {
      await page.waitForFunction(() => [...document.querySelectorAll('p')].some((p) => /Hope you like it/.test(p.textContent || '')), { timeout: 45_000 });
    } catch {
      console.log('after reload: the reply never came back at', await page.evaluate(() => location.pathname));
      await page.screenshot({ path: path.join(out, `${kind}-reload.png`) });
      return;
    }
    await sleep(2500);
    const reopened = await page.evaluate(() => {
      const order = [];
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (node.matches('.gm-image')) order.push('image');
        else if (node.tagName === 'P' && /Here you go|Sure, here's a dog|Hope you like it/.test(node.textContent || '')) order.push(node.textContent.trim().slice(0, 16));
      }
      return { url: location.pathname, order };
    });
    console.log('after reload:', JSON.stringify(reopened));

    const before = seen.length;
    await send('Make it cuter');
    await page.waitForFunction(() => [...document.querySelectorAll('p')].filter((p) => /Here you go/.test(p.textContent || '')).length >= 3, { timeout: 30_000 });
    console.log('make it cuter after the reload:', JSON.stringify(seen.slice(before)));

    // Edit on the first cat, which is no longer the newest image: only that one may go.
    await sleep(2000);
    const beforeEdit = seen.length;
    await page.evaluate(() => document.querySelector('[aria-label="Edit image"]').click());
    await page.waitForSelector('textarea[placeholder="Describe your changes"]', { visible: true, timeout: 10_000 });
    await page.type('textarea[placeholder="Describe your changes"]', 'Add a tiny hat', { delay: 15 });
    await page.click('.gm-viewer__send');
    await page.waitForFunction(() => [...document.querySelectorAll('p')].filter((p) => /Here you go/.test(p.textContent || '')).length >= 4, { timeout: 30_000 });
    console.log('edit of an older image:', JSON.stringify(seen.slice(beforeEdit)));
    console.log('\nrequests:', JSON.stringify(seen, null, 1));
  } finally {
    await context.close();
    browser.disconnect();
  }
})().catch((error) => { console.error(error); process.exit(1); });
