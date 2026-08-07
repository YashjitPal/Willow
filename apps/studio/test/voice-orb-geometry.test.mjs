/**
 * Voice orb geometry, verified against pixels measured from a live session.
 *
 * The capture was taken at a 1536x826 viewport on a 2x display, in the
 * transcript-visible session kind that upstream calls semi-focused. Four numbers
 * came off that session's own element rects:
 *
 *   focused button   left 795.6  top 272.4  size 204.8
 *   collapsed button left 855.6  top 635.2  size  84.8
 *
 * This test recomputes those four rects from the constants as they are written in
 * `focus-surface-constants.ts` and requires them to land on the measurements. The
 * constants are parsed out of the source text rather than copied here, so editing
 * a size or an offset in the source makes this test recompute and fail rather than
 * pass against a stale duplicate. Node cannot import the TypeScript module
 * directly, which is why the source is read as text -- the same approach the other
 * tests in this directory take.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const here = path.dirname(fileURLToPath(import.meta.url));
const sourcePath = path.resolve(
  here,
  '../../../features/chat/src/voice-orb/focus-surface-constants.ts',
);
const source = fs.readFileSync(sourcePath, 'utf8');

/**
 * Read an exported numeric constant.
 *
 * Values are either a literal or a product, and a factor may name another
 * exported constant (`106 * SEMI_FOCUS_SIZE_SCALE`), so identifiers resolve
 * recursively.
 */
const constant = (name, seen = new Set()) => {
  assert.ok(!seen.has(name), `${name} resolves in a cycle`);
  seen.add(name);

  const match = source.match(
    new RegExp(`export const ${name}\\s*=\\s*([^;]+);`),
  );
  assert.ok(match, `${name} should be exported from focus-surface-constants.ts`);

  const value = match[1]
    .split('*')
    .map((part) => {
      const factor = part.trim();
      return /^[0-9.]+$/.test(factor) ? Number(factor) : constant(factor, seen);
    })
    .reduce((product, factor) => product * factor, 1);

  assert.ok(Number.isFinite(value), `${name} should parse to a number`);
  return value;
};

const FOCUS_LG = constant('FOCUS_ORB_SIZE_LG');
const SIZE_SCALE = constant('SEMI_FOCUS_SIZE_SCALE');
const FLOATING_MD = constant('SEMI_FOCUS_FLOATING_SIZE_MD');
const BOTTOM_GAP = constant('FLOATING_ORB_BOTTOM_GAP');
const BREAKPOINT_LG = constant('BREAKPOINT_LG');

// Measured rects, as [left, top, size].
const MEASURED_FOCUSED = [795.6, 272.4, 204.8];
const MEASURED_COLLAPSED = [855.6, 635.2, 84.8];

// The container the orb positions against, solved from the two measured rects.
// Both states share a horizontal centre of 898.0; the focused orb is centred
// vertically in the container, and the floating orb sits a gap above its bottom
// edge. Those constraints fix the container exactly.
const CONTAINER = { top: 5.6, height: 738.4, centreX: 898.0 };
const VIEWPORT_WIDTH = 1536;

/** Centre of the container, which the focused orb is centred on. */
const focusedCentreY = () => CONTAINER.top + CONTAINER.height / 2;

/** Top of the floating strip: a `floatingSize` band above the container bottom. */
const floatingStripTop = (floatingSize) =>
  CONTAINER.top + CONTAINER.height - floatingSize - BOTTOM_GAP;

/**
 * Assert to sub-pixel tolerance.
 *
 * The sizes are products of a decimal scale (`106 * 0.8`), so binary floating
 * point lands a few ulps off the measured decimal. A tolerance well below one
 * device pixel keeps that from reading as a mismatch while still catching any
 * real change in a constant.
 */
const assertPixel = (actual, expected, what) => {
  assert.ok(
    Math.abs(actual - expected) < 1e-6,
    `${what}: got ${actual}, measured ${expected}`,
  );
};

describe('voice orb geometry', () => {
  it('derives the two orb sizes the session measured', () => {
    assert.ok(VIEWPORT_WIDTH >= BREAKPOINT_LG, 'capture was above the lg breakpoint');
    assertPixel(FOCUS_LG * SIZE_SCALE, MEASURED_FOCUSED[2], 'focused size');
    assertPixel(FLOATING_MD, MEASURED_COLLAPSED[2], 'collapsed size');
  });

  it('places the focused button on its measured rect', () => {
    const size = FOCUS_LG * SIZE_SCALE;
    const left = CONTAINER.centreX - size / 2;
    const top = focusedCentreY() - size / 2;

    assertPixel(size, MEASURED_FOCUSED[2], 'focused size');
    assertPixel(left, MEASURED_FOCUSED[0], 'focused left');
    assertPixel(top, MEASURED_FOCUSED[1], 'focused top');
  });

  it('places the collapsed button on its measured rect', () => {
    const focusSize = FOCUS_LG * SIZE_SCALE;
    const floatingSize = FLOATING_MD;

    // The wrapper stays focus-size and is inset so the smaller visible orb lands
    // centred in the floating strip. The button is the visible size.
    const stripTop = floatingStripTop(floatingSize);
    const inset = (focusSize - floatingSize) / 2;
    const wrapperTop = stripTop - inset;
    const buttonTop = wrapperTop + focusSize / 2 - floatingSize / 2;
    const buttonLeft = CONTAINER.centreX - floatingSize / 2;

    assertPixel(buttonLeft, MEASURED_COLLAPSED[0], 'collapsed left');
    assertPixel(buttonTop, MEASURED_COLLAPSED[1], 'collapsed top');
  });

  it('offsets the two states by half the size difference', () => {
    // Measured: the collapsed button sits 60px right of the focused one.
    const delta = MEASURED_COLLAPSED[0] - MEASURED_FOCUSED[0];
    assertPixel((FOCUS_LG * SIZE_SCALE - FLOATING_MD) / 2, delta, 'state offset');
    assertPixel(delta, 60, 'measured offset');
  });

  it('shrinks by the ratio the recorded spring settled on', () => {
    // uSurfaceScale was sampled settling 0.8608 -> 0.5692 -> 0.4857 -> 0.4397
    // -> 0.4181 -> 0.41137 -> ~0.41345 across a real collapse.
    const ratio = FLOATING_MD / (FOCUS_LG * SIZE_SCALE);
    assertPixel(ratio, 0.4140625, 'surface scale ratio');
  });
});
