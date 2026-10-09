/**
 * The October 2026 canvas, matched to Gemini's: the rich-text editor's Markdown round
 * trip, the code view's bracket colours, the measured values in canvas.css, and the
 * full-width layout ChatView switches to for a full-screen canvas.
 *
 * The values pinned here were read off the live Gemini app over CDP (1536x826 / DPR
 * 1.25, plus 390x844 and 800x1280 under emulation) and re-measured off Willow's own
 * render to the decimal. They are asserted as text because the point is that they do
 * not drift; the round trip is executed because the point is that it is lossless.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { it } from 'node:test';
import { importTs } from './ts-module.mjs';

const repo = path.resolve(import.meta.dirname, '..', '..', '..');
const canvasDir = path.join(repo, 'features', 'chat', 'src', 'canvas');
const read = (...parts) => fs.readFileSync(path.join(...parts), 'utf8');
const CSS = read(canvasDir, 'canvas.css');
const PANEL = read(canvasDir, 'CanvasPanel.tsx');
const CARD = read(canvasDir, 'CanvasCard.tsx');
const VIEW = read(canvasDir, 'canvas-view.tsx');
const PROMPT = read(canvasDir, 'CanvasPrompt.tsx');
const EDITOR = read(canvasDir, 'CanvasRichEditor.tsx');
const CHAT = read(repo, 'features', 'chat', 'src', 'ChatView.tsx');

const { markdownToEditorHtml, editorDomToMarkdown, normalizeMathDelimiters } = await importTs(path.join(canvasDir, 'canvas-markdown.ts'));

/* ------------------------------------------------ a DOM, just big enough */

const VOID = new Set(['br', 'hr', 'img', 'input']);
const decode = (text) => text.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#8203;/g, '\u200b').replace(/&amp;/g, '&');

