import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';

import { importTs } from './ts-module.mjs';

const root = path.resolve(import.meta.dirname, '../../..');

describe('model menu positioning', () => {
  it('returns to the preferred side after an early oversized measurement settles', async () => {
    const { chooseMenuSide } = await importTs(
      path.join(root, 'platform/ui/src/models/menu-position.ts'),
    );

    assert.equal(chooseMenuSide({
      preferredSide: 'bottom',
      menuHeight: 360,
      spacing: 4,
      spaceAbove: 350,
      spaceBelow: 340,
    }), 'top');

    assert.equal(chooseMenuSide({
      preferredSide: 'bottom',
      menuHeight: 289,
      spacing: 4,
      spaceAbove: 350,
      spaceBelow: 340,
    }), 'bottom');
  });

  it('keeps the preferred side when neither side fully fits but it has more room', async () => {
    const { chooseMenuSide } = await importTs(
      path.join(root, 'platform/ui/src/models/menu-position.ts'),
    );

    assert.equal(chooseMenuSide({
      preferredSide: 'bottom',
      menuHeight: 500,
      spacing: 4,
      spaceAbove: 240,
      spaceBelow: 260,
    }), 'bottom');
  });

  it('positions from the unshifted panel rather than stacking an old correction', async () => {
    const { getViewportConstrainedOffset } = await importTs(
      path.join(root, 'platform/ui/src/models/menu-position.ts'),
    );

    assert.equal(getViewportConstrainedOffset({
      bottom: 825,
      viewportHeight: 720,
    }), -121);
  });

  it('remeasures while the main menu settles and when its animation ends', () => {
    const source = fs.readFileSync(
      path.join(root, 'platform/ui/src/models/ModelsMenu.tsx'),
      'utf8',
    );

    assert.match(source, /setIsPositionReady\(true\)/);
    assert.match(source, /requestAnimationFrame\(\(\) =>/);
    assert.match(source, /new ResizeObserver\(calculatePosition\)/);
    assert.match(source, /addEventListener\('animationend', handleModelMenuAnimationEnd\)/);
    assert.match(source, /isEffortPositionReady/);
    assert.match(source, /willChange: 'transform'/);
    assert.match(source, /translateZ\(0\)/);
  });
});
