/**
 * The Canvas card and the Canvas panel, rendered — not read.
 *
 * `canvas-refs-plumbing.test.mjs` reads these two components as source text, which
 * cannot see the failures they actually had: a missing import from `canvas-view`
 * (the module exports fifteen names and both files pull ten of them), and a panel
 * that mounted and painted nothing. Rendering them to static markup catches both,
 * and pins four things at the DOM level rather than at the constant:
 *
 *  - The preview frame's `sandbox` ATTRIBUTE, as written into the document. The
 *    constant is asserted in `canvas-preview-and-export.test.mjs`; this is the
 *    other half, because a frame can be given the right list and still be handed
 *    the wrong one by an intervening prop.
 *  - `previewMounted`. The panel holds the iframe out of the DOM for the 500ms
 *    scale, and an early version hid the CODE for a preview element that did not
 *    exist yet — a blank panel, no error. `renderToStaticMarkup` runs no effects,
 *    so its markup IS that first frame: `embedReady` is false in exactly the way
 *    it is false in the browser, and nothing else reproduces that state this cheaply.
 *  - The sibling trick. Once mounted, the iframe is HIDDEN rather than unmounted,
 *    so a trip to the Code tab does not restart a running app.
 *  - Which version a snapshot shows. The card is anchored to the turn that wrote
 *    it, every version carries its own title, and a stale index clamps.
 *
 * Two notes on reading the output. React writes `srcDoc` and `referrerPolicy` into
 * static markup in camelCase (HTML attribute names are case-insensitive, so the
 * browser does not care) — match them case-insensitively or the assertion fails on
 * a spelling the DOM never sees. And the bundle goes through the same
 * `willowAliasPlugin` the production build uses, so a test cannot resolve
 * `@willow/chat` differently from Vite; stylesheets stub to nothing, since a
 * `.css` import is a side effect no assertion here can observe.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { after, before, it } from 'node:test';
import { build } from 'esbuild';
import { willowAliasPlugin } from '../scripts/lib/willow-aliases.mjs';

const appDir = path.resolve(import.meta.dirname, '..');
const repoRoot = path.resolve(appDir, '..', '..');

let bundleDir = '';
/** `{ [surface]: html }` — every surface rendered once, in `before`. */
let surfaces;

/*
 * `\\n` in the strings below is deliberate: this is source text for esbuild, so a
 * real newline would end the string literal it sits in.
 */
