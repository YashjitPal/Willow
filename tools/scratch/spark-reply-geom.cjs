/**
 * Settled geometry of a Spark reply on the current task page: the first paragraph and list
 * of the richest reply, and the processing pill with its label. Brings the tab forward and
 * turns animations off while reading, because a background tab freezes the task view's
 * slide-in at its first frame.
 *
 *   node tools/scratch/spark-reply-geom.cjs gemini|willow
 */
const puppeteer = require('puppeteer-core');

const CONFIG = {
  gemini: {
    origin: 'https://gemini.google.com',
    reply: 'message-content',
    pill: 'button.processing-state-container-button',
    label: '.processing-state-text',
  },
  willow: {
    origin: 'http://localhost:3000',
    reply: '.spark-task-detail__response-body, .spark-task-detail__assistant-response',
    pill: 'button.spark-task-detail__processing-trigger',
    label: '.spark-task-detail__processing-label',
  },
};

(async () => {
  const which = process.argv[2] || 'gemini';
  const cfg = CONFIG[which];
  const browser = await puppeteer.connect({
    browserURL: process.env.SPARK_CDP_URL || 'http://[::1]:9222',
    defaultViewport: null,
    protocolTimeout: 30_000,
  });
  const page = (await browser.pages()).find((p) => p.url().startsWith(cfg.origin));
  await page.bringToFront();
  const out = await page.evaluate((c) => {
    const style = document.createElement('style');
    style.textContent = '*, *::before, *::after { animation: none !important; transition: none !important; }';
    document.head.appendChild(style);
    const r1 = (n) => Math.round(n * 10) / 10;
    const roots = [...document.querySelectorAll(c.reply)];
    const root = roots.sort((a, b) => b.querySelectorAll('ul').length - a.querySelectorAll('ul').length)[0];
    const p = root?.querySelector('p');
    const ul = root?.querySelector('ul');
    const pill = document.querySelector(c.pill);
    const label = pill?.querySelector(c.label);
    const result = [
      `p x ${p ? r1(p.getBoundingClientRect().x) : '-'}`,
      `ul x ${ul ? r1(ul.getBoundingClientRect().x) : '-'} margin ${ul ? getComputedStyle(ul).margin : '-'}`,
      `pill x ${pill ? r1(pill.getBoundingClientRect().x) : '-'} label x ${label ? r1(label.getBoundingClientRect().x) : '-'}`,
    ].join(' | ');
    style.remove();
    return result;
  }, cfg);
  console.log(`${which}: ${out}`);
  await browser.disconnect();
})().catch((e) => { console.error('FAILED', e.message); process.exit(1); });
