/**
 * Willow's spinner against MDC's own, pixel for pixel, at the same phases.
 *
 * The invariants an earlier probe invented ("ink on both sides of centre", "one contiguous
 * arc") each reported a failure against a spinner that turned out to be correct. A made-up
 * rule is a bad oracle. This uses the real one: `gemini-spinner.css` in the captures is MDC's
 * actual stylesheet, so MDC's spinner can be built from its own class names, rendered beside
 * Willow's, and the two compared. No Gemini tab is opened and nothing can reach the notebook.
 *
 * Why the minimum arc is TWO pieces, which is what sent me here: at t=0 the left graphic is
 * at `rotate(265deg)` and the right at `rotate(-265deg)`, so the two semicircles sit 170°
 * apart and each clipper's window catches only a ~5° sliver of its own — one at each end of
 * the ring. Two nubs 180° apart is MDC's shortest arc, not a break in Willow's.
 *
 * What makes the comparison fair:
 *
 *  - Both are 20px and both get the SAME inline circle geometry Angular Material computes for
 *    `diameter: 20, strokeWidth: 4`; the stroke is forced to one colour on both, since MDC
 *    takes it from a theme variable and Willow from `currentColor`.
 *  - Every animation on both is paused and seeked to the same `currentTime`, so they are
 *    compared at one phase rather than at whatever frame each happened to be on.
 *  - `--mat-progress-spinner-animation-multiplier: 1` is declared. Without it MDC's
 *    `animation: … calc(1568.2352941176ms * var(--multiplier)) …` is invalid at computed-value
 *    time, the shorthand drops, and MDC's spinner sits frozen — which would read as a Willow
 *    bug. The same variable is why `mdcLit === 0` is treated as inconclusive below rather than
 *    as a pass: an invisible reference agrees with nothing.
 */
const { connect, openOwnWindow, outPath, sleep } = require('../ui-research/scrapers/notebooks/lib.cjs');
const fs = require('fs');
const path = require('path');

const CAPTURES = path.resolve(__dirname, '../ui-research/captures/notebooks/src-chip');
const MDC_CSS = fs.readFileSync(path.join(CAPTURES, 'gemini-spinner.css'), 'utf8');

const D = 20;
const STROKE = 4;
const R = (D - STROKE) / 2;
const CIRC = 2 * Math.PI * R;
/* The inline style Angular Material writes on every circle of an indeterminate spinner. */
const CIRCLE_STYLE =
  `stroke-dasharray:${CIRC}px;stroke-dashoffset:${CIRC / 2}px;stroke-width:${(STROKE / D) * 100}%`;

const svg = (cls) =>
  `<svg class="${cls}" viewBox="0 0 ${D} ${D}"><circle cx="50%" cy="50%" r="${R}" ` +
  `style="${CIRCLE_STYLE}"/></svg>`;

/* Willow's, exactly as `TileSpinner` renders it — tags closed tight, no whitespace nodes. */
const WILLOW =
  '<span class="nb-src-tile-spinner" role="progressbar" style="width:20px;height:20px">' +
  '<span class="nb-spinner-rotator"><span class="nb-spinner-layer">' +
  `<span class="nb-spinner-clip nb-spinner-clip-left">${svg('nb-spinner-graphic')}</span>` +
  `<span class="nb-spinner-gap">${svg('nb-spinner-graphic')}</span>` +
  `<span class="nb-spinner-clip nb-spinner-clip-right">${svg('nb-spinner-graphic')}</span>` +
  '</span></span></span>';

/* MDC's, from its own class names. `--indeterminate` is what carries every animation. */
const G = 'mdc-circular-progress__indeterminate-circle-graphic';
const MDC =
  '<div class="mdc-circular-progress mdc-circular-progress--indeterminate" ' +
  'style="width:20px;height:20px;--mat-progress-spinner-animation-multiplier:1">' +
  '<div class="mdc-circular-progress__indeterminate-container">' +
  '<div class="mdc-circular-progress__spinner-layer">' +
  `<div class="mdc-circular-progress__circle-clipper mdc-circular-progress__circle-left">${svg(G)}</div>` +
  `<div class="mdc-circular-progress__gap-patch">${svg(G)}</div>` +
  `<div class="mdc-circular-progress__circle-clipper mdc-circular-progress__circle-right">${svg(G)}</div>` +
  '</div></div></div>';

