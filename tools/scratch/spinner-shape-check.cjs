/**
 * Is the spinner a growing ARC, or the wave the missing `left: -100%` drew?
 *
 * A `getBoundingClientRect` cannot answer that — the box is 20x20 either way, which is why
 * the bug survived an earlier run that measured every rect and read every `playState`. This
 * reads PIXELS across a full clipper cycle and asks three geometric questions of them:
 *
 *   1. Is the ink on the ring? Every lit pixel should sit at r≈8 from the centre, within the
 *      stroke's half-width. This is the test that catches the bug: with `left: -100%`
 *      missing, the right clipper's window falls on a circle centred on the box's right EDGE
 *      rather than its middle, so its ink lands at radii of ~2 and ~13 instead of 8.
 *   2. Is it ONE arc? Measured from the gaps between pixel angles: a single arc leaves one
 *      large gap in the ring (its unlit remainder) and nothing else. Two arcs leave two.
 *   3. Does it sweep? The arc's angular extent must change across the 1333ms cycle, or it is
 *      a static ring fragment rather than MDC's growing-and-shrinking arc.
 *
 * An earlier revision also asked whether ink appeared either side of the centre line. That
 * is NOT an invariant — MDC's arc shrinks to ~25°, which fits inside one quadrant — and it
 * reported a failure against a spinner that was already correct.
 *
 * Three things about how it runs, each one a trap paid for earlier:
 *
 *  - **It never touches `/api/fetch-source`, the sources dialog, or the notebook.** The run
 *    that held that request open lost its interception when the process died, Chrome
 *    completed the request, and a source landed in the user's real notebook. Here the tile's
 *    markup is mounted directly against the app's own already-loaded stylesheet, so the
 *    thing under test is the shipped CSS and nothing can reach storage.
 *  - **Phases are seeked, not waited for.** Chrome paints no frames in a window nobody is
 *    looking at, so a wait-and-screenshot loop reads one frame four times, or none.
 *    `animation.currentTime` is frame-independent and deterministic.
 *  - **The PNG is decoded back inside the page**, via `createImageBitmap` into an
 *    `OffscreenCanvas`. No image decoder is installed in this repo, and adding one for a
 *    scratch probe is not worth it. The offscreen canvas is never in the DOM, so decoding
 *    one screenshot cannot disturb the next.
 */
const { connect, openOwnWindow, outPath, sleep } = require('../ui-research/scrapers/notebooks/lib.cjs');
const fs = require('fs');

/*
 * The markup `TileSpinner` renders, and the inline circle style `SpinnerArc` computes for
 * `diameter: 20, strokeWidth: 4`. Kept in step with SourceTile.tsx by hand — a divergence
 * here tests something the app does not render. The tags are closed tight against each
 * other on purpose: the clippers are inline-level, so a newline between them is a word
 * space, and reproducing the JSX means reproducing that it has none.
 */
const R = (20 - 4) / 2;
const CIRC = 2 * Math.PI * R;

function arc() {
  return (
    `<svg class="nb-spinner-graphic" viewBox="0 0 20 20"><circle cx="50%" cy="50%" r="${R}" ` +
    `style="stroke-dasharray:${CIRC}px;stroke-dashoffset:${CIRC / 2}px;stroke-width:20%"/></svg>`
  );
}

const MARKUP =
  '<span class="nb-src-tile-spinner" role="progressbar" style="width:20px;height:20px">' +
  '<span class="nb-spinner-rotator"><span class="nb-spinner-layer">' +
  `<span class="nb-spinner-clip nb-spinner-clip-left">${arc()}</span>` +
  `<span class="nb-spinner-gap">${arc()}</span>` +
  `<span class="nb-spinner-clip nb-spinner-clip-right">${arc()}</span>` +
  '</span></span></span>';

/**
 * Mount the tile, then hand back the handles the sampler needs.
 *
 * The app's root is hidden rather than the body emptied: React is still mounted, and
 * clearing its container invites a re-render that repopulates the page mid-capture. Hiding
 * the root also leaves `<head>`'s style tags in place, which is where Vite puts the app's
 * CSS in dev — so the rules under test are the ones the app is actually running.
 */