/** Parses the editor's own HTML (and the browser's editing output) into `MdNode`s. */
const parse = (html) => {
  const root = { nodeType: 1, nodeName: 'DIV', childNodes: [], attrs: {} };
  const stack = [root];
  const re = /<\/?([a-zA-Z0-9]+)((?:\s+[a-zA-Z-]+(?:="[^"]*")?)*)\s*\/?>|([^<]+)/g;
  let m;
  while ((m = re.exec(html))) {
    const top = stack[stack.length - 1];
    if (m[3] !== undefined) { top.childNodes.push({ nodeType: 3, nodeName: '#text', text: decode(m[3]), childNodes: [] }); continue; }
    const tag = m[1].toLowerCase();
    if (m[0].startsWith('</')) {
      while (stack.length > 1 && stack.pop().nodeName.toLowerCase() !== tag) { /* unwind */ }
      continue;
    }
    const attrs = {};
    for (const a of (m[2] || '').matchAll(/([a-zA-Z-]+)(?:="([^"]*)")?/g)) attrs[a[1]] = decode(a[2] ?? '');
    const node = { nodeType: 1, nodeName: tag.toUpperCase(), childNodes: [], attrs };
    top.childNodes.push(node);
    if (!VOID.has(tag)) stack.push(node);
  }
  const finish = (n) => {
    n.getAttribute = (name) => (n.attrs && name in n.attrs ? n.attrs[name] : null);
    n.childNodes.forEach(finish);
    Object.defineProperty(n, 'textContent', { get: () => (n.nodeType === 3 ? n.text : n.childNodes.map((c) => c.textContent).join('')) });
  };
  finish(root);
  return root;
};

const roundTrip = (markdown) => editorDomToMarkdown(parse(markdownToEditorHtml(markdown)));

/* ------------------------------------------------------------ round trip */

it('renders the editor\'s DOM with only the tags it reads back', () => {
  const html = markdownToEditorHtml('# Title\n\nSome **bold** and *italic* text.\n\n## Part\n\n- one\n- two\n');
  assert.equal(html, '<h1>Title</h1><p>Some <strong>bold</strong> and <em>italic</em> text.</p><h2>Part</h2><ul><li>one</li><li>two</li></ul>');
  assert.equal(markdownToEditorHtml(''), '<p><br></p>', 'an empty document is one empty paragraph to type into');
});

it('round-trips a document without changing a character', () => {
  const doc = [
    '# The Keeper',
    '',
    '**Thomas** had counted every one of the steps \u2014 the day\u2019s *last* climb.',
    '',
    '### The Midnight Watch',
    '',
    '1. First',
    '2. Second',
    '   - nested',
    '',
    '> A quote with `code`.',
    '',
    '```js',
    'const a = { b: 1 };',
    '```',
    '',
    'Inline $x^2$ and a [link](https://example.com).',
    '',
    '$$',
    'E = mc^2',
    '$$',
    '',
  ].join('\n');
  assert.equal(roundTrip(doc), doc);
});

it('keeps equations as atoms carrying their TeX', () => {
  const html = markdownToEditorHtml('Area $\\pi r^2$.\n');
  assert.match(html, /<span class="cv-math" data-tex="\\pi r\^2" contenteditable="false">/);
  assert.equal(normalizeMathDelimiters('a \\(x\\) b \\[y\\]'), 'a $x$ b $$y$$');
  assert.equal(normalizeMathDelimiters('`\\(kept\\)`'), '`\\(kept\\)`', 'code is left alone');
});

it('reads the browser\'s own editing output back as Markdown', () => {
  /* execCommand writes <b>/<i>, and Enter in a contenteditable can produce <div> lines. */
  assert.equal(editorDomToMarkdown(parse('<p><b>Bold</b> then <i>it</i></p><div>next line</div>')), '**Bold** then *it*\n\nnext line\n');
  assert.equal(editorDomToMarkdown(parse('<h1>Only <b>bold</b></h1>')), '# Only **bold**\n');
});

it('escapes typed text that would otherwise become syntax', () => {
  assert.equal(editorDomToMarkdown(parse('<p># not a heading and 2*3 = $6</p>')), '\\# not a heading and 2\\*3 = \\$6\n');
  assert.equal(roundTrip('\\# not a heading\n'), '\\# not a heading\n');
});

it('drops unsafe link targets instead of rendering them', () => {
  assert.ok(!markdownToEditorHtml('[x](javascript:alert(1))').includes('href'), 'a javascript: link must not survive');
});

/* ------------------------------------------------------- the code palette */

it('colours brackets by depth, outside strings and tags', async () => {
  const { colorBrackets } = await importTs(path.join(canvasDir, 'canvas-view.tsx'));
  const out = colorBrackets('f(a[0]) <span class="hljs-string">"(x)"</span> {');
  assert.equal(
    out,
    'f<span class="cv-bracket-0">(</span>a<span class="cv-bracket-1">[</span>0<span class="cv-bracket-1">]</span><span class="cv-bracket-0">)</span> <span class="hljs-string">"(x)"</span> <span class="cv-bracket-0">{</span>',
  );
  for (const [token, colour] of [['hljs-name', '#ff96da'], ['hljs-attr', '#ffdb0f'], ['hljs-string', '#60d673'], ['hljs-keyword', '#969dff'], ['hljs-tag', '#757575']]) {
    assert.match(CSS, new RegExp(`\\.cv-code-tokens \\.${token}[^{]*\\{ color: ${colour}; \\}`), `${token} drifted from Monaco's ${colour}`);
  }
});

/* --------------------------------------------------- the measured values */

it('pins the card, the panel and the toolbar to Gemini\'s measurements', () => {
  assert.match(CSS, /\.cv-card \{[^}]*height: 900px;[^}]*margin: 40px 0;[^}]*border-radius: 40px;/);
  assert.match(CSS, /\.cv-card__head \{[^}]*min-height: 72px;[^}]*padding: 8px 28px;/);
  assert.match(CSS, /\.cv-card \{ height: 500px; \}/, 'a phone\'s card is 500 tall');
  assert.match(CSS, /\.cv-toolbar \{[^}]*height: 60px;[^}]*padding: 0 32px;/);
  assert.match(CSS, /\.cv-toolbar__title \{[^}]*margin: 4px 0;[^}]*padding: 0 12px 0 8px;[^}]*font-weight: 370;/);
  assert.match(CSS, /\.cv-panel__doc \{ padding: 4px 48px 48px; \}/, '<=960 is 48 a side');
  assert.match(CSS, /\.cv-toolbar__actions > \.cv-share \{ margin-left: 8px; \}/, 'the empty gem-popover before Share');
});

