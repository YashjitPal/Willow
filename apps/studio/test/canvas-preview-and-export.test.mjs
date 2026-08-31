/**
 * The Preview tab, the download name, and the version clamp — run, not read.
 *
 * The sandbox assertion below is the reason this file exists. Gemini's preview
 * iframe carries `allow-same-origin`, and matching it here would be a real
 * vulnerability rather than a fidelity win: Gemini serves its preview from a
 * throwaway `*.scf.usercontent.goog` origin, while Willow renders the document
 * with `srcDoc`, where `allow-scripts` + `allow-same-origin` resolves to
 * *Willow's own* origin. Model-authored script would then read the app's
 * `localStorage`, its IndexedDB and its provider keys. The comment in
 * `canvas-view.tsx` says so; this makes a later "match Gemini" edit fail a test.
 *
 * Loading the module at all needs `ts-module.mjs` to stub package stylesheets:
 * the view reaches `StreamingMarkdown`, which reaches `katex/dist/katex.min.css`,
 * and Node refuses a `.css` file with `Unknown file extension`.
 */
import { it } from 'node:test';
import assert from 'node:assert';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { importTs } from './ts-module.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const canvasDir = path.resolve(here, '..', '..', '..', 'features', 'chat', 'src', 'canvas');

const {
  CANVAS_PREVIEW_SANDBOX,
  CANVAS_PREVIEW_SHIM,
  canvasFileName,
  canvasPreviewDocument,
} = await importTs(path.join(canvasDir, 'canvas-view.tsx'));
const { canvasDocId, clampVersion, codeExtension, isPreviewable } =
  await importTs(path.join(canvasDir, 'canvas-store.ts'));

/* ----------------------------------------------------------------- the sandbox */

it('never gives the preview frame the app\'s own origin', () => {
  const flags = CANVAS_PREVIEW_SANDBOX.split(' ');
  assert.ok(
    !flags.includes('allow-same-origin'),
    'with srcDoc this resolves to Willow\'s origin — model-authored script would read localStorage, IndexedDB and the provider keys',
  );
  assert.ok(flags.includes('allow-scripts'), 'a preview that cannot run script is not a preview');
  // The rest of Gemini's set, which costs nothing under an opaque origin.
  for (const flag of ['allow-forms', 'allow-modals', 'allow-popups', 'allow-downloads']) {
    assert.ok(flags.includes(flag), `missing ${flag}`);
  }
});

/* ---------------------------------------------------------------- the document */

/*
 * A model asked for a web app writes the whole document. Rewrapping one nests
 * `<html>` inside `<html>`, and the browser resolves that by dropping the inner
 * `<head>` — so the page loses its own stylesheet and title with no error.
 *
 * "Untouched" now means untouched APART from the storage shim, which is prepended
 * rather than merged: an opaque-origin frame throws a `SecurityError` on merely
 * touching `localStorage`, and a model's init path reads it often enough that the
 * throw was showing up as a document whose buttons did nothing. The insertion point
 * is inside the existing `<head>`, so the model's own markup keeps its order.
 */
it('passes a whole document through, touching only its head', () => {
  const full = '<!DOCTYPE html>\n<html><head><title>App</title></head><body>hi</body></html>';
  const out = canvasPreviewDocument(full);
  assert.ok(out.startsWith('<!DOCTYPE html>\n<html><head>'), 'the doctype and the opening tags are the model\'s own');
  assert.ok(out.endsWith('<title>App</title></head><body>hi</body></html>'), 'and nothing after the head moves');
  assert.equal(
    out.replace(CANVAS_PREVIEW_SHIM, ''),
    full,
    'the shim is the ONLY difference — anything else is a rewrap, and a rewrap drops the inner head',
  );

  const noDoctype = '<html lang="en"><body>hi</body></html>';
  const outNoDoctype = canvasPreviewDocument(noDoctype);
  assert.equal(
    outNoDoctype.replace(CANVAS_PREVIEW_SHIM, ''),
    noDoctype,
    'a document with no doctype is still a document',
  );
  assert.ok(
    outNoDoctype.startsWith('<html lang="en">'),
    'with no head to enter, the shim goes after the html tag — the attributes must survive',
  );
});