const ENTRY = `
  import React from 'react';
  import { renderToStaticMarkup } from 'react-dom/server';
  import { CanvasCard } from '@willow/chat/canvas/CanvasCard';
  import { CanvasPanel } from '@willow/chat/canvas/CanvasPanel';
  import { CanvasCodeView } from '@willow/chat/canvas/canvas-view';

  const noop = () => {};

  /** Two versions, and version 0 is titled differently — the fold keeps both. */
  const prose = {
    docId: 'c_1f2e3d4c_rain.md',
    kind: 'text',
    title: 'Rain',
    versions: [
      { title: 'Draft', content: '# Draft\\n\\nSoft rain.\\n' },
      { title: 'Rain', content: '# Rain\\n\\nSoft rain, and the city goes quiet.\\n' },
    ],
    lastTouchedIndex: 1,
  };

  const html = {
    docId: 'c_1f2e3d4c_page.html',
    kind: 'code',
    title: 'Page',
    language: 'html',
    versions: [{ title: 'Page', content: '<h1>hi</h1>\\n<p>one</p>\\n<p>two</p>\\n<p>three</p>\\n' }],
    lastTouchedIndex: 0,
  };

  /** Code, but not previewable: no tab switch and no frame at all. */
  const python = {
    docId: 'c_1f2e3d4c_solver.py',
    kind: 'code',
    title: 'Solver',
    language: 'python',
    versions: [{ title: 'Solver', content: 'print(1)\\n' }],
    lastTouchedIndex: 0,
  };

  /*
   * The same document with a stamped revision. The chip's second line is a
   * TIMESTAMP in the live app; refs written before \`createdAt\` existed have none,
   * and every other fixture here is one of those — which is what pins the fallback.
   */
  const stamped = {
    docId: 'c_1f2e3d4c_stamped.html',
    kind: 'code',
    title: 'Stamped',
    language: 'html',
    versions: [{
      title: 'Stamped',
      content: '<h1>hi</h1>\\n',
      createdAt: new Date(2026, 7, 29, 18, 39).getTime(),
    }],
    lastTouchedIndex: 0,
  };

  const card = (doc, props) => renderToStaticMarkup(
    <CanvasCard doc={doc} onToggleExpanded={noop} onOpen={noop} {...props} />,
  );
  const panel = (doc, version, props) => renderToStaticMarkup(
    <CanvasPanel
      doc={doc}
      version={version}
      onVersionChange={noop}
      onCollapse={noop}
      onPrompt={noop}
      {...props}
    />,
  );

  export function renderCanvasSurfaces() {
    return {
      collapsedCode: card(html, { version: 0, expanded: false }),
      collapsedOldVersion: card(prose, { version: 0, expanded: false }),
      collapsedStamped: card(stamped, { version: 0, expanded: false }),
      expandedCode: card(html, { version: 0, expanded: true, bleed: true }),
      expandedCodeNoBleed: card(html, { version: 0, expanded: true }),
      expandedProse: card(prose, { version: 1, expanded: true }),
      /* Writable: the newest version, with a sink to write to. */
      editableCode: card(html, { version: 0, expanded: true, onEditContent: noop }),
      editableProse: card(prose, { version: 1, expanded: true, onEditContent: noop }),
      /* Scrubbed back WITH a sink — an edit rewrites the newest revision, so this
         one must still come out read-only. */
      oldVersionProse: card(prose, { version: 0, expanded: true, onEditContent: noop }),
      codePanel: panel(html, 0),
      pythonPanel: panel(python, 0),
      prosePanel: panel(prose, 0),
      stalePanel: panel(prose, 9),
      editablePanel: panel(prose, 1, { onEditContent: noop }),
      editableCodePanel: panel(html, 0, { onEditContent: noop }),
      closablePanel: panel(prose, 1, { onClose: noop }),
      /*
       * The body on its own, on the Code tab. Nothing else can reach this state:
       * \`tab\` is local state set by a click, so every surface above renders the
       * default, and the sibling invariant is about what happens on the OTHER tab.
       */
      codeTabBody: renderToStaticMarkup(
        <CanvasCodeView doc={html} content={html.versions[0].content} tab="code" />,
      ),
      /* The same body with a sink: the caret layer only exists when there is
         somewhere for the keystrokes to go. */
      editableCodeTabBody: renderToStaticMarkup(
        <CanvasCodeView doc={html} content={html.versions[0].content} tab="code" onContentChange={noop} />,
      ),
    };
  }
`;

before(async () => {
  const cacheDir = path.join(repoRoot, 'node_modules', '.cache');
  fs.mkdirSync(cacheDir, { recursive: true });
  bundleDir = fs.mkdtempSync(path.join(cacheDir, 'willow-canvas-smoke-'));
  const outfile = path.join(bundleDir, 'smoke.mjs');
  await build({
    stdin: { resolveDir: appDir, sourcefile: 'canvas-smoke-entry.tsx', loader: 'tsx', contents: ENTRY },
    outfile,
    bundle: true,
    packages: 'external',
    platform: 'node',
    format: 'esm',
    target: 'node23',
    jsx: 'automatic',
    plugins: [
      {
        name: 'canvas-smoke-css',
        setup(buildApi) {
          buildApi.onResolve({ filter: /\.css$/ }, () => ({ path: 'empty.css', namespace: 'canvas-css' }));
          buildApi.onLoad({ filter: /.*/, namespace: 'canvas-css' }, () => ({ loader: 'css', contents: '' }));
        },
      },
      willowAliasPlugin(repoRoot),
    ],
    logLevel: 'silent',
  });
  const module = await import(`${pathToFileURL(outfile).href}?v=${Date.now()}`);
  surfaces = module.renderCanvasSurfaces();
});

after(() => {
  if (bundleDir) fs.rmSync(bundleDir, { recursive: true, force: true });
});

/* ------------------------------------------------------------------- helpers */

/** An attribute's value, matched case-insensitively — see the note above. */
const attribute = (html, name) => {
  const found = new RegExp(`\\b${name}="([^"]*)"`, 'i').exec(html);
  return found ? found[1] : null;
};

