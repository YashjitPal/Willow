/**
 * In the desktop app nothing covers the frame: a layer fixed over the whole window (a dim, the
 * layer a dialog is centred in, a full-window viewer) lies over the page, inside its outline, by
 * the frame's rule in apps/studio/src/shell/rail/AppRail.css. This finds every such layer in
 * Willow's sources (stylesheets, Tailwind class strings, inline styles) and fails on one the rule
 * does not catch, unless it is set aside below with its reason.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';

const ROOT = path.resolve(import.meta.dirname, '../../..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8').replace(/\r\n/g, '\n');
const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');

const FRAME_CSS = stripComments(read('apps/studio/src/shell/rail/AppRail.css'));
const RULE = /:root:has\(\.willow-frame\) :where\(([\s\S]*?)\):where\(:not\(([^)]*)\)\) \{([^}]*)\}/.exec(FRAME_CSS);

/** A selector list split at its top-level commas only. */
const splitSelectors = (list) => {
  const parts = [];
  let depth = 0;
  let current = '';
  for (const ch of list) {
    if (ch === '(' || ch === '[') depth += 1;
    if (ch === ')' || ch === ']') depth -= 1;
    if (ch === ',' && depth === 0) { parts.push(current); current = ''; } else current += ch;
  }
  parts.push(current);
  return parts.map((s) => s.trim().replace(/\s+/g, ' ')).filter(Boolean);
};

/** The frame rule's own selectors, one per entry. */
const NAMED = splitSelectors(RULE?.[1] ?? '');

/**
 * Stylesheet layers left over the whole window, and why. A selector here must still exist, so the
 * list cannot outlive what it describes.
 */
const CSS_SET_ASIDE = {
  '.willow-tooltip-container': 'tooltips are placed in window coordinates and may sit over the rail',
  '.willow-copy-toast-container': 'paints only its toast, nothing under it',
  '.ask-willow': "Ask Willow's card is placed at the selection in window coordinates, and nothing is dimmed",
  '.customize-card-menu-backdrop': 'a transparent click-catcher: it paints nothing',
  '.customize-create-menu-backdrop': "the Create menu's transparent click-catcher: it paints nothing",
  '.sb-menu-backdrop': 'a transparent click-catcher: it paints nothing',
  '.sched-menu-backdrop': "the Scheduled filter menu's transparent click-catcher: it paints nothing",
  '.studio-sidebar-mobile-scrim': "the frame's narrow rules already place it in the page",
  '.cv-panel': "the canvas full screen below 961px, a panel rather than a dim (features/chat/src/canvas's own work)",
  '.cv-float-overlay': "holds the canvas's floating card and dims nothing",
  ':where(.wtv-root):fullscreen .wtv-video__outerContainer': "the browser's own full screen, outside the frame",
  '.gm-discovery': 'a card centred with inset 0 and margin auto; the frame moves its box separately',
};