it('wraps a bare fragment so it can lay out', () => {
  const wrapped = canvasPreviewDocument('<h1>hi</h1>');
  assert.match(wrapped, /^<!doctype html>/);
  assert.match(wrapped, /<meta charset="utf-8">/);
  assert.match(wrapped, /width=device-width/, 'without a viewport a mobile-width preview zooms out');
  assert.ok(wrapped.includes('<h1>hi</h1>'));
  assert.equal((wrapped.match(/<html/g) || []).length, 1);
});

/*
 * `<html>` inside an attribute or a text node is not a document. Matching it
 * would pass a fragment through unwrapped, which renders unstyled and at the
 * wrong width.
 */
it('does not read the word html in prose as a document', () => {
  const fragment = '<p>Use the &lt;html&gt; element, or an <a title="html">anchor</a>.</p>';
  assert.match(canvasPreviewDocument(fragment), /^<!doctype html>/);
});

/* ----------------------------------------------------------- which tab exists */

it('offers Preview for HTML and for an unlabelled code document only', () => {
  assert.equal(isPreviewable({ kind: 'code', language: 'html' }), true);
  assert.equal(isPreviewable({ kind: 'code' }), true, 'a code canvas defaults to HTML');
  assert.equal(isPreviewable({ kind: 'code', language: 'HTM' }), true);
  assert.equal(isPreviewable({ kind: 'code', language: 'python' }), false, 'an empty Preview reads as a bug');
  assert.equal(isPreviewable({ kind: 'text' }), false);
});

/* -------------------------------------------------------------- the file name */

it('names the download from the id the document was minted with', () => {
  assert.equal(canvasFileName({ docId: 'c_1f2e3d4c_rainy_notes.md', kind: 'text', title: 'Ignored' }), 'rainy_notes.md');
  assert.equal(canvasFileName({ docId: 'c_1f2e3d4c_page.html', kind: 'code', title: 'Page' }), 'page.html');
});

it('falls back to a slug, and cannot emit a path', () => {
  // A ref read back off disk may carry any docId, so the fallback has to be safe
  // on its own: `../` in a download name is a directory traversal.
  const name = canvasFileName({ docId: 'legacy', kind: 'text', title: '../../etc/passwd' });
  assert.ok(!name.includes('/') && !name.includes('\\'), `a download name must be one segment: ${name}`);
  assert.match(name, /\.md$/, 'prose downloads as markdown');
  assert.equal(canvasFileName({ docId: 'legacy', kind: 'code', title: '!!!', language: 'python' }), 'document.py');
});

it('maps a language to its real extension and defaults to html', () => {
  assert.equal(codeExtension('TypeScript'), 'ts');
  assert.equal(codeExtension('bash'), 'sh');
  assert.equal(codeExtension('brainfuck'), 'html', 'an unknown language falls back to the code canvas default');
  assert.equal(codeExtension(undefined), 'html');
});

it('collides two documents of the same title deliberately, and only within a chat', () => {
  assert.equal(canvasDocId('Rainy day', 'Photosynthesis Guide', 'text'), canvasDocId('Rainy day', 'Photosynthesis Guide', 'text'));
  assert.notEqual(canvasDocId('Rainy day', 'Guide', 'text'), canvasDocId('Other chat', 'Guide', 'text'));
  assert.match(canvasDocId('Rainy day', 'Photosynthesis Guide', 'text'), /^c_[0-9a-f]{8}_photosynthesis_guide\.md$/);
  assert.match(canvasDocId('Rainy day', '???', 'code', 'python'), /^c_[0-9a-f]{8}_document\.py$/);
});

/* ------------------------------------------------------------------ the versions */

it('clamps a stale version rather than rendering nothing', () => {
  const doc = { versions: [{}, {}, {}] };
  assert.equal(clampVersion(doc, 9), 2, 'stepping past the newest must hold at the newest');
  assert.equal(clampVersion(doc, -1), 0);
  assert.equal(clampVersion({ versions: [{}] }, 0), 0);
});
