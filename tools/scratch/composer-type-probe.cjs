/*
 * Types text into the Gemini or Willow composer, measures its controls, then clears it
 * again. Never presses Enter and never touches the send button — `Input.insertText` adds
 * text without key events, and the clear is Ctrl+A then Backspace.
 *
 *   node tools/scratch/composer-type-probe.cjs gemini|willow short|long|"<text>" [--keep]
 *
 * Reports the composer box, plus, mic and send buttons (box + glyph), and the first and
 * last text line boxes.
 */
const puppeteer = require('puppeteer-core');

const URLS = { gemini: 'https://gemini.google.com/', willow: 'http://localhost:3000' };
const TEXTS = {
  short: 'Summarize my emails',
  long: 'Summarize every unread email from this week, group them by sender and topic, and draft short replies for the ones that need an answer today',
};
const SEL = {
  gemini: {
    editor: 'rich-textarea .ql-editor',
    box: '.text-input-field',
    plus: 'simplified-input-menu button, .leading-actions-wrapper button',
    mic: 'speech-dictation-mic-button button',
    send: 'button.send-button, button[aria-label="Send message"]',
  },
  willow: {
    editor: 'textarea.willow-dictation-textarea',
    box: '.willow-gemini-composer',
    plus: 'button[aria-label="Upload & tools"]',
    mic: 'button[aria-label="Microphone"]',
    send: 'button[aria-label="Send message"], button[aria-label="Submit"]',
  },
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

(async () => {
  const [app, which] = process.argv.slice(2);
  const keep = process.argv.includes('--keep');
  const clearOnly = which === 'clear';
  const text = clearOnly ? '' : (TEXTS[which] || which || TEXTS.short);
  const sel = SEL[app];
  const browser = await puppeteer.connect({ browserURL: process.env.CDP_URL || 'http://[::1]:9222', defaultViewport: null });
  const page = (await browser.pages()).find((candidate) => candidate.url().startsWith(URLS[app]));
  await page.bringToFront();
  const cdp = await page.createCDPSession();
  const focused = await page.evaluate((s) => {
    const editor = [...document.querySelectorAll(s.editor)].find((el) => el.getBoundingClientRect().width > 0);
    if (!editor) return false;
    editor.focus();
    return document.activeElement === editor || editor.contains(document.activeElement);
  }, sel);
  if (!focused) {
    console.log('could not focus the composer editor');
    await browser.disconnect();
    return;
  }
  if (text) await cdp.send('Input.insertText', { text });
  await sleep(600);
  const report = clearOnly ? '' : await page.evaluate((s, isWillow) => {
    const r2 = (n) => Math.round(n * 10) / 10;
    const box = (el) => {
      if (!el) return 'none';
      const r = el.getBoundingClientRect();
      return `[${[r.x, r.y, r.width, r.height].map(r2).join(',')}]`;
    };
    const visible = (q) => [...document.querySelectorAll(q)].find((el) => el.getBoundingClientRect().width > 0);
    const glyph = (button) => button && (button.querySelector('mat-icon, .luminous-symbols, .google-symbols, svg'));
    const editor = visible(s.editor);
    let lines = 'n/a';
    if (!isWillow && editor) {
      const range = document.createRange();
      range.selectNodeContents(editor);
      const rects = [...range.getClientRects()].filter((r) => r.width > 0);
      if (rects.length) lines = `${rects.length} rects, first [${[rects[0].x, rects[0].y, rects[0].width, rects[0].height].map(r2)}] last [${[rects.at(-1).x, rects.at(-1).y, rects.at(-1).width, rects.at(-1).height].map(r2)}]`;
    } else if (editor) {
      const cs = getComputedStyle(editor);
      const lineHeight = parseFloat(cs.lineHeight);
      const r = editor.getBoundingClientRect();
      lines = `textarea ${box(editor)} pad ${cs.paddingTop} ${cs.paddingRight} ${cs.paddingBottom} ${cs.paddingLeft} lh ${cs.lineHeight} rows ~${Math.round((editor.scrollHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom)) / lineHeight)} textLeft ${r2(r.x + parseFloat(cs.paddingLeft))} textTop ${r2(r.y + parseFloat(cs.paddingTop))}`;
    }
    const plus = visible(s.plus);
    const mic = visible(s.mic);
    const send = visible(s.send);
    return [
      `box   ${box(visible(s.box))}`,
      `plus  ${box(plus)} glyph ${box(glyph(plus))}`,
      `mic   ${box(mic)} glyph ${box(glyph(mic))}`,
      `send  ${box(send)} glyph ${box(glyph(send))}${send ? ` bg ${getComputedStyle(send).backgroundColor}` : ''}`,
      `text  ${lines}`,
    ].join('\n');
  }, sel, app === 'willow');
  if (report) console.log(report);
  if (!keep || clearOnly) {
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'a', code: 'KeyA', modifiers: 2, windowsVirtualKeyCode: 65 });
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', modifiers: 2, windowsVirtualKeyCode: 65 });
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 });
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 });
    await sleep(300);
    const left = await page.evaluate((s) => {
      const editor = [...document.querySelectorAll(s.editor)].find((el) => el.getBoundingClientRect().width > 0);
      return editor ? (editor.value ?? editor.textContent).trim().length : -1;
    }, sel);
    console.log(left === 0 ? 'cleared' : `WARNING: ${left} characters left in the composer`);
  }
  await cdp.detach();
  await browser.disconnect();
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
