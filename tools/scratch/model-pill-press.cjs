/*
 * Taps the header model selector with a real CDP touch and records every animation
 * frame: state layer, ripple elements, icon colour and menu presence, through press,
 * release, open, and an Escape close. Prints only the frames where something changed.
 *
 *   node tools/scratch/model-pill-press.cjs gemini|willow [holdMs]
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const puppeteer = require('puppeteer-core');

const TARGETS = {
  gemini: {
    url: 'https://gemini.google.com/',
    button: 'button[aria-label^="Open mode picker"]',
    layer: '.mat-mdc-button-persistent-ripple',
    layerPseudo: '::before',
    ripple: '.mat-ripple-element',
    icon: 'mat-icon',
  },
  willow: {
    url: 'http://localhost:3000/',
    button: 'button.studio-mobile-model-button',
    layer: '.studio-mobile-model-state',
    layerPseudo: null,
    ripple: '.studio-mobile-model-ripple',
    icon: '.luminous-symbols',
  },
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function installSampler(config) {
  const button = document.querySelector(config.button);
  const samples = [];
  const t0 = performance.now();
  const round = (n) => +n.toFixed(1);
  const tick = () => {
    const layerEl = button.querySelector(config.layer);
    const layer = layerEl ? getComputedStyle(layerEl, config.layerPseudo) : null;
    const buttonStyle = getComputedStyle(button);
    samples.push({
      t: round(performance.now() - t0),
      state: {
        layerOpacity: layer?.opacity,
        layerTransform: layer?.transform,
        layerBg: layer?.backgroundColor,
        buttonBg: buttonStyle.backgroundColor,
        icon: getComputedStyle(button.querySelector(config.icon)).color,
        iconTransform: getComputedStyle(button.querySelector(config.icon)).transform,
        ripples: [...button.querySelectorAll(config.ripple)].map((el) => {
          const box = el.getBoundingClientRect();
          const style = getComputedStyle(el);
          return {
            rect: [box.x, box.y, box.width, box.height].map(round),
            opacity: (+style.opacity).toFixed(3),
            transform: style.transform,
            bg: style.backgroundColor,
            timing: style.transitionDuration !== '0s' ? `${style.transitionProperty} ${style.transitionDuration} ${style.transitionTimingFunction}` : `${style.animationName} ${style.animationDuration} ${style.animationTimingFunction}`,
          };
        }),
        menu: [...document.querySelectorAll('.cdk-overlay-pane, [role="menu"], [role="dialog"], [role="listbox"]')]
          .filter((el) => el.getBoundingClientRect().height > 0).length,
        focused: document.activeElement === button,
        classes: (button.className.match(/cdk-[a-z]+-focused|mat-menu-trigger\S*|is-open|is-active/g) || []).join(' '),
        expanded: button.getAttribute('aria-expanded'),
      },
    });
    window.__pressRaf = requestAnimationFrame(tick);
  };
  window.__pressSamples = samples;
  window.__pressRaf = requestAnimationFrame(tick);
  const box = button.getBoundingClientRect();
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

function drain() {
  cancelAnimationFrame(window.__pressRaf);
  return window.__pressSamples;
}

function report(label, samples) {
  const intervals = samples.slice(1).map((s, i) => s.t - samples[i].t);
  const avg = intervals.reduce((a, b) => a + b, 0) / Math.max(1, intervals.length);
  console.log(`--- ${label}: ${samples.length} frames, avg ${avg.toFixed(1)}ms/frame, max gap ${Math.max(0, ...intervals).toFixed(1)}ms`);
  let previous = '';
  for (const sample of samples) {
    const json = JSON.stringify(sample.state);
    if (json === previous) continue;
    previous = json;
    console.log(`  t=${sample.t}  ${json}`);
  }
}

(async () => {
  const name = process.argv[2];
  const holdMs = Number(process.argv[3] || 300);
  const config = TARGETS[name];
  if (!config) throw new Error('usage: model-pill-press.cjs gemini|willow [holdMs]');
  const browser = await puppeteer.connect({ browserURL: process.env.CDP_URL || 'http://[::1]:9222', defaultViewport: null });
  const pages = await browser.pages();
  const page = pages.find((candidate) => candidate.url().startsWith(config.url));
  const visibleBefore = [];
  for (const candidate of pages) {
    if (await candidate.evaluate(() => document.visibilityState === 'visible').catch(() => false)) visibleBefore.push(candidate);
  }
  const cdp = await page.createCDPSession();
  await page.bringToFront();
  await sleep(500);

  const center = await page.evaluate(installSampler, config);
  await sleep(150);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: center.x, y: center.y }] });
  await sleep(holdMs);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await sleep(900);
  report(`press (hold ${holdMs}ms) + release + open`, await page.evaluate(drain));

  const shot = path.join(os.tmpdir(), 'willow-emulator', `${name}-model-open.png`);
  fs.mkdirSync(path.dirname(shot), { recursive: true });
  fs.writeFileSync(shot, Buffer.from((await cdp.send('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
  console.log(`open-state screenshot: ${shot}`);

  await page.evaluate(installSampler, config);
  await sleep(100);
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await sleep(700);
  report('Escape close', await page.evaluate(drain));

  await cdp.detach();
  if (visibleBefore[0] && visibleBefore[0] !== page) await visibleBefore[0].bringToFront();
  await browser.disconnect();
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
