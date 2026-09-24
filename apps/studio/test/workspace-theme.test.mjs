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

  it('computes complete themes with glow, sendButton, chipBg, loadbar, creamy, logoFilter, and fileDrop for every color', () => {
    for (const def of WORKSPACE_COLOR_DEFINITIONS) {
      const theme = getWorkspaceTheme(def.id);
      assert.equal(theme.id, def.id);
      assert.equal(theme.swatchHex, def.hex);
      assert.match(theme.glowAccent, /^rgb\(\d+,\s*\d+,\s*\d+\)$/);
      assert.match(theme.glowAccentLight, /^rgb\(\d+,\s*\d+,\s*\d+\)$/);
      assert.match(theme.sendButton.bg, /^#[0-9a-f]{6}$/i);
      assert.match(theme.sendButton.hover, /^#[0-9a-f]{6}$/i);
      assert.match(theme.sendButton.lightBg, /^#[0-9a-f]{6}$/i);
      assert.match(theme.sendButton.lightHover, /^#[0-9a-f]{6}$/i);
      assert.match(theme.chipBg, /^#[0-9a-f]{6}$/i);
      assert.match(theme.loadbar.hex, /^#[0-9a-f]{6}$/i);
      assert.match(theme.loadbar.shadow, /^rgba\(\d+,\s*\d+,\s*\d+,\s*0\.85\)$/);
      assert.match(theme.creamy.hex, /^#[0-9a-f]{6}$/i);
      assert.match(theme.creamy.rgba, /^rgba\(\d+,\s*\d+,\s*\d+,\s*0\.35\)$/);
      assert.match(theme.logoFilter, /^hue-rotate\(-?\d+deg\)$/);
      assert.ok(theme.fileDrop);
      assert.ok(theme.fileDrop.border);
      assert.ok(theme.fileDrop.text);
      assert.ok(theme.fileDrop.activeBg);
      assert.equal(theme.fileDrop.inactiveBg, 'rgba(27, 27, 27, 0.6)');
      assert.ok(theme.notice);
      assert.match(theme.notice.bg, /^#[0-9a-f]{6}$/i);
      assert.match(theme.notice.text, /^#[0-9a-f]{6}$/i);
      assert.ok(theme.toggle);
      assert.match(theme.toggle.track, /^#[0-9a-f]{6}$/i);
      assert.match(theme.toggle.thumb, /^#[0-9a-f]{6}$/i);
      assert.ok(theme.accentButton);
      assert.ok(theme.accentButton.bg);
      assert.ok(theme.accentButton.hover);
    }
  });

  it('preserves the exact green baseline default', () => {
    const greenTheme = getWorkspaceTheme('green');
    assert.equal(greenTheme.glowAccent, 'rgb(6, 78, 59)');
    assert.equal(greenTheme.glowAccentLight, 'rgb(158, 174, 153)');
    assert.equal(greenTheme.sendButton.bg, '#127352');
    assert.equal(greenTheme.sendButton.hover, '#0d5c41');
    assert.equal(greenTheme.sendButton.lightBg, '#9eae99');
    assert.equal(greenTheme.sendButton.lightHover, '#93a38e');
    assert.equal(greenTheme.accentButton.bg, '#127352');
    assert.equal(greenTheme.accentButton.hover, '#0d5c41');
    assert.equal(greenTheme.chipBg, '#127352');
    assert.equal(greenTheme.loadbar.hex, '#4a7c59');
    assert.equal(greenTheme.creamy.hex, '#9ce4b3');
    assert.equal(greenTheme.creamy.rgba, 'rgba(156, 228, 179, 0.35)');
    assert.equal(greenTheme.logoFilter, 'hue-rotate(30deg)');
    assert.equal(greenTheme.fileDrop.border, '#0f4625');
    assert.equal(greenTheme.fileDrop.text, '#57ad74');
    assert.equal(greenTheme.fileDrop.activeBg, 'rgba(32, 49, 37, 0.6)');
    assert.equal(greenTheme.fileDrop.inactiveBg, 'rgba(27, 27, 27, 0.6)');
    assert.equal(greenTheme.notice.bg, '#293a2d');
    assert.equal(greenTheme.notice.text, '#d5e2d8');
    assert.equal(greenTheme.toggle.track, '#b3d0ba');
    assert.equal(greenTheme.toggle.thumb, '#0c311a');
  });

  it('preserves measured blue baseline', () => {
    const blueTheme = getWorkspaceTheme('blue');
    assert.equal(blueTheme.glowAccent, 'rgb(20, 32, 79)');
    assert.equal(blueTheme.glowAccentLight, 'rgb(157, 210, 255)');
    assert.equal(blueTheme.sendButton.bg, '#1b3f95');
    assert.equal(blueTheme.sendButton.hover, '#153277');
    assert.equal(blueTheme.sendButton.lightBg, '#9dd2ff');
    assert.equal(blueTheme.sendButton.lightHover, '#90c4f1');
    assert.equal(blueTheme.accentButton.bg, 'rgb(31, 59, 155)');
    assert.equal(blueTheme.accentButton.hover, 'rgb(42, 75, 190)');
    assert.equal(blueTheme.chipBg, '#192967');
    assert.equal(blueTheme.loadbar.hex, '#a8c7fa');
    assert.equal(blueTheme.creamy.hex, '#a8c7fa');
    assert.equal(blueTheme.creamy.rgba, 'rgba(168, 199, 250, 0.35)');
    assert.equal(blueTheme.logoFilter, 'hue-rotate(160deg)');
    assert.equal(blueTheme.fileDrop.border, 'rgb(31, 59, 155)');
    assert.equal(blueTheme.fileDrop.text, 'rgb(49, 134, 255)');
    assert.equal(blueTheme.fileDrop.activeBg, 'rgba(31, 55, 96, 0.6)');
    assert.equal(blueTheme.fileDrop.inactiveBg, 'rgba(27, 27, 27, 0.6)');
    assert.equal(blueTheme.notice.bg, '#1f3760');
    assert.equal(blueTheme.notice.text, '#d3e3fd');
    assert.equal(blueTheme.toggle.track, '#a8c7fa');
    assert.equal(blueTheme.toggle.thumb, '#062e6f');
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
    assert.ok(customTheme.glowAccentLight.startsWith('rgb('));
    assert.ok(customTheme.sendButton.bg.startsWith('#'));
    assert.ok(customTheme.sendButton.lightBg.startsWith('#'));
    assert.ok(customTheme.sendButton.lightHover.startsWith('#'));
    assert.ok(customTheme.accentButton.bg.startsWith('#'));
    assert.ok(customTheme.accentButton.hover.startsWith('#'));
    assert.ok(customTheme.chipBg.startsWith('#'));
    assert.ok(customTheme.loadbar.hex.startsWith('#'));
    assert.ok(customTheme.creamy.hex.startsWith('#'));
    assert.ok(customTheme.logoFilter.startsWith('hue-rotate('));
    assert.ok(customTheme.fileDrop.border.startsWith('#') || customTheme.fileDrop.border.startsWith('rgb('));
    assert.ok(customTheme.fileDrop.text.startsWith('#') || customTheme.fileDrop.text.startsWith('rgb('));
    assert.ok(customTheme.fileDrop.activeBg.startsWith('rgba('));
    assert.equal(customTheme.fileDrop.inactiveBg, 'rgba(27, 27, 27, 0.6)');
    assert.ok(customTheme.notice.bg.startsWith('#'));
    assert.ok(customTheme.notice.text.startsWith('#'));
    assert.ok(customTheme.toggle.track.startsWith('#'));
    assert.ok(customTheme.toggle.thumb.startsWith('#'));
  });

  it('safely falls back to green default for missing or undefined color', () => {
    assert.equal(getWorkspaceTheme(null).id, 'green');
    assert.equal(getWorkspaceTheme(undefined).id, 'green');
    assert.equal(getWorkspaceTheme('unknown_color_xyz').id, 'green');
  });
});
