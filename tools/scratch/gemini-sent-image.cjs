/**
 * Read-only: what Gemini shows when an image the user sent is pressed in the thread. Opens a
 * chat in a tab of its own, finds the image in a user turn, records the thumbnail, presses it,
 * and records the preview that opens — every animation it starts, a screencast, the overlay's
 * boxes, type, colours and icons, and the CSS rules behind it — then closes it with Escape
 * and records that too. Nothing is sent or changed.
 *
 *   node tools/scratch/gemini-sent-image.cjs <chat id> [desktop|tablet|phone] [out-dir]
 */
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');

const SIZES = {
  desktop: { width: 1536, height: 826 },
  tablet: { width: 800, height: 1280, mobile: true },
  phone: { width: 390, height: 844, mobile: true },
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const THUMBS = () => [...document.querySelectorAll('user-query img, .user-query-container img, user-query-file-preview img')]
  .filter((img) => img.getBoundingClientRect().width > 20)
  .map((img, index) => {
    img.setAttribute('data-willow-thumb', String(index));
    const r = img.getBoundingClientRect();
    const chain = [];
    for (let el = img; el && chain.length < 8 && el.tagName !== 'USER-QUERY'; el = el.parentElement) {
      const cs = getComputedStyle(el);
      const er = el.getBoundingClientRect();
      chain.push(`${el.tagName.toLowerCase()}.${String(el.className || '').split(' ').filter(Boolean).slice(0, 4).join('.')} [${[er.x, er.y, er.width, er.height].map((v) => Math.round(v * 10) / 10)}] r:${cs.borderRadius} cursor:${cs.cursor}`);
    }
    return { index, rect: [r.x, r.y, r.width, r.height].map((v) => Math.round(v * 10) / 10), natural: [img.naturalWidth, img.naturalHeight], fit: getComputedStyle(img).objectFit, src: img.src.slice(0, 80), chain };
  });

const DUMP = () => {
  const pick = (el) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    const own = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent.trim()).join(' ').trim();
    return {
      tag: el.tagName.toLowerCase(),
      cls: (typeof el.className === 'string' ? el.className : String(el.className?.baseVal ?? '')).slice(0, 160),
      aria: el.getAttribute('aria-label') || undefined,
      role: el.getAttribute('role') || undefined,
      icon: el.getAttribute('fonticon') || el.getAttribute('data-mat-icon-name') || undefined,
      text: own.slice(0, 120) || undefined,
      src: el.tagName === 'IMG' ? el.src.slice(0, 120) : undefined,
      rect: [r.x, r.y, r.width, r.height].map((v) => Math.round(v * 100) / 100),
      cs: {
        position: cs.position !== 'static' ? cs.position : undefined,
        font: `${cs.fontSize}/${cs.lineHeight} ${cs.fontWeight} ${cs.fontFamily.split(',')[0]}`,
        fvs: cs.fontVariationSettings !== 'normal' ? cs.fontVariationSettings : undefined,
        color: cs.color,
        bg: cs.backgroundColor !== 'rgba(0, 0, 0, 0)' ? cs.backgroundColor : undefined,
        bgImage: cs.backgroundImage !== 'none' ? cs.backgroundImage.slice(0, 160) : undefined,
        radius: cs.borderRadius !== '0px' ? cs.borderRadius : undefined,
        pad: cs.padding !== '0px' ? cs.padding : undefined,
        margin: cs.margin !== '0px' ? cs.margin : undefined,
        border: cs.borderStyle !== 'none' && cs.borderTopWidth !== '0px' ? `${cs.borderTopWidth} ${cs.borderStyle} ${cs.borderTopColor}` : undefined,
        display: cs.display,
        flex: cs.display.includes('flex') ? `${cs.flexDirection} ${cs.alignItems} ${cs.justifyContent} gap:${cs.gap}` : undefined,
        shadow: cs.boxShadow !== 'none' ? cs.boxShadow : undefined,
        opacity: cs.opacity !== '1' ? cs.opacity : undefined,
        filter: cs.filter !== 'none' ? cs.filter : undefined,
        backdrop: cs.backdropFilter && cs.backdropFilter !== 'none' ? cs.backdropFilter : undefined,
        transform: cs.transform !== 'none' ? cs.transform : undefined,
        objectFit: el.tagName === 'IMG' ? cs.objectFit : undefined,
        z: cs.zIndex !== 'auto' ? cs.zIndex : undefined,
        cursor: cs.cursor !== 'auto' ? cs.cursor : undefined,
      },
    };
  };
  const roots = [...document.querySelectorAll('.cdk-overlay-container, [role="dialog"], .cdk-overlay-pane, mat-dialog-container')]
    .filter((el) => el.getBoundingClientRect().width > 0 || el.querySelector('*'));
  const root = roots[0] ?? null;
  const nodes = [];
  if (root) {
    for (const el of [root, ...root.querySelectorAll('*')]) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      nodes.push(pick(el));
      if (nodes.length > 600) break;
    }
  }
  return {
    viewport: [innerWidth, innerHeight],
    roots: roots.map((el) => `${el.tagName.toLowerCase()}.${String(el.className || '').split(' ').slice(0, 4).join('.')}`),
    html: root ? root.outerHTML.slice(0, 40000) : null,
    nodes,
  };
};