/*
 * A deliberate departure. Gemini's full screen keeps the 24px side margins of its
 * side-by-side layout (max(24px, 50% - 900px), capped at 1800px), so the panel touches
 * the top and bottom of the window but stops short of the rail and the right edge.
 * Willow's is flush on both sides at every width; only the document's text column keeps
 * Gemini's 1800px ceiling, so lines on a wide monitor are no longer than Gemini's.
 */
it('draws the full-screen panel flush, with the document capped at Gemini\'s 1800px', () => {
  assert.match(CSS, /@media \(min-width: 960px\) \{[^}]*\*\/\s*\.cv-panel \{ grid-area: 1 \/ 1; margin: 0; \}/);
  assert.ok(!/50% - 900px\)\)/.test(CSS), 'no rule rebuilds Gemini\'s side margins');
  assert.match(CSS, /\.cv-panel__doc \{ max-width: 1800px; margin: 0 auto; padding: 4px 60px 48px 48px; \}/);
});

/*
 * "there is a gap between the right edge of the app's preview and the right edge of the
 * canvas". The prose body's `scrollbar-gutter: stable` was inherited by the code body, and
 * `overflow: hidden` still makes it a scroll container, so 15px stayed reserved for a
 * scrollbar that can never appear.
 */
it('runs the card\'s code preview to both edges', () => {
  assert.match(CSS, /\.cv-card__body \{[^}]*scrollbar-gutter: stable;/, 'the prose body keeps its gutter');
  assert.match(CSS, /\.cv-card__body--code \{[^}]*overflow: hidden;[^}]*scrollbar-gutter: auto; \}/);
});

it('pins the menus, the toggle and the editor type', () => {
  assert.match(CSS, /\.cv-gem-menu \{[^}]*top: calc\(100% \+ 4px\);[^}]*padding: 8px;[^}]*border-radius: 20px;[^}]*box-shadow: rgba\(0, 0, 0, 0\.28\) 0 0 20px 0;/);
  assert.match(CSS, /\.cv-mat-menu \{[^}]*width: 280px;[^}]*border-radius: 16px;[^}]*animation: cv-mat-menu-enter 120ms cubic-bezier\(0, 0, 0\.2, 1\);/);
  assert.match(CSS, /\.cv-mat-menu--leaving \{[^}]*animation: cv-mat-menu-exit 100ms linear 25ms forwards;/);
  assert.match(CSS, /\.cv-toggle \{[^}]*gap: 2px;[^}]*height: 36px;[^}]*padding: 4px;/);
  assert.match(CSS, /--cv-toggle-checked: rgb\(15, 15, 15\);/);
  assert.match(CSS, /\.cv-prose h1 \{ margin: 28px 0 8px; font-size: 28px; line-height: 36px; font-weight: 350;/);
  assert.match(CSS, /\.cv-prose h2 \{ margin: 28px 0 8px; font-size: 24px; line-height: 28px; font-weight: 380;/);
  assert.match(CSS, /\.cv-prose p \{ margin: 0 0 12\.5px; \}/);
});

/*
 * The <=960 toolbar, either side of Gemini's breakpoints. Its title goes at
 * `max-width: 480px` (shown at 481), and the overflow panel is shrink-to-fit from the
 * container's left edge: 148 wide on a 390 phone (the 132px Styles button is its
 * widest control) and the container's 531.5 on an 800 tablet, from one rule.
 */
it('folds the narrow toolbar at Gemini\'s breakpoints', () => {
  assert.match(CSS, /@media \(max-width: 480px\) \{\s*\.cv-overflow \.cv-toolbar__title \{ display: none; \}/);
  assert.ok(!/599\.98px/.test(CSS), 'no canvas rule keys off the old 600px guess');
  const panel = CSS.match(/\.cv-overflow-panel \{([^}]*)\}/)[1];
  assert.match(panel, /left: 0;/);
  assert.match(panel, /max-width: calc\(100vw - 12px\);/);
  assert.ok(!/\bright:/.test(panel) && !/\bwidth:/.test(panel.replace(/max-width/g, '')), 'no right edge and no width: it sizes to its contents');
});

