/**
 * The workspace-colour orb palettes, checked against the transform they came from.
 *
 * The requirement was that each workspace colour tint the orb by the *same* amount
 * that the orb's current blue differs from the workspace blue swatch. That makes the
 * palettes derived values, and derived values baked into a shader as literals drift:
 * GLSL cannot import a module, so `interior.frag.glsl` holds numbers and
 * `orb-palette.ts` holds the transform that produced them. This test re-runs the
 * derivation and requires the shader's literals to equal its output, so the two
 * cannot separate without a failure.
 *
 * The transform itself is anchored, not asserted into existence: applying it to
 * `#3b82f6` has to reproduce `materialDefaultPalette`, the palette the orb renders
 * today. That is the one pair that was measured, so it is the one pair that can
 * falsify the measurement.
 *
 * Two properties are checked beyond equality, because both were violated by the
 * first (additive-lightness) model and neither shows up in a spot check:
 *
 *   the mid-high slot is pure white in all seven shipped palettes -- an invariant
 *   the derivation must reproduce for every swatch, not just for blue
 *
 *   no two adjacent slots may collapse, which is what clipping did to yellow when
 *   its highlight was pushed past white
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

import { importTs } from './ts-module.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const orbDir = path.resolve(here, '../../../features/chat/src/voice-orb');

const glsl = fs.readFileSync(path.join(orbDir, 'shaders/interior.frag.glsl'), 'utf8');
const voiceOrb = fs.readFileSync(path.join(orbDir, 'VoiceOrb.tsx'), 'utf8');

const {
  ORB_PALETTE_SLOTS,
  ORB_PALETTE_TRANSFORM,
  TRANSFORM_SOURCE_HEX,
  WORKSPACE_COLOR_HEX,
  WORKSPACE_PALETTE_INDEX,
  deriveOrbPalette,
  hexToRgb,
  rgbToOklch,
} = await importTs(path.join(orbDir, 'orb-palette.ts'));

/** Parse a `const HorizonPalette <name> = HorizonPalette(vec4...)` block. */
const shaderPalette = (name) => {
  const match = glsl.match(
    new RegExp(`const\\s+HorizonPalette\\s+${name}\\s*=\\s*HorizonPalette\\(([^;]*)\\);`),
  );
  assert.ok(match, `no ${name} in the shader`);
  const slots = [...match[1].matchAll(/vec4\(([^)]*)\)/g)].map((vec) =>
    vec[1].split(',').map((n) => Number.parseFloat(n.trim())),
  );
  assert.equal(slots.length, 4, `${name} should have four slots`);
  for (const slot of slots) {
    assert.equal(slot.length, 4, `${name} slots should be vec4`);
    assert.equal(slot[3], 1.0, `${name} alpha should be 1`);
  }
  return slots;
};

/** Which shader palette each workspace colour resolves to, per the switch. */
const paletteNameForIndex = (index) => {
  if (index === 0) return 'materialDefaultPalette';
  const match = glsl.match(
    new RegExp(`case\\s+${index}u:\\s*return\\s+(\\w+);`),
  );
  assert.ok(match, `no switch arm for index ${index}u`);
  return match[1];
};

/** sRGB triples compare at float32, since that is what the GPU stores. */
const assertSameColor = (actual, expected, label) => {
  for (let i = 0; i < 3; i += 1) {
    assert.equal(
      Math.fround(actual[i]),
      Math.fround(expected[i]),
      `${label} channel ${i}: shader ${actual[i]} vs derived ${expected[i]}`,
    );
  }
};

const deltaE = (a, b) => {
  const [L1, C1, h1] = rgbToOklch(a);
  const [L2, C2, h2] = rgbToOklch(b);
  const rad = (d) => (d * Math.PI) / 180;
  return Math.hypot(
    L1 - L2,
    C1 * Math.cos(rad(h1)) - C2 * Math.cos(rad(h2)),
    C1 * Math.sin(rad(h1)) - C2 * Math.sin(rad(h2)),
  );
};