const SETUP = `(markup) => {
  const root = document.querySelector('#root') || document.querySelector('body > div');
  if (root) root.style.display = 'none';
  document.body.style.background = '#000';
  document.body.style.margin = '0';

  const host = document.createElement('div');
  /*
   * The spinner is \`position: absolute\`, so it needs a containing block or it escapes to
   * the viewport and the crop misses it. 88x88 at inset 12 is the tile's real content box.
   */
  host.style.cssText = 'position:fixed;left:40px;top:40px;width:88px;height:88px;background:#000;z-index:99999';
  host.innerHTML = markup;
  document.body.appendChild(host);

  const spinner = host.querySelector('.nb-src-tile-spinner');
  const anims = [spinner, ...spinner.querySelectorAll('*')]
    .flatMap((el) => (el.getAnimations ? el.getAnimations() : []));
  for (const a of anims) a.pause();

  const cs = getComputedStyle(spinner);
  const rightGraphic = host.querySelector('.nb-spinner-clip-right .nb-spinner-graphic');
  const leftGraphic = host.querySelector('.nb-spinner-clip-left .nb-spinner-graphic');
  const r = spinner.getBoundingClientRect();

  window.__seek = (t) => { for (const a of anims) { try { a.currentTime = t; } catch {} } };

  /* Decode a screenshot and classify its ink, in the page, off an OffscreenCanvas. */
  window.__classify = async (dataUrl, box, geom) => {
    const bmp = await createImageBitmap(await (await fetch(dataUrl)).blob());
    const scale = bmp.width / window.innerWidth;   // measured, not assumed from DPR
    const cv = new OffscreenCanvas(bmp.width, bmp.height);
    const ctx = cv.getContext('2d');
    ctx.drawImage(bmp, 0, 0);
    const px = ctx.getImageData(0, 0, bmp.width, bmp.height).data;

    const cx = (box.x + box.w / 2) * scale;
    const cy = (box.y + box.h / 2) * scale;
    const rNom = (geom.r / geom.d) * box.w * scale;
    const half = ((geom.stroke / geom.d) * box.w * scale) / 2;
    const slack = half + 1.6 * scale;             // anti-aliasing widens the band

    const x0 = Math.max(0, Math.floor(box.x * scale) - 4);
    const y0 = Math.max(0, Math.floor(box.y * scale) - 4);
    const x1 = Math.min(bmp.width, Math.ceil((box.x + box.w) * scale) + 4);
    const y1 = Math.min(bmp.height, Math.ceil((box.y + box.h) * scale) + 4);

    let lit = 0, offRing = 0, left = 0, right = 0, top = 0, bottom = 0;
    let minR = Infinity, maxR = 0;
    const angles = [];
    for (let y = y0; y < y1; y += 1) {
      for (let x = x0; x < x1; x += 1) {
        /*
         * Ink threshold. The arc is #e6e6e6 on #000 with nothing else in the crop, so
         * anything well clear of black is ink and 45 is not a noise risk. It was 90, which
         * was too high at the arc's MINIMUM: 12° of heavily anti-aliased sliver dimmed below
         * it, and the same phase read 12 lit pixels on one run and 0 on the next.
         */
        if (px[(y * bmp.width + x) * 4] < 45) continue;
        lit += 1;
        const dx = x + 0.5 - cx, dy = y + 0.5 - cy;
        const rad = Math.sqrt(dx * dx + dy * dy);
        if (rad < minR) minR = rad;
        if (rad > maxR) maxR = rad;
        if (Math.abs(rad - rNom) > slack) offRing += 1;
        if (dx < 0) left += 1; else right += 1;
        if (dy < 0) top += 1; else bottom += 1;
        angles.push(((Math.atan2(dy, dx) * 180) / Math.PI + 360) % 360);
      }
    }

    /*
     * The arc's extent and how many pieces it is in, from GAPS between the pixel angles
     * rather than from fixed-width bins.
     *
     * Binning into degrees does not work at this size and reported ten runs for one arc: the
     * ring is r=8, so its whole circumference is ~50 pixels of arc, and 360 bins leaves five
     * of every six empty by construction. Gaps are resolution-independent — a single arc has
     * exactly one large gap (the unlit remainder) and the rest are pixel-spacing gaps, while
     * two arcs have two large ones however coarse the sampling.
     */
    angles.sort((a, b) => a - b);
    const gaps = [];
    for (let i = 0; i < angles.length; i += 1) {
      const next = i === angles.length - 1 ? angles[0] + 360 : angles[i + 1];
      gaps.push(next - angles[i]);
    }
    const maxGap = gaps.length ? Math.max(...gaps) : 360;
    // Comfortably above the ~7° a single pixel subtends here, far below an arc's own extent.
    const GAP_DEG = 25;
    const bigGaps = gaps.filter((g) => g > GAP_DEG).length;
    const extent = lit ? Math.round(360 - maxGap) : 0;
    const round = (n) => Math.round(n * 10) / 10;
    return {
      scale, lit, offRing,
      offRingPct: lit ? round((offRing / lit) * 100) : null,
      rMin: lit ? round(minR / scale) : null,
      rMax: lit ? round(maxR / scale) : null,
      rNominal: round(rNom / scale),
      band: round(slack / scale),
      left, right, top, bottom,
      extent, pieces: lit ? bigGaps : 0, maxGap: round(maxGap),
    };
  };

  return {
    /* The rules under test, read back off the shipped CSS rather than assumed. */
    applied: cs.position === 'absolute' && cs.lineHeight === '0px',
    animations: anims.length,
    rightClipperLeft: rightGraphic ? getComputedStyle(rightGraphic).left : null,
    leftClipperLeft: leftGraphic ? getComputedStyle(leftGraphic).left : null,
    rotatorFontSize: getComputedStyle(host.querySelector('.nb-spinner-rotator')).fontSize,
    linecap: getComputedStyle(host.querySelector('circle')).strokeLinecap,
    box: { x: r.x, y: r.y, w: r.width, h: r.height },
  };
}`;