/** Tailwind layers, by file and a piece of their class string: covered some way the scan cannot see, or set aside. */
const TAILWIND_SET_ASIDE = [
  ['features/auth/src/AuthModal.tsx', 'fixed inset-0 cursor-pointer', "the modal's dim, inside its centring layer: the rule's last pattern"],
  ['apps/studio/src/shell/sidebar/SettingsSheet.tsx', 'fixed inset-0 z-[1000]', 'the sheet\'s layer, caught by `:has(> .willow-settings-sheet-backdrop)`'],
  ['platform/ui/src/RichResourcePreview.tsx', 'fixed inset-0 z-50', 'a full-screen panel below 960px (relative above), not a dim'],
  ['features/chat/src/research/ResearchPanel.tsx', 'dr-panel fixed inset-0', 'a full-screen panel below 960px (relative above), not a dim'],
  ['features/chat/src/ChatResponseChrome.tsx', 'fixed inset-0 z-[1000] flex flex-col', 'a full-screen panel on compact screens, not a dim'],
  ['features/chat/src/voice-orb/VoiceFocusSurface.tsx', 'pointer-events-none fixed inset-0', 'moves the voice orb in window coordinates and dims nothing'],
  ['features/spark/src/dots/creation/dot-onboarding-flight.tsx', 'pointer-events-none fixed inset-0', 'flies a ring in window coordinates; moving its layer would throw the flight off'],
  ['features/spark/src/codex/ui/dialog.tsx', 'pointer-events-none fixed inset-0 z-50 overflow-y-auto', "a non-modal dialog's scroll layer, which dims nothing"],
  ['features/spark/src/codex/ui/dropdown-menu.tsx', 'pointer-events-auto fixed inset-0', 'a transparent click-catcher: it paints nothing'],
  ['features/code/src/workbench/WorkbenchTopBar.tsx', 'fixed inset-0 z-[90]', 'a transparent click-catcher: it paints nothing'],
  ['features/media/src/MediaView.tsx', 'fixed inset-0 bg-transparent', 'a transparent click-catcher: it paints nothing'],
  ['features/design/src/ColorPickerMenu.tsx', 'fixed inset-0 z-[99999] bg-transparent', 'a transparent click-catcher: it paints nothing'],
  ['features/design/src/ColorPickerMenu.tsx', 'fixed inset-0 z-[100001] bg-transparent', 'a transparent click-catcher: it paints nothing'],
  ['features/code/src/visual-editing/VisualEditorSelectMenu.tsx', 'fixed inset-0 z-[99999] bg-transparent', 'a transparent click-catcher: it paints nothing'],
  ['features/onboarding/src/Onboarding.tsx', 'fixed inset-0 z-[100] min-h-screen', 'also carries `relative`, which wins: it is not fixed at all'],
];

/** Inline-styled layers: kept-alive surfaces, never painted or hit. */
const INLINE_SET_ASIDE = {
  'apps/studio/src/app/App.tsx': 'a kept-alive surface: opacity 0, hidden, inert',
  'features/spark/src/SparkWorkspace.tsx': 'a kept-alive page: opacity 0, hidden, inert',
};

const SKIP = /node_modules|[\\/]dist[\\/]|[\\/]vendor[\\/]|[\\/]test[\\/]|\.test\./;
const sources = [];
const walk = (dir) => {
  for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = `${dir}/${entry.name}`;
    if (SKIP.test(rel)) continue;
    if (entry.isDirectory()) walk(rel);
    else if (/\.(css|tsx|ts)$/.test(entry.name)) sources.push(rel);
  }
};
['apps/studio/src', 'features', 'platform'].forEach(walk);