/** `disabled=""` inside one button's opening tag, found by its label. */
const isDisabled = (html, label) =>
  new RegExp(`aria-label="${label}"[^>]*\\sdisabled=""`).test(html);

const occurrences = (html, needle) => html.split(needle).length - 1;

const decodeEntities = (text) =>
  text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, '&');

/* ------------------------------------------------------------- it all renders */

it('renders every Canvas surface without a browser', () => {
  for (const [name, html] of Object.entries(surfaces)) {
    assert.ok(html.length > 500, `${name} rendered ${html.length} characters`);
  }
});

/* --------------------------------------------------------------- the sandbox */

it('writes a sandbox without the app\'s own origin into the frame', () => {
  const sandbox = attribute(surfaces.expandedCode, 'sandbox');
  assert.ok(sandbox, 'the expanded code card mounts the preview frame');
  const flags = sandbox.split(' ');
  assert.ok(
    !flags.includes('allow-same-origin'),
    'with srcDoc this is Willow\'s origin — model-authored script would read localStorage, IndexedDB and the provider keys',
  );
  assert.ok(flags.includes('allow-scripts'));
  assert.equal(
    attribute(surfaces.expandedCode, 'referrerPolicy'),
    'no-referrer',
    'a model-authored request must not carry the app\'s URL',
  );
});

it('embeds the wrapped document rather than the raw content', () => {
  const srcDoc = decodeEntities(attribute(surfaces.expandedCode, 'srcDoc') || '');
  assert.match(srcDoc, /^<!doctype html>/, 'a bare fragment has to be wrapped to lay out');
  assert.match(srcDoc, /width=device-width/);
  assert.ok(srcDoc.includes('<h1>hi</h1>'));
});

/* ------------------------------------------------------ the deferred iframe */

/*
 * The panel's first frame. `embedReady` starts false and is set by an effect, and
 * static markup runs no effects — so this is the state the browser is in during
 * the 500ms scale.
 *
 * It shows NOTHING. The code used to be the fallback here, on the theory that a
 * blank panel reads as a bug, and the user reported the opposite: "before the flash
 * for a momentary time the codebase appears in the place of the preview for some
 * weird unknown reasons". The code body is hidden for the selected TAB now, not for
 * the frame's existence, so the deferral shows the shell's own dark fill.
 */
it('shows neither the code nor a frame while the preview is held back', () => {
  assert.ok(!surfaces.codePanel.includes('<iframe'), 'the frame is held out for the animation');
  assert.match(
    surfaces.codePanel,
    /<div class="hidden">/,
    'the code body is hidden because Preview is the tab, not because the frame is missing',
  );
  assert.equal(
    occurrences(surfaces.codePanel, 'class="hidden"'),
    1,
    'exactly one body is hidden — there is no second thing to hide yet',
  );
});

/*
 * The white flash: a sub-frame paints its own base background — white — as soon as
 * it has a box, before its document's style is parsed. The frame is therefore
 * transparent until `load`, and static markup is the pre-load state.
 */
it('mounts the preview frame transparent, and fades it in', () => {
  const frame = surfaces.expandedCode.slice(surfaces.expandedCode.indexOf('<iframe'));
  const tag = frame.slice(0, frame.indexOf('>') + 1);
  assert.ok(/opacity-0/.test(tag), 'a frame that paints white must not be visible while it does');
  assert.ok(!/opacity-100/.test(tag), 'the lit state belongs to the load handler');
  assert.ok(/transition-opacity/.test(tag), 'and it arrives as a fade, not a cut');
});

/*
 * The measured behaviour worth copying from Gemini's code panel: `div.container`
 * holds the preview, the editor and the console at once and toggles `.hidden`
 * between them. Rendering one OR the other restarts the document on every tab
 * press, which for anything with state — a game, a form, a timer — reads as the
 * preview being broken.
 */
it('keeps the frame in the tree on the Code tab instead of unmounting it', () => {
  const body = surfaces.codeTabBody;
  assert.ok(body.includes('<iframe'), 'switching to Code must not tear the running document down');
  assert.match(body, /<iframe[^>]*class="hidden"/, 'it is hidden, which does not reload it');
  assert.ok(body.includes('class="hljs'), 'and the code is what shows');
  assert.equal(occurrences(body, 'class="hidden"'), 1, 'exactly one sibling is hidden');
});