/**
 * The same spinner inside the REAL tile, which is a different question.
 *
 * A bare mount proves the CSS draws MDC's arc. It cannot prove the shipped tile does: there
 * the spinner sits at inset 12 of a 112px box with `border-radius: 20px` and
 * `overflow: hidden`, inherits its colour rather than being handed one, and shares a stacking
 * context with the clamped name. The corner curve clears the spinner by arithmetic — at x=12
 * the boundary is y≈1.7, well above the spinner's top — but `getBoundingClientRect` cannot see
 * clipping at all, so the only way to know is to render it and read the pixels.
 */
const TILE =
  '<div class="nb-src-tile"><span class="nb-src-tile-content">' +
  WILLOW +
  '<span class="nb-src-tile-name">Photosynthesis</span>' +
  '</span></div>';

/**
 * Lit-pixel sets for every crop out of ONE screenshot, compared against MDC's.
 *
 * One screenshot for all of them deliberately: separate captures could straddle a repaint, and
 * then a disagreement would be timing rather than geometry. Ink is keyed by position RELATIVE
 * to each box, which is what lets the 20x20 boxes be overlaid.
 *
 * The threshold is 45. The arc is `rgb(230,230,230)`; black reads 0 and the tile's
 * `rgba(255,255,255,0.12)` fill over black reads 31, so both backgrounds fall below it. That
 * fill does mean the tile's anti-aliased edge pixels blend up from 31 rather than 0, so a few
 * more of them clear the threshold — which is why an excess of ink on the tile is reported but
 * not failed, while ink MISSING from the tile is the real signal: that is clipping.
 */
const COMPARE = `async (dataUrl, boxes) => {
  const bmp = await createImageBitmap(await (await fetch(dataUrl)).blob());
  const scale = bmp.width / window.innerWidth;   // measured, not assumed from DPR
  const cv = new OffscreenCanvas(bmp.width, bmp.height);
  const ctx = cv.getContext('2d');
  ctx.drawImage(bmp, 0, 0);
  const px = ctx.getImageData(0, 0, bmp.width, bmp.height).data;

  const read = (box) => {
    const set = new Set();
    const x0 = Math.round(box.x * scale), y0 = Math.round(box.y * scale);
    const w = Math.round(box.w * scale), h = Math.round(box.h * scale);
    for (let dy = 0; dy < h; dy += 1) {
      for (let dx = 0; dx < w; dx += 1) {
        const i = ((y0 + dy) * bmp.width + (x0 + dx)) * 4;
        if (px[i] >= 45) set.add(dy * w + dx);
      }
    }
    return set;
  };

  /* boxes[1] is MDC — every other crop is scored against it. */
  const dims = boxes.map((b) => Math.round(b.w * scale));
  const sets = boxes.map(read);
  const ref = sets[1];
  const refW = dims[1];
  return sets.map((set, idx) => {
    let both = 0;
    const extra = [];
    for (const k of set) { if (ref.has(k)) both += 1; else extra.push(k); }
    const union = set.size + ref.size - both;

    /*
     * Split the extra ink into "hugs the arc" and "sits apart from it".
     *
     * This is the distinction that matters and a bare IoU cannot make. Anti-aliasing against
     * the tile's translucent fill necessarily lights a few more EDGE pixels — every one of
     * them touching a pixel MDC also drew. Ink that is NOT adjacent to MDC's arc is something
     * else entirely: a second arc, a stray graphic, a mis-clipped copy. At these pixel counts
     * (18 at the minimum) a handful of edge pixels swings IoU by 28 points, so thresholding
     * the ratio would fail a correct render — as it did before this split existed.
     */
    const w = dims[idx];
    let adjacent = 0;
    for (const k of extra) {
      const y = Math.floor(k / w), x = k % w;
      let touches = false;
      for (let dy = -1; dy <= 1 && !touches; dy += 1) {
        for (let dx = -1; dx <= 1 && !touches; dx += 1) {
          if (!dx && !dy) continue;
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= refW) continue;
          if (ref.has(ny * refW + nx)) touches = true;
        }
      }
      if (touches) adjacent += 1;
    }

    return {
      lit: set.size,
      shared: both,
      only: extra.length,             // ink this crop has and MDC does not
      onlyAdjacent: adjacent,         // ...of which touches MDC's arc: anti-aliasing
      onlyIsolated: extra.length - adjacent,  // ...and this does not: a real defect
      missing: ref.size - both,       // ink MDC has and this crop does not: clipping
      iou: union ? Math.round((both / union) * 1000) / 10 : null,
    };
  });
}`;