const RULES = (source) => {
  const wanted = new RegExp(source);
  const found = [];
  const walk = (list, wrappers) => {
    for (const rule of list) {
      if (rule.cssRules && !(rule instanceof CSSStyleRule)) {
        const label = rule instanceof CSSMediaRule ? `@media ${rule.conditionText}` : rule.constructor.name;
        walk(rule.cssRules, [...wrappers, label]);
        continue;
      }
      if (rule instanceof CSSStyleRule && wanted.test(rule.selectorText)) found.push(`${wrappers.length ? `${wrappers.join(' > ')} :: ` : ''}${rule.cssText}`);
      if (rule instanceof CSSKeyframesRule && wanted.test(rule.name)) found.push(rule.cssText);
    }
  };
  for (const sheet of document.styleSheets) { try { walk(sheet.cssRules, []); } catch { /* cross-origin */ } }
  return found;
};

const RECORD = (ms) => {
  const t0 = performance.now();
  const seen = new Set();
  window.__record = { animations: [], done: false };
  const describe = (el) => (el && el.tagName ? `${el.tagName.toLowerCase()}.${String(el.className || '').split(' ').filter(Boolean).slice(0, 3).join('.')}` : String(el));
  const tick = () => {
    const now = performance.now() - t0;
    for (const animation of document.getAnimations()) {
      if (seen.has(animation)) continue;
      seen.add(animation);
      const effect = animation.effect;
      const timing = effect?.getTiming?.() ?? {};
      window.__record.animations.push({
        seenAt: Math.round(now),
        type: animation.constructor.name,
        name: animation.animationName || animation.transitionProperty || animation.id || '',
        target: describe(effect?.target),
        pseudo: effect?.pseudoElement || undefined,
        delay: timing.delay,
        duration: timing.duration,
        easing: timing.easing,
        fill: timing.fill,
        keyframes: effect?.getKeyframes?.().map(({ composite, computedOffset, ...rest }) => rest),
      });
    }
    if (now < ms) requestAnimationFrame(tick);
    else window.__record.done = true;
  };
  requestAnimationFrame(tick);
};

