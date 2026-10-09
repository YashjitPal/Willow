/*
 * Measures the last conversation turn in the debug Chrome's Gemini or Willow tab: the
 * scroller, the user bubble and what sits under it, every markdown element type in the
 * response (first instance of each, plus the vertical rhythm between blocks), the actions
 * row, the disclaimer and the header's right-hand icons.
 *
 *   node tools/scratch/thread-measure.cjs gemini|willow [label]
 *
 * Writes %TEMP%\willow-emulator\thread-<app>-<label>.json and prints a digest.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const puppeteer = require('puppeteer-core');

const APPS = {
  gemini: {
    url: 'https://gemini.google.com/',
    scroller: 'infinite-scroller, #chat-history',
    turn: '.conversation-container',
    bubble: 'user-query .user-query-bubble-with-background',
    bubbleText: 'user-query .query-text-line, user-query .query-text',
    underBubble: 'user-query .luminous-actions-container',
    response: 'model-response .markdown',
    actions: 'model-response message-actions',
    disclaimer: 'hallucination-disclaimer',
    header: 'top-bar-actions .right-section',
  },
  willow: {
    url: 'http://localhost:3000/',
    scroller: '.gemini-chat-scrollbar.flex-1',
    turn: '.gemini-chat-scrollbar.flex-1 > div > div',
    bubble: '[class*="rounded-[40px]"][class*="whitespace-pre-wrap"]',
    bubbleText: '[class*="rounded-[40px]"][class*="whitespace-pre-wrap"] > div > div',
    underBubble: '.gemini-user-actions',
    response: '.smd-root',
    actions: '[aria-label="Response actions"] > button',
    disclaimer: 'div:has(> [aria-label="Response actions"]) + p',
    header: '.studio-layout',
  },
};
const TYPE = ['fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'fontVariationSettings', 'color'];
const BOX = ['display', 'marginTop', 'marginBottom', 'marginLeft', 'marginRight', 'paddingTop', 'paddingBottom', 'paddingLeft', 'paddingRight', 'borderRadius', 'backgroundColor', 'border', 'maxWidth', 'minHeight', 'rowGap', 'gap', 'scrollPaddingTop', 'scrollMarginTop', 'listStyleType', 'opacity'];

function measure(cfg, TYPE, BOX) {
  const round = (n) => Math.round(n * 100) / 100;
  const rect = (el) => { const r = el.getBoundingClientRect(); return [r.x, r.y, r.width, r.height].map(round); };
  const pick = (el, keys, pseudo) => { const cs = getComputedStyle(el, pseudo); return Object.fromEntries(keys.map((k) => [k, cs[k]])); };
  const last = (selector) => { const all = document.querySelectorAll(selector); return all.length ? all[all.length - 1] : null; };
  const info = (el) => el ? { rect: rect(el), type: pick(el, TYPE), box: pick(el, BOX), cls: String(el.className?.baseVal ?? el.className).slice(0, 100) } : null;

  const out = { viewport: `${innerWidth}x${innerHeight}` };
  const scroller = document.querySelector(cfg.scroller);
  out.scroller = scroller ? { ...info(scroller), scrollTop: scroller.scrollTop, scrollHeight: scroller.scrollHeight, clientHeight: scroller.clientHeight } : null;
  out.turn = info(last(cfg.turn));
  out.bubble = info(last(cfg.bubble));
  out.bubbleText = info(last(cfg.bubbleText));
  const under = last(cfg.underBubble);
  out.underBubble = under ? { ...info(under), buttons: [...under.querySelectorAll('button')].map((b) => ({ rect: rect(b), label: b.getAttribute('aria-label'), opacity: getComputedStyle(b).opacity })) } : null;

  const response = last(cfg.response);
  out.response = info(response);
  if (response) {
    const byTag = {};
    for (const el of response.querySelectorAll('*')) {
      const tag = el.tagName.toLowerCase();
      if (!['h1', 'h2', 'h3', 'h4', 'p', 'ul', 'ol', 'li', 'strong', 'b', 'em', 'code', 'pre', 'table', 'thead', 'th', 'td', 'tr', 'blockquote', 'hr', 'a'].includes(tag)) continue;
      if (byTag[tag]) { byTag[tag].count++; continue; }
      byTag[tag] = { count: 1, text: (el.textContent || '').trim().slice(0, 30), ...info(el), marker: tag === 'li' ? pick(el, ['content', 'color', 'fontSize', 'width', 'marginRight'], '::marker') : undefined };
    }
    out.tags = byTag;
    const blocks = [];
    const walk = (parent, depth) => {
      for (const child of parent.children) {
        const cs = getComputedStyle(child);
        if (cs.display === 'none' || child.getBoundingClientRect().height === 0) continue;
        const tag = child.tagName.toLowerCase();
        if (['div', 'section', 'response-element', 'table-block', 'code-block'].includes(tag) && child.children.length && depth < 3 && !['table', 'pre'].some((t) => child.querySelector(`:scope > ${t}`))) {
          walk(child, depth + 1);
          continue;
        }
        blocks.push({ tag, cls: String(child.className).slice(0, 40), text: (child.textContent || '').trim().slice(0, 24), rect: rect(child) });
      }
    };
    walk(response, 0);
    out.blocks = blocks.map((b, i) => ({ ...b, gapAbove: i ? round(b.rect[1] - (blocks[i - 1].rect[1] + blocks[i - 1].rect[3])) : null }));
  }
  const actionsEl = last(cfg.actions);
  const actionsRow = actionsEl ? (actionsEl.closest('message-actions') || actionsEl.parentElement) : null;
  out.actions = actionsRow ? { ...info(actionsRow), buttons: [...actionsRow.querySelectorAll('button')].filter((b) => b.getBoundingClientRect().width > 0).map((b) => ({ rect: rect(b), label: b.getAttribute('aria-label'), icon: (() => { const i = b.querySelector('mat-icon, .luminous-symbols, .google-symbols, svg'); return i ? { rect: rect(i), fontSize: getComputedStyle(i).fontSize, fvs: getComputedStyle(i).fontVariationSettings, color: getComputedStyle(i).color } : null; })() })) } : null;
  out.disclaimer = info(last(cfg.disclaimer));
  const header = document.querySelector(cfg.header);
  out.headerButtons = header ? [...header.querySelectorAll('button, a')].filter((b) => b.getBoundingClientRect().width > 0).map((b) => ({ rect: rect(b), label: b.getAttribute('aria-label') })) : null;
  return out;
}

(async () => {
  const [name, label = 'run'] = process.argv.slice(2);
  const cfg = APPS[name];
  const browser = await puppeteer.connect({ browserURL: process.env.CDP_URL || 'http://[::1]:9222', defaultViewport: null });
  const page = (await browser.pages()).find((candidate) => candidate.url().startsWith(cfg.url));
  const data = await page.evaluate(measure, cfg, TYPE, BOX);
  const file = path.join(os.tmpdir(), 'willow-emulator', `thread-${name}-${label}.json`);
  fs.writeFileSync(file, JSON.stringify(data, null, 1));
  const short = (o) => o ? JSON.stringify({ rect: o.rect, ...Object.fromEntries(Object.entries({ ...o.type, ...o.box }).filter(([k, v]) => v && !['0px', 'normal', 'none', 'rgba(0, 0, 0, 0)', 'auto', '1', 'block'].includes(v) && !(k === 'border' && /^0px/.test(v)))) }) : 'null';
  console.log(`== ${name} ${data.viewport}  (${file})`);
  console.log('scroller   ', short(data.scroller), `scrollTop=${data.scroller?.scrollTop} scrollHeight=${data.scroller?.scrollHeight}`);
  console.log('turn       ', short(data.turn));
  console.log('bubble     ', short(data.bubble));
  console.log('bubbleText ', short(data.bubbleText));
  console.log('underBubble', data.underBubble ? JSON.stringify({ rect: data.underBubble.rect, opacity: data.underBubble.box.opacity, buttons: data.underBubble.buttons }) : 'null');
  console.log('response   ', short(data.response));
  for (const [tag, t] of Object.entries(data.tags || {})) console.log(`  <${tag}> x${t.count} "${t.text}" ${short(t)}${t.marker ? ` marker=${JSON.stringify(t.marker)}` : ''}`);
  console.log('blocks (gapAbove):');
  for (const b of data.blocks || []) console.log(`  ${String(b.gapAbove).padStart(6)}  <${b.tag}${b.cls ? `.${b.cls.replace(/\s+/g, '.')}` : ''}> ${JSON.stringify(b.rect)} "${b.text}"`);
  console.log('actions    ', data.actions ? JSON.stringify({ rect: data.actions.rect, padding: [data.actions.box.paddingTop, data.actions.box.paddingLeft], gap: data.actions.box.gap, buttons: data.actions.buttons }) : 'null');
  console.log('disclaimer ', short(data.disclaimer));
  console.log('header     ', JSON.stringify(data.headerButtons));
  await browser.disconnect();
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