it('hides the code behind the frame on the Preview tab', () => {
  const expanded = surfaces.expandedCode;
  assert.ok(expanded.includes('<iframe'), 'the card mounts its frame immediately — nothing is animating');
  assert.ok(expanded.includes('class="hljs'), 'the code stays in the tree behind the preview');
  assert.equal(occurrences(expanded, 'class="hidden"'), 1);
});

it('offers no tab switch and no frame for code that cannot be previewed', () => {
  assert.ok(!surfaces.pythonPanel.includes('role="tablist"'), 'an empty Preview reads as a bug');
  assert.ok(!surfaces.pythonPanel.includes('<iframe'));
  assert.ok(surfaces.pythonPanel.includes('class="hljs'), 'the code is all there is');
  assert.ok(surfaces.codePanel.includes('role="tablist"'), 'HTML does get the switch');
});

it('lands on Preview for HTML, since Code is the tab you switch to', () => {
  assert.match(surfaces.expandedCode, /aria-selected="true"[^>]*>Preview</);
  assert.match(surfaces.expandedCode, /aria-selected="false"[^>]*>Code</);
});

/* ---------------------------------------------------------- the inline card */

it('shows the title, the kind and an Open button while collapsed', () => {
  const collapsed = surfaces.collapsedCode;
  assert.ok(collapsed.includes('>Page</span>'));
  assert.ok(collapsed.includes('>Code · Canvas</span>'), 'one version reads as Canvas, not Version 1 of 1');
  assert.ok(collapsed.includes('>Open</span>'), 'Open is the only measured control on the chip');
  assert.ok(!collapsed.includes('<iframe'), 'the chip is a chip — it must not run the document');
});

/*
 * The measured chip, and the two things Willow's first attempt got wrong — both
 * filed by the user as "the closed view looks different from what it looks in
 * gemini app".
 *
 *   gem-processing-card.completed: radius 28px, bg rgb(23,23,23), NO border,
 *   padding 20px, and 133px tall from 20 + 28 + 4 + 17 + 8 + 36 + 20.
 *
 * There is NO preview inside it: the body is the timestamp alone. And `Open` is
 * not on the title row — it is below, right aligned, and filled rgb(31,59,155),
 * the only saturated fill in the thread.
 */
it('draws the collapsed chip as Gemini does: no preview, filled Open, whole card clickable', () => {
  const collapsed = surfaces.collapsedCode;
  assert.ok(collapsed.includes('rounded-[28px]'), '28px radius, not the panel\'s 40 or the old 24');
  assert.ok(collapsed.includes('bg-[rgb(23,23,23)]'));
  assert.ok(!collapsed.includes('border-white/[0.12]'), 'the chip is borderless');
  assert.ok(!collapsed.includes('<pre'), 'the measured chip has no code preview in it');
  assert.ok(
    !collapsed.includes('pointer-events-none'),
    'and so no inert decorative body — the icon\'s own aria-hidden is the only one left',
  );
  assert.ok(collapsed.includes('cursor-pointer'), 'the WHOLE card opens the document');
  assert.ok(
    collapsed.includes('bg-[rgb(31,59,155)]'),
    'Open is the filled blue button, not another transparent pill',
  );
  assert.ok(collapsed.includes('aria-label="Open Page in Canvas"'));
});

/*
 * The chip's second line. `createdAt` is stamped by the tool executor, so a ref
 * written before that field existed has none — and inventing a date for those
 * would be a lie, hence the kind-and-version fallback the other fixtures show.
 */
it('reads the chip\'s second line as a timestamp when the revision has one', () => {
  assert.match(
    surfaces.collapsedStamped,
    />Aug 29, \d{1,2}:\d{2} (AM|PM)</,
    'a stamped revision shows when it was written',
  );
  assert.ok(
    !surfaces.collapsedStamped.includes('Code · Canvas'),
    'the fallback is for refs with no stamp at all',
  );
});

/*
 * The bleed is the horizontal-scrollbar hazard: a card wider than its column makes
 * the whole shell scroll sideways at narrow widths, which broke ChatView's grid
 * twice. It is opt-in AND gated on a width, and both halves matter.
 */