/*
 * The expanded card's title row. Gemini's overflows from 601px to ~690px (its title
 * collapses to nothing and the redo arrow slides under Code / Preview); Willow's did
 * too, because its toggle sat inside the shrinking title group. The actions are one
 * group now, the title group cannot shrink below its trio, and the row wraps.
 */
it('wraps the card\'s actions under the title instead of overlapping them', () => {
  const head = CARD.slice(CARD.indexOf('className="cv-card__head"'), CARD.indexOf('{/* Code is edge to edge'));
  const titleGroup = head.slice(head.indexOf('cv-card__title-wrap'), head.indexOf('cv-card__actions'));
  const actions = head.slice(head.indexOf('cv-card__actions'));
  assert.ok(!titleGroup.includes('CanvasTabToggle'), 'Code / Preview is an action, not part of the title group');
  for (const control of ['<CanvasTabToggle', 'label="Download"', '<CanvasExportMenu', 'label="Share"', 'label="Fullscreen"', 'label="Close"']) {
    assert.ok(actions.includes(control), `${control} belongs to the actions group`);
  }
  assert.match(CSS, /\.cv-card__head \{[^}]*flex-wrap: wrap;[^}]*justify-content: flex-end;[^}]*gap: 4px 8px;/);
  assert.match(CSS, /\.cv-card__title-wrap \{[^}]*flex: 1 1 0;[^}]*min-width: min-content;/, 'only the title gives way');
  assert.match(CSS, /\.cv-card__title \{[^}]*width: 0;[^}]*min-width: 0;/);
  assert.match(CSS, /\.cv-card__actions \{[^}]*flex-wrap: wrap;[^}]*justify-content: flex-end;/);
  assert.match(CSS, /\.cv-card__actions > \.cv-anchor,\s*\.cv-card__actions > \.cv-toggle \{ margin-right: 8px; \}/, 'toggle + 16 = Download, as measured');
  assert.match(
    CSS,
    /@media \(max-width: 600px\) \{\s*\.cv-card \{ height: 500px; \}\s*\.cv-card__head \{ padding: 8px 16px; \}\s*\.cv-card__title-wrap \{ flex-basis: 100%; \}/,
    'Gemini\'s narrow card is max-width 600px inclusive: 600 wraps, 601 does not',
  );
});

it('pins the prompt surfaces: fab, co-creation pill, floating window, select-and-ask, console', () => {
  assert.match(CSS, /\.cv-fab \{[^}]*bottom: 40px;[^}]*padding: 8px;[^}]*animation: cv-fab-fade-in 500ms cubic-bezier\(0\.2, 0, 0, 1\);/);
  assert.match(CSS, /\.cv-fab__button \{[^}]*width: 120px;[^}]*height: 50px;/);
  assert.match(CSS, /\.cv-cocreate \{[^}]*width: 320px;[^}]*height: 56px;[^}]*border-radius: 56px;/);
  assert.match(CSS, /\.cv-float-overlay \{[^}]*z-index: 1001;[^}]*padding-bottom: 40px;/);
  assert.match(CSS, /\.cv-float-card--window \{[^}]*width: 380px;[^}]*box-shadow: rgba\(0, 0, 0, 0\.2\) 0 3px 5px -1px, rgba\(0, 0, 0, 0\.14\) 0 6px 10px 0, rgba\(0, 0, 0, 0\.12\) 0 1px 18px 0;/);
  assert.match(CSS, /\.cv-float-window \{[^}]*gap: 16px;[^}]*max-height: 467px;[^}]*padding: 12px 16px;/);
  assert.ok(!/\.cv-float-window \{[^}]*scrollbar-gutter/.test(CSS), 'Gemini\'s turns use the full 348px until the window scrolls');
  assert.match(CSS, /\.cv-float-window__user \{[^}]*max-width: 85%;[^}]*padding: 12px 18px;[^}]*font-size: 15px;[^}]*line-height: 20px;/);
  assert.match(CSS, /\.cv-float-window__thinking \{[^}]*height: 28px;[^}]*padding: 0 4px;/, '32x28');
  assert.match(CSS, /\.cv-float-window__reply \{[^}]*font-size: 15px;[^}]*line-height: 20px;/, 'gds-body-m, not the thread\'s 16/24');
  assert.match(CSS, /\.cv-float-window__reply > :where\(\*\) \+ :where\(\*\) \{ margin-top: 16px; \}/);
  assert.match(CSS, /\.cv-float-window__reply ul \{ padding-left: 27px; list-style: disc; \}/);
  assert.match(CSS, /\.cv-select-ask \{[^}]*background-color: rgb\(119, 119, 119\);[^}]*opacity: 0\.3;[^}]*cursor: crosshair;/);
  assert.match(PANEL, /floodColor="#3271EA"[\s\S]*floodColor="#4C8DF6"[\s\S]*floodColor="#FF7DD2"/, 'the blue-blue-pink glow');
  assert.match(CSS, /\.cv-console \{[^}]*height: 25%;/);
  assert.match(CSS, /\.cv-float-tools \{[^}]*right: 20px;[^}]*bottom: 20px;/);
});

