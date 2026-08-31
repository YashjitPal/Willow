/**
 * Canvas history on disk: one full document plus reverse patches.
 *
 * Executed, not read — this is the one part of the feature where a wrong answer
 * destroys the user's writing rather than mislaying a pixel. The properties that
 * matter are all round trips, and each test below is one of them:
 *
 *  - **encode → decode is the identity.** Every version, every document.
 *  - **The newest text is never derived.** It is stored whole, so a corrupted
 *    patch costs history and never the document the user is working in.
 *  - **A file with no patches decodes.** Chats written before this existed, and
 *    anything the turn runner's mid-turn checkpoint writes, hold full content.
 *  - **A broken link stops there.** Older versions go missing, nothing is
 *    invented, and the versions after it survive.
 */
import { it } from 'node:test';
import assert from 'node:assert';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { importTs } from './ts-module.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const chatSrc = (...parts) => path.join(here, '..', '..', '..', 'features', 'chat', 'src', ...parts);

const {
  applyCanvasPatch,
  decodeCanvasHistory,
  diffCanvasText,
  encodeCanvasHistory,
} = await importTs(chatSrc('canvas', 'canvas-diff.ts'));

const ref = (content, extra) => ({
  docId: 'c_1_page.html',
  kind: 'code',
  title: 'Page',
  index: 0,
  content,
  ...extra,
});

const turn = (id, refs) => ({ id, role: 'assistant', content: 'Here you go.', canvasRefs: refs });

/** Every (ref, field) text in a message list, oldest first, as the fold sees them. */
const texts = (messages) => messages.flatMap((message) => (message.canvasRefs ?? []).flatMap((r) => [
  ...(typeof r.originalContent === 'string' ? [r.originalContent] : []),
  ...(typeof r.content === 'string' ? [r.content] : []),
]));

const LONG = Array.from({ length: 400 }, (_, i) => `line ${i}`).join('\n');
const LONG_EDITED = LONG.replace('line 200', 'line 200 — changed').concat('\nline 400');

/* ------------------------------------------------------------- the primitives */

it('round trips a patch over an edit in the middle of a document', () => {
  const patch = diffCanvasText(LONG, LONG_EDITED);
  assert.equal(applyCanvasPatch(LONG, patch), LONG_EDITED);
  /* The head and tail are matched before anything else, so a one-line change in a
     400-line file is a handful of ops rather than a rewrite. */
  assert.ok(patch.length <= 6, `expected a small patch, got ${patch.length} ops`);
});

it('round trips the empty, the identical and the wholly replaced', () => {
  for (const [from, to] of [
    ['', ''],
    ['same\n', 'same\n'],
    ['', 'all new\nlines\n'],
    ['gone\n', ''],
    ['a\nb\nc\n', 'x\ny\nz\n'],
    ['trailing\n', 'trailing'],
  ]) {
    assert.equal(applyCanvasPatch(from, diffCanvasText(from, to)), to, `${JSON.stringify(from)} -> ${JSON.stringify(to)}`);
  }
});

it('refuses a patch that does not fit instead of guessing', () => {
  const patch = diffCanvasText('a\nb\nc\n', 'a\nB\nc\n');
  assert.equal(applyCanvasPatch('completely different\n', patch), null, 'a wrong base must not half-apply');
  assert.equal(applyCanvasPatch('a\nb\nc\n', 'not a patch'), null);
  assert.equal(applyCanvasPatch('a\n', [['?', 1]]), null, 'an unknown op is a refusal, not a skip');
  assert.equal(applyCanvasPatch('a\n', [['=', 99]]), null, 'and so is running off the end');
});

/* --------------------------------------------------------------- the encoding */

it('keeps the newest text whole and turns every older one into a patch', () => {
  const messages = [
    turn('m0', [ref('<h1>one</h1>\n')]),
    turn('m1', [ref('<h1>one</h1>\n<p>two</p>\n')]),
    turn('m2', [ref('<h1>one</h1>\n<p>two</p>\n<p>three</p>\n')]),
  ];
  const encoded = encodeCanvasHistory(messages);

  assert.equal(encoded[2].canvasRefs[0].content, '<h1>one</h1>\n<p>two</p>\n<p>three</p>\n', 'the live document is stored verbatim');
  for (const index of [0, 1]) {
    assert.equal(encoded[index].canvasRefs[0].content, undefined, `revision ${index} is a patch now`);
    assert.ok(Array.isArray(encoded[index].canvasRefs[0].contentPatch), `revision ${index} carries one`);
  }
  assert.deepEqual(texts(decodeCanvasHistory(encoded)), texts(messages), 'and it all comes back');
});

it('leaves the input alone', () => {
  const messages = [turn('m0', [ref('a\n')]), turn('m1', [ref('b\n')])];
  const before = JSON.stringify(messages);
  encodeCanvasHistory(messages);
  assert.equal(JSON.stringify(messages), before, 'the array being saved is still the array in React state');
});