it('overhangs the column only when asked, and only above 1200px', () => {
  assert.match(surfaces.expandedCode, /min-\[1200px\]:w-\[calc\(100%\+245\.6px\)\]/);
  assert.match(surfaces.expandedCode, /min-\[1200px\]:-translate-x-1\/2/);
  assert.ok(
    !surfaces.expandedCodeNoBleed.includes('min-[1200px]:'),
    'without `bleed` the card is column-width at every viewport',
  );
});

/* ------------------------------------------------------------- the versions */

/*
 * A card is a snapshot of the turn that wrote it, and every version carries its
 * own title — scrubbing back has to show what the document was called then, not
 * what it is called now.
 */
it('renders the version it is anchored to, with that version\'s own title', () => {
  assert.ok(surfaces.collapsedOldVersion.includes('>Draft</span>'), 'version 0 was called Draft');
  assert.ok(
    surfaces.collapsedOldVersion.includes('>Document · Version 1 of 2</span>'),
    'two versions read as a position in the history',
  );
  assert.ok(surfaces.expandedProse.includes('>Rain</span>'), 'version 1 is Rain');
});

it('clamps a stale index rather than rendering nothing', () => {
  assert.match(surfaces.stalePanel, /<h2[^>]*>Rain</, 'version 9 of 2 holds at the newest');
  assert.ok(isDisabled(surfaces.stalePanel, 'Next version'), 'and there is nothing forward of it');
});

it('disables the ends of the history', () => {
  assert.ok(isDisabled(surfaces.prosePanel, 'Previous version'), 'at version 0');
  assert.ok(!isDisabled(surfaces.prosePanel, 'Next version'));
  assert.ok(isDisabled(surfaces.expandedCode, 'Previous version'), 'a one-version document');
  assert.ok(isDisabled(surfaces.expandedCode, 'Next version'));
});

it('says Changes saved only while showing the newest version', () => {
  assert.ok(surfaces.stalePanel.includes('aria-label="Changes saved"'));
  assert.ok(
    surfaces.prosePanel.includes('aria-label="Version 1 of 2"'),
    'an older version is a position, and the label is the only thing that says so',
  );
});

/* --------------------------------------------------------- the two toolbars */

it('gives prose an Export menu and code a direct Download, in both places', () => {
  assert.ok(surfaces.prosePanel.includes('>Export</span>'));
  assert.ok(surfaces.expandedProse.includes('>Export</span>'));
  assert.ok(surfaces.codePanel.includes('>Download</span>'));
  assert.ok(surfaces.expandedCode.includes('>Download</span>'));
  assert.ok(!surfaces.codePanel.includes('>Export</span>'), 'the code panel has no Export dropdown');
});

/*
 * `close` on the card and `collapse_content` on the panel are not the same action:
 * closing an expanded card puts the document back to its chip, collapsing the panel
 * returns the panel TO a chip. Neither discards anything.
 */
it('keeps the card\'s close and the panel\'s collapse distinct', () => {
  assert.ok(surfaces.expandedProse.includes('aria-label="Close canvas"'));
  assert.ok(surfaces.expandedProse.includes('aria-label="Open in Canvas"'), 'the card still offers the panel');
  assert.ok(!surfaces.expandedProse.includes('aria-label="Collapse canvas"'));
  assert.ok(surfaces.prosePanel.includes('aria-label="Collapse canvas"'));
  assert.ok(!surfaces.prosePanel.includes('aria-label="Close canvas"'));
});

it('names the panel for a screen reader and titles it with a heading', () => {
  assert.equal(attribute(surfaces.prosePanel, 'aria-label'), 'Draft canvas');
  assert.match(surfaces.prosePanel, /<h2[^>]*>Draft</);
  assert.ok(surfaces.prosePanel.includes('aria-label="Share canvas"'));
});

/*
 * The rail is prose-only: its three actions are length, tone and wording, none of
 * which mean anything against a code document — and the code body is an iframe and
 * an editor that fill the panel edge to edge.
 */
it('rails the quick actions beside prose only', () => {
  for (const label of ['Length', 'Tone', 'Suggest']) {
    assert.ok(surfaces.prosePanel.includes(`aria-label="${label}"`), `prose is missing ${label}`);
    assert.ok(!surfaces.codePanel.includes(`aria-label="${label}"`), `code should not offer ${label}`);
  }
  assert.ok(
    !surfaces.expandedProse.includes('aria-label="Length"'),
    'the rail belongs to the panel; the card has no room for it',
  );
});

