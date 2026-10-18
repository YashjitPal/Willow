/**
 * Gemini's sidebar header (search and toggle), the collapsed rail's search, and its floating
 * "Search chats" panel, measured at 1536x826, 800x1280 and 390x844
 * (tools/ui-research/captures/gemini/sidebar-search/).
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { importTs } from './ts-module.mjs';

const ROOT = path.resolve(import.meta.dirname, '../../..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8').replace(/\r\n/g, '\n');
const codeOnly = (text) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const format = await importTs(path.join(ROOT, 'apps/studio/src/shell/search/search-format.ts'));

const PANEL = () => codeOnly(read('apps/studio/src/shell/search/SearchPanel.tsx'));
const PANEL_CSS = () => codeOnly(read('apps/studio/src/shell/search/search-panel.css'));
const ISLAND = () => codeOnly(read('apps/studio/src/shell/search/IslandButton.tsx'));
const SIDEBAR = () => codeOnly(read('apps/studio/src/shell/sidebar/Sidebar.tsx'));
const SIDEBAR_CSS = () => codeOnly(read('apps/studio/src/shell/sidebar/Sidebar.css'));
const HEADER_BUTTONS = () => codeOnly(read('apps/studio/src/shell/sidebar/SidebarHeaderButtons.tsx'));

/** The body of the first `selector { … }` rule outside any at-rule wrapper's other rules. */
const rule = (css, selector) => {
  const at = css.indexOf(`${selector} {`);
  assert.ok(at !== -1, `${selector} has a rule`);
  return css.slice(at, css.indexOf('}', at) + 1);
};

/** The joined bodies of every `@media <query> { … }` block, matched brace for brace. */
const media = (css, query) => {
  const opener = `@media ${query} {`;
  let out = '';
  for (let at = css.indexOf(opener); at !== -1; at = css.indexOf(opener, at + 1)) {
    let depth = 0;
    let end = at + opener.length - 1;
    for (; end < css.length; end += 1) {
      if (css[end] === '{') depth += 1;
      else if (css[end] === '}') { depth -= 1; if (depth === 0) break; }
    }
    out += css.slice(at + opener.length, end);
  }
  assert.ok(out, `${query} has a block`);
  return out;
};

describe('the date a row shows', () => {
  const now = new Date(2026, 9, 15, 12, 0);
  const daysAgo = (n) => new Date(2026, 9, 15 - n, 9, 30).getTime();

  it('counts calendar days: Today, Yesterday, then days, weeks, months and years, narrow', () => {
    const label = (n) => format.searchDateLabel(daysAgo(n), now);
    assert.equal(label(0), 'Today');
    assert.equal(label(1), 'Yesterday');
    assert.equal(label(2), '2d');
    assert.equal(label(6), '6d');
    assert.equal(label(7), '1w');
    assert.equal(label(29), '4w');
    assert.equal(label(30), '1mo');
    assert.equal(label(359), '11mo');
    assert.equal(label(364), '1y', 'twelve months reads as a year');
    assert.equal(label(800), '2y');
  });

  it('gives a later day its date, and nothing for no time', () => {
    assert.equal(format.searchDateLabel(new Date(2026, 9, 17).getTime(), now), 'Oct 17');
    assert.equal(format.searchDateLabel(0, now), '');
    assert.equal(format.searchDateLabel(Number.NaN, now), '');
  });
});

