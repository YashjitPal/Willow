/**
 * Media on phones and tablets: Willow's own narrow layout for the Media editor (not Flow's, whose
 * narrow screens are its desktop squeezed). Media splits at Willow's compact width, 960px, and
 * again at 600px: a phone draws the rail as a drawer and its panels full screen, a tablet keeps an
 * icon rail. Touch screens, at any width, get what hover would have shown.
 *
 * The desktop layout was measured off Flow and must not move, so the narrow rules live in their
 * own stylesheets, every rule inside a narrow (or touch-only) @media block; the components switch
 * on `useMediaViewport`. The first test pins that nothing in those sheets reaches the desktop.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { importTs } from './ts-module.mjs';

const repoRoot = path.resolve(import.meta.dirname, '..', '..', '..');
const mediaDir = path.join(repoRoot, 'features', 'media', 'src');
const read = (file) => fs.readFileSync(path.join(mediaDir, file), 'utf8').replace(/\r\n/g, '\n');
const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');

/** The joined bodies of every `@media <query> { … }` block, matched brace for brace. */
const mediaBodies = (css, query) => {
  const opener = `@media ${query} {`;
  const bodies = [];
  let at = css.indexOf(opener);
  while (at !== -1) {
    let depth = 1;
    let i = at + opener.length;
    for (; i < css.length && depth > 0; i += 1) {
      if (css[i] === '{') depth += 1;
      else if (css[i] === '}') depth -= 1;
    }
    bodies.push(css.slice(at + opener.length, i - 1));
    at = css.indexOf(opener, i);
  }
  assert.ok(bodies.length > 0, `no @media ${query} block`);
  return bodies.join('\n');
};

/** The stylesheet with every @media block removed: what the desktop always sees. */
const withoutMedia = (css) => {
  let out = '';
  let at = 0;
  for (let start = css.indexOf('@media', at); start !== -1; start = css.indexOf('@media', at)) {
    out += css.slice(at, start);
    let i = css.indexOf('{', start) + 1;
    for (let depth = 1; i < css.length && depth > 0; i += 1) {
      if (css[i] === '{') depth += 1;
      else if (css[i] === '}') depth -= 1;
    }
    at = i;
  }
  return out + css.slice(at);
};

/** The declarations of the first rule whose selector list is exactly `selector`. */
const rule = (css, selector) => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = css.match(new RegExp(`(?:^|[}\\s])${escaped}\\s*\\{([^}]*)\\}`));
  assert.ok(match, `no rule for ${selector}`);
  return match[1];
};

const NARROW = '(max-width: 960px)';
const PHONE = '(max-width: 600px)';
const TABLET = '(min-width: 601px) and (max-width: 960px)';
const TOUCH = '(hover: none)';
/** A phone on its side. */
const SHORT = '(max-width: 960px) and (max-height: 500px)';

/** Each narrow stylesheet, the queries it may use, and who imports it. */
const SHEETS = [
  { file: 'media-responsive.css', queries: [NARROW, PHONE, TABLET, SHORT, TOUCH], importers: ['MediaView.tsx'] },
  { file: 'home-responsive.css', queries: [NARROW, TOUCH, PHONE, SHORT], importers: ['MediaHome.tsx'] },
  { file: 'editor/editor-responsive.css', queries: [NARROW, PHONE, SHORT, TOUCH], importers: ['editor/ImageEditor.tsx', 'scenes/SceneBuilder.tsx', 'editor/VersionStrip.tsx'] },
  { file: 'characters/characters-responsive.css', queries: [NARROW, PHONE, TOUCH], importers: ['characters/NewCharacterPage.tsx', 'characters/CharacterEditPage.tsx'] },
  { file: 'music/music-responsive.css', queries: [NARROW, PHONE], importers: ['music/MusicView.tsx'] },
  { file: 'tools/tools-responsive.css', queries: [NARROW, PHONE, SHORT], importers: ['tools/ToolsSurface.tsx'] },
  // Flow TV turns to its desktop remote at 768px; only the stretch from there to Willow's 960 is Willow's.
  { file: 'tv/tv-responsive.css', queries: ['(min-width: 768px) and (max-width: 960px)'], importers: ['tv/WillowTV.tsx'] },
];