/*
 * Gemini's `immersivePanelTransitions`, read off the running app: scale 0.6 -> 1
 * over 500ms and opacity 0 -> 1 over 200ms. The first frame is the one assertable
 * without a compositor, and it is also the frame the deferred iframe exists for.
 */
it('enters from the captured scale and opacity', () => {
  assert.equal(attribute(surfaces.prosePanel, 'style'), 'opacity:0;transform:scale(0.6)');
  assert.ok(surfaces.prosePanel.includes('origin-center'), 'the captured transform-origin is the panel\'s centre');
});

/* ------------------------------------------------------------- the tooltips */

/*
 * An iframe's `title` doubles as a NATIVE TOOLTIP, so hovering anywhere inside a
 * running preview popped up the document's name — reported as "when I hover on the
 * canvas… it shows the name of the document in the tooltip". The frame still needs
 * an accessible name, so it moves to `aria-label`, which no browser renders.
 */
it('names the preview frame without giving it a hover tooltip', () => {
  for (const name of ['expandedCode', 'codeTabBody']) {
    const frame = surfaces[name].slice(surfaces[name].indexOf('<iframe'));
    const tag = frame.slice(0, frame.indexOf('>') + 1);
    assert.ok(tag.includes('aria-label="Page preview"'), `${name} labels the frame`);
    assert.ok(!/\stitle="/.test(tag), `${name} must not put a native tooltip over the document`);
  }
});

/* --------------------------------------------------------------- the seam */

/*
 * The white hairline down the left of a running preview, filed against the
 * expanded card ("in the preview of the code there is a white vertical line").
 *
 * A sub-frame rasterises on whole device pixels; the bleeding card's inner edge
 * does not sit on one (`calc(100% + 245.6px)` centred by `translateX(-50%)`), so
 * the frame's raster starts a fraction of a pixel inboard and the ELEMENT's
 * background paints the remainder. `bg-white` there was a white line against the
 * dark shell. It was never doing anything else: a document's own white base
 * background comes from the sub-frame, not from this element.
 */
it('gives the preview frame no background of its own', () => {
  for (const name of ['expandedCode', 'codeTabBody', 'editableCodeTabBody']) {
    const frame = surfaces[name].slice(surfaces[name].indexOf('<iframe'));
    const tag = frame.slice(0, frame.indexOf('>') + 1);
    assert.ok(!/bg-white/.test(tag), `${name} must not paint white in the sub-pixel seam`);
    /* On the Code tab the frame is `class="hidden"` and carries nothing else —
       that is the sibling trick, not a missing style. */
    if (!/class="hidden"/.test(tag)) {
      assert.ok(/border-0/.test(tag), `${name} keeps the frame's own border off`);
    }
  }
});

/* ------------------------------------------------------------- the scroller */

/*
 * "I still cant scroll down vertically or horizontally in the codebase."
 *
 * The cause was a borrowed class. The code body carried `.smd-code-block` for its
 * hljs palette, and that rule is a whole markdown block: `overflow: clip` — which
 * is not scrollable by wheel OR by script — plus a -16px full-bleed margin, a 40px
 * radius and 32px of padding fighting `inset`. The palette now has a second entry
 * point that styles nothing but colour, so the scroller can own its own overflow.
 */
it('leaves the code body a scroller, in both axes', () => {
  for (const name of ['codeTabBody', 'editableCodeTabBody', 'pythonPanel']) {
    const html = surfaces[name];
    assert.ok(
      !/class="[^"]*\bsmd-code-block\b/.test(html),
      `${name} must not borrow the markdown block — it brings overflow: clip`,
    );
    assert.match(
      html,
      /class="smd-code-tokens [^"]*overflow-auto/,
      `${name} needs the palette AND its own overflow`,
    );
    assert.match(html, /<pre[^>]*class="m-0 w-max min-w-full/, `${name} keeps a pre wider than its box`);
  }
});

/*
 * And the palette's own half of it: `.smd-code-tokens` must be a colour-only hook.
 * A declaration that sets a box on it puts the bug straight back.
 */