(async () => {
  const browser = await connect();
  let page = null;
  try {
    page = await openOwnWindow(browser, 'http://localhost:3000/notebooks/view');
    await page.waitForSelector('body', { timeout: 30000 });
    await sleep(2500);

    const info = await page.evaluate(new Function('return ' + SETUP)(), MARKUP);
    if (!info.applied || !info.animations) {
      throw new Error(
        `spinner CSS did not apply (applied=${info.applied}, animations=${info.animations}) ` +
        '— the rules were not in the page, so nothing below would mean anything',
      );
    }

    console.log('\n=== SHIPPED CSS ===');
    console.log('  animations found  :', info.animations, '(expect 4)');
    console.log('  left clipper left :', info.leftClipperLeft, '   (expect 0px / auto)');
    console.log('  right clipper left:', info.rightClipperLeft, '   <-- THE FIX: must be negative');
    console.log('  rotator font-size :', info.rotatorFontSize, '   (expect 0px)');
    console.log('  stroke-linecap    :', info.linecap, '            (expect butt)');
    console.log('  spinner box       :', JSON.stringify(info.box));

    const GEOM = { d: 20, r: R, stroke: 4 };
    /*
     * A full clipper cycle, not four arbitrary points. The clippers run at 1333ms, and the
     * arc's length is what that cycle controls — sampling across one of them is what proves
     * the arc grows and shrinks rather than sitting at one size.
     */
    const phases = [0, 166, 333, 500, 666, 833, 999, 1166, 1332];
    const rows = [];
    console.log('\n=== PIXELS ===');
    for (const t of phases) {
      await page.evaluate((ms) => window.__seek(ms), t);
      const b64 = await page.screenshot({ type: 'png', encoding: 'base64' });
      const m = await page.evaluate(
        (url, box, geom) => window.__classify(url, box, geom),
        'data:image/png;base64,' + b64,
        info.box,
        GEOM,
      );
      rows.push({ t, ...m });
      console.log(
        `  t=${String(t).padStart(4)}ms lit=${String(m.lit).padStart(4)}` +
        ` offRing=${String(m.offRingPct).padStart(5)}%` +
        ` r=[${m.rMin}..${m.rMax}]` +
        ` arc=${String(m.extent).padStart(3)}° pieces=${m.pieces}` +
        ` (largest gap ${m.maxGap}°)`,
      );
      if (t === 666) {
        const shot = outPath('src-chip/willow-spinner-arc.png');
        fs.writeFileSync(shot, Buffer.from(b64, 'base64'));
        console.log('    saved', shot);
      }
    }

    /*
     * Three invariants, each one a way the wave differed from an arc.
     *
     * The `both halves` check an earlier revision used is gone: it was not an invariant at
     * all. MDC's arc shrinks to ~25° at its shortest, which legitimately fits inside one
     * quadrant, so "one side of the box is empty" is a normal phase and not a defect.
     */
    const offRing = rows.filter((r) => r.offRingPct > 6);
    const multiRun = rows.filter((r) => r.lit > 0 && r.pieces !== 1);
    const empty = rows.filter((r) => r.lit === 0);
    const arcs = rows.map((r) => r.extent);
    const sweep = Math.max(...arcs) - Math.min(...arcs);

    console.log('\n=== VERDICT ===');
    if (empty.length) {
      console.log('  INCONCLUSIVE — no ink at', empty.map((r) => r.t + 'ms').join(', '),
        '\n  (a blank crop is not a passing arc — check the saved screenshot)');
    }
    console.log('  on the ring :', offRing.length === 0
      ? `PASS — every lit pixel sits at r≈${rows[0].rNominal}±${rows[0].band}, all ${phases.length} phases`
      : 'FAIL — off-ring ink at ' + offRing.map((r) => `${r.t}ms (${r.offRingPct}%)`).join(', '));
    console.log('  one arc     :', multiRun.length === 0
      ? 'PASS — one unbroken arc at every phase (a single gap in the ring)'
      : 'FAIL — broken into pieces at ' + multiRun.map((r) => `${r.t}ms (${r.pieces})`).join(', '));
    console.log('  it sweeps   :', sweep > 100
      ? `PASS — arc ranges ${Math.min(...arcs)}°..${Math.max(...arcs)}° across one 1333ms cycle`
      : `FAIL — arc barely changes (${Math.min(...arcs)}°..${Math.max(...arcs)}°)`);

    /*
     * A zoomed strip, purely to look at. Scaled with a CSS transform rather than by raising
     * the viewport's `deviceScaleFactor`: that is an `Emulation.setDeviceMetricsOverride`,
     * which needs settle time before anything measures true and outlives the connection that
     * set it. A transform needs neither, and nothing is measured after this point anyway.
     */
    const STRIP = [0, 333, 666, 999];
    const stripBox = await page.evaluate((ts) => {
      const host = document.querySelector('.nb-src-tile-spinner').parentElement;
      const template = host.querySelector('.nb-src-tile-spinner');
      host.style.display = 'none';

      const strip = document.createElement('div');
      strip.style.cssText =
        'position:fixed;left:0;top:0;display:flex;gap:8px;padding:8px;background:#000;z-index:999999';
      // In the document BEFORE the clones: an element outside it has no animations at all,
      // so pausing and seeking them was a no-op and every cell showed the same live phase.
      document.body.appendChild(strip);

      for (const t of ts) {
        const cell = document.createElement('div');
        // 8x with a top-left origin, so each 20px box lands on a predictable 160px square.
        cell.style.cssText = 'width:160px;height:160px;position:relative;overflow:hidden';
        const clone = template.cloneNode(true);
        clone.style.transform = 'scale(8)';
        clone.style.transformOrigin = 'top left';
        cell.appendChild(clone);
        strip.appendChild(cell);
        for (const a of [clone, ...clone.querySelectorAll('*')]
          .flatMap((el) => (el.getAnimations ? el.getAnimations() : []))) {
          a.pause();
          try { a.currentTime = t; } catch {}
        }
      }
      const r = strip.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    }, STRIP);
    await sleep(400);
    /*
     * `page.screenshot({clip})`, not `elementHandle.screenshot()`. The latter scrolls the
     * element into view and waits for a stable box first, and in a window Chrome is not
     * painting that wait never finishes — the run hung until the outer timeout killed it,
     * which looks like a broken script rather than a skipped screenshot.
     */
    const stripShot = outPath('src-chip/willow-spinner-arc-strip.png');
    await page.screenshot({ path: stripShot, clip: stripBox });
    console.log('\n  strip (8x, t =', STRIP.join(', ') + 'ms):', stripShot);
  } finally {
    if (page) await page.close().catch(() => {});
    await browser.disconnect();
  }
})();
