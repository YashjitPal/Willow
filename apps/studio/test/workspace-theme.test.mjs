import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  WORKSPACE_COLOR_DEFINITIONS,
  getWorkspaceTheme,
  computeWorkspaceTheme,
} from '../../../platform/core/src/workspace-theme.ts';

describe('workspace-theme central engine', () => {
  it('has all 9 workspace color definitions registered', () => {
    assert.equal(WORKSPACE_COLOR_DEFINITIONS.length, 9);
    const ids = WORKSPACE_COLOR_DEFINITIONS.map((d) => d.id);
    assert.deepEqual(ids, [
      'green',
      'blue',
      'pink',
      'yellow',
      'orange',
      'purple',
      'lilac',
      'coral',
      'teal',
    ]);
  });

  it('computes complete themes with glow, sendButton, loadbar, creamy, and logoFilter for every color', () => {
    for (const def of WORKSPACE_COLOR_DEFINITIONS) {
      const theme = getWorkspaceTheme(def.id);
      assert.equal(theme.id, def.id);
      assert.equal(theme.swatchHex, def.hex);
      assert.match(theme.glowAccent, /^rgb\(\d+,\s*\d+,\s*\d+\)$/);
      assert.match(theme.sendButton.bg, /^#[0-9a-f]{6}$/i);
      assert.match(theme.sendButton.hover, /^#[0-9a-f]{6}$/i);
      assert.match(theme.loadbar.hex, /^#[0-9a-f]{6}$/i);
      assert.match(theme.loadbar.shadow, /^rgba\(\d+,\s*\d+,\s*\d+,\s*0\.85\)$/);
      assert.match(theme.creamy.hex, /^#[0-9a-f]{6}$/i);
      assert.match(theme.creamy.rgba, /^rgba\(\d+,\s*\d+,\s*\d+,\s*0\.35\)$/);
      assert.match(theme.logoFilter, /^hue-rotate\(-?\d+deg\)$/);
    }
  });

  it('preserves the exact green baseline default', () => {
    const greenTheme = getWorkspaceTheme('green');
    assert.equal(greenTheme.glowAccent, 'rgb(6, 78, 59)');
    assert.equal(greenTheme.sendButton.bg, '#127352');
    assert.equal(greenTheme.sendButton.hover, '#0d5c41');
    assert.equal(greenTheme.loadbar.hex, '#4a7c59');
    assert.equal(greenTheme.creamy.hex, '#9ce4b3');
    assert.equal(greenTheme.creamy.rgba, 'rgba(156, 228, 179, 0.35)');
    assert.equal(greenTheme.logoFilter, 'hue-rotate(30deg)');
  });

  it('preserves measured blue baseline', () => {
    const blueTheme = getWorkspaceTheme('blue');
    assert.equal(blueTheme.glowAccent, 'rgb(20, 32, 79)');
    assert.equal(blueTheme.sendButton.bg, '#1b3f95');
    assert.equal(blueTheme.sendButton.hover, '#153277');
    assert.equal(blueTheme.loadbar.hex, '#a8c7fa');
    assert.equal(blueTheme.creamy.hex, '#a8c7fa');
    assert.equal(blueTheme.creamy.rgba, 'rgba(168, 199, 250, 0.35)');
    assert.equal(blueTheme.logoFilter, 'hue-rotate(160deg)');
  });

  it('automatically computes full theme for an arbitrary newly registered color definition', () => {
    const customDef = {
      id: 'amber',
      label: 'Warm Amber',
      hex: '#f59e0b',
    };
    const customTheme = computeWorkspaceTheme(customDef);
    assert.equal(customTheme.id, 'amber');
    assert.equal(customTheme.swatchHex, '#f59e0b');
    assert.ok(customTheme.glowAccent.startsWith('rgb('));
    assert.ok(customTheme.sendButton.bg.startsWith('#'));
    assert.ok(customTheme.loadbar.hex.startsWith('#'));
    assert.ok(customTheme.creamy.hex.startsWith('#'));
    assert.ok(customTheme.logoFilter.startsWith('hue-rotate('));
  });

  it('safely falls back to green default for missing or undefined color', () => {
    assert.equal(getWorkspaceTheme(null).id, 'green');
    assert.equal(getWorkspaceTheme(undefined).id, 'green');
    assert.equal(getWorkspaceTheme('unknown_color_xyz').id, 'green');
  });
});