const SETUP = `(willow, mdc, tile, mdcCss) => {
  /*
   * Hide the app's root rather than empty the body: React is still mounted, and clearing its
   * container invites a re-render that repopulates the page mid-capture. Hiding also leaves
   * <head>'s style tags alone, which is where Vite puts the app's CSS in dev — so the Willow
   * rules under test are the ones the app is actually running.
   */
  const root = document.querySelector('#root') || document.querySelector('body > div');
  if (root) root.style.display = 'none';
  document.body.style.cssText = 'background:#000;margin:0';

  const style = document.createElement('style');
  style.textContent = mdcCss;
  document.head.appendChild(style);

  /* An 88x88 box — the tile's real content box — so the \`position: absolute\` spinner has a
   * containing block and does not escape to the viewport. The tile case brings its own. */
  const mount = (html, left, sel) => {
    const host = document.createElement('div');
    host.style.cssText =
      'position:fixed;top:40px;left:' + left + 'px;width:112px;height:112px;background:#000;' +
      'color:rgb(230,230,230);z-index:99999';
    if (!sel) host.style.cssText += 'width:88px;height:88px';
    host.innerHTML = html;
    document.body.appendChild(host);
    const outer = host.firstElementChild;
    /* What gets measured is the SPINNER, even when what is mounted is the whole tile. */
    const el = sel ? outer.querySelector(sel) : outer;
    for (const c of el.querySelectorAll('circle')) c.style.stroke = 'rgb(230,230,230)';
    const anims = [el, ...el.querySelectorAll('*')]
      .flatMap((n) => (n.getAnimations ? n.getAnimations() : []));
    for (const a of anims) a.pause();
    const r = el.getBoundingClientRect();
    return { host, outer, el, anims, box: { x: r.x, y: r.y, w: r.width, h: r.height } };
  };

  const w = mount(willow, 40);
  const m = mount(mdc, 200);
  const t = mount(tile, 360, '.nb-src-tile-spinner');
  window.__both = [w, m, t];
  window.__seek = (ms) => {
    for (const side of window.__both) {
      for (const a of side.anims) { try { a.currentTime = ms; } catch {} }
    }
  };
  window.__compare = ${COMPARE};

  const durations = (side) => side.anims
    .map((a) => Math.round(a.effect.getTiming().duration)).sort((x, y) => x - y);
  const describe = (side) => ({
    box: side.box, anims: side.anims.length, durations: durations(side),
  });

  /* The tile's corner geometry, to say whether clipping is even in play. */
  const tileRect = t.outer.getBoundingClientRect();
  return {
    willow: describe(w),
    mdc: describe(m),
    tile: Object.assign(describe(t), {
      radius: getComputedStyle(t.outer).borderRadius,
      overflow: getComputedStyle(t.outer).overflow,
      inheritedColor: getComputedStyle(t.el).color,
      spinnerInsetFromTile: {
        dx: Math.round((t.box.x - tileRect.x) * 100) / 100,
        dy: Math.round((t.box.y - tileRect.y) * 100) / 100,
      },
    }),
  };
}`;

/**
 * Announce each step BEFORE awaiting it, and cap it.
 *
 * `lib.cjs` connects with `protocolTimeout: 0`, so any CDP call can hang forever — and with
 * the first `console.log` sitting after five awaits, a hang printed nothing at all and the
 * outer `timeout` killed the run with an empty log. Naming the step first turns that into a
 * message that says which call stalled.
 */