describe('the line under a title', () => {
  it('finds every word of the query, ignoring case, and runs them together where they touch', () => {
    assert.deepEqual(format.matchRanges('Organic Chemistry', 'chem'), [{ start: 8, end: 12 }]);
    assert.deepEqual(format.matchRanges('Board and JEE one-shots', 'jee one'), [{ start: 10, end: 13 }, { start: 14, end: 17 }]);
    assert.deepEqual(format.matchRanges('anything', '   '), []);
    assert.deepEqual(
      format.highlightSegments('abcdef', [{ start: 2, end: 4 }, { start: 1, end: 3 }, { start: 9, end: 12 }]),
      [{ text: 'a', highlighted: false }, { text: 'bcd', highlighted: true }, { text: 'ef', highlighted: false }],
    );
    assert.deepEqual(format.highlightSegments('plain', []), [{ text: 'plain', highlighted: false }]);
  });

  it('cuts at Gemini\'s 200 units without splitting a surrogate pair', () => {
    assert.equal(format.trimSnippet('x'.repeat(250)).length, 200);
    const pair = `${'x'.repeat(199)}\u{1F600}tail`;
    assert.equal(format.trimSnippet(pair), 'x'.repeat(199));
    assert.equal(format.SNIPPET_MAX_LENGTH, 200);
  });

  it('reads markdown as one line of text', () => {
    assert.equal(format.plainSnippetText('# Title\n**Bold** and `code`, a [link](https://x.y)\n```js\nconst a = 1;\n```\n- item'), 'Title Bold and code, a link item');
  });

  it('takes the first message with a match, quotes a prompt, and falls back to the first prompt', () => {
    const messages = [
      { role: 'user', content: 'teach me organic chemistry' },
      { role: 'assistant', content: 'Carbon compounds are the subject.' },
    ];
    const prompt = format.pickSnippet(messages, 'organic');
    assert.equal(prompt.text, '\u201cteach me organic chemistry\u201d');
    assert.equal(prompt.fromUser, true);
    assert.deepEqual(prompt.ranges, [{ start: 10, end: 17 }], 'the ranges fall on the quoted text');
    const reply = format.pickSnippet(messages, 'carbon');
    assert.equal(reply.text, 'Carbon compounds are the subject.');
    assert.equal(reply.fromUser, false);
    assert.equal(format.pickSnippet(messages, 'nowhere').text, '\u201cteach me organic chemistry\u201d');
    assert.equal(format.pickSnippet([], 'x'), null);
  });

  it('starts a late match at its sentence', () => {
    const long = `${'Filler words go on and on. '.repeat(4)}The match is chemistry here.`;
    const snippet = format.pickSnippet([{ role: 'assistant', content: long }], 'chemistry');
    assert.ok(snippet.text.startsWith('The match is chemistry'), snippet.text);
  });
});

