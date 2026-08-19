/**
 * Verify the source tile's loading spinner in Willow, in a window of our own.
 *
 * **Writes nothing.** `/api/fetch-source` is intercepted and never resolved, so the pending
 * tile stays up for as long as it is being measured and `addNotebookSource` is never reached —
 * the notebook this opens is the user's own, and it ends the run exactly as it started.
 *
 * Holding the request is also the only way to measure this state at rest: unheld, the tile
 * exists for a few hundred milliseconds and every screenshot is a race.
 *
 * A held request is RELEASED, not dropped, when the driver dies. An earlier run was killed by
 * a timeout, Chrome completed the request it had been holding, and a real source landed in the
 * user's notebook. So every held request is now recorded and explicitly `abort()`ed on the way
 * out — on the normal path, on a throw, and on SIGINT/SIGTERM, which is what a timeout sends.
 * A hard SIGKILL still cannot be defended against; nothing in this file can be.
 */
const { connect, openOwnWindow, outPath, sleep } = require('../ui-research/scrapers/notebooks/lib.cjs');
const fs = require('fs');

/** The pending tile: its spinner's box, and the icon slot it is supposed to be standing in. */
const MEASURE = `() => {
  const rect = (el) => {
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.x * 100) / 100, y: Math.round(r.y * 100) / 100,
             w: Math.round(r.width * 100) / 100, h: Math.round(r.height * 100) / 100 };
  };
  const tiles = Array.from(document.querySelectorAll('.nb-src-tile'));
  const out = { tileCount: tiles.length, tiles: [] };
  for (const tile of tiles) {
    const spinner = tile.querySelector('.nb-src-tile-spinner');
    const icon = tile.querySelector('.nb-src-tile-icon');
    const content = tile.querySelector('.nb-src-tile-content');
    const name = tile.querySelector('.nb-src-tile-name');
    const entry = {
      label: name ? name.textContent.trim() : null,
      loading: !!spinner,
      hasIcon: !!icon,
      hasRemove: !!tile.querySelector('.nb-src-tile-remove'),
      tile: rect(tile),
      content: content ? rect(content) : null,
    };
    if (spinner) {
      const cs = getComputedStyle(spinner);
      entry.spinner = rect(spinner);
      entry.spinnerStyle = {
        position: cs.position, top: cs.top, insetInlineStart: cs.insetInlineStart,
        color: cs.color, lineHeight: cs.lineHeight, overflow: cs.overflow,
      };
      const rot = spinner.querySelector('.nb-spinner-rotator');
      if (rot) entry.rotatorAnimation = getComputedStyle(rot).animation;
      const circle = spinner.querySelector('circle');
      if (circle) {
        const ccs = getComputedStyle(circle);
        entry.circle = { stroke: ccs.stroke, strokeWidth: ccs.strokeWidth,
                         dasharray: ccs.strokeDasharray, dashoffset: ccs.strokeDashoffset };
      }
      // Where the icon WOULD be: offset of the spinner from its content box.
      if (content) {
        const c = rect(content), s = rect(spinner);
        entry.spinnerOffsetInContent = { dx: Math.round((s.x - c.x) * 100) / 100,
                                         dy: Math.round((s.y - c.y) * 100) / 100 };
      }
    }
    if (icon) entry.icon = rect(icon);
    out.tiles.push(entry);
  }
  return out;
}`;

/**
 * Proof the spinner is actually running, read off the animation objects rather than by
 * sampling frames.
 *
 * A `requestAnimationFrame` sampler HANGS here: this is a window the user is not looking
 * at, Chrome stops rAF in it, and the promise never settles — which reads as a hung script,
 * not as a failed check. `getAnimations()` reports `playState` off the timeline, no frames
 * required.
 */
const ANIMATIONS = `() => {
  const spinner = document.querySelector('.nb-src-tile-spinner');
  if (!spinner) return { error: 'no spinner' };
  const all = [spinner, ...spinner.querySelectorAll('*')].flatMap((el) =>
    (el.getAnimations ? el.getAnimations() : []).map((a) => ({
      target: el.className || el.tagName,
      name: a.animationName,
      playState: a.playState,
      duration: a.effect ? Math.round(a.effect.getTiming().duration) : null,
      easing: a.effect ? a.effect.getTiming().easing : null,
      iterations: a.effect ? a.effect.getTiming().iterations : null,
    })),
  );
  return { count: all.length, running: all.filter((a) => a.playState === 'running').length, all };
}`;