const FULL_INSET = (body) => /(^|[;\s{])inset:\s*0(px)?\s*(;|$)/.test(body)
  || ['top', 'right', 'bottom', 'left'].every((side) => new RegExp(`(^|[;\\s{])${side}:\\s*0(px)?\\s*(;|$)`).test(body));

/** Every stylesheet rule fixed over the whole window: [file, selector, body]. */
const cssLayers = () => sources.filter((f) => f.endsWith('.css')).flatMap((file) => {
  const css = stripComments(read(file));
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter((m) => /position:\s*fixed/.test(m[2]) && FULL_INSET(m[2]))
    .flatMap((m) => splitSelectors(m[1]).map((selector) => [file, selector, m[2]]));
});

/** Every Tailwind class string with `fixed` and `inset-0`: [file, line]. */
const tailwindLayers = () => sources.filter((f) => /\.tsx?$/.test(f)).flatMap((file) => read(file).split('\n')
  .filter((line) => /(^|[\s"'`])fixed([\s"'`]|$)/.test(line) && /(^|[\s"'`])inset-0([\s"'`]|$)/.test(line))
  .map((line) => [file, line.trim()]));

/** Whether the frame rule's Tailwind patterns catch a class string. */
const caughtByPatterns = (classes) => {
  const tokens = new Set(classes.split(/[\s"'`{}$()?:]+/).filter(Boolean));
  if (['relative', 'absolute', 'sticky'].some((t) => tokens.has(t)) || /:(relative|absolute|static|inset-auto)\b/.test(classes)) return false;
  return /bg-black\/|backdrop-blur|willow-frame-fill|codex-dialog-overlay/.test(classes)
    || (tokens.has('flex') && tokens.has('items-center') && tokens.has('justify-center'));
};

describe("the frame's rule", () => {
  it('lays a full-window layer over the page, inside its outline and corners, in the desktop app only', () => {
    assert.ok(RULE, 'the frame rule is in AppRail.css');
    const body = RULE[3];
    assert.match(body, /inset: var\(--willow-frame-inset\) !important;/);
    assert.match(body, /width: auto !important;\s*height: auto !important;/);
    assert.match(body, /border-radius: var\(--willow-frame-page-radius\) !important;/);
    assert.match(body, /clip-path: inset\(0 round var\(--willow-frame-page-radius\)\);/);
    assert.match(RULE[2], /\.relative, \.absolute, \.sticky/, 'a layer with another position is left alone');
    assert.match(FRAME_CSS, /:root:has\(\.willow-frame\) \{[^}]*--willow-frame-inset: var\(--willow-frame-top\) var\(--willow-frame-right\) var\(--willow-frame-bottom\) var\(--willow-frame-left\);/);
  });

  it('names the search panel, its own and the rest of the stylesheet dims', () => {
    for (const selector of ['.willow-search-backdrop', '.willow-search-positioner', '.willow-gdlg-backdrop', '.gm-library-lightbox-scrim']) {
      assert.ok(NAMED.includes(selector), selector);
    }
  });

  it("gives the Library's blurred copy, a picture, the page's size, which auto would not", () => {
    assert.match(FRAME_CSS, /:root:has\(\.willow-frame\) \.gm-library-lightbox-ambient \{\s*width: calc\(100vw - var\(--willow-frame-left\) - var\(--willow-frame-right\)\) !important;\s*height: calc\(100vh - var\(--willow-frame-top\) - var\(--willow-frame-bottom\)\) !important;/);
  });
});

describe('every full-window layer', () => {
  it('in a stylesheet is named by the rule, follows the frame itself, or is set aside with its reason', () => {
    const missing = cssLayers()
      .filter(([, selector, body]) => !NAMED.includes(selector) && !/var\(--willow-frame-inset/.test(body) && !(selector in CSS_SET_ASIDE))
      .map(([file, selector]) => `${file}: ${selector}`);
    assert.deepEqual(missing, [], 'new full-window layers: add them to the frame rule in AppRail.css, or set them aside here with why');
  });

  it('built with Tailwind is caught by its classes or set aside with its reason', () => {
    const missing = tailwindLayers()
      .filter(([file, line]) => !caughtByPatterns(line) && !TAILWIND_SET_ASIDE.some(([f, piece]) => f === file && line.includes(piece)))
      .map(([file, line]) => `${file}: ${line.slice(0, 120)}`);
    assert.deepEqual(missing, [], 'new full-window layers: give them a dim or centring class the rule catches, or set them aside here with why');
  });

  it('styled inline is a kept-alive surface or follows the frame', () => {
    const inline = sources.filter((f) => /\.tsx?$/.test(f)).flatMap((file) => {
      const lines = read(file).split('\n');
      return lines.flatMap((line, i) => {
        if (!/position:\s*['"]fixed['"]/.test(line)) return [];
        const near = lines.slice(Math.max(0, i - 3), i + 6).join(' ');
        return /inset:\s*(0\b|['"]0)/.test(near) && !/willow-frame/.test(near) ? [file] : [];
      });
    });
    assert.deepEqual([...new Set(inline)].filter((file) => !(file in INLINE_SET_ASIDE)), []);
  });

  it('set aside still exists, so the list cannot outlive what it describes', () => {
    const selectors = new Set(cssLayers().map(([, selector]) => selector));
    for (const selector of Object.keys(CSS_SET_ASIDE)) assert.ok(selectors.has(selector), selector);
    for (const [file, piece] of TAILWIND_SET_ASIDE) assert.ok(read(file).includes(piece), `${file}: ${piece}`);
    for (const file of Object.keys(INLINE_SET_ASIDE)) assert.match(read(file), /position:\s*'fixed',\s*inset:\s*0,/, file);
  });

  it('named by the rule still exists, so a renamed layer is not silently uncovered', () => {
    const selectors = new Set(cssLayers().map(([, selector]) => selector));
    for (const selector of NAMED.filter((s) => !s.startsWith('.fixed'))) {
      assert.ok(selectors.has(selector) || sources.some((f) => /\.tsx?$/.test(f) && read(f).includes(selector.slice(1))), selector);
    }
  });
});
