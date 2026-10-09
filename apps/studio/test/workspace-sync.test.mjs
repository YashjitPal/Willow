/**
 * Workspace colour sync for the surfaces cloned from Gemini (`platform/core/src/workspace-sync.ts`).
 *
 * Gemini is blue, and what Willow transcribed from it came across in its literal blues. Blue is
 * the anchor: a surface writes `var(--sync-<hex>, <the Gemini blue>)`, nothing is published on a
 * blue workspace, and every other colour publishes the counterpart. These pin the formula's
 * guarantees, and that the synced stylesheets have no raw Gemini blue left to escape it.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';

import { importTs } from './ts-module.mjs';

const repoRoot = path.resolve(import.meta.dirname, '..', '..', '..');
const at = (...parts) => path.join(repoRoot, ...parts);
const sync = await importTs(at('platform', 'core', 'src', 'workspace-sync.ts'));
const theme = await importTs(at('platform', 'core', 'src', 'workspace-theme.ts'));

const COLOURS = theme.WORKSPACE_COLOR_DEFINITIONS.map((def) => def.id).filter((id) => id !== 'blue');
const lightness = (hex) => theme.rgbToOklch(theme.hexToRgb(hex))[0];
const hexOf = (value) => (value.startsWith('#') ? value.toLowerCase() : theme.rgbToHex(value.match(/\d+/g).slice(0, 3).map((n) => Number(n) / 255)));

describe('the counterparts', () => {
  it('publishes nothing on a blue workspace, so every surface keeps Gemini\'s value', () => {
    assert.deepEqual(sync.workspaceSyncVariables('blue'), {});
    for (const anchor of sync.SYNC_ANCHORS) assert.equal(sync.syncedColor(anchor, 'blue'), anchor);
  });

  it('publishes every anchor, with an rgb triplet for translucent uses, on every other colour', () => {
    for (const colour of COLOURS) {
      const variables = sync.workspaceSyncVariables(colour);
      for (const anchor of sync.SYNC_ANCHORS) {
        const name = `--sync-${anchor.slice(1)}`;
        assert.match(variables[name], /^#[0-9a-f]{6}$/, `${colour} ${name}`);
        assert.match(variables[`${name}-rgb`], /^\d{1,3}, \d{1,3}, \d{1,3}$/, `${colour} ${name}-rgb`);
      }
    }
    assert.deepEqual(sync.SYNC_VARIABLE_NAMES.length, sync.SYNC_ANCHORS.length * 2);
  });

  it('gives the blues the theme engine already has roles for those roles\' values', () => {
    for (const colour of COLOURS) {
      const t = theme.getWorkspaceTheme(colour);
      assert.equal(sync.syncedColor('#a8c7fa', colour), hexOf(t.creamy.hex), `${colour} primary`);
      assert.equal(sync.syncedColor('#1f3b9b', colour), hexOf(t.accentButton.bg), `${colour} filled button`);
      assert.equal(sync.syncedColor('#26449f', colour), hexOf(t.accentButton.hover), `${colour} filled hover`);
      assert.equal(sync.syncedColor('#1f3760', colour), hexOf(t.notice.bg), `${colour} tonal`);
      assert.equal(sync.syncedColor('#d3e3fd', colour), hexOf(t.notice.text), `${colour} on tonal`);
      assert.equal(sync.syncedColor('#062e6f', colour), hexOf(t.toggle.thumb), `${colour} on primary`);
      assert.equal(sync.syncedColor('#14204f', colour), hexOf(t.glowAccent), `${colour} glow`);
    }
  });

  it('keeps base, hover and pressed in Gemini\'s order on every colour', () => {
    const order = (lighter, darker, colour) => assert.ok(
      lightness(sync.syncedColor(lighter, colour)) > lightness(sync.syncedColor(darker, colour)),
      `${colour}: ${lighter} should stay lighter than ${darker}`,
    );
    for (const colour of COLOURS) {
      order('#0b57d0', '#0842a0', colour);
      order('#0842a0', '#073888', colour);
      order('#b4d0fc', '#a8c7fa', colour);
      order('#c3ddff', '#a8c7fa', colour);
      order('#1d2f73', '#192967', colour);
    }
  });

  it('keeps a free blue\'s lightness, and with it its contrast against Gemini\'s greys', () => {
    for (const colour of COLOURS) {
      for (const anchor of ['#2596be', '#2f5be3', '#60a9ed']) {
        assert.ok(Math.abs(lightness(sync.syncedColor(anchor, colour)) - lightness(anchor)) < 0.03, `${colour} ${anchor}`);
      }
    }
  });

  it('tints a subtree with a colour of its own, blue (or grey, or none) giving Gemini\'s blues', () => {
    const identity = sync.tintSyncVariables(null);
    for (const anchor of sync.SYNC_ANCHORS) {
      assert.equal(identity[`--sync-${anchor.slice(1)}`], anchor, 'every property is set, so the workspace\'s never shows through');
    }
    assert.deepEqual(sync.tintSyncVariables('#4778FF'), identity, 'the orbit catalog\'s blue is the anchor');
    assert.deepEqual(sync.tintSyncVariables('#4c6ed0'), identity, 'a blue pet is the anchor');
    assert.deepEqual(sync.tintSyncVariables('#BAC1D3'), identity, 'a grey ring keeps the blue');
    const lime = sync.tintSyncVariables('#B6D80B');
    assert.notEqual(lime['--sync-1f3760'], '#1f3760');
    assert.ok(Math.abs(lightness(lime['--sync-1f3760']) - lightness('#1f3760')) < 0.06, 'the tonal chip keeps its depth');
    assert.match(lime['--sync-1f3760-rgb'], /^\d{1,3}, \d{1,3}, \d{1,3}$/);
  });

  it('colours a dot\'s profile after the bot, and the Bots page after the workspace', () => {
    const tint = fs.readFileSync(at('features', 'spark', 'src', 'dots', 'dot-tint.ts'), 'utf8');
    assert.match(tint, /if \(dot\.petId != null\) return PET_TINTS\[dot\.petId\] \?\? null;/, 'a pet\'s colour first');
    assert.match(tint, /decodeCharacterState\(bytes\)\.color/, 'else the character\'s body colour, custom or preset');
    assert.match(tint, /tintSyncVariables\(dotTintHex\(/);
    // The conversation is its chat and its profile, and each wears the bot's colours on its own root.
    for (const [file, root] of [[['chat', 'DotChat.tsx'], 'dot-chat'], [['profile', 'DotProfilePanel.tsx'], 'dot-panel']]) {
      const source = fs.readFileSync(at('features', 'spark', 'src', 'dots', ...file), 'utf8');
      assert.match(source, /const tint = useDotTint\(dot\);/, file.at(-1));
      assert.match(source, new RegExp(`className=\\{\`${root} \\$\\{M3_SCOPE\\}\`\\}[^>]*style=\\{tint\\}`), file.at(-1));
    }
    const css = fs.readFileSync(at('features', 'spark', 'src', 'dots', 'SparkDots.css'), 'utf8');
    assert.match(css, /\.spark-dots-profile__tint \{\s*display: contents;/);
    const page = fs.readFileSync(at('features', 'spark', 'src', 'SparkDotsPage.tsx'), 'utf8');
    assert.match(page, /style=\{\{ display: 'contents', \.\.\.accentVars \}\}/, '"New bot" reads --spark-accent, which the page must declare');
  });

  it('is published from the app root, where portalled menus see it too', () => {
    const app = fs.readFileSync(at('apps', 'studio', 'src', 'app', 'App.tsx'), 'utf8');
    assert.match(app, /React\.useLayoutEffect\(\(\) => \{\s*applyWorkspaceSync\((?:userProfile\?\.)?workspaceColor\);\s*\}, \[(?:userProfile\?\.)?workspaceColor\]\);/);
    const source = fs.readFileSync(at('platform', 'core', 'src', 'workspace-sync.ts'), 'utf8');
    assert.match(source, /root: HTMLElement = document\.documentElement/);
  });
});

// ── The surfaces ──────────────────────────────────────────────────────────────

const walk = (dir, out = []) => {
  for (const name of fs.readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const full = path.join(dir, name);
    if (fs.statSync(full).isDirectory()) walk(full, out);
    else if (/\.(css|tsx?)$/.test(name)) out.push(full);
  }
  return out;
};

/** The stylesheets of the Gemini-derived surfaces. */
const SYNCED_STYLESHEETS = [
  'features/chat/src/media/media.css',
  'features/chat/src/research/research.css',
  'features/chat/src/composer/mentions/chat-mentions.css',
  'features/chat/src/canvas/canvas.css',
  'features/chat/src/library/ChatCreatedCards.css',
  'features/gems/src/gems.css',
  'platform/ui/src/GeminiDialog.css',
  'platform/ui/src/GeminiBottomSheet.css',
  'apps/studio/src/settings/SettingsModal.css',
  'apps/studio/src/import-memory/ImportMemoryView.css',
  'apps/studio/src/usage/UsageLimitsView.css',
  'apps/studio/src/spark-settings/SparkSettingsView.css',
  'apps/studio/src/customize/CustomizeView.css',
  'apps/studio/src/shell/sidebar/Sidebar.css',
  'features/notebooks/src/notebooks.css',
  'features/spark/src/composer/spark-mentions.css',
  'features/spark/src/pets/PetsPage.css',
  'features/spark/src/spaces/willow/spaces-theme.css',
  ...walk(at('apps', 'studio', 'src', 'settings', 'tabs')).filter((f) => f.endsWith('.css')).map((f) => path.relative(repoRoot, f)),
  ...fs.readdirSync(at('features', 'spark', 'src')).filter((n) => n.endsWith('.css') && n !== 'SparkFileViewer.css').map((n) => `features/spark/src/${n}`),
  ...fs.readdirSync(at('features', 'spark', 'src', 'dots')).filter((n) => n.endsWith('.css')).map((n) => `features/spark/src/dots/${n}`),
  ...fs.readdirSync(at('features', 'spark', 'src', 'dots', 'computer')).filter((n) => n.endsWith('.css')).map((n) => `features/spark/src/dots/computer/${n}`),
];

const srgbToLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const isGeminiBlue = ([r, g, b]) => {
  const [lr, lg, lb] = [r, g, b].map(srgbToLinear);
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  const hue = ((Math.atan2(bb, a) * 180) / Math.PI + 360) % 360;
  return Math.hypot(a, bb) >= 0.035 && hue >= 225 && hue <= 300;
};
const COLOR = /#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})(?![0-9a-zA-Z_-])|rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/g;

describe('the surfaces that read it', () => {
  it('names only anchors that are published', () => {
    const anchors = new Set(sync.SYNC_ANCHORS.map((a) => a.slice(1)));
    const unknown = [];
    for (const root of ['apps/studio/src', 'features', 'platform']) {
      for (const file of walk(at(root))) {
        for (const m of fs.readFileSync(file, 'utf8').matchAll(/--sync-([0-9a-f]{6})\b/g)) {
          if (!anchors.has(m[1])) unknown.push(`${path.relative(repoRoot, file)}: --sync-${m[1]}`);
        }
      }
    }
    assert.deepEqual(unknown, [], 'add these to SYNC_ANCHORS in workspace-sync.ts');
  });

  it('leaves no raw Gemini blue in the synced stylesheets', () => {
    const raw = [];
    for (const file of SYNCED_STYLESHEETS) {
      const code = fs.readFileSync(at(file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, ' '));
      code.split('\n').forEach((line, index) => {
        if (/hljs|cv-bracket|cv-code-tokens|syntax|\btoken/.test(line)) return;
        for (const m of line.matchAll(COLOR)) {
          if (/var\(--[\w-]+,\s*$/.test(line.slice(0, m.index))) continue;
          const rgb = m[1]
            ? (m[1].length === 3 ? [...m[1]].map((c) => parseInt(c + c, 16) / 255) : [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16) / 255))
            : [m[2], m[3], m[4]].map((v) => Number(v) / 255);
          if (isGeminiBlue(rgb)) raw.push(`${file}:${index + 1}  ${m[0]}`);
        }
      });
    }
    assert.deepEqual(raw, [], 'write each as var(--sync-<hex>, <the blue>) and add <hex> to SYNC_ANCHORS');
  });
});