(async () => {
  const browser = await connect();
  let page = null;
  /*
   * Every request being held, so it can be killed rather than left to complete. `abort()` is
   * what makes the fetch FAIL, which is the only outcome that cannot store a source; simply
   * dropping the reference lets Chrome finish it the moment interception goes away.
   */
  const heldRequests = [];
  const releaseHeld = async (why) => {
    if (!heldRequests.length) return;
    console.log(`  aborting ${heldRequests.length} held request(s) — ${why}`);
    await Promise.all(heldRequests.splice(0).map((r) => r.abort('failed').catch(() => {})));
  };
  /* A timeout sends SIGTERM, and that used to be exactly when the source leaked. */
  const onSignal = (sig) => {
    releaseHeld(sig).finally(() => process.exit(130));
  };
  process.once('SIGINT', () => onSignal('SIGINT'));
  process.once('SIGTERM', () => onSignal('SIGTERM'));

  try {
    page = await openOwnWindow(browser, 'http://localhost:3000/notebooks/view');
    await page.waitForSelector('.nb-card, button', { timeout: 30000 });
    await sleep(2500);

    // Held and never resolved, so nothing is ever stored — see the file note.
    await page.setRequestInterception(true);
    let held = 0;
    page.on('request', (req) => {
      if (req.url().includes('/api/fetch-source')) {
        held += 1;
        heldRequests.push(req);
        console.log('  holding fetch-source #' + held + ' (never resolved)');
        return; // no continue, no abort: it simply hangs until releaseHeld kills it
      }
      req.continue().catch(() => {});
    });

    if (!/\/notebook\//.test(page.url())) {
      await page.waitForSelector('.nb-card', { timeout: 30000 });
      await page.evaluate(() => document.querySelector('.nb-card').click());
    }
    await page.waitForSelector('.nb-source-chip', { timeout: 30000 });
    await sleep(1200);
    console.log('  at', page.url());

    // Open the sources dialog from the chip.
    await page.evaluate(() => document.querySelector('.nb-source-chip').click());
    await page.waitForSelector('.nb-src-pane', { timeout: 15000 });
    await sleep(900);

    // The rail entry is "Add websites", and it is a `.nb-src-rail-item`.
    const opened = await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('.nb-src-rail-item'))
        .find((b) => /website/i.test(b.textContent || ''));
      if (!btn) return false;
      btn.click();
      return true;
    });
    if (!opened) throw new Error('no "Add websites" rail entry found');
    await page.waitForSelector('.nb-sub-textarea', { timeout: 10000 });
    await sleep(600);

    /*
     * Scoped to `.nb-sub-textarea` deliberately. A bare `querySelector('textarea')` picks
     * the notebook page's COMPOSER, which comes first in document order — the URL went
     * there, the dialog's state never changed, and Insert stayed disabled.
     */
    const typed = await page.evaluate(() => {
      const box = document.querySelector('.nb-sub-textarea');
      if (!box) return false;
      const desc = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(box), 'value');
      desc.set.call(box, 'https://en.wikipedia.org/wiki/Photosynthesis');
      box.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    });
    if (!typed) throw new Error('no .nb-sub-textarea found');
    await sleep(500);

    // The confirm button is labelled "Insert", not "Add".
    const submitted = await page.evaluate(() => {
      const btn = document.querySelector('.nb-sub-confirm');
      if (!btn || btn.disabled) return { ok: false, disabled: btn ? btn.disabled : null };
      btn.click();
      return { ok: true, label: btn.textContent.trim() };
    });
    console.log('  submit:', JSON.stringify(submitted));
    if (!submitted.ok) throw new Error('Insert was disabled — the textarea did not take');

    // Pending now, and staying pending: the fetch is hanging.
    await sleep(1600);
    const pendingState = await page.evaluate(new Function('return ' + MEASURE)());
    console.log('\n=== PENDING ===');
    console.log(JSON.stringify(pendingState, null, 2));

    const anims = await page.evaluate(new Function('return ' + ANIMATIONS)());
    console.log('\n=== ANIMATIONS ===');
    console.log(JSON.stringify(anims, null, 2));

    const shot = outPath('src-chip/willow-spinner-pending.png');
    fs.mkdirSync(require('path').dirname(shot), { recursive: true });
    await page.screenshot({ path: shot });
    console.log('saved', shot);

    /*
     * The live tile's own pixels.
     *
     * `spinner-vs-mdc.cjs` proves the CSS draws MDC's arc when mounted in isolation; it cannot
     * prove the real tile does. Inside the tile the spinner inherits colour, sits under
     * `overflow: hidden` on a 20px radius, and shares a stacking context with the name — so
     * clipping or a colour it did not expect would show here and nowhere else. Same radius-band
     * test as the other script: every lit pixel should sit at r≈8 from the spinner's centre.
     */
    const live = await page.evaluate(() => {
      const spinner = document.querySelector('.nb-src-tile-spinner');
      if (!spinner) return { error: 'no pending spinner on screen' };
      const r = spinner.getBoundingClientRect();
      return { box: { x: r.x, y: r.y, w: r.width, h: r.height } };
    });
    console.log('\n=== LIVE TILE ===');
    if (live.error) {
      console.log('  ' + live.error);
    } else {
      /* Crop straight out of a fresh screenshot — no DOM mutation, so nothing shifts. */
      const b64 = await page.screenshot({ type: 'png', encoding: 'base64' });
      const ink = await page.evaluate(async (dataUrl, box) => {
        const bmp = await createImageBitmap(await (await fetch(dataUrl)).blob());
        const scale = bmp.width / window.innerWidth;
        const cv = new OffscreenCanvas(bmp.width, bmp.height);
        const ctx = cv.getContext('2d');
        ctx.drawImage(bmp, 0, 0);
        const px = ctx.getImageData(0, 0, bmp.width, bmp.height).data;
        const cx = (box.x + box.w / 2) * scale;
        const cy = (box.y + box.h / 2) * scale;
        const rNom = (8 / 20) * box.w * scale;
        const slack = ((4 / 20) * box.w * scale) / 2 + 1.6 * scale;
        let lit = 0, off = 0, minR = Infinity, maxR = 0;
        const x0 = Math.floor(box.x * scale) - 3, y0 = Math.floor(box.y * scale) - 3;
        const x1 = Math.ceil((box.x + box.w) * scale) + 3, y1 = Math.ceil((box.y + box.h) * scale) + 3;
        for (let y = Math.max(0, y0); y < Math.min(bmp.height, y1); y += 1) {
          for (let x = Math.max(0, x0); x < Math.min(bmp.width, x1); x += 1) {
            const i = (y * bmp.width + x) * 4;
            // The tile's fill is a light translucent grey, so key on the ARC's brightness:
            // it is rgb(230,230,230) against that fill, well above it.
            if (px[i] < 150) continue;
            lit += 1;
            const dx = x + 0.5 - cx, dy = y + 0.5 - cy;
            const rad = Math.sqrt(dx * dx + dy * dy);
            minR = Math.min(minR, rad); maxR = Math.max(maxR, rad);
            if (Math.abs(rad - rNom) > slack) off += 1;
          }
        }
        const round = (n) => Math.round(n * 10) / 10;
        return { scale, lit, off, offPct: lit ? round((off / lit) * 100) : null,
                 rMin: lit ? round(minR / scale) : null, rMax: lit ? round(maxR / scale) : null };
      }, 'data:image/png;base64,' + b64, live.box);
      console.log('  spinner box:', JSON.stringify(live.box));
      console.log(`  ink: lit=${ink.lit} offRing=${ink.offPct}% r=[${ink.rMin}..${ink.rMax}] (nominal 8)`);
      console.log('  on the ring:', ink.lit === 0
        ? 'INCONCLUSIVE — no ink found in the spinner box'
        : ink.offPct <= 8 ? 'PASS — the live tile draws the arc on its ring'
        : `FAIL — ${ink.offPct}% of ink is off-ring, so the real tile is not drawing MDC's arc`);

      const tile = await page.evaluate(() => {
        const t = document.querySelector('.nb-src-tile-spinner').closest('.nb-src-tile');
        const r = t.getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height };
      });
      const tileShot = outPath('src-chip/willow-spinner-tile.png');
      await page.screenshot({ path: tileShot, clip: tile });
      console.log('  saved', tileShot);
    }

    console.log('\n  held requests:', held);
  } finally {
    // Before the window closes: a request still hanging here is one Chrome may yet complete.
    await releaseHeld('run finished');
    if (page) await page.close().catch(() => {});
    await browser.disconnect();
  }
})();