/* -------------------------------------------------------- the behaviour */

it('opens a canvas full width, with the chat laid over it and the composer replaced by the fab', () => {
  assert.match(CHAT, /const canvasFullWidth = !!openCanvasDoc;/);
  assert.match(CHAT, /canvasFullWidth\s*\/\*[^*]*\*\/\s*\? 'min-\[960px\]:grid-cols-\[minmax\(0,1fr\)\] min-\[960px\]:gap-x-0'/);
  assert.match(CHAT, /canvasFullWidth \? 'min-\[960px\]:z-\[2\] min-\[960px\]:pointer-events-none min-\[960px\]:\[grid-area:1\/1\]' : ''/);
  assert.match(CHAT, /canvasFullWidth \? 'min-\[960px\]:invisible' : ''/, 'hidden, not unmounted: the scroll position survives');
  assert.match(CHAT, /canvasFullWidth \? 'min-\[960px\]:pointer-events-none min-\[960px\]:invisible min-\[960px\]:opacity-0/);
  assert.match(CHAT, /\{canvasFullWidth && !isCompact && \(\s*<CanvasPromptFab/, 'desktop only — a phone\'s full screen has no prompt');
  assert.match(CHAT, /const splitThread = immersiveOpen && !canvasFullWidth;/);
});

it('expands the chip in place and reaches the panel only through Fullscreen', () => {
  assert.match(CARD, /<div\s+onClick=\{onToggleExpanded\}/, 'the whole chip expands it');
  assert.match(CARD, /onClick=\{\(event\) => \{ event\.stopPropagation\(\); onToggleExpanded\(\); \}\}/, 'and so does its Open');
  assert.match(CARD, /label="Fullscreen" tooltip="Fullscreen" onClick=\{onOpen\}/);
  assert.ok(!PANEL.includes('label="Close"'), 'the panel collapses; it has no cross');
  assert.match(PANEL, /return compact && typeof document !== 'undefined' \? createPortal\(panel, document\.body\) : panel;/, 'over the mobile header');
});

it('keeps the editor\'s DOM out of React\'s hands', () => {
  assert.match(EDITOR, /dangerouslySetInnerHTML=\{seedRef\.current\.prop\}/, 'one object for life, or every re-render rewrites innerHTML');
  assert.match(EDITOR, /aria-label="Canvas editor"/);
});

it('relays the preview\'s console and answers select-and-ask from inside the frame', () => {
  assert.match(VIEW, /\['log','info','warn','error','debug'\]\.forEach/);
  assert.match(VIEW, /data\.source!=='willow-canvas-host'\|\|data\.kind!=='region'/);
  assert.match(PANEL, /source: 'willow-canvas-host', kind: 'region', rect/);
});

/* -------------------------------------------------- the floating chat */

const { floatingTurns, floatingWindowView } = await importTs(path.join(canvasDir, 'canvas-floating.ts'));

const user = (id, content) => ({ id, role: 'user', content });
const answer = (id, content, extra = {}) => ({ id, role: 'assistant', content, ...extra });

it('reads the thread into question-and-answer turns, streaming from the live buffer', () => {
  const turns = floatingTurns([
    user('u1', 'What does this page do?'),
    answer('a1', 'It counts clicks.'),
    user('u2', 'Make it start at 10'),
    answer('a2', '', { isGenerating: true }),
  ], 'Done. I upd', true);
  assert.deepEqual(turns, [
    { id: 'u1', prompt: 'What does this page do?', reply: 'It counts clicks.', done: true, editedCanvas: false },
    { id: 'u2', prompt: 'Make it start at 10', reply: 'Done. I upd', done: false, editedCanvas: false },
  ]);
  const edited = floatingTurns([user('u1', 'q'), answer('a1', 'a', { canvasRefs: [{ docId: 'c' }] })], '', false);
  assert.equal(edited[0].editedCanvas, true);
  assert.equal(floatingTurns([user('u1', 'q')], '', true)[0].done, false, 'unanswered while the thread runs');
  assert.equal(floatingTurns([user('u1', 'q')], 'stale', false)[0].reply, '', 'a finished turn never reads the live buffer');
});

/*
 * The reported bug: "the answer disappears". The window used to close 600ms after ANY
 * turn. Gemini's stays with the answer, and closes only when the newest answer is
 * complete and rewrote the canvas.
 */
it('keeps a plain answer on screen and closes only after a canvas edit', () => {
  const asked = { id: 'u1', prompt: 'What does this page do?', reply: 'It counts clicks.', done: true, editedCanvas: false };
  const plain = floatingWindowView([asked], 0, null, false);
  assert.equal(plain.closeForEdit, false, 'a plain answer stays');
  assert.deepEqual(plain.entries, [asked]);
  assert.equal(plain.thinking, false);

  const editing = { id: 'u2', prompt: 'Make it 10', reply: 'Done.', done: false, editedCanvas: true };
  const streaming = floatingWindowView([asked, editing], 0, null, true);
  assert.equal(streaming.closeForEdit, false, 'not before the edit is complete');
  assert.equal(streaming.entries.length, 2, 'the edit stays listed while it streams');
  assert.equal(streaming.thinking, true);

  const edited = floatingWindowView([asked, { ...editing, done: true }], 0, null, false);
  assert.equal(edited.closeForEdit, true);
  assert.deepEqual(edited.entries, [asked], 'Gemini lists only the turns that did not write the canvas');
});

it('shows only the turns asked since the pill opened, and a sent question at once', () => {
  const old = { id: 'u0', prompt: 'earlier', reply: 'before full screen', done: true, editedCanvas: true };
  const view = floatingWindowView([old], 1, { text: 'What color is it?', base: 1 }, true);
  assert.deepEqual(view.entries, [], 'the session starts where the pill opened');
  assert.deepEqual(view.pendingShown, { text: 'What color is it?', base: 1 });
  assert.equal(view.closeForEdit, false, 'an older edit cannot close a new session');
  const arrived = floatingWindowView([old, { id: 'u1', prompt: 'What color is it?', reply: '', done: false, editedCanvas: false }], 1, { text: 'What color is it?', base: 1 }, true);
  assert.equal(arrived.pendingShown, null, 'once the turn exists it is listed instead');
  assert.equal(arrived.entries.length, 1);
});

it('wires the fab to every turn, with Gemini\'s queue and no Escape', () => {
  assert.match(CHAT, /floatingTurns\(messages, streaming, isGenerating\)/);
  assert.match(CHAT, /turns=\{canvasFloatingTurns\}/);
  assert.ok(!PROMPT.includes('sawGenerating'), 'the close-after-every-turn timer is gone');
  assert.match(PROMPT, /if \(closeForEdit\) close\(\);/);
  assert.match(PROMPT, /disabled=\{queued !== null\}/, 'a question sent mid-turn waits, input disabled, as Gemini\'s does');
  const fab = PROMPT.slice(PROMPT.indexOf('export const CanvasPromptFab'));
  assert.ok(!fab.includes('onEscape'), 'Gemini\'s floating input ignores Escape');
  assert.match(fab, /<FloatingReply text=\{turn\.reply\} \/>/, 'answers render as markdown');
});

it('hides the fab while a selection prompt is open, as Gemini\'s hide-fab does', () => {
  assert.match(PROMPT, /export const \$canvasSelectionPromptOpen = atom\(false\);/);
  assert.match(PROMPT, /cv-fab\$\{selectionPromptOpen \? ' cv-fab--hidden' : ''\}/);
  assert.match(CSS, /\.cv-fab--hidden \{ opacity: 0; visibility: hidden; pointer-events: none; \}/);
});