test('no narrow rule reaches the desktop: every rule sits in a narrow or touch-only block', () => {
  for (const { file, queries, importers } of SHEETS) {
    const css = stripComments(read(file));
    assert.equal(withoutMedia(css).trim(), '', `${file} has rules outside @media`);
    for (const [, query] of css.matchAll(/@media\s*([^{]+?)\s*\{/g)) {
      assert.ok(queries.includes(query), `${file} uses @media ${query}`);
    }
    const name = path.basename(file);
    for (const importer of importers) {
      assert.match(read(importer), new RegExp(`import '\\.{1,2}/(?:[a-z]+/)?${name.replace('.', '\\.')}';`), `${importer} does not import ${name}`);
    }
  }
});

test('the viewport splits at 600 and 960px, and the components switch on it', async () => {
  const { mediaViewportNow, PHONE_VIEWPORT_QUERY, TOUCH_SCREEN_QUERY } = await importTs(path.join(mediaDir, 'use-media-viewport.ts'));
  assert.equal(PHONE_VIEWPORT_QUERY, PHONE);
  assert.equal(TOUCH_SCREEN_QUERY, TOUCH);
  const at = (width) => {
    const queryWidth = (q) => Number(q.match(/max-width:\s*(\d+)px/)[1]);
    globalThis.window = { matchMedia: (q) => ({ matches: width <= queryWidth(q) }) };
    try { return mediaViewportNow(); } finally { delete globalThis.window; }
  };
  assert.equal(at(390), 'phone');
  assert.equal(at(600), 'phone');
  assert.equal(at(601), 'tablet');
  assert.equal(at(960), 'tablet');
  assert.equal(at(961), 'desktop');
  assert.equal(at(1536), 'desktop');

  const view = read('MediaView.tsx');
  assert.match(view, /const isNarrow = viewport !== 'desktop';\s+useKeyboardInset\(isNarrow\);/);
  assert.match(view, /\{isNarrow \? \(\s*<MediaCompactHeader/);
  // The rail is a drawer on a phone either way up: on its side the icon column runs off the bottom.
  assert.match(read('use-media-viewport.ts'), /export function useRailDrawer\(\): boolean \{[^}]*return viewport === 'phone' \|\| \(short && viewport === 'tablet'\);/);
  assert.match(view, /const railAsDrawer = useRailDrawer\(\);\s+const railPresentation = railAsDrawer \? 'drawer' : viewport === 'tablet' \? 'rail' : 'desktop';/);
  // The gallery's rows: shorter and closer on a tablet and a phone, the desktop's own above 960px.
  assert.match(view, /const galleryGap = viewport === 'phone' \? 6 : viewport === 'tablet' \? 8 : GALLERY_GAP;/);
  assert.match(view, /const galleryTargetH = viewport === 'phone' \|\| isShortNarrow \? 128 : viewport === 'tablet' \? 176 : isSidebarCollapsed \? 230 : 270;/);
});

test('the rail is a drawer on a phone and an icon rail on a tablet; the desktop aside is untouched', () => {
  const sidebar = read('MediaSidebar.tsx');
  assert.match(sidebar, /presentation\?: 'desktop' \| 'rail' \| 'drawer'/);
  // Flow's project nav: 232px, its rows 215px from a 16px inset.
  assert.match(sidebar, /className=\{`\$\{collapsed \? 'w-\[80px\] px-4' : 'w-\[232px\] pl-4 pr-px'\} flex flex-col justify-between pb-2 shrink-0 relative z-\[75\]`\}/);
  assert.match(sidebar, /inert=\{!drawerOpen\}/);

  const narrow = mediaBodies(stripComments(read('media-responsive.css')), NARROW);
  // Willow's drawer metrics: min(320px, 85vw), #1c1c1c, the 300ms standard curve.
  const drawer = rule(narrow, '.media-drawer');
  assert.match(drawer, /width:\s*min\(320px,\s*85vw\)/);
  assert.match(drawer, /background:\s*#1c1c1c/);
  assert.match(drawer, /transition:\s*transform 300ms cubic-bezier\(0\.2, 0, 0, 1\)/);
  assert.match(rule(narrow, '.media-drawer-scrim'), /background:\s*rgba\(0, 0, 0, 0\.45\)/);

  // Wherever the rail is the drawer, the header leads with the menu button: Media's, and Explore
  // tools'. On its side a phone has no rail, so the composer centres on the whole window again.
  assert.match(read('MediaCompactHeader.tsx'), /\) : railAsDrawer \? \(\s*<HeaderButton glyph="menu" label="Open menu" onClick=\{onOpenDrawer\} \/>/);
  assert.match(read('tools/ToolsManagerPage.tsx'), /\{railAsDrawer && <FlowIconButton icon="menu" label="Open menu"/);
  assert.match(rule(mediaBodies(stripComments(read('media-responsive.css')), SHORT), '.media-composer'), /left:\s*50% !important/);
});

test('below 961px every FlowMatMenu, the filters and the settings are bottom sheets', () => {
  const ui = read('scenes/flow-ui.tsx');
  assert.match(ui, /const sheet = useCompactViewport\(\);/);
  // A sheet needs no anchor: a phone opens View settings and Filters from More.
  assert.match(ui, /if \(!mounted \|\| !panelRef\.current\) return;\s+[\s\S]*?if \(sheet\) \{\s+setPos\(\{ left: 0, top: 0, origin: 'bottom center' \}\);\s+return;\s+\}\s+if \(!lastAnchor\.current\) return;/);
  assert.match(ui, /const backdrop = sheet \|\| \(!parent && lastAnchor\.current\?\.kind !== 'point'\);/);

  const menus = read('HeaderMenus.tsx');
  assert.match(menus, /className=\{`hp-filter\$\{sheet \? ' is-sheet' : ''\}`\}/);

  const narrow = mediaBodies(stripComments(read('media-responsive.css')), NARROW);
  for (const selector of ['.sb-menu.is-sheet,\n  .sb-popover.is-sheet', '.hp-filter.is-sheet']) {
    assert.match(rule(narrow, selector), /border-radius:\s*28px 28px 0 0/);
  }

  // The composer's settings sheet: toggles grow to 44px and their rows with them, so no row runs
  // into the next; a model list opens in place rather than floating past the sheet's edge.
  assert.match(rule(narrow, '.media-settings-sheet button'), /min-height:\s*44px/);
  assert.match(rule(narrow, '.media-settings-sheet div:has(> button)'), /height:\s*auto/);
  assert.match(rule(narrow, '.media-settings-sheet .media-model-list'), /position:\s*static/);
  assert.equal(read('MediaView.tsx').match(/<div ref=\{revealModelList\} className=\{`media-model-list absolute /g)?.length, 2);

  // On a phone's side the add panel spans the room above the composer rather than its own height,
  // which would start above the screen.
  assert.match(rule(mediaBodies(stripComments(read('media-responsive.css')), SHORT), 'body .sb-picker.sb-picker--popover'), /top:\s*8px;\s*height:\s*auto/);
});

test('touch screens get the hover chrome some other way: three dots, a long press', () => {
  const css = stripComments(read('media-responsive.css'));
  const touch = mediaBodies(css, TOUCH);
  assert.match(touch, /\.gt-hover,[\s\S]*?\{\s*display:\s*none !important;/);
  assert.match(rule(touch, '.gallery-tile .gt-touch-more,\n  .cg-tile .gt-touch-more'), /width:\s*44px/);
  // Hidden for a mouse by the tile's own sheet, so the button never shows on the desktop.
  assert.match(stripComments(read('gallery-tile.css')), /\.gt-touch-more \{\s*display: none;\s*\}/);

  for (const file of ['GalleryTile.tsx', 'scenes/SceneTile.tsx', 'collections/CollectionTile.tsx', 'characters/CharactersGrid.tsx']) {
    const source = read(file);
    assert.match(source, /useLongPress\(/, `${file} has no long press`);
    assert.match(source, /<TouchMoreButton/, `${file} has no touch menu button`);
  }

  const hold = read('use-long-press.ts');
  assert.match(hold, /if \(event\.pointerType !== 'touch' \|\| !event\.isPrimary\) return;/);
  assert.match(hold, /const HOLD_MS = 500;/);
  // The lifted finger's click is dropped, so it cannot land on the sheet's backdrop.
  assert.match(hold, /window\.addEventListener\('click', swallow, true\);/);
});

test('the editors: one-row headers, the version strip, and a timeline a finger can scroll', () => {
  const editor = read('editor/ImageEditor.tsx');
  assert.match(editor, /\{narrow && !cropShape && <ImageHistory layout="strip" \{\.\.\.historyProps\} \/>\}/);
  assert.match(editor, /\{!narrow && <ImageHistory \{\.\.\.historyProps\} \/>\}/);
  const scene = read('scenes/SceneBuilder.tsx');
  assert.match(scene, /\{narrow && <SceneHistory layout="strip" \{\.\.\.historyProps\} \/>\}/);
  assert.match(scene, /\{touch && clips\.length > 1 && \(/);

  const css = stripComments(read('editor/editor-responsive.css'));
  const narrow = mediaBodies(css, NARROW);
  assert.match(rule(narrow, '.sb-editor .sb-header__center'), /order:\s*3/);
  assert.match(rule(narrow, '.sb-editor .sb-header .sb-icon-btn'), /width:\s*44px/);
  // The edit settings sheet: the toggles' row grows to its 44px toggles; the model picker spans it.
  assert.match(rule(narrow, '.sb-editor .ie-settings.is-sheet .ie-toggles'), /height:\s*auto/);
  assert.match(narrow, /\.sb-editor \.ie-settings\.is-sheet \.ie-model-select \{\s*width:\s*100%;/);
  assert.match(rule(mediaBodies(css, TOUCH), '.sb-editor .sb-playhead-hit,\n  .sb-editor .sb-trim'), /touch-action:\s*none/);

  const timeline = read('scenes/SceneTimeline.tsx');
  assert.match(timeline, /if \(e\.pointerType === 'touch'\) return;/);
  assert.match(timeline, /window\.addEventListener\('pointercancel', cancel\);/);
});

test('characters, music, tools, TV and the agent keep inside the screen', () => {
  const characters = stripComments(read('characters/characters-responsive.css'));
  assert.match(rule(mediaBodies(characters, PHONE), '.cp-page .cn-grid'), /grid-template-columns:\s*minmax\(0, 1fr\)/);
  assert.match(read('characters/CharacterEditPage.tsx'), /\{narrow && historyShown && \(\s*<div className="ce-strip">/);

  const music = stripComments(read('music/music-responsive.css'));
  assert.match(rule(mediaBodies(music, NARROW), '.music-sample-grid'), /grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\) !important/);

  const tools = stripComments(read('tools/tools-responsive.css'));
  assert.match(rule(mediaBodies(tools, NARROW), '.ng-flow-tools .ng-flow-applet-view-page .wt-pane-agent .applet-view-main'), /display:\s*none/);
  // Create tool's prompt stands under the hero and suggestions, so a short window scrolls them
  // above it rather than covering them.
  assert.match(rule(mediaBodies(tools, NARROW), '.ng-flow-tools .ng-flow-create-applet-page .create-applet-footer'), /position:\s*relative/);
  assert.match(rule(mediaBodies(tools, NARROW), '.ng-flow-tools .ng-flow-create-applet-page .create-applet-main'), /justify-content:\s*safe center/);
  // Its hint gives the field its height where it wraps, instead of floating cut off over one line;
  // on a phone's side the hero takes one line and the suggestions one row.
  assert.match(rule(mediaBodies(tools, NARROW), '.ng-flow-tools .ng-flow-create-applet-page .prosemirror-placeholder'), /position:\s*static/);
  assert.match(rule(mediaBodies(tools, SHORT), '.ng-flow-tools .ng-flow-create-applet-page .suggestions-row'), /flex-wrap:\s*nowrap/);
  // So does the agent's welcome, over its own prompt box.
  assert.match(read('AgentSidebar.tsx'), /className="agent-empty-state absolute inset-0 /);
  assert.match(rule(mediaBodies(stripComments(read('media-responsive.css')), NARROW), '.agent-sidebar-container .agent-empty-state'), /overflow-y:\s*auto/);
  const view = read('tools/ToolViewPage.tsx');
  assert.match(view, /\{narrow && showSidebar && \(\s*<div className="wt-edit-panes"/);
  assert.match(view, /\{editable && !narrow && \(\s*<FlowButton variant="secondary" className="apply-to-be-featured-button"/);

  assert.match(stripComments(read('tv/tv-responsive.css')), /margin-right:\s*calc\(var\(--gutter-outer\) \+ 50px\)/);
});

test("Media's home scrolls, and narrows: its promo takes a phone's shape, cards a touch menu, New project a pill", () => {
  // The chat experience's <main> clips, so the home is a scroll container of its own; without a
  // scrollbar, so the desktop's columns keep their width.
  const app = fs.readFileSync(path.join(repoRoot, 'apps', 'studio', 'src', 'app', 'App.tsx'), 'utf8').replace(/\r\n/g, '\n');
  assert.match(app, /<div className="media-home h-full overflow-y-auto overscroll-contain no-scrollbar">\s*<div className="flex min-h-full flex-col" key="media">\s*<HeroSection/);

  const css = stripComments(read('home-responsive.css'));
  const narrow = mediaBodies(css, NARROW);
  // Under the shell's menu button and avatar, as the Code tab's home starts.
  assert.match(rule(narrow, '.media-home .mh-root'), /padding:\s*calc\(68px \+ env\(safe-area-inset-top\)\) 24px 0/);
  assert.match(rule(narrow, '.media-home .mh-promo'), /aspect-ratio:\s*16 \/ 9 !important/);
  assert.match(rule(narrow, '.media-home .mh-new'), /left:\s*calc\(50% \+ var\(--willow-frame-center-shift, 0px\)\) !important/);
  const phone = mediaBodies(css, PHONE);
  assert.match(rule(phone, '.media-home .mh-promo'), /aspect-ratio:\s*1 \/ 1 !important/);
  assert.match(rule(phone, '.media-home .mh-projects'), /grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(rule(mediaBodies(css, TOUCH), '.media-home .mh-promo'), /touch-action:\s*pan-y/);

  const home = read('MediaHome.tsx');
  assert.match(home, /\{touch \? \(\s*<button\s+type="button"\s+aria-label=\{`Options for \$\{proj\.name\}`\}/);
  assert.match(home, /\{\.\.\.\(touch \? cardHold\.handlers : \{\}\)\}/);
  // A portal still bubbles React clicks, and a card's click opens its project: the sheet is after the cards.
  assert.ok(home.indexOf('<GeminiBottomSheet') > home.lastIndexOf('className="mh-card '), 'the sheet is rendered inside a card');
  assert.match(read('MediaShowcase.tsx'), /const menuAsSheet = isCompact;/);
});