describe('orb palette transform', () => {
  it('reproduces the palette the orb renders today from the workspace blue', () => {
    // The anchor. This is the pair the transform was measured from, so if the
    // transform is wrong this is what catches it.
    const derived = deriveOrbPalette(TRANSFORM_SOURCE_HEX);
    const shipped = shaderPalette('materialDefaultPalette');

    derived.forEach((slot, i) => {
      // Within a byte of the shipped constant: the round-trip through OKLab loses
      // up to 2 float32 ulps on a channel that is exactly 1.0.
      slot.forEach((channel, c) => {
        assert.ok(
          Math.abs(channel - shipped[i][c]) < 1 / 255,
          `${ORB_PALETTE_SLOTS[i]} channel ${c}: ${channel} vs shipped ${shipped[i][c]}`,
        );
      });
      assert.ok(
        deltaE(slot, shipped[i]) < 1e-6,
        `${ORB_PALETTE_SLOTS[i]} should match the shipped default palette`,
      );
    });
  });

  it('leaves blue on the palette it already renders', () => {
    // Deriving blue would land ~1 ulp away — identical on screen, but there is no
    // reason to recompute a value the shader already holds when the requirement is
    // that blue looks exactly as it does now.
    assert.equal(WORKSPACE_PALETTE_INDEX.blue, 0);
    assert.equal(paletteNameForIndex(0), 'materialDefaultPalette');
  });

  it('matches every derived shader palette to the derivation', () => {
    for (const [name, hex] of Object.entries(WORKSPACE_COLOR_HEX)) {
      if (name === 'blue') continue;
      const index = WORKSPACE_PALETTE_INDEX[name];
      const shader = shaderPalette(paletteNameForIndex(index));
      const derived = deriveOrbPalette(hex);

      derived.forEach((slot, i) => {
        assertSameColor(shader[i], slot, `${name} ${ORB_PALETTE_SLOTS[i]}`);
      });
    }
  });

  it('applies one identical transform to every colour', () => {
    // The actual request: the same difference, not a per-colour tweak. A palette
    // hand-adjusted for one hue would have to bypass this table to exist.
    assert.equal(ORB_PALETTE_TRANSFORM.length, ORB_PALETTE_SLOTS.length);
    for (const slot of ORB_PALETTE_TRANSFORM) {
      assert.ok(slot.lightnessToWhite >= 0 && slot.lightnessToWhite <= 1);
      assert.ok(slot.chromaScale >= 0);
      assert.equal(typeof slot.hueShiftDeg, 'number');
    }

    // Measured against the source, so the source's own values are recoverable.
    const [L, C, h] = rgbToOklch(hexToRgb(TRANSFORM_SOURCE_HEX));
    const shipped = shaderPalette('materialDefaultPalette');
    shipped.forEach((slot, i) => {
      const [Ls, Cs, hs] = rgbToOklch(slot);
      const t = (Ls - L) / (1 - L);
      assert.ok(
        Math.abs(t - ORB_PALETTE_TRANSFORM[i].lightnessToWhite) < 1e-6,
        `${ORB_PALETTE_SLOTS[i]} lightness fraction`,
      );
      if (Cs > 1e-6) {
        assert.ok(
          Math.abs(Cs / C - ORB_PALETTE_TRANSFORM[i].chromaScale) < 1e-6,
          `${ORB_PALETTE_SLOTS[i]} chroma scale`,
        );
        const dh = ((hs - h + 540) % 360) - 180;
        assert.ok(
          Math.abs(dh - ORB_PALETTE_TRANSFORM[i].hueShiftDeg) < 1e-6,
          `${ORB_PALETTE_SLOTS[i]} hue shift`,
        );
      }
    });
  });
});

describe('invariants the additive model broke', () => {
  it('keeps the mid-high slot pure white in all seven shipped palettes', () => {
    // The measurement this rests on: that slot is t=1 with sd 0 across all seven,
    // which is why lightness is a headroom fraction rather than an offset.
    const names = [
      'materialDefaultPalette', 'materialBluePalette', 'materialGreenPalette',
      'materialYellowPalette', 'materialPinkPalette', 'materialOrangePalette',
      'materialPurplePalette',
    ];
    for (const name of names) {
      assert.deepEqual(
        shaderPalette(name)[2].slice(0, 3),
        [1.0, 1.0, 1.0],
        `${name} mid-high should be pure white`,
      );
    }
  });

  it('derives pure white for the mid-high slot of every workspace colour', () => {
    // An additive lightness offset produced #e4e4e4 here for green, because green
    // is dark enough that a fixed offset does not reach white.
    for (const [name, hex] of Object.entries(WORKSPACE_COLOR_HEX)) {
      const midHigh = deriveOrbPalette(hex)[2];
      midHigh.forEach((channel, c) => {
        assert.equal(Math.fround(channel), 1, `${name} mid-high channel ${c}`);
      });
    }
  });

  it('keeps four distinct tones for every workspace colour', () => {
    // Yellow is the case that failed: an additive offset pushed its highlight past
    // white, so highlight and mid-high both clipped to #ffffff and the orb lost a
    // tone. Clipping shows up here as a zero gap.
    for (const [name, hex] of Object.entries(WORKSPACE_COLOR_HEX)) {
      const palette = deriveOrbPalette(hex);
      for (let i = 0; i < 3; i += 1) {
        assert.ok(
          deltaE(palette[i], palette[i + 1]) > 0.02,
          `${name}: ${ORB_PALETTE_SLOTS[i]} and ${ORB_PALETTE_SLOTS[i + 1]} collapsed`,
        );
      }
    }
  });

  it('holds every derived channel inside the sRGB range', () => {
    for (const [name, hex] of Object.entries(WORKSPACE_COLOR_HEX)) {
      for (const slot of deriveOrbPalette(hex)) {
        for (const channel of slot) {
          assert.ok(channel >= 0 && channel <= 1, `${name} channel ${channel} out of range`);
        }
      }
    }
  });
});

describe('shader and wiring', () => {
  it('leaves the shipped palettes and their indices untouched', () => {
    // The workspace palettes were appended, not substituted. Upstream's own name
    // map still resolves to the hand-authored ones.
    for (const [index, name] of [
      [1, 'materialBluePalette'], [2, 'materialGreenPalette'],
      [3, 'materialYellowPalette'], [4, 'materialPinkPalette'],
      [5, 'materialOrangePalette'], [6, 'materialPurplePalette'],
    ]) {
      assert.equal(paletteNameForIndex(index), name);
    }
  });

  it('gives every workspace colour a distinct palette index', () => {
    const indices = Object.values(WORKSPACE_PALETTE_INDEX);
    assert.equal(new Set(indices).size, indices.length);
    assert.equal(indices.length, Object.keys(WORKSPACE_COLOR_HEX).length);
  });

  it('prefers the workspace colour over the upstream palette name', () => {
    assert.match(
      voiceOrb,
      /paletteIndex:\s*workspaceIndex\s*\?\?\s*PALETTE_INDEX_BY_NAME\[paletteRef\.current\]\s*\?\?\s*0/,
      'the workspace index should take precedence, falling back to the name map',
    );
  });

  it('reads the workspace colour per frame so a change re-tints live', () => {
    // Held in a ref and read inside the render loop. Reading the prop directly
    // would capture the value the loop started with and never update.
    assert.match(voiceOrb, /workspaceColorRef\.current = workspaceColor;/);
    assert.match(voiceOrb, /workspaceColorRef\.current === undefined/);
  });
});