(async () => {
  const [chatId, kindArg, outArg] = process.argv.slice(2);
  if (!chatId) throw new Error('usage: <chat id> [desktop|tablet|phone] [out-dir]');
  const kind = SIZES[kindArg] ? kindArg : 'desktop';
  const size = SIZES[kind];
  const out = outArg || `tools/ui-research/captures/gemini/sent-image/${kind}`;
  fs.mkdirSync(out, { recursive: true });
  const browser = await puppeteer.connect({ browserURL: 'http://[::1]:9222', defaultViewport: null, protocolTimeout: 90_000 });
  const page = await browser.newPage();
  const cdp = await page.createCDPSession();
  try {
    if (size.mobile) {
      const version = (await browser.version()).match(/\/(\d+)/)?.[1] || '150';
      await cdp.send('Emulation.setUserAgentOverride', {
        userAgent: `Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${version}.0.0.0${kind === 'phone' ? ' Mobile' : ''} Safari/537.36`,
      });
      await cdp.send('Emulation.setDeviceMetricsOverride', { width: size.width, height: size.height, deviceScaleFactor: 0, mobile: true, screenWidth: size.width, screenHeight: size.height });
      await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    } else {
      await page.setViewport({ width: size.width, height: size.height });
    }
    await page.bringToFront();
    await page.goto(`https://gemini.google.com/app/${chatId}`, { waitUntil: 'networkidle2', timeout: 90_000 });
    await sleep(6000);
    const thumbs = await page.evaluate(THUMBS);
    console.log('sent images:', JSON.stringify(thumbs, null, 1));
    if (!thumbs.length) throw new Error('no image in a user turn');
    await page.evaluate(() => document.querySelector('[data-willow-thumb="0"]')?.scrollIntoView({ block: 'center' }));
    await sleep(1200);
    const thumb = (await page.evaluate(THUMBS))[0];
    fs.writeFileSync(path.join(out, 'thumb.json'), JSON.stringify(thumb, null, 1));
    await page.screenshot({ path: path.join(out, 'thread.png') });

    const press = async (label, action) => {
      const frames = [];
      cdp.on('Page.screencastFrame', async ({ data, sessionId, metadata }) => {
        frames.push({ data, at: metadata.timestamp });
        await cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
      });
      await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 70, everyNthFrame: 1 });
      await sleep(300);
      await page.bringToFront();
      await page.evaluate(RECORD, 1200);
      const t0 = Date.now() / 1000;
      await action();
      await page.waitForFunction(() => window.__record?.done, { timeout: 10_000 });
      await sleep(300);
      await cdp.send('Page.stopScreencast');
      cdp.removeAllListeners('Page.screencastFrame');
      const record = await page.evaluate(() => window.__record);
      const dir = path.join(out, `${label}-frames`);
      fs.rmSync(dir, { recursive: true, force: true });
      fs.mkdirSync(dir, { recursive: true });
      frames.forEach((frame, index) => fs.writeFileSync(path.join(dir, `${String(index).padStart(3, '0')}_${Math.round((frame.at - t0) * 1000)}ms.jpg`), Buffer.from(frame.data, 'base64')));
      fs.writeFileSync(path.join(out, `${label}-animations.json`), JSON.stringify(record.animations, null, 1));
      const fresh = record.animations.filter((a) => !/sidenav|nl-blob|gradient|morph|sweep|scaleBG|scaleFG|rotateFG|fadeInHeader|lm-background/.test(`${a.name} ${a.target}`));
      console.log(`\n== ${label}: ${fresh.length} animations`);
      for (const a of fresh.slice(0, 40)) {
        console.log(`  +${a.seenAt}ms ${a.type} ${a.name} on ${a.target}${a.pseudo ? a.pseudo : ''} | delay ${a.delay} dur ${a.duration} ${a.easing} | ${JSON.stringify(a.keyframes).slice(0, 260)}`);
      }
    };

    const centre = { x: thumb.rect[0] + thumb.rect[2] / 2, y: thumb.rect[1] + thumb.rect[3] / 2 };
    await press('open', async () => {
      if (size.mobile) await page.touchscreen.tap(centre.x, centre.y);
      else await page.mouse.click(centre.x, centre.y);
    });
    await sleep(800);
    const dump = await page.evaluate(DUMP);
    fs.writeFileSync(path.join(out, 'preview.json'), JSON.stringify(dump, null, 1));
    console.log('\npreview roots:', dump.roots.join(' | '));
    for (const n of dump.nodes.filter((node) => node.aria || node.icon || node.text || node.tag === 'img' || node.cs.bg || node.cs.backdrop || node.cs.position === 'fixed').slice(0, 80)) {
      console.log(`  ${(`${n.tag}.${n.cls.split(' ').slice(0, 3).join('.')}`).slice(0, 70).padEnd(70)} ${(n.aria || n.icon || n.text || '').slice(0, 30).padEnd(30)} ${JSON.stringify(n.rect).padEnd(34)} ${[n.cs.position, n.cs.bg && `bg:${n.cs.bg}`, n.cs.backdrop && `bd:${n.cs.backdrop}`, n.cs.radius && `r:${n.cs.radius}`, n.cs.font, n.cs.color, n.cs.objectFit && `fit:${n.cs.objectFit}`].filter(Boolean).join(' | ')}`);
    }
    await page.screenshot({ path: path.join(out, 'preview.png') });
    // Hover the image and every control once, for their hover states.
    const controls = await page.evaluate(() => [...document.querySelectorAll('.cdk-overlay-container button, [role="dialog"] button')]
      .filter((el) => el.getBoundingClientRect().width > 0)
      .map((el, index) => { el.setAttribute('data-willow-control', String(index)); const r = el.getBoundingClientRect(); return { index, aria: el.getAttribute('aria-label'), rect: [r.x, r.y, r.width, r.height].map(Math.round) }; }));
    console.log('\ncontrols:', JSON.stringify(controls));
    const classes = [...new Set(dump.nodes.flatMap((n) => n.cls.split(' ')).filter((c) => c && !/^ng-|^mat-mdc|^mdc-|^cdk-|^gds-|^mat-/.test(c)))].slice(0, 60);
    const rules = await page.evaluate(RULES, classes.map((c) => `\\.${c.replace(/[^\w-]/g, '')}\\b`).join('|') || 'none');
    fs.writeFileSync(path.join(out, 'preview-rules.css'), rules.join('\n\n'));
    console.log(`\n${rules.length} rules -> preview-rules.css`);

    // More options: what it offers for a sent image.
    const more = controls.find((control) => /more/i.test(control.aria || ''));
    if (more) {
      await page.click(`[data-willow-control="${more.index}"]`);
      await sleep(900);
      const menu = await page.evaluate(() => [...document.querySelectorAll('[role="menu"], .mat-mdc-menu-panel')]
        .filter((el) => el.getBoundingClientRect().width > 0)
        .map((panel) => {
          const r = panel.getBoundingClientRect();
          const cs = getComputedStyle(panel);
          return {
            panel: [r.x, r.y, r.width, r.height].map((v) => Math.round(v * 10) / 10),
            bg: cs.backgroundColor,
            radius: cs.borderRadius,
            padding: cs.padding,
            shadow: cs.boxShadow,
            items: [...panel.querySelectorAll('button, [role="menuitem"]')].map((item) => {
              const ir = item.getBoundingClientRect();
              const icon = item.querySelector('mat-icon');
              const label = item.querySelector('span, .mat-mdc-menu-item-text');
              return {
                rect: [ir.x, ir.y, ir.width, ir.height].map((v) => Math.round(v * 10) / 10),
                icon: icon ? `${icon.getAttribute('fonticon') || icon.textContent.trim()} ${getComputedStyle(icon).fontFamily.split(',')[0]} ${getComputedStyle(icon).fontSize} w${getComputedStyle(icon).fontWeight} ${getComputedStyle(icon).color}` : null,
                text: item.textContent.replace(/\s+/g, ' ').trim(),
                font: label ? `${getComputedStyle(label).fontSize}/${getComputedStyle(label).lineHeight} ${getComputedStyle(label).fontWeight} ${getComputedStyle(label).color}` : null,
              };
            }),
          };
        }));
      console.log('\nmore options menu:', JSON.stringify(menu, null, 1));
      await page.screenshot({ path: path.join(out, 'preview-menu.png') });
      await page.keyboard.press('Escape');
      await sleep(600);
    }

    const closeControl = controls.find((control) => /close|back/i.test(control.aria || ''));
    await press('close', async () => {
      if (closeControl) await page.click(`[data-willow-control="${closeControl.index}"]`);
      else await page.keyboard.press('Escape');
    });
    await sleep(600);
    console.log('\nafter Close, overlay open:', await page.evaluate(() => !!document.querySelector('.cdk-overlay-container mat-dialog-container')),
      '| thumbnail opacity:', await page.evaluate(() => getComputedStyle(document.querySelector('[data-willow-thumb="0"]')?.closest('.file-preview-container') ?? document.body).opacity));
  } finally {
    await page.close().catch(() => {});
    browser.disconnect();
  }
})().catch((error) => { console.error(error); process.exit(1); });