const startedAt = Date.now();
async function step(name, run, ms = 45000) {
  process.stdout.write(`  … ${name}\n`);
  let timer = null;
  try {
    const out = await Promise.race([
      run(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${name}: no answer in ${ms}ms`)), ms);
      }),
    ]);
    process.stdout.write(`  ok ${name} (+${Date.now() - startedAt}ms)\n`);
    return out;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

(async () => {
  const browser = await step('connect to :9222', () => connect());
  let page = null;
  try {
    page = await step('open own window', () => openOwnWindow(browser, 'http://localhost:3000/notebooks/view'));
    await step('wait for body', () => page.waitForSelector('body', { timeout: 30000 }));
    await sleep(2500);

    const info = await step('mount all three', () =>
      page.evaluate(new Function('return ' + SETUP)(), WILLOW, MDC, TILE, MDC_CSS));

    console.log('\n=== MOUNTED ===');
    for (const key of ['willow', 'mdc', 'tile']) {
      console.log(`  ${key.padEnd(6)}:`, JSON.stringify(info[key]));
    }
    if (!info.mdc.anims || !info.willow.anims || !info.tile.anims) {
      throw new Error(
        `no animations (willow=${info.willow.anims}, mdc=${info.mdc.anims}, ` +
        `tile=${info.tile.anims}) — a stylesheet did not apply, so nothing below means anything`,
      );
    }
    const sameDurations = ['willow', 'tile'].every(
      (k) => JSON.stringify(info[k].durations) === JSON.stringify(info.mdc.durations),
    );
    console.log('  durations match   :', sameDurations,
      sameDurations ? `(${info.mdc.durations.join(', ')})` : '<-- see above');

    /* A full clipper cycle, including the boundary phase an earlier probe flagged. */
    const phases = [0, 166, 333, 500, 666, 833, 999, 1166, 1332];
    const boxes = [info.willow.box, info.mdc.box, info.tile.box];
    const rows = [];
    console.log('\n=== PIXELS, vs MDC ===');
    console.log('        |  bare willow                |  in the real tile');
    console.log('   t    |  lit same extra miss   IoU  |  lit same  edge stray miss   IoU  (mdc)');
    for (const t of phases) {
      await page.evaluate((ms) => window.__seek(ms), t);
      const b64 = await page.screenshot({ type: 'png', encoding: 'base64' });
      const [w, m, tile] = await page.evaluate(
        (url, bx) => window.__compare(url, bx),
        'data:image/png;base64,' + b64,
        boxes,
      );
      rows.push({ t, w, m, tile });
      const n = (v, pad) => String(v).padStart(pad);
      console.log(
        `  ${n(t, 4)}ms | ${n(w.lit, 4)} ${n(w.shared, 4)} ${n(w.only, 5)} ${n(w.missing, 4)}` +
        ` ${n(w.iou, 5)}% | ${n(tile.lit, 4)} ${n(tile.shared, 4)} ${n(tile.onlyAdjacent, 5)}` +
        ` ${n(tile.onlyIsolated, 5)} ${n(tile.missing, 4)} ${n(tile.iou, 5)}%  (${m.lit})`,
      );
    }

    console.log('\n=== VERDICT ===');
    const blindMdc = rows.filter((r) => r.m.lit === 0);
    if (blindMdc.length) {
      /* Agreeing with an invisible reference is not agreement. */
      console.log('  INCONCLUSIVE — the MDC reference drew nothing at',
        blindMdc.map((r) => r.t + 'ms').join(', '));
    }

    /*
     * Three questions, and none of them is a raw IoU threshold.
     *
     * IoU was the criterion in a previous revision and it failed the tile at 72% — on a render
     * whose ink was a superset of MDC's, differing only in anti-aliased edge pixels against the
     * tile's translucent fill. At 18 lit pixels, seven edge pixels move IoU by 28 points. So:
     * missing ink is clipping, ISOLATED extra ink is a stray graphic, and adjacent extra ink is
     * anti-aliasing and carries no verdict at all.
     */
    const report = (label, pick) => {
      const clipped = rows.filter((r) => pick(r).missing > 2);
      const stray = rows.filter((r) => (pick(r).onlyIsolated ?? pick(r).only) > 2);
      console.log(`  ${label} — draws MDC's arc :`, clipped.length === 0
        ? 'PASS — every pixel MDC draws is present, all 9 phases'
        : 'FAIL — ink missing at ' +
          clipped.map((r) => `${r.t}ms (${pick(r).missing}px)`).join(', '));
      console.log(`  ${label} — nothing extra   :`, stray.length === 0
        ? 'PASS — no ink apart from the arc'
        : 'FAIL — stray ink at ' +
          stray.map((r) => `${r.t}ms (${pick(r).onlyIsolated ?? pick(r).only}px)`).join(', '));
    };
    report('bare', (r) => r.w);
    report('tile', (r) => r.tile);
    const edge = rows.reduce((n, r) => n + r.tile.onlyAdjacent, 0);
    const strayTotal = rows.reduce((n, r) => n + r.tile.onlyIsolated, 0);
    console.log('  tile edge ink  :', `${edge}px adjacent to the arc across 9 phases`,
      `(anti-aliasing against the tile fill), ${strayTotal}px isolated`);
    console.log('  tile context   :', `radius ${info.tile.radius}, overflow ${info.tile.overflow},`,
      `spinner at +${info.tile.spinnerInsetFromTile.dx}/+${info.tile.spinnerInsetFromTile.dy}`,
      `from the tile corner, inherited colour ${info.tile.inheritedColor}`);

    /* All three, side by side and 8x, for the phases most worth looking at. */
    const STRIP = [0, 333, 666, 999];
    const stripBox = await page.evaluate((ts) => {
      // Hide via the stored host handle. A `[style*="position:fixed"]` selector cannot match
      // here: the serialized style attribute reads `position: fixed` with a space.
      for (const side of window.__both) side.host.style.display = 'none';

      const strip = document.createElement('div');
      strip.style.cssText =
        'position:fixed;left:0;top:0;display:grid;grid-auto-flow:column;gap:6px;padding:6px;' +
        'background:#000;z-index:999999';
      // In the document BEFORE the clones: an element outside it has no animations at all, so
      // pausing and seeking them is a no-op and every cell shows the same live phase.
      document.body.appendChild(strip);

      for (const t of ts) {
        const col = document.createElement('div');
        col.style.cssText = 'display:flex;flex-direction:column;gap:6px';
        // Into the document BEFORE the clones, and that means the COLUMN too — not just the
        // strip. A first version built the column detached and appended it after pausing, so
        // the clones were still outside the tree, `getAnimations()` returned [], the seek was
        // a silent no-op, and every cell rendered the same live phase.
        strip.appendChild(col);
        for (const side of window.__both) {
          const cell = document.createElement('div');
          cell.style.cssText =
            'width:160px;height:160px;position:relative;overflow:hidden;color:rgb(230,230,230)';
          col.appendChild(cell);
          /*
           * `outer`, not `el`: for the two bare spinners those are the same node, but for the
           * tile case `outer` is the whole tile — which is the point, since its fill and its
           * clipped corner are what this row is for.
           */
          const clone = side.outer.cloneNode(true);
          const isTile = clone.classList.contains('nb-src-tile');
          // 6x and shifted 6px in for the tile, so one 160px cell holds both the corner curve
          // and the whole spinner (which sits at inset 12 of a 112px box). 8x for the others.
          clone.style.transform = isTile ? 'scale(6) translate(-6px, -6px)' : 'scale(8)';
          clone.style.transformOrigin = 'top left';
          cell.appendChild(clone);
          const anims = [clone, ...clone.querySelectorAll('*')]
            .flatMap((n) => (n.getAnimations ? n.getAnimations() : []));
          if (!anims.length) throw new Error('clone has no animations — it is not in the document');
          for (const a of anims) {
            a.pause();
            try { a.currentTime = t; } catch {}
          }
        }
      }
      const r = strip.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    }, STRIP);
    await sleep(400);
    /*
     * `page.screenshot({clip})`, not `elementHandle.screenshot()`. The latter scrolls the
     * element into view and waits for a stable box first, and in a window Chrome is not
     * painting that wait never finishes — the run hangs until the outer timeout kills it,
     * which looks like a broken script rather than a skipped screenshot.
     */
    const shot = outPath('src-chip/willow-vs-mdc-spinner.png');
    await page.screenshot({ path: shot, clip: stripBox });
    console.log('\n  strip: rows: bare Willow, MDC, real tile, t =', STRIP.join(', ') + 'ms');
    console.log('  ' + shot);
  } finally {
    if (page) await page.close().catch(() => {});
    await browser.disconnect();
  }
})();
