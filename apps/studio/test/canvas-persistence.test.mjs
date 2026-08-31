/**
 * The in-memory ⇄ on-disk contract for Canvas documents, executed.
 *
 * This is the half of the original bug that left four saved chats with no
 * `canvasRefs` key at all. The ref is the document's ONLY copy — the version
 * history is the fold over surviving messages — so a serializer that drops the
 * field, or a save filter that discards a card-only turn, deletes the user's
 * writing outright and no error is raised anywhere.
 *
 * `canvas-refs-plumbing.test.mjs` asserts the shape of that code as text. This
 * file runs it: a message with refs goes through `serializeChatMessage`, a real
 * `JSON.stringify`/`parse` (the actual disk boundary), and back through
 * `sanitizeSavedCanvasRefs`, and the documents must come out the far side intact
 * enough for `buildCanvasDocs` to fold them into the same versions.
 */
import { it } from 'node:test';
import assert from 'node:assert';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { importTs } from './ts-module.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const chatSrc = (...parts) => path.join(here, '..', '..', '..', 'features', 'chat', 'src', ...parts);

const {
  hasSavedMessageContent,
  sanitizeSavedCanvasRefs,
  serializeChatMessage,
} = await importTs(chatSrc('chat-message.ts'));
const { buildCanvasDocs } = await importTs(chatSrc('canvas', 'canvas-store.ts'));

/** A settled assistant turn that wrote one document. */
const REF = {
  docId: 'doc-rain',
  kind: 'text',
  title: 'Rain',
  index: 12,
  content: '# Rain\n\nSoft rain on the window.\n',
};

const messageWith = (refs, extra = {}) => ({
  id: 'msg-0',
  role: 'assistant',
  content: 'Here you go.',
  canvasRefs: refs,
  ...extra,
});

/** Everything a save actually does to a message, in order. */
const throughDisk = (message) => {
  const saved = JSON.parse(JSON.stringify(serializeChatMessage(message)));
  return {
    saved,
    loaded: sanitizeSavedCanvasRefs(saved.canvasRefs, (saved.content || '').length),
  };
};

/* --------------------------------------------------------------- round trip */

it('carries a document through a save and back unchanged', () => {
  const { saved, loaded } = throughDisk(messageWith([REF]));
  assert.ok(saved.canvasRefs, 'the serializer must not drop the key — this is the bug');
  assert.deepEqual(loaded, [REF]);
});

it('keeps every version of a document across the whole thread', () => {
  const second = { ...REF, index: 4, content: '# Rain\n\nSoft rain, and the city goes quiet.\n' };
  const log = [messageWith([REF]), messageWith([second], { id: 'msg-1' })]
    .map((message, order) => {
      const { saved, loaded } = throughDisk(message);
      return { ...saved, id: `msg-${order}`, canvasRefs: loaded };
    });

  const doc = buildCanvasDocs(log).get('doc-rain');
  assert.ok(doc, 'the fold found no document after a round trip');
  assert.deepEqual(doc.versions.map((v) => v.content), [REF.content, second.content]);
  assert.equal(doc.lastTouchedIndex, 1);
});

it('strips the runtime-only flags without touching the refs', () => {
  const { saved } = throughDisk(messageWith([REF], { isGenerating: true, isNew: true, errorDetail: 'boom' }));
  assert.equal(saved.isGenerating, undefined);
  assert.equal(saved.isNew, undefined);
  assert.equal(saved.errorDetail, undefined);
  assert.equal(saved.canvasRefs.length, 1, 'the strip is a rest spread, so a new field must survive it');
});

/* ------------------------------------------------------------ what is saved */

/*
 * A turn whose only output is a document. Gemini writes one when the reply is
 * the canvas itself, and the pre-fix filter — text or attachments only —
 * discarded the whole message, taking the document with it.
 */
it('saves a turn whose only content is a document', () => {
  assert.equal(hasSavedMessageContent({ content: '', canvasRefs: [REF] }), true);
  assert.equal(hasSavedMessageContent({ content: '   ', canvasRefs: [] }), false, 'an empty array is not content');
  assert.equal(hasSavedMessageContent({ content: '' }), false);
});

/* -------------------------------------------------------- reading back junk */

/*
 * The chat file is user-editable and predates the field, so every entry is
 * re-checked. A ref with no `content` is nothing to render and an empty version
 * in the history; a ref with no `docId` is worse than useless, because minting
 * one would fork one document's revisions into a document per revision.
 */
it('drops a ref with no content and one with no id, and never mints an id', () => {
  const loaded = sanitizeSavedCanvasRefs([
    { docId: 'doc-a', content: '' },
    { docId: '', content: 'orphaned text' },
    { content: 'no id at all' },
    REF,
  ]);
  assert.deepEqual(loaded, [REF], 'only the sound ref survives');
});

it('clamps a bad offset rather than discarding the writing', () => {
  const [far] = sanitizeSavedCanvasRefs([{ ...REF, index: 9999 }], 20);
  assert.equal(far.index, 20, 'a card in the wrong place still opens the right document');
  const [negative] = sanitizeSavedCanvasRefs([{ ...REF, index: -3 }], 20);
  assert.equal(negative.index, 0);
  const [missing] = sanitizeSavedCanvasRefs([{ docId: 'd', content: 'x' }], 20);
  assert.equal(missing.index, 0, 'an absent offset is the start of the reply, not NaN');
});

it('defaults a missing title per kind, since the header and the filename read it', () => {
  const [text] = sanitizeSavedCanvasRefs([{ docId: 'd', content: 'x' }]);
  assert.equal(text.kind, 'text', 'anything but "code" is prose');
  assert.equal(text.title, 'Untitled document');
  const [code] = sanitizeSavedCanvasRefs([{ docId: 'd', kind: 'code', content: 'x', title: '  ' }]);
  assert.equal(code.title, 'Untitled code');
});

it('keeps a language only where it means something', () => {
  const [code] = sanitizeSavedCanvasRefs([{ docId: 'd', kind: 'code', content: 'x', language: 'python' }]);
  assert.equal(code.language, 'python');
  const [prose] = sanitizeSavedCanvasRefs([{ docId: 'd', kind: 'text', content: 'x', language: 'python' }]);
  assert.equal('language' in prose, false, 'a prose document with a language would offer Preview');
});

it('reads a missing or malformed array as absent, not as an empty document list', () => {
  assert.equal(sanitizeSavedCanvasRefs(undefined), undefined);
  assert.equal(sanitizeSavedCanvasRefs('[]'), undefined);
  assert.equal(sanitizeSavedCanvasRefs([{ docId: 'd', content: '' }]), undefined, 'all-dropped is absent');
});