describe('recents and results', () => {
  it('leaves pinned chats out of recents, and pages as Gemini does', () => {
    assert.deepEqual(format.recentChatIds(['a', 'b', 'c'], ['b']), ['a', 'c']);
    assert.equal(format.RECENTS_PAGE_SIZE, 13);
    assert.equal(format.RESULTS_LIMIT, 20);
    assert.equal(format.SEARCH_DEBOUNCE_MS, 200);
    assert.equal(format.SEARCH_DEBOUNCE_COMPACT_MS, 270);
  });

  it('sorts on the client: as ranked for Most relevant, newest first for Most recent', () => {
    const ranked = [{ id: 'old', updatedAt: 1 }, { id: 'new', updatedAt: 3 }, { id: 'mid', updatedAt: 2 }];
    assert.deepEqual(format.sortSearchResults(ranked, 'relevant').map((r) => r.id), ['old', 'new', 'mid']);
    assert.deepEqual(format.sortSearchResults(ranked, 'recent').map((r) => r.id), ['new', 'mid', 'old']);
    assert.deepEqual(ranked.map((r) => r.id), ['old', 'new', 'mid'], 'the ranked list is left as it was');
  });

  it('keeps what it showed through the debounce, then the skeleton while the search runs, then every result at once', () => {
    // Gemini's, recorded frame by frame: Recents (or the last results) stay ~300ms after a
    // keystroke, then "Searching chats" until the answer, which lands whole. No "No results
    // found" in between, and no rows dripping in one chat at a time.
    const search = codeOnly(read('apps/studio/src/shell/SearchChats.tsx'));
    assert.match(search, /skeletonFrame = window\.requestAnimationFrame\(\(\) => \{\s*if \(!settled && !cancelled\) setShown\(\{ query: typed, results: \[\], isSearching: true \}\);/);
    assert.match(search, /settled = true;\s*window\.cancelAnimationFrame\(skeletonFrame\);\s*if \(!cancelled\) setShown\(\{ query: typed, results: found, isSearching: false \}\);/);
    assert.doesNotMatch(search, /setSearchResults\(\[\.\.\.matches\]\)/, 'no rows one at a time');
    assert.match(search, /return queryKey \? shown : NOTHING_SEARCHED;/);
    const panel = PANEL();
    assert.match(panel, /const \{ query: searched, results, isSearching \} = useChatSearch\(/);
    assert.match(panel, /if \(!searched\) \{[\s\S]*?\} else if \(isSearching\) \{\s*body = <Skeleton variant="results" \/>;\s*\} else if \(sortedResults\.length === 0\) \{\s*body = <p className="willow-search-empty">No results found<\/p>;/);
    assert.match(panel, /query=\{searched\} snippet=\{result\.snippet\}/, 'matches are marked for the query the results are for');
  });

  it('keeps the query for the tab\'s session', () => {
    assert.equal(format.SEARCH_QUERY_STORAGE_KEY, 'willow.search.last_query');
    const panel = PANEL();
    assert.match(panel, /useState\(readSearchQuery\)/);
    assert.match(panel, /writeSearchQuery\(next\)/);
    assert.match(panel, /useChatSearch\(value, modelConfig, compact \? SEARCH_DEBOUNCE_COMPACT_MS : SEARCH_DEBOUNCE_MS\)/);
  });
});

describe('the panel', () => {
  it('is a modal dialog over the page, opened and closed in one frame', () => {
    const panel = PANEL();
    assert.match(panel, /createPortal\(<SearchDialog \{\.\.\.props\} \/>, document\.body\)/);
    assert.match(panel, /role="dialog" aria-modal="true" aria-label="Search chats" className="willow-search-panel"/);
    assert.match(panel, /<section role="search" aria-label="Search chats"/);
    assert.doesNotMatch(PANEL_CSS(), /\.willow-search-(panel|backdrop|positioner) \{[^}]*(animation|transition):/);
  });

  it('closes the sort menu before the panel on Escape, and keeps Tab inside', () => {
    const panel = PANEL();
    assert.match(panel, /if \(sortMenuOpenRef\.current\) \{\s*setSortMenu\(null\);\s*sortButtonRef\.current\?\.focus\(\{ preventScroll: true \}\);\s*\} else \{\s*onCloseRef\.current\(\);/);
    assert.match(panel, /if \(event\.shiftKey && document\.activeElement === first\) \{ event\.preventDefault\(\); last\.focus\(\); \}/);
  });

  it('closes on a press that starts and ends outside the card', () => {
    const panel = PANEL();
    assert.match(panel, /if \(event\.target === event\.currentTarget\) event\.currentTarget\.dataset\.pressedOutside = 'true';/);
    assert.match(panel, /if \(pressedOutside && event\.target === event\.currentTarget\) onClose\(\);/);
  });

  it('hands focus back while it is still in the page, quietly if the control in it showed none', () => {
    const panel = PANEL();
    assert.match(panel, /useLayoutEffect\(\(\) => \{\s*const opener = document\.activeElement/);
    assert.match(panel, /if \(quiet\) focusQuietly\(opener\);\s*else opener\.focus\(\{ preventScroll: true \}\);/);
    assert.match(panel, /element\.focus\(\{ preventScroll: true, focusVisible: false \} as FocusOptions\)/);
  });

  it('leaves a modified or middle click on a row to the browser', () => {
    assert.match(PANEL(), /if \(event\.button !== 0 \|\| event\.defaultPrevented \|\| event\.metaKey \|\| event\.ctrlKey \|\| event\.shiftKey \|\| event\.altKey\) return;/);
  });

  it('uses the island buttons for Clear, Close and the sort order', () => {
    const panel = PANEL();
    assert.match(panel, /<IslandButton\s+aria-label="Clear search"/);
    assert.match(panel, /<IslandButton aria-label="Close" className="willow-search-close"/);
    assert.match(panel, /<IslandButton\s+ref=\{sortButtonRef\}\s+aria-haspopup="menu"/);
  });
});

describe('the sort menu', () => {
  it('focuses itself from a click and an end item from the keys', () => {
    const panel = PANEL();
    assert.match(panel, /setSortMenu\(\(open\) => \(open \? null : event\.detail === 0 \? 'first' : 'pointer'\)\)/);
    assert.match(panel, /setSortMenu\(event\.key === 'ArrowDown' \? 'first' : 'last'\)/);
    assert.match(panel, /useState<number \| null>\(opening === 'pointer' \? null : opening === 'first' \? 0 : last\)/);
  });

  it('wraps the arrows, jumps on letters, and leaves for the next stop on Tab', () => {
    const panel = PANEL();
    assert.match(panel, /setHighlighted\(\(i\) => \(i === null \|\| i === last \? 0 : i \+ 1\)\)/);
    assert.match(panel, /setHighlighted\(\(i\) => \(i === null \|\| i === 0 \? last : i - 1\)\)/);
    assert.match(panel, /const TYPEAHEAD_RESET_MS = 750;/);
    assert.match(panel, /onClose\(event\.shiftKey \? 'shift-tab' : 'tab'\)/);
  });

  it('sits 4px under its button, right edges aligned, on whole device pixels', () => {
    const panel = PANEL();
    assert.match(panel, /setPlace\(\{ top: toDevicePixel\(box\.bottom \+ 4\), left: toDevicePixel\(box\.right - width\) \}\)/);
    assert.match(panel, /aria-label="Sort search results"/);
  });

  it('marks the chosen order, not the highlighted item, with the fill and the check', () => {
    const panel = PANEL();
    assert.match(panel, /aria-selected=\{selected \? 'true' : undefined\}/);
    assert.match(panel, /\{selected && <span className="willow-search-menu-item-check"/);
    const css = PANEL_CSS();
    assert.match(rule(css, '.willow-search-menu-item[aria-selected="true"]'), /background-color: var\(--willow-search-fill\);/);
    assert.doesNotMatch(css, /\.willow-search-menu-item\[data-highlighted\] \{/);
  });
});

describe('the panel\'s stylesheet', () => {
  it('is Gemini\'s card above 960px and the whole screen below', () => {
    const css = PANEL_CSS();
    const card = rule(css, '.willow-search-panel');
    for (const value of ['max-width: 660px;', 'height: min(85vh, 760px);', 'padding: 16px 16px 0;', 'border-radius: 40px;', 'box-shadow: rgba(0, 0, 0, 0.04) 0 0 20px 0;']) {
      assert.ok(card.includes(value), value);
    }
    const narrow = media(css, '(max-width: 959.98px)');
    assert.match(narrow, /\.willow-search-panel \{[^}]*max-width: 100%;[^}]*height: 100%;[^}]*padding: 16px 8px 0;[^}]*border-radius: 0;/);
    assert.match(narrow, /\.willow-search-heading,\s*\.willow-search-heading-row \{[^}]*padding: 0 16px;/);
  });

  it('takes its colours from the island theme\'s tokens, both themes', () => {
    const css = PANEL_CSS();
    const dark = rule(css, '.willow-search-panel');
    for (const token of ['--willow-search-text: #e3e3e3;', '--willow-search-muted: rgba(255, 255, 255, 0.55);', '--willow-search-faint: rgba(255, 255, 255, 0.38);', '--willow-search-surface: #1c1c1c;', '--willow-search-fill: #171717;']) {
      assert.ok(dark.includes(token), token);
    }
    assert.match(media(css, '(max-width: 767px)'), /--willow-search-fill: #141414;/);
    const light = rule(css, ':is(.light-theme, [data-theme="light"]) .willow-search-panel');
    for (const token of ['--willow-search-text: #000000;', '--willow-search-muted: rgba(0, 0, 0, 0.55);', '--willow-search-faint: rgba(0, 0, 0, 0.38);', '--willow-search-surface: #ffffff;', '--willow-search-fill: #f2f0f0;']) {
      assert.ok(light.includes(token), token);
    }
    assert.match(rule(css, '.willow-search-backdrop'), /background-color: rgba\(0, 0, 0, 0\.32\);/);
    assert.match(rule(css, ':is(.light-theme, [data-theme="light"]) .willow-search-backdrop'), /rgba\(0, 0, 0, 0\.2\)/);
  });

  it('draws the island states from IslandButton\'s attributes, as mixes of the ink', () => {
    const css = PANEL_CSS();
    assert.match(css, /background-color: color-mix\(in srgb, currentColor 8%, transparent\);/);
    assert.match(css, /\.willow-search-pill\[data-pressed\]::after,[^{]*\{\s*background-color: color-mix\(in srgb, currentColor 12%, transparent\);/);
    assert.match(css, /\.willow-search-pill\[data-focus-visible\]::before,[\s\S]*?\.willow-search-row:focus-visible::before \{\s*inset: -5px;\s*opacity: 1;/);
    assert.doesNotMatch(css, /\.willow-search-(pill|close)(:hover|:active|:focus-visible)/);
  });

  it('fills a row under the pointer or the press at once, and keeps an empty field faint', () => {
    const css = PANEL_CSS();
    assert.match(css, /\.willow-search-row:hover,\s*\.willow-search-row:active \{\s*background-color: var\(--willow-search-fill\);/);
    assert.match(rule(css, '.willow-search-input:placeholder-shown'), /color: var\(--willow-search-faint\);/);
    assert.match(rule(css, '.willow-search-input::placeholder'), /color: var\(--willow-search-muted\);/);
  });

  it('breathes the skeleton in the ink between 8% and 18%', () => {
    const css = PANEL_CSS();
    const bar = rule(css, '.willow-search-skeleton-bar');
    assert.match(bar, /background-color: currentColor;/);
    assert.match(bar, /animation: willow-search-pulse 1\.2s ease-in-out infinite;/);
    assert.match(css, /@keyframes willow-search-pulse \{\s*0% \{\s*opacity: 0\.08;\s*\}\s*50% \{\s*opacity: 0\.18;/);
  });
});

describe('the island buttons', () => {
  it('take hover, press and keyboard focus from mouse and focus events, as Luminous does', () => {
    const island = ISLAND();
    assert.match(island, /onMouseEnter: \(event: React\.MouseEvent<T>\) => \{\s*if \(!disabled\) setHovered\(true\);/);
    assert.match(island, /onMouseLeave: \(event: React\.MouseEvent<T>\) => \{\s*setHovered\(false\);\s*setPressed\(false\);/);
    assert.match(island, /onMouseDown: \(event: React\.MouseEvent<T>\) => \{\s*if \(!disabled\) setPressed\(true\);/);
    assert.match(island, /event\.target\.matches\(':focus-visible'\)\) setFocusVisible\(true\);/);
    assert.match(island, /'data-hovered': hovered \? '' : undefined/);
  });
});

describe('the sidebar header and the rail', () => {
  it('puts Search chats left of Close sidebar, behind the width, and drops the Search tab', () => {
    const sidebar = SIDEBAR();
    assert.match(sidebar, /<div className="willow-sidenav-header-buttons">\s*<SidebarSearchButton placement="header" onClick=\{\(\) => onSearchClick\?\.\(\)\} \/>\s*<SidebarCloseButton onClick=\{onToggleCollapse\} \/>/);
    assert.match(sidebar, /<SidebarOpenButton onClick=\{onToggleCollapse\}>/);
    assert.doesNotMatch(sidebar, /label="Search chats"/);
    const header = rule(SIDEBAR_CSS(), '.willow-sidenav-header-buttons');
    assert.match(header, /position: absolute;\s*top: 8px;\s*right: 8px;/);
    assert.match(header, /animation: willow-sidenav-show-close-button 50ms linear 250ms forwards;/);
  });

  it('shows the rail\'s search under New chat with Gemini\'s fade, display held to its end', () => {
    assert.match(SIDEBAR(), /<div className="willow-rail-search">\s*<SidebarSearchButton placement="rail"/);
    const css = SIDEBAR_CSS();
    const hidden = rule(css, '.willow-rail-search .willow-sidenav-search');
    assert.match(hidden, /display: none;/);
    assert.match(hidden, /transition: opacity 150ms cubic-bezier\(0, 0, 0, 0\) 0s, visibility 0s ease 150ms, display 150ms ease 0s;/);
    assert.match(hidden, /transition-behavior: allow-discrete;/);
    assert.match(rule(css, '.studio-sidebar--collapsed .willow-rail-search .willow-sidenav-search'), /display: flex;[\s\S]*transition-delay: 0s, 0s, 0s;/);
    assert.match(css, /@starting-style \{\s*\.studio-sidebar--collapsed \.willow-rail-search \.willow-sidenav-search \{\s*opacity: 0;/);
    assert.match(rule(css, '.studio-sidebar--collapsed .willow-rail-search'), /height: 36px;/);
  });

  it('fades the rail\'s list in as it collapses and after the width as it expands', () => {
    assert.match(SIDEBAR(), /list\.animate\(\[\{ opacity: 0 \}, \{ opacity: 1 \}\], \{ duration: 150, delay: isCollapsed \? 0 : 100, easing: 'linear', fill: 'backwards' \}\);/);
  });

  it('gives the search button the island tooltip, below in the header and right on the rail', () => {
    const buttons = HEADER_BUTTONS();
    assert.match(buttons, /<IslandButton\s+aria-label="Search chats"\s+aria-haspopup="dialog"\s+title="Search chats"\s+data-tooltip-variant="island"\s+data-tooltip-position=\{placement === 'rail' \? 'right' : 'below'\}/);
    assert.match(buttons, /aria-label="Close sidebar"/);
    assert.match(buttons, /aria-label="Open sidebar"/);
    for (const glyph of ['side_nav<', 'side_nav_collapse<', 'side_nav_expand<', '>close<']) assert.ok(buttons.includes(glyph), glyph);
  });

  it('sizes the drawer\'s search 48px on phones and 36px from 769px', () => {
    const css = SIDEBAR_CSS();
    assert.match(rule(css, '.willow-sidenav-search'), /width: 36px;\s*height: 36px;/);
    const phone = media(css, '(max-width: 768px)');
    assert.match(phone, /\.willow-sidenav-header-buttons \.willow-sidenav-search \{\s*width: 48px;\s*height: 48px;/);
    assert.match(phone, /\.willow-sidenav-header-buttons \.willow-sidenav-search-glyph \{[^}]*font-size: 24px;[^}]*"opsz" 24, "wght" 300;/);
  });

  it('mixes the search button\'s layers from its ink, so both themes come out right', () => {
    const css = SIDEBAR_CSS();
    assert.match(rule(css, '.willow-sidenav-search::after'), /background-color: color-mix\(in srgb, currentColor 8%, transparent\);/);
    assert.match(rule(css, '.willow-sidenav-search[data-pressed]::after'), /color-mix\(in srgb, currentColor 12%, transparent\)/);
    assert.match(rule(css, '.willow-sidenav-search[data-focus-visible]::before'), /inset: -5px;/);
  });
});

describe('opening the panel', () => {
  it('opens from the sidebar and from /search, which goes back to /app', () => {
    assert.match(codeOnly(read('apps/studio/src/shell/StudioLayout.tsx')), /onSearchClick=\{\(\) => setIsSearchOpen\(true\)\}/);
    const app = codeOnly(read('apps/studio/src/app/App.tsx'));
    assert.match(app, /useState\(\(\) => location\.pathname === '\/search'\)/);
    assert.match(app, /if \(\w+ === 'search'\) \{\s*setIsSearchOpen\(true\);\s*return true;\s*\}/);
    assert.match(app, /if \(location\.pathname === '\/search'\) \{\s*setIsSearchOpen\(true\);\s*navigate\('\/app', \{ replace: true \}\);/);
    assert.doesNotMatch(app, /SearchChatsPage/);
  });

  it('has replaced the search page and the old modal', () => {
    for (const gone of ['SearchModal.tsx', 'SearchModal.css', 'SearchChats.css']) {
      assert.equal(fs.existsSync(path.join(ROOT, 'apps/studio/src/shell', gone)), false, gone);
    }
  });
});

describe('the island tooltip', () => {
  it('is opted into by attribute, snapped to device pixels, 6.4px from its trigger', () => {
    const tooltip = codeOnly(read('platform/ui/src/Tooltip.tsx'));
    assert.match(tooltip, /const VARIANT_ATTR = 'data-tooltip-variant';/);
    assert.match(tooltip, /const snap = \(value: number\) => \(variant === 'island' \? Math\.round\(value \* dpr\) \/ dpr : value\);/);
    const css = codeOnly(read('platform/ui/src/Tooltip.css'));
    assert.match(css, /\.willow-tooltip-pane--island\.willow-tooltip-pane--below \{\s*transform: translateY\(6\.4px\);/);
    assert.match(css, /\.willow-tooltip-surface--island \{\s*background-color: rgb\(227, 227, 227\);\s*font-family: initial;\s*font-size: 16px;\s*line-height: normal;/);
  });
});