it('adds no box to the palette hook', () => {
  const css = fs.readFileSync(
    path.join(repoRoot, 'platform', 'ui', 'src', 'streaming-markdown-styles.ts'),
    'utf8',
  );
  assert.match(css, /:is\(\.smd-code-block, \.smd-code-tokens\) \.hljs \{/, 'the palette takes both hooks');
  const own = css.match(/^\s*'\.smd-code-tokens[^']*'/gm) || [];
  assert.deepEqual(own, [], '`.smd-code-tokens` must never be a rule of its own — only a descendant hook');
});

/* -------------------------------------------------------------- the editing */

/*
 * Code is editable IN PLACE: a transparent textarea sits exactly on the
 * highlighted `<pre>` the user is already reading (Willow runs no Monaco). Both
 * layers must be present, and the `<pre>` becomes decorative once they are.
 */
it('lays a caret layer over the highlighted code when there is somewhere to write', () => {
  const editable = surfaces.editableCodeTabBody;
  assert.ok(editable.includes('<textarea'), 'no sink, no caret — with one, a real textarea');
  assert.ok(editable.includes('class="hljs'), 'the tokens are still what is painted');
  assert.match(editable, /<pre[^>]*aria-hidden="true"/, 'the pre is decorative once the textarea owns the text');
  assert.ok(editable.includes('text-transparent'), 'the textarea\'s own glyphs must not double the pre\'s');
  assert.ok(editable.includes('caret-white'));
  assert.ok(!surfaces.codeTabBody.includes('<textarea'), 'read-only is the default');
});

it('makes the code editable in the card and in the panel', () => {
  assert.ok(surfaces.editableCode.includes('<textarea'), 'the expanded card');
  assert.ok(surfaces.editableCodePanel.includes('<textarea'), 'and the panel');
  assert.ok(!surfaces.expandedCode.includes('<textarea'), 'without a sink, neither');
});

/*
 * Prose has NO edit button. The user asked for it gone — "there shouldn't be an
 * edit button to edit inside a document canvas... the user can freely edit and it
 * will be saved automatically" — so the document itself takes the caret and the
 * existing 400ms autosave carries the keystrokes.
 *
 * Static markup is the pre-focus frame, so what is assertable here is the
 * affordance: a focusable textbox wrapping the rendered document when there is
 * somewhere to save to, and a plain rendered document when there is not.
 */
it('makes prose editable without a button', () => {
  for (const name of ['editableProse', 'editablePanel']) {
    const html = surfaces[name];
    assert.ok(!html.includes('aria-label="Edit document"'), `${name} must not carry a mode button`);
    assert.ok(!html.includes('aria-label="Preview document"'), `${name} must not carry its inverse either`);
    assert.match(html, /role="textbox"[^>]*aria-label="Document"/, `${name} takes the caret itself`);
    assert.match(html, /tabindex="0"/, `${name} has to be reachable by keyboard, not only by pointer`);
    assert.ok(!html.includes('<textarea'), `${name} still starts as the rendered document`);
  }
});

/*
 * An OLDER revision is editable too. The edit lands on the document's current text,
 * so typing into one carries that text forward rather than rewriting history — and
 * the view follows to the end afterwards, or the keystroke appears to vanish into a
 * version the user is not looking at.
 *
 * The only thing that is read-only is a turn in flight, because the runner owns
 * `messages` for its duration and would overwrite the edit at settle.
 */
it('keeps an older revision editable, and only a live turn read-only', () => {
  assert.match(
    surfaces.oldVersionProse,
    /role="textbox"[^>]*aria-label="Document"/,
    'scrubbing back must not take the caret away',
  );
  assert.ok(!surfaces.expandedProse.includes('role="textbox"'), 'no sink, no caret');
  assert.ok(!surfaces.expandedProse.includes('tabindex="0"'), 'and no tab stop it cannot honour');
});

/*
 * Item 7: the panel's own cross. `collapse_content` hands the document back to the
 * thread as an expanded card; `close` dismisses it and leaves chips. Both exist
 * only because they differ — Gemini's panel only collapses.
 */
it('adds a cross to the panel when there is somewhere to close to', () => {
  assert.ok(surfaces.closablePanel.includes('aria-label="Close canvas"'));
  assert.ok(surfaces.closablePanel.includes('aria-label="Collapse canvas"'), 'and keeps the collapse');
  assert.ok(!surfaces.prosePanel.includes('aria-label="Close canvas"'), 'absent without the handler');
});