it('chains each document separately', () => {
  const messages = [
    turn('m0', [ref('a1\n', { docId: 'doc-a' }), ref('b1\n', { docId: 'doc-b' })]),
    turn('m1', [ref('a2\n', { docId: 'doc-a' })]),
    turn('m2', [ref('b2\n', { docId: 'doc-b' })]),
  ];
  const encoded = encodeCanvasHistory(messages);
  assert.equal(encoded[0].canvasRefs[0].content, undefined, 'doc-a m0 is behind doc-a m1');
  assert.equal(encoded[1].canvasRefs[0].content, 'a2\n', 'doc-a\'s newest is whole even though doc-b\'s is later');
  assert.equal(encoded[0].canvasRefs[1].content, undefined, 'doc-b m0 is behind doc-b m2');
  assert.equal(encoded[2].canvasRefs[0].content, 'b2\n', 'doc-b m2 is doc-b\'s newest');
  assert.deepEqual(texts(decodeCanvasHistory(encoded)), texts(messages));
});

/*
 * A hand-edited ref holds two texts — what the model wrote and what the user typed
 * — and they are two links of the same chain, in that order.
 */
it('chains both halves of a hand-edited ref', () => {
  const messages = [
    turn('m0', [ref('v1\n')]),
    turn('m1', [ref('mine\n', { originalContent: 'v2\n', editedAt: 111 })]),
  ];
  const encoded = encodeCanvasHistory(messages);
  assert.equal(encoded[1].canvasRefs[0].content, 'mine\n', 'the user\'s text is the newest');
  assert.equal(encoded[1].canvasRefs[0].originalContent, undefined);
  assert.ok(Array.isArray(encoded[1].canvasRefs[0].originalPatch), 'the model\'s half is a patch off it');
  assert.ok(Array.isArray(encoded[0].canvasRefs[0].contentPatch));
  const decoded = decodeCanvasHistory(encoded);
  assert.deepEqual(texts(decoded), ['v1\n', 'v2\n', 'mine\n']);
  assert.equal(decoded[1].canvasRefs[0].editedAt, 111, 'and the stamp rides along');
});

/* --------------------------------------------------------------- the decoding */

it('decodes a file that was never encoded', () => {
  const messages = [turn('m0', [ref('a\n')]), turn('m1', [ref('b\n')])];
  assert.deepEqual(texts(decodeCanvasHistory(messages)), ['a\n', 'b\n'], 'every old chat on disk looks like this');
});

it('stops at a broken link rather than inventing a revision', () => {
  const encoded = encodeCanvasHistory([
    turn('m0', [ref('one\n')]),
    turn('m1', [ref('one\ntwo\n')]),
    turn('m2', [ref('one\ntwo\nthree\n')]),
  ]);
  /* Corrupt the middle patch, as a hand-edited or truncated file would. */
  encoded[1].canvasRefs[0].contentPatch = [['=', 99]];
  const decoded = decodeCanvasHistory(encoded);

  assert.equal(decoded[2].canvasRefs[0].content, 'one\ntwo\nthree\n', 'the live document is untouched');
  assert.equal(decoded[1].canvasRefs[0].content, undefined, 'the broken revision is dropped, not guessed');
  assert.equal(decoded[0].canvasRefs[0].content, undefined, 'and so is everything behind it');
});

it('drops the patch fields on the way in', () => {
  const encoded = encodeCanvasHistory([turn('m0', [ref('a\n')]), turn('m1', [ref('b\n')])]);
  const decoded = decodeCanvasHistory(encoded);
  for (const message of decoded) {
    assert.equal(message.canvasRefs[0].contentPatch, undefined, 'nothing carries a patch into memory');
    assert.equal(message.canvasRefs[0].originalPatch, undefined);
  }
});

it('survives the shapes a hand-edited file can hold', () => {
  assert.deepEqual(decodeCanvasHistory(null), null);
  assert.deepEqual(decodeCanvasHistory([null, 7, {}, { canvasRefs: 'nope' }]), [null, 7, {}, { canvasRefs: 'nope' }]);
  assert.deepEqual(encodeCanvasHistory([{ canvasRefs: [null, { docId: 5 }] }]), [{ canvasRefs: [null, { docId: 5 }] }]);
});

/*
 * The point of the exercise: seven revisions of one document used to be seven
 * copies in every save.
 */
it('is dramatically smaller than seven copies', () => {
  const revisions = Array.from({ length: 7 }, (_, i) => (
    `${LONG}\n<!-- revision ${i} -->\n`
  ));
  const messages = revisions.map((content, i) => turn(`m${i}`, [ref(content)]));
  const plain = JSON.stringify(messages).length;
  const encoded = JSON.stringify(encodeCanvasHistory(messages)).length;
  assert.ok(encoded * 4 < plain, `expected a large saving, got ${encoded} vs ${plain}`);
  assert.deepEqual(texts(decodeCanvasHistory(encodeCanvasHistory(messages))), texts(messages));
});
