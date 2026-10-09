/**
 * The Code tab on phones and tablets. Gemini has no coding surface to measure, so below
 * 961px it follows the narrow pages that do: the shell's top bar with the model picker, a
 * landing whose cards fill the height between the heading and the composer, one workspace
 * pane at a time, and bottom sheets for menus.
 * The desktop layout must not move, so every narrow rule sits in a max-width query and the
 * components switch on the compact viewport rather than changing what the desktop renders.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

const repoRoot = path.resolve(import.meta.dirname, '..', '..', '..');
const read = (...parts) => fs.readFileSync(path.join(repoRoot, ...parts), 'utf8');
const code = (...parts) => read('features', 'code', 'src', ...parts);
const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');
const responsiveCss = () => stripComments(code('code-responsive.css'));

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

/** Every selector in a block of rules, comma-separated lists split apart. */
const selectorsOf = (body) => body
  .split('}')
  .map((chunk) => chunk.slice(0, chunk.indexOf('{')).trim())
  .filter(Boolean)
  .flatMap((list) => list.split(',').map((selector) => selector.trim()));

const NARROW = '(max-width: 960px)';
const PHONE = '(max-width: 600px)';

test('every narrow Code tab rule sits inside a phone or tablet query', () => {
  const css = responsiveCss();
  assert.equal(withoutMedia(css).trim(), '', 'a rule outside @media would reach the desktop');
  const queries = [...css.matchAll(/@media ([^{]+)\{/g)].map((match) => match[1].trim());
  assert.ok(queries.length > 0);
  for (const query of queries) assert.match(query, /\(max-width: (960|600|380)px\)/, `${query} is not a narrow query`);
  for (const file of ['CodeHome.tsx', 'CodeHomeSkeleton.tsx', 'WorkbenchView.tsx']) {
    assert.match(code(file), /import '\.\/code-responsive\.css';/, `${file} does not load the narrow rules`);
  }
});

test('the landing is a column: the heading under the top bar, then cards filling the height down to Your apps', () => {
  const css = responsiveCss();
  const narrow = mediaBodies(css, NARROW);
  assert.match(narrow, /\.code-hero \{\s*--code-apps-h: 72px;\s*display: flex;\s*flex-direction: column;/);
  assert.match(narrow, /\.code-hero \.code-hero-head \{\s*position: relative;\s*inset: auto;\s*flex: none;/);
  // Every category is in view: the pills wrap onto centred rows rather than scrolling.
  assert.match(narrow, /\.code-hero \.code-hero-pills \{\s*flex-wrap: wrap;\s*justify-content: center;/);
  assert.match(
    narrow,
    /\.code-hero \.code-hero-bento \{\s*position: relative;\s*inset: auto;\s*display: flex;\s*min-height: 0;\s*flex: 1 1 0;\s*flex-direction: column;/,
  );
  assert.match(
    narrow,
    /\.code-hero \.code-bento-grid \{\s*min-height: 0;\s*flex: 1 1 0;\s*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\) !important;\s*grid-template-rows: repeat\(2, minmax\(0, 1fr\)\);/,
  );
  assert.match(narrow, /\.code-hero \.code-bento-card\.is-wide \{\s*display: none;/);
  // The pictures take what the text leaves, so the cards can grow and shrink with the screen.
  assert.match(narrow, /\.code-hero \.code-bento-media \{\s*min-height: 0;\s*flex: 1 1 0;/);
  assert.match(narrow, /\.code-hero \.code-composer-spacer \{\s*flex: none;/);

  assert.match(
    mediaBodies(css, '(min-width: 601px) and (max-width: 960px) and (min-height: 1000px)'),
    /\.code-bento-grid \{\s*grid-template-rows: repeat\(3, minmax\(0, 1fr\)\);[\s\S]*\.code-bento-card\.is-wide \{\s*display: flex;\s*grid-column: 1 \/ -1;/,
    'a portrait tablet no longer gives the wide card the middle row',
  );
  assert.match(
    mediaBodies(css, '(max-width: 960px) and (max-height: 640px)'),
    /\.code-bento-grid \{\s*grid-template-rows: minmax\(0, 1fr\);[\s\S]*\.code-bento-card\.is-tall \{\s*display: none;/,
  );
  // A phone on its side keeps the heading and the composer; the cards would be crushed flat.
  const landscape = mediaBodies(css, '(max-width: 960px) and (max-height: 480px)');
  assert.match(landscape, /\.code-hero \.code-hero-head \{\s*flex: 1 1 0;/);
  assert.match(landscape, /\.code-hero \.code-hero-pills,\s*\.code-hero \.code-bento-grid \{\s*display: none;/);
});

test('the landing skeleton carries the live landing\'s hooks, so the swap does not jump on a phone', () => {
  const live = code('CodeHome.tsx');
  const skeleton = code('CodeHomeSkeleton.tsx');
  assert.doesNotMatch(skeleton, /from '\.\/CodeHome'/, 'the skeleton would pull the lazy chunk into the main bundle');
  const hooks = [
    'code-hero', 'code-hero-head', 'code-hero-head-inner', 'code-hero-title', 'code-hero-greeting', 'code-hero-pills',
    'code-hero-bento', 'code-bento-fade', 'code-bento-wrap', 'code-bento-grid', 'code-bento-col1', 'code-bento-smalls',
    'code-composer-spacer',
  ];
  for (const hook of hooks) {
    const used = new RegExp(`className=["\`]${hook} `);
    assert.match(live, used, `CodeHome lost ${hook}`);
    assert.match(skeleton, used, `the skeleton lacks ${hook}`);
  }
  const count = (source, cls) => source.split(`code-bento-card ${cls} `).length - 1;
  for (const [cls, expected] of [['is-small', 2], ['is-wide', 1], ['is-tall', 2]]) {
    assert.equal(count(live, cls), expected, `CodeHome has ${count(live, cls)} ${cls} cards`);
    assert.equal(count(skeleton, cls), expected, `the skeleton has ${count(skeleton, cls)} ${cls} cards`);
  }
});

test('below 961px the workspace shows one pane at a time and opens a tool on the pane that holds it', () => {
  for (const [file, collapsed, setCollapsed] of [
    ['CodeHome.tsx', 'isWorkbenchSidebarCollapsed', 'setIsWorkbenchSidebarCollapsed'],
    ['WorkbenchView.tsx', 'isSidebarCollapsed', 'setIsSidebarCollapsed'],
  ]) {
    const source = code(file);
    assert.match(source, new RegExp(`\\? \\{ width: ${collapsed} \\? '0px' : '100%' \\}`), `${file}: the chat pane does not take the width`);
    assert.match(source, /width=\{isCompact \? viewportWidth : isChatMode \? 800 : sidebarWidth\}/);
    assert.match(source, /width: isChatMode && !isCompact \? '800px' : '100%'/);
    assert.match(source, /\$\{isCompact \? ' hidden' : ''\}`\}/, `${file}: the resizer still takes touches`);
    assert.match(
      source,
      new RegExp(
        "if \\(!isCompact \\|\\| isChatMode\\) return;\\s*"
        + "if \\(activeTab === 'design' \\|\\| activeTab === 'agents' \\|\\| activeTab === 'canvas'\\) \\{\\s*"
        + `${setCollapsed}\\(false\\);\\s*`
        + "\\} else if \\(activeTab === 'agent-builder' \\|\\| activeTab === 'canvas-screens' \\|\\| activeTab === 'canvas-elements'\\) \\{\\s*"
        + `${setCollapsed}\\(true\\);`,
      ),
      `${file}: a tool no longer opens on its own pane`,
    );
  }
  const sidebar = code('workbench', 'WorkbenchSidebar.tsx');
  assert.match(sidebar, /aria-label="Show preview"/);
  const topBar = code('workbench', 'WorkbenchTopBar.tsx');
  assert.match(topBar, /\{isSidebarCollapsed && isNarrow \? \(/);
  assert.match(topBar, /aria-label="Back to chat"/);
  assert.match(topBar, /\{activeTab !== 'agent-builder' && !isNarrow && \(/, 'the address bar is back on a narrow bar');

  // A fourth open tool overran the bar and hid Add tool under Problems: the tabs scroll
  // instead, outside of which Add tool and its menu stay, and the active tab is kept in view.
  assert.match(topBar, /<div ref=\{tabStripRef\} className="code-topbar-tabs flex items-center gap-1">/);
  assert.match(topBar, /data-active=\{isActive \? 'true' : undefined\}/);
  assert.ok(
    topBar.indexOf('aria-label="Add tool"') > topBar.indexOf('{visibleTools.map(') && /\}\)\}\s*<\/div>\s*\{\/\* Separated Add Button/.test(topBar),
    'Add tool moved into the scrolling strip, which would clip its menu',
  );
  const narrow = mediaBodies(responsiveCss(), NARROW);
  assert.match(narrow, /div\.code-topbar \{\s*column-gap: 8px;/);
  assert.match(narrow, /\.code-topbar \.code-topbar-tabs \{\s*min-width: 0;\s*overflow-x: auto;/);
  assert.match(narrow, /\.code-topbar \.code-topbar-tabs > button \{\s*flex: none;/);
});

test('the composer, sidebar and top bar menus are bottom sheets below 961px, and a sheet tap is no outside click', () => {
  const home = code('CodeHome.tsx');
  assert.match(home, /\{isToolsMenuOpen && !isCompact && \(/);
  assert.match(home, /<GeminiBottomSheet isOpen=\{isCompact && isToolsMenuOpen\}/);
  assert.match(home, /\{isCompact && \(\s*<MobileModelPicker/, 'the landing lost the top bar model picker');
  assert.match(mediaBodies(responsiveCss(), NARROW), /\.code-composer \.code-composer-model \{\s*display: none;/);

  const sidebar = code('workbench', 'WorkbenchSidebar.tsx');
  assert.match(sidebar, /\{shouldRenderToolsMenu && !isNarrowScreen && \(/);
  assert.match(sidebar, /<GeminiBottomSheet isOpen=\{isNarrowScreen && isToolsMenuOpen\}/);
  assert.match(sidebar, /mobile=\{isNarrowScreen\}/);
  // A tap on a sheet row lands outside the dropdown's ref, so the dropdown's handler stands down.
  for (const [name, source] of [['CodeHome', home], ['WorkbenchSidebar', sidebar]]) {
    assert.match(source, /if \(isCompactViewport\(\)\) return;/, `${name} closes its menu mid-tap`);
  }

  assert.match(code('workbench', 'WorkbenchTopBar.tsx'), /<GeminiBottomSheet isOpen=\{isMoreOpen && !isVisualEdit\}/);

  // The effort row opens on a tap; a hover handler closed it again in the same gesture.
  const models = read('platform', 'ui', 'src', 'models', 'ModelsMenu.tsx');
  assert.match(models, /onMouseEnter=\{mobile \? undefined : /);
  assert.match(models, /onMouseLeave=\{mobile \? undefined : /);
});

test('on a phone the code panel shows the file list or the open file, with a way back', () => {
  const panel = code('workbench', 'CodePanel.tsx');
  assert.match(panel, /const isPhone = useViewportWidth\(\) <= 600;/);
  assert.match(panel, /const showsPhoneEditor = isPhone && phonePane === 'editor' && !!activeFileContent;/);
  assert.match(panel, /aria-label="Back to files"/);
  const phone = mediaBodies(responsiveCss(), PHONE);
  assert.match(phone, /\.code-panel \.code-panel-explorer\.is-phone-full \{\s*width: 100%;\s*min-width: 0;\s*max-width: none;/);
});

test('"Your apps" starts at the top on every screen, its narrow rules stay with the Code tab, and both tabs take the sheet', () => {
  const home = code('CodeHome.tsx');
  assert.match(
    home,
    /className=\{`code-apps-body w-full\$\{codeProjectCount > 0 \? '' : ' my-auto'\}`\}/,
    'the list is centred again, or the empty state is not',
  );

  const showcase = read('features', 'media', 'src', 'MediaShowcase.tsx');
  // Media's home narrows too (features/media/src/home-responsive.css), so its copy's menu is the sheet as well.
  assert.match(showcase, /const menuAsSheet = isCompact;/, 'a narrow screen would get the desktop menu in one of the tabs');
  assert.match(showcase, /\{isMenuOpen && !menuAsSheet && \(/);
  // A portal still bubbles React clicks, and a card's click opens its project.
  const lastCard = showcase.lastIndexOf('showcase-card');
  const sheet = showcase.indexOf('<GeminiBottomSheet');
  assert.ok(lastCard !== -1 && sheet > showcase.indexOf('})}', lastCard), 'the sheet is rendered inside a card');

  const css = responsiveCss();
  for (const query of [NARROW, PHONE]) {
    const showcaseSelectors = selectorsOf(mediaBodies(css, query)).filter((selector) => selector.includes('showcase-'));
    assert.ok(showcaseSelectors.length > 0);
    for (const selector of showcaseSelectors) {
      assert.match(selector, /^\.code-apps-section /, `${selector} would restyle the Media tab's panel`);
    }
  }
  const narrow = mediaBodies(css, NARROW);
  assert.match(narrow, /\.code-apps-section \.showcase-pills \{\s*flex-wrap: wrap;/);
  assert.match(narrow, /\.code-apps-section \.showcase-star,\s*\.code-apps-section \.showcase-more \{\s*opacity: 1;/);
});

test('the error toasts, the preview\'s loading art and the shell avatar give way on a narrow screen', () => {
  const narrow = mediaBodies(responsiveCss(), NARROW);
  assert.match(narrow, /div\.code-error-toasts \{\s*right: 16px;\s*max-width: calc\(100vw - 32px\);/);
  assert.match(narrow, /\.code-error-toasts \.code-error-toast-text \{\s*min-width: 0;/);
  assert.match(narrow, /div\.code-preview-loading-art \{\s*width: min\(400px, calc\(100vw - 48px\)\);\s*height: auto;\s*aspect-ratio: 2 \/ 1;/);
  assert.match(code('workbench', 'GlobalErrorToasts.tsx'), /className="code-error-toasts fixed top-20 bottom-4 right-6 /);
  assert.match(code('workbench', 'WorkbenchPreview.tsx'), /className="code-preview-loading-art w-\[400px\] h-\[200px\]"/);
  assert.match(
    read('apps', 'studio', 'src', 'shell', 'StudioLayout.tsx'),
    /currentView === 'home' && isChatExperience && !isChatOngoing && !isGemChat && !isSidebarHidden && \(/,
    'the narrow avatar is back over the workbench header',
  );
});
